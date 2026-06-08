import { prisma } from "@/lib/db";
import { emailService } from "@/lib/email";
import { requireSession, unauthorized, badRequest, jsonOk, serverError, tooManyRequests } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// Send a TEST alert email to ALERT_EMAIL so the host can verify the SMTP setup
// (host/user/app-password) actually works — without waiting for a real
// complaint. Reports the exact outcome (sent, or the SMTP error).
// ---------------------------------------------------------------------------

export async function POST() {
  const session = await requireSession();
  if (!session) return unauthorized();

  // Sends real SMTP mail — throttle hard so it can't be used to email-bomb.
  const limited = rateLimit(`test-email:${session.userId}`, 5, 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  // Per-tenant: send to THIS org's own alert address, else the env fallback.
  const org = await prisma.organization.findUnique({
    where: { id: session.organizationId },
    select: { alertEmail: true },
  });
  const to = org?.alertEmail?.trim() || process.env.ALERT_EMAIL?.trim();
  if (!to) {
    return badRequest({ _: "Uyarı e-postası ayarlı değil. Önce yukarıdaki alana bir e-posta girin." });
  }

  try {
    const html =
      `<div style="font-family:sans-serif;line-height:1.5">` +
      `<h2>✅ Lixus AI — Test e-postası</h2>` +
      `<p>Bu bir test mesajıdır. Bunu gördüyseniz, acil bildirim e-postalarınız <b>çalışıyor</b> 🎉</p>` +
      `<p>Artık bir misafir şikayet/iade yazdığında bu adrese anında uyarı gelecek.</p>` +
      `<p style="color:#888;font-size:12px">— Lixus AI</p></div>`;

    const result = await emailService.sendReporting(to, "✅ Lixus AI — Test e-postası", html);
    if (result.ok) return jsonOk({ sent: true, to });
    return badRequest({ _: result.error ?? "E-posta gönderilemedi." });
  } catch {
    return serverError();
  }
}
