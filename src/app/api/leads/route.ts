import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { leadSchema, zodFieldErrors } from "@/lib/validators";
import { badRequest, jsonOk, serverError } from "@/lib/api";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { emailService } from "@/lib/email";

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

// PUBLIC "request a demo / free trial" capture from the marketing landing page.
// No auth. Rate-limited per IP to stop spam/abuse. Stored for the operator to
// review in the Operator Panel.
export async function POST(req: NextRequest) {
  try {
    const limited = rateLimit(`lead:${clientIp(req)}`, 5, 60 * 60_000); // 5 / hour
    if (!limited.ok) {
      return NextResponse.json(
        { error: "Çok fazla istek. Lütfen biraz sonra tekrar deneyin." },
        { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
      );
    }

    const data = await req.json().catch(() => null);
    // Honeypot: a hidden "website" field that only bots fill. Pretend success so
    // the bot doesn't learn it was rejected, but store nothing.
    if (data && typeof (data as { website?: unknown }).website === "string" && (data as { website: string }).website.trim()) {
      return jsonOk({ ok: true }, 201);
    }
    const parsed = leadSchema.safeParse(data);
    if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));

    const name = parsed.data.name.trim();
    const email = parsed.data.email.toLowerCase().trim();
    const phone = parsed.data.phone?.trim() || null;
    const message = parsed.data.message?.trim() || null;

    await prisma.lead.create({
      data: { name, email, phone, message, consentAt: new Date() }, // KVKK: schema enforced consent === true
    });

    // Notify the operator so a demo request is never missed (pull-only before).
    // AWAIT it (Railway is a long-lived server, so this reliably sends before we
    // respond) and LOG failures, so a delivery problem is visible rather than
    // silently swallowed. The DB Lead row above is the source of truth either way.
    const to = process.env.ALERT_EMAIL?.trim();
    if (to) {
      try {
        await emailService.send(
          to,
          `Yeni demo talebi: ${name}`,
          `<p>Yeni bir demo / deneme talebi geldi.</p>
           <p>İsim: ${esc(name)}<br/>
           E-posta: ${esc(email)}${phone ? `<br/>Telefon: ${esc(phone)}` : ""}${
             message ? `<br/>Mesaj: ${esc(message)}` : ""
           }</p>
           <p>Operatör panelindeki "Demo Talepleri" bölümünde de görünür.</p>`,
        );
      } catch (e) {
        console.error("[leads] notification email failed:", e);
      }
    }

    return jsonOk({ ok: true }, 201);
  } catch (err) {
    return serverError(undefined, err);
  }
}
