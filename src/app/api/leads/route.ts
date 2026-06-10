import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { leadSchema, zodFieldErrors } from "@/lib/validators";
import { badRequest, jsonOk, serverError } from "@/lib/api";
import { rateLimit, clientIp } from "@/lib/rate-limit";

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

    await prisma.lead.create({
      data: {
        name: parsed.data.name.trim(),
        email: parsed.data.email.toLowerCase().trim(),
        phone: parsed.data.phone?.trim() || null,
        message: parsed.data.message?.trim() || null,
        consentAt: new Date(), // KVKK: schema enforced consent === true
      },
    });

    return jsonOk({ ok: true }, 201);
  } catch {
    return serverError();
  }
}
