import "server-only";

import type { SessionPayload } from "@/lib/auth/session";

// ---------------------------------------------------------------------------
// OPERATÖR YETKİSİ — SAF KARAR KATMANI (DB YOK, ÇEREZ YOK, DÖNGÜ YOK).
//
// 🚨 BU MODÜLÜN VAR OLMA SEBEBİ (08-06): `isSuperAdmin` kapısı `requireAuth`'a
// (SAYFA yolu) da eklenmek zorundaydı — API yolu onu 08-01'den beri taşıyordu,
// sayfa yolu taşımıyordu (kod-doğrulanmış açık). Ama `auth/index.ts`'in
// doğrudan `@/lib/admin`'i import etmesi DAİRESEL bir bağ kurdu:
//     auth/index.ts → admin.ts → auth/index.ts
// ve bu ÖLÇÜLDÜ: `exit-impersonation.test.ts`'in 5 testi ANINDA kırıldı
// ("`cookies` was called outside a request scope") — döngü, testin `next/headers`
// mock'unun modül başlatma sırasını bozuyordu. Yani bu bir teori değil, gözlenmiş
// bir arıza.
//
// Çözüm bu deponun KENDİ emsali: `email-core.ts` / `report-error-core.ts` ile
// aynı desen — KARARI, onu kullanan yan etkilerden ayrı bir çekirdeğe koy.
// Buradaki üç fonksiyon YALNIZ oturum nesnesine ve env'e bakar; `prisma`,
// `cookies`, `audit` hiçbirine dokunmaz → hiçbir modül döngüsü üretemez.
//
// ⚠️ `admin.ts` bunları AYNEN RE-EXPORT eder, yani mevcut 13 çağrı yerinin
// hiçbiri değişmez ve "iki farklı isSuperAdmin" riski YOKTUR — tek gövde var.
// ---------------------------------------------------------------------------

function superAdminEmails(): Set<string> {
  return new Set(
    (process.env.SUPERADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * The REAL operator email behind a session: the impersonator when entering a
 * customer org, otherwise the session's own email. Super-admin status is always
 * judged on THIS, so an operator keeps their powers while impersonating.
 */
export function actorEmail(session: SessionPayload): string {
  return (session.actorEmail ?? session.email).toLowerCase();
}

/**
 * True when the (real) operator behind this session is a configured super-admin
 * AND this session actually passed a second factor.
 *
 * ⚠️ İKİ KOŞUL, İKİSİ DE GEREKLİ (08-05). Airbnb partner şartı: "your
 * organization must ensure that its personnel use multi-factor authentication
 * to access the API Client, Scopes and Content". Bugüne kadar 2FA tamamen
 * opt-in'di, yani `SUPERADMIN_EMAILS`'teki bir hesap YALNIZ ŞİFREYLE her müşteri
 * org'una impersonation ile girebiliyordu.
 *
 * ⚠️ KAPI BURADA, ÇAĞIRANLARDA DEĞİL. 14 çağrı yeri var (6 admin rotası +
 * `requireSession` + `requireAuth` + 3 Hospitable rotası + 3 sayfa). Ayrı bir
 * `superAdminAllowed()` eklemek "biri unutulur" sınıfına girerdi; bu repo o
 * dersi `api-route-scoping.test.ts` ile zaten ödedi. Tek boğaz noktası.
 *
 * ⚠️ GİRİŞİ ENGELLEMEZ — kasten. Kapı yalnız YETKİYİ tutar; 2FA'sız bir
 * operatör normal owner olarak girer ve panelini kullanır. Girişi engelleyen bir
 * tasarım, authenticator'ını kaybeden TEK operatörü kendi ürününden kilitlerdi
 * ve kurtarma yolu (`admin/reset-2fa`) zaten superadmin oturumu istiyor →
 * dairesel kilit. Acil durumda `SUPERADMIN_EMAILS`'ten e-postayı çıkarmak
 * (Railway = ayrı kimlik bilgisi) hesabı normal owner'a düşürür.
 *
 * ⚠️ `mfa` "hesapta 2FA VAR" DEĞİL, "BU OTURUM faktörden GEÇTİ" demek. Fark
 * gerçek: `middleware.ts` çerezi her istekte 14 gün uzattığı için kayıttan önce
 * açılmış oturumlar hiç yeniden doğrulanmıyor, ve `verify-email` şifresiz
 * oturum basabiliyor. İkisi de "hesapta 2FA var" testinden geçerdi.
 */
export function isSuperAdmin(session: SessionPayload | null): boolean {
  if (!session) return false;
  if (session.mfa !== true) return false;
  const emails = superAdminEmails();
  return emails.has(actorEmail(session));
}

/** True when the current session is an operator impersonating a customer org. */
export function isImpersonating(session: SessionPayload | null): boolean {
  return Boolean(session?.actorUserId);
}
