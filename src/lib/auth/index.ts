import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
// ⚠️ `@/lib/admin` DEĞİL, `@/lib/admin-core` — döngü kırıcı. `admin.ts` bu
// modülü import ediyor; oradan almak `auth/index → admin → auth/index` döngüsü
// kurar ve ÖLÇÜLDÜ: `exit-impersonation.test.ts`'in 5 testi anında kırıldı
// (mock sırası bozuluyor). Gerekçe `admin-core.ts` başlığında.
import { isSuperAdmin } from "@/lib/admin-core";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  signSession,
  verifySession,
  type SessionPayload,
} from "@/lib/auth/session";
import {
  TRUSTED_DEVICE_COOKIE,
  TRUSTED_DEVICE_MAX_AGE,
  signTrustedDeviceToken,
  verifyTrustedDeviceToken,
} from "@/lib/auth/trusted-device";

export type { SessionPayload };

/** Read & verify the current session from cookies. Returns null if absent/invalid. */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  return verifySession(token);
}

/** Require a session in a Server Component / Action. Redirects to /login otherwise.
 *  ALSO enforces the session epoch on the PAGE path: the (app) layout checks it,
 *  but a Next.js soft/client navigation does NOT re-run the layout server
 *  component, so without a per-render check a password-reset-invalidated (or
 *  stolen) session could keep READING page data until a full document load.
 *  requireAuth runs on every page-segment render, closing that gap. Fail-OPEN on
 *  the SESSION (never mass-logout on a transient DB blip — the JWT signature is
 *  still valid) but fail-CLOSED on CAPABILITY: if the DB-authoritative role can't
 *  be read, clamp to the least-privileged role so a just-demoted (or stolen-
 *  elevated) token can't render owner/manager-gated views during the outage. */
