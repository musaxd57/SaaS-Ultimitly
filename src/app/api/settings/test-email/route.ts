import { prisma } from "@/lib/db";
import { identityEmailShell } from "@/lib/email-shell";
import { reportError } from "@/lib/report-error";
import { emailService } from "@/lib/email";
import { badRequest, jsonOk, tooManyRequests } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { rateLimit } from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// Send a TEST alert email to ALERT_EMAIL so the host can verify the SMTP setup
// (host/user/app-password) actually works — without waiting for a real
// complaint. Reports the exact outcome (sent, or the SMTP error).
// ---------------------------------------------------------------------------

export const POST = withManage(async (session) => {
  // Sends real SMTP mail — throttle hard so it can't be used to email-bomb.
  const limited = await rateLimit(`test-email:${session.userId}`, 5, 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  // Per-tenant: send to THIS org's own alert address, else the env fallback.
  const org = await prisma.organization.findUnique({
    where: { id: session.organizationId },
    select: { alertEmail: true },
  });
  // 🚨 `process.env.ALERT_EMAIL`'E ASLA DÜŞÜLMEZ — GERİ EKLEME.
  // O adres OPERATÖRÜN kişisel adresi. Buraya düşmek iki şey birden yapıyordu:
  // (1) adresi kiracının ekranına basıyordu (yanıt `to` alanını döndürüyor ve
  // `test-email-button.tsx` onu düz metin gösteriyor), (2) herhangi bir
  // müşteriye dakikada 5 kez operatörün kutusuna posta attırma imkânı veriyordu.
  // Deponun kendi kuralı bunu ZATEN iki yerde yasaklıyor — `automation.ts`
  // ("we must NOT fall back to env ALERT_EMAIL: that is the operator's address")
  // ve `guest-chat-alerts.ts` ("never the env ALERT_EMAIL"). Üretim uyarı
  // yollarının ikisi de org sahibinin adresine düşerken bu rota tek istisnaydı.
  const to = org?.alertEmail?.trim();
  if (!to) {
    return badRequest({ _: "Uyarı e-postası ayarlı değil. Önce yukarıdaki alana bir e-posta girin." });
  }

  // ⚠️ ORTAK KABUK KULLANILIR — elle inline HTML YAZILMAZ. Bu mail eskiden
  // kendi HTML'ini kuruyordu ve ürünün geri kalanına benzemiyordu; "test
  // mesajıdır 🎉" tonu, host'un gördüğü ilk teknik e-postayı debug artığı gibi
  // gösteriyordu. Özellik KALDIRILMADI çünkü işlevi gerçek: alarm boru hattının
  // çalıştığını GERÇEK bir şikayet gelmeden önce kanıtlıyor. Değişen tek şey,
  // artık ürün gibi görünmesi ve ne olduğunu düz anlatması.
  const html = identityEmailShell({
    heading: "Acil bildirim adresiniz çalışıyor",
    intro:
      "Bu adres Lixus AI'da <strong style=\"color:#0f172a\">acil bildirim adresi</strong> olarak kayıtlı. Bir misafir şikayet, iade ya da güvenlik konusu yazdığında uyarı buraya gelecek.",
    footnote:
      "Bu mesajı Ayarlar &rsaquo; Bağlantılar'daki &ldquo;Test e-postası gönder&rdquo; düğmesi oluşturdu. Adresi istediğiniz zaman aynı yerden değiştirebilirsiniz.",
  });

  const result = await emailService.sendReporting(to, "Lixus AI — Acil bildirim adresi doğrulandı", html);
  if (result.ok) return jsonOk({ sent: true, to });
  // ⚠️ HAM SAĞLAYICI METNİ KİRACIYA GİTMEZ. `result.error` çevrilmemiş
  // Resend/nodemailer çıktısıdır ve posta altyapısının host/port bilgisini
  // (`getaddrinfo ENOTFOUND <host>`, `connect ECONNREFUSED <ip>:<port>`, ham SMTP
  // 5xx) sızdırır. Hospitable tarafında 08-06'da kapatılan sınıfın e-posta eşi.
  void reportError("settings.test_email", new Error(result.error ?? "email send failed"));
  return badRequest({
    _: "Test e-postası şu anda gönderilemedi. Birkaç dakika sonra tekrar deneyin.",
  });
});
