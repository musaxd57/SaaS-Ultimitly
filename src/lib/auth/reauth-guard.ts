import { rateLimit, rateLimitPeek } from "@/lib/rate-limit";
import { auditActor, writeAudit } from "@/lib/audit";

// ---------------------------------------------------------------------------
// OTURUM İÇİ YENİDEN KİMLİK DOĞRULAMA — GÜNLÜK ORTAK HATA TAVANI (09-23 saldırgan turu).
//
// Girişte oturum zaten açıkken şifre ya da 2FA kodu isteyen ekranlar (2FA kurulumu, 2FA
// kapatma, kurtarma kodu üretme, hesap silme) çalınmış bir oturum için TAHMİN ARACIDIR:
//   · 2FA kurulumu: 10 deneme / 10 dk = günde 1.440 şifre tahmini; doğru tahmin düz metin
//     2FA sırrını verir → saldırgan 2FA'yı kendi uygulamasıyla açıp sahibi dışarıda bırakır.
//   · hesap silme: 5 / 15 dk = günde 480 şifre tahmini; doğru tahmin HESABI SİLER.
//   · 2FA kodu isteyen üç işlem: günde 1.440 kod tahmini (±1 adım penceresiyle ayda ~%12).
// Kısa pencereli kovalar tek başına günlük toplamı sınırlamıyordu. Artık hepsi TEK sayaca
// yazar: kullanıcı başına günde en fazla 20 HATA; tavan dolunca DOĞRU şifre/kod da o gün
// reddedilir (yoksa tavan tahmini durdurmaz, yalnız yavaşlatır).
//
// ⚠️ Girişin günlük sayacından AYRI anahtar: oturumu ele geçiren biri kurbanın GİRİŞ hakkını
// yakamasın. Yalnız HATALAR sayılır; meşru kullanıcı bu sınıra yaklaşmaz, bedeli yalnız
// oturumu ele geçirilmiş hesabın o günkü hesap yönetimi işlemleridir.
// ---------------------------------------------------------------------------

export const REAUTH_DAILY_FAILURES = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Müşteriye giden metin: sade, teknik terim yok. */
export const REAUTH_CAP_MESSAGE =
  "Çok fazla hatalı deneme yapıldı. Güvenliğiniz için bu işlem bir süreliğine durduruldu; lütfen daha sonra tekrar deneyin.";

function reauthKey(userId: string): string {
  return `reauth-fail-day:${userId}`;
}

/** Şifre/kod doğrulamadan ÖNCE sorulur; hak YAKMAZ. */
export function reauthBlocked(userId: string) {
  return rateLimitPeek(reauthKey(userId), REAUTH_DAILY_FAILURES);
}

/** Yeniden doğrulama isteyen işlemler (kapalı küme — denetim kaydının `operation` alanı). */
export type ReauthOperation = "2fa_setup" | "2fa_enable" | "2fa_disable" | "2fa_recovery_codes" | "account_delete";

/**
 * Hatalı (ya da yeniden oynatılan) şifre/kod — günlük tavana sayılır VE denetim kaydına yazılır (DENETIM 08-09 #8: başarılı 2FA /
 * silme işlemleri kayıtlıydı, hatalı deneme yalnız sayaçtaydı → ele geçirilmiş oturumla yapılan tahmin denemeleri iz bırakmıyordu).
 * Kayıt yalnız işlem adını taşır (şifre / kod / değer YOK); bürünmede gerçek aktör operatördür (`auditActor`). Kayıt yazımı asla
 * işlemi durdurmaz (`writeAudit` fırlatmaz).
 */
export async function noteReauthFailure(
  session: { userId: string; organizationId: string; actorUserId?: string | null },
  operation: ReauthOperation,
): Promise<void> {
  await rateLimit(reauthKey(session.userId), REAUTH_DAILY_FAILURES, DAY_MS);
  await writeAudit({
    organizationId: session.organizationId,
    actorUserId: auditActor(session),
    action: "account.reauth_failed",
    metadata: { operation },
  });
}