export async function requireAuth(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect("/login");

  // ⚠️ OPERATÖR YETKİSİ SAYFA YOLUNDA DA YENİDEN DOĞRULANIR (denetim, 08-06).
  //
  // 🚨 KAPATILAN AÇIK: aynı kapı `requireSession`'da (API yolu, `api.ts:54`)
  // 08-01'de eklenmişti ve kendi yorumu amacı AÇIKÇA yazıyor: "Env'den silmek
  // etkili bir iptal aracı olmalı". SAYFA yolu o kapıyı HİÇ taşımıyordu —
  // burası ve `(app)/layout.tsx` yalnız aktörün EPOCH'una bakıyordu. Sonuç:
  // bir e-postayı `SUPERADMIN_EMAILS`'ten silmek `/api/*`'ı 401'liyor ama
  // `/inbox`, `/dashboard`, `/guest-chats`, `/reports` … sayfaları RENDER
  // OLMAYA DEVAM ediyordu ve `session.organizationId` hâlâ MÜŞTERİNİN org'u →
  // misafir adları, mesaj gövdeleri, rezervasyonlar okunabiliyordu. Kişi
  // `/api/admin/exit`'i de çağıramadığı için (o da 401) müşteri org'unda
  // KİLİTLİ ve OKUYABİLİR kalıyordu; middleware her sayfa görüntülemesinde
  // çerezi 14 gün ileri ittiği için pencere kendi kendine kapanmıyordu.
  //
  // ⚠️ Kontrol try/catch'in DIŞINDA çünkü `isSuperAdmin` SAF bir env okuması +
  // string karşılaştırmasıdır (DB'ye GİTMEZ) — aşağıdaki fail-open mantığının
  // kapsamına girmesi yanlış olurdu; bir DB arızası bu kararı etkilemez.
  // ⚠️ Yalnız IMPERSONATION oturumlarını ilgilendirir (`actorUserId` yoksa hiç
  // koşmaz), yani normal müşteri oturumları bu satırdan etkilenmez.
  if (session.actorUserId && !isSuperAdmin(session)) redirect("/api/auth/logout");

  // Epoch check outside try/catch's control flow: redirect() throws NEXT_REDIRECT,
  // which must NOT be swallowed by the fail-open catch below.
  let invalid = false;
  try {
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      // DB-authoritative role/org (see requireSession): a demoted user loses
      // powers on the page path too, not only on API routes.
      select: { sessionEpoch: true, role: true, organizationId: true, twoFactorEnabledAt: true },
    });
    if (!user || user.sessionEpoch !== session.sessionEpoch) invalid = true;
    else {
      session.role = user.role as SessionPayload["role"];
      session.organizationId = user.organizationId;
    }
    let actorRow: { sessionEpoch: number; twoFactorEnabledAt: Date | null } | null = null;
    if (!invalid && session.actorUserId && session.actorSessionEpoch !== undefined) {
      // Impersonation: also enforce the real operator's epoch (see requireSession).
      const actor = await prisma.user.findUnique({
        where: { id: session.actorUserId },
        select: { sessionEpoch: true, twoFactorEnabledAt: true },
      });
      if (!actor || actor.sessionEpoch !== session.actorSessionEpoch) invalid = true;
      actorRow = actor;
    }
    // 🚨 `mfa` İDDİASI SAYFA YOLUNDA DA DÜŞER (denetim 08-09, İKİ AJAN DA
    // BLOKLAYICI SAYDI). İlk yazımda düzeltme YALNIZ `requireSession`'daydı,
    // yani API tarafındaydı. Sonuç yarım kalıyordu ve KÖTÜYDÜ: `/admin` sayfası
    // TAM RENDER oluyor (her org, abonelik, 50 lead, 50 denetim satırı — hepsi
    // sunucuda `prisma` ile okunuyor) ama sayfadaki HER DÜĞME 401 dönüyordu.
    // Kurucu için bu, "çalışıyor görünen ama hiçbir şey yapmayan panel" demek.
    // `admin-core.ts` kapının TEK boğaz noktası olmasını açıkça amaçlıyor;
    // yarım uygulamak onu çağıran tarafa göre farklı anlama gelen bir kapıya
    // çevirirdi — üstelik açık kalan taraf en çok çapraz-kiracı veri okuyan taraf.
    // ⚠️ İddia, impersonation'da AKTÖRÜN satırından doğrulanır (yukarıdaki
    // `actor`), değilse kişinin KENDİ satırından. Yalnız AŞAĞI yönde.
    // ⚠️ `factorRow` NULL olabilir: `actorUserId` var ama `actorSessionEpoch`
    // yoksa yukarıdaki aktör okuması hiç koşmaz. O hâlde iddiayı DOĞRULAYAMIYORUZ
    // → fail-safe yön VERMEMEKTİR (aynı boşluk `requireSession`'da da kapatıldı).
    const factorRow = session.actorUserId ? actorRow : user;
    if (!invalid && session.mfa === true && (!factorRow || !factorRow.twoFactorEnabledAt)) {
      session.mfa = false;
    }
    // İddia düştüyse impersonation oturumu ürün içinden çıkamaz hâle gelirdi
    // (`/api/admin/exit` de `requireSession`'a bağlı ve 401 döner) → sayfa
    // yolunda temiz çıkış: logout'a yönlendir. Bu, `SUPERADMIN_EMAILS`
    // kaldırıldığında yukarıda ZATEN yapılan şeyin aynısı.
    if (session.actorUserId && !isSuperAdmin(session)) invalid = true;
  } catch {
    // DB blip: keep the (signature-valid) session alive — no mass-logout — but we
    // could NOT confirm the DB-authoritative role, so fail CLOSED on capability by
    // clamping to the least-privileged role. Manager/owner-gated UI + role-scoped
    // reads stay hidden until the DB recovers and the real role is read back.
    // Super-admin is email+env based (not this role) → intentionally unaffected.
    session.role = "staff";
  }
  if (invalid) redirect("/api/auth/logout");
  return session;
}

export async function setSessionCookie(payload: SessionPayload): Promise<void> {
  const token = await signSession(payload);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  // Overwrite-then-expire with the SAME attributes the cookie was set with
  // (notably path:"/"). A bare delete-by-name can fail to clear the cookie
  // behind some proxy/path setups, leaving a valid session alive after logout.
  store.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

/** Mark the current browser as a remembered device for this user (30 days). */
export async function setTrustedDeviceCookie(userId: string, epoch: number): Promise<void> {
  const token = await signTrustedDeviceToken(userId, epoch);
  const store = await cookies();
  store.set(TRUSTED_DEVICE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TRUSTED_DEVICE_MAX_AGE,
  });
}

/** Whether the current browser is a remembered device for this user. Fail-closed. */
export async function hasTrustedDevice(userId: string, epoch: number): Promise<boolean> {
  try {
    const store = await cookies();
    const token = store.get(TRUSTED_DEVICE_COOKIE)?.value;
    return await verifyTrustedDeviceToken(token, userId, epoch);
  } catch {
    return false;
  }
}
