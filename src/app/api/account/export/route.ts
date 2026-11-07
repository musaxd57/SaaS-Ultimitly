import { isImpersonating } from "@/lib/auth/impersonation";
import { NextResponse } from "next/server";
import { badRequest, forbidden, hasJsonContentType, readJsonCappedOrNull, tooManyRequests, unsupportedMediaType } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { buildOrganizationDataExport } from "@/lib/data-export";
import { rateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { noteReauthFailure, reauthBlocked, REAUTH_CAP_MESSAGE } from "@/lib/auth/reauth-guard";
import { emailService } from "@/lib/email";
import { dataExportNoticeEmail } from "@/lib/email-templates";
import { appBaseUrl } from "@/lib/auth/email-verify";
import { formatDateTime } from "@/lib/utils";
import { orgTimezone } from "@/lib/timezone";
import { reportError } from "@/lib/report-error";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// KVKK m.11 SELF-SERVE data access — the HOST exports THEIR OWN organization's
// data (no operator needed). Scoped strictly to session.organizationId. The
// payload comes from the SINGLE-SOURCE allowlist builder shared with the
// operator route (src/lib/data-export.ts) — see there for the exact scope and
// the secrets-exclusion contract; a parity test pins the two routes together.
// ---------------------------------------------------------------------------
// 🚨 U10 (kurucu 10-22: "şifre sorulsun"; 2FA ek kodu YOK — girişte zaten istendi): döküm artık ŞİFREYLE alınır (POST + JSON) ve sahibe
// "verileriniz indirildi" e-postası gider. Eskiden açık bir oturumu olan herkes (ele geçirilmiş çerez, kilitlenmemiş bilgisayar) tek
// tıkla bütün misafir verisini ve takvim bağlantılarını indirebiliyordu, kimse haberdar olmuyordu. Hatalı şifre 2FA / silme ekranlarıyla
// ORTAK günlük tavana sayılır (`reauth-guard.ts`). GET artık YOK (405) — bağlantıyla tetiklenemez.
export const POST = withManage(async (session, req) => {
  // K8 (kurucu kararı 09-28): destek görünümü (bürünme) tüm misafir verisini indiremez.
  if (isImpersonating(session)) return forbidden("Destek görünümünde müşteri verisi dışa aktarılamaz.");
  // Başka siteden form POST'u (text/plain, ön uçuş yok) burada durur — JSON zorunlu (kimlik rotalarıyla aynı kural).
  if (!hasJsonContentType(req)) return unsupportedMediaType();
  // OWNER-ONLY (Codex): the export carries the org's calendar-feed URLs
  // (bearer-like credentials), invoices and consent evidence — manager-level
  // access is not enough for a full-account data handover. withManage already
  // 403s staff; this narrows the remaining manager case.
  // 🚨 SIRA (09-23, güvenlik ajanı): yetki kontrolü KOTADAN ÖNCE. Eskiden kota önce
  // tüketiliyordu ve kova ORG başınaydı → bir yönetici üç 403'lük istekle SAHİBİN KVKK
  // veri dışa aktarımını bir saat kilitleyebiliyordu (depo kuralı: bütçe doğrulamadan
  // SONRA tüketilir).
  if (session.role !== "owner") return forbidden();

  const day = await reauthBlocked(session.userId);
  if (!day.ok) return tooManyRequests(day.retryAfter, REAUTH_CAP_MESSAGE);
  const data = await readJsonCappedOrNull<{ password?: unknown }>(req);
  const password = typeof data?.password === "string" ? data.password : "";
  if (!password) return badRequest({ password: "İndirmek için şifrenizi girin." });
  // Kısa kova ŞİFRE DENEMESİNDEN ÖNCE (silme rotasıyla aynı; Haiku 10-22): günlük ortak tavan yalnız HATADAN sonra sayar, eşzamanlı bir
  // istek patlaması ilk hata yazılana kadar tavanı aşabiliyordu. Boş şifre isteği şifre denemez → sayılmaz.
  const burst = await rateLimit(`account-export-auth:${session.userId}`, 5, 15 * 60_000);
  if (!burst.ok) return tooManyRequests(burst.retryAfter);
  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { passwordHash: true } });
  const passwordOk = user?.passwordHash ? await verifyPassword(password, user.passwordHash) : false;
  if (!passwordOk) {
    await noteReauthFailure(session, "data_export");
    return badRequest({ password: "Şifre hatalı." });
  }

  // Limitsizdi: export tum org verisini TEK string'e yaziyor; esszamanli birkac istek replikayi dusurebilir.
  // Kota şifre DOĞRULANDIKTAN sonra düşer (hatalı şifre sahibin saatlik hakkını yakmaz).
  const limited = await rateLimit(`account-export:${session.organizationId}`, 3, 60 * 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);
  const orgId = session.organizationId;
  const payload = await buildOrganizationDataExport(orgId);
  if (!payload) return forbidden();

  await writeAudit({
    organizationId: orgId,
    actorUserId: session.actorUserId ?? session.userId,
    action: "data.export_self",
    metadata: { email: session.email },
  });

  // Sahibe bilgi e-postası — indirmeyi BEKLETMEZ, düşerse operasyon haber alır (alıcı / içerik kayda yazılmaz). Saat dilimi okuması da
  // arka planda: geçici veritabanı hatası dosyayı 500'e çevirmesin (Haiku 10-22).
  const at = new Date();
  void (async () => {
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { timezone: true } }).catch(() => null);
    const r = await emailService.sendReporting(
      session.email,
      "Lixus AI — Hesap verileriniz indirildi",
      dataExportNoticeEmail(formatDateTime(at, orgTimezone(org?.timezone)), `${appBaseUrl()}/settings?tab=hesap-guvenlik`),
    );
    if (!r.ok) void reportError("account.export_notice", new Error(r.error ?? "email send failed"));
  })().catch((err) => void reportError("account.export_notice", err));

  const safeName = payload.organization.name.replace(/[^a-z0-9]+/gi, "_").slice(0, 40) || "isletme";
  const filename = `lixus-verilerim-${safeName}-${new Date().toISOString().slice(0, 10)}.json`;
  const body = JSON.stringify({ exportedAt: new Date().toISOString(), ...payload }, null, 2);

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Never let a proxy/browser cache a file full of credentials + PII.
      "Cache-Control": "no-store",
    },
  });
});
