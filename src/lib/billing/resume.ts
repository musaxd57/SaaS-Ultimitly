import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/db";
import { planByCode } from "./plans";
import { getSubscriptionCurrentPriceId, getSubscriptionStatus, paddlePriceToPlanCode } from "@/lib/payments/paddle";

// ---------------------------------------------------------------------------
// I4 C (kurucu 10-17: "şimdi A; sonra KESİNLİKLE C — tıklanınca hemen ödeme alınsın, pakete dönsün"; C1 onay penceresi + küçük yazı,
// C2 bütün paketler görünsün, C3 kartsız hesap ödeme ekranından). DURAKLATILMIŞ Paddle aboneliğini uygulamadan HEMEN devam ettir.
// Anahtar `PADDLE_RESUME_ENABLED` KAPALI (rotalar 404); açma = kurucu + sandbox'ta ilk denemeler birlikte (P6–P8,
// `docs/TASARIM-2026-10-17-paddle-devam-ettir-ve-kartla-deneme.md`).
// Kurallar: yalnız `paused` + Paddle + abonelik kimliği dolu. Devam ettirilen paket aboneliğin KENDİ fiyatıdır (aylık / yıllık aynen);
// başka paket istenirse önce devam, sonra bugünkü paket değiştirme penceresi (tutar önizlemeli) — Paddle duraklatılmış abonelikte paket
// değişikliğine izin veriyorsa (P3) tek adıma indirilir. Onay → apply bağı paket değiştirmeyle aynı desen: HMAC imzalı, 10 dk, TEK
// kullanımlık önizleme belirteci (tutar bağlı, apply'da yeniden önizlenir) + kuruluş başına "işleniyor" kilidi.
// ---------------------------------------------------------------------------

export function resumeEnabled(): boolean {
  return process.env.PADDLE_RESUME_ENABLED === "1";
}

export type ResolvedResume =
  | {
      ok: true;
      providerRef: string;
      customerId: string;
      priceId: string;
      planCode: string;
      planName: string;
      annual: boolean;
    }
  | { ok: false; error: string };

/** Devam ettirilebilir mi + Paddle çağrısının ihtiyaç duyduğu her şey. Kuruluş kimliği OTURUMDAN (çağıran) → başka kuruluş hedeflenemez. */
export async function resolveResume(organizationId: string): Promise<ResolvedResume> {
  const sub = await prisma.subscription.findUnique({
    where: { organizationId },
    select: { provider: true, providerRef: true, status: true, planCode: true, customerId: true },
  });
  if (!sub || sub.provider !== "paddle" || !sub.providerRef) {
    return { ok: false, error: "Yönetilecek bir aboneliğiniz bulunamadı. Bir plan seçerek abonelik başlatabilirsiniz." };
  }
  if (sub.status !== "paused") {
    return {
      ok: false,
      error:
        sub.status === "canceled"
          ? "Aboneliğiniz iptal edilmiş. Bir paket seçerek yeni abonelik başlatabilirsiniz."
          : "Aboneliğiniz zaten etkin.",
    };
  }
  // Fiyat Paddle'dan (yerelde dönem / fiyat kolonu yok): aylık ise aylık, yıllık ise yıllık AYNEN devam eder. Okunamazsa / katalog dışıysa
  // KAPALI yön (yanlış paket / dönemle para çekilmez).
  const priceId = await getSubscriptionCurrentPriceId(sub.providerRef);
  const planCode = priceId ? paddlePriceToPlanCode(priceId) : null;
  if (!priceId || !planCode) {
    return { ok: false, error: "Paketiniz şu anda doğrulanamadı. Birkaç dakika sonra tekrar deneyin ya da bize yazın." };
  }
  // Paddle'daki GERÇEK durum (Haiku 10-17): yerel satır yalnız webhook'la güncellenir; webhook kaybolursa yerel "paused" kalırken Paddle'da
  // abonelik etkin olabilir → yerel duruma güvenip ikinci kez devam (ikinci tahsilat) denenmesin. Okunamazsa KAPALI yön.
  const live = await getSubscriptionStatus(sub.providerRef);
  if (!live?.status) return { ok: false, error: RESUME_TEXT.statusUnknown };
  if (live.status === "active" || live.status === "trialing") return { ok: false, error: RESUME_TEXT.alreadyActive };
  if (live.status !== "paused") return { ok: false, error: RESUME_TEXT.notResumable };
  // Müşteri kimliği ŞART (Haiku 10-17; tutar artık aboneliğin kendi tekrarlayan önizlemesinden gelse de müşterisiz abonelik tutarsız kayıttır).
  const customerId = sub.customerId ?? live.customerId ?? null;
  if (!customerId) return { ok: false, error: RESUME_TEXT.statusUnknown };
  // Yıllık abone YILLIK devam eder (fiyat aboneliğin kendisinden) → onay metni dönemi söyler (Opus 10-17 A3: liste "₺899 / ay" derken ₺8.990
  // çekilirdi).
  const annualIds = [process.env.PADDLE_PRICE_BASLANGIC_YILLIK, process.env.PADDLE_PRICE_PRO_YILLIK, process.env.PADDLE_PRICE_ISLETME_YILLIK]
    .map((v) => v?.trim())
    .filter((v): v is string => Boolean(v));
  return {
    ok: true,
    providerRef: sub.providerRef,
    customerId,
    priceId,
    planCode,
    planName: planByCode(planCode)?.name ?? planCode,
    annual: annualIds.includes(priceId),
  };
}

// ---------------------------------------------------------------------------
// Önizleme → apply bağı. Paket değiştirme belirtecinden ALAN AYRIMLI (HMAC anahtarına "resume:" öneki): biri ötekinin rotasında geçmez.
// ---------------------------------------------------------------------------

const RESUME_TOKEN_TTL_MS = 10 * 60 * 1000;

export type ResumeTokenPayload = { org: string; priceId: string; amount: string; jti: string; exp: number };

function mac(body: string): string {
  return createHmac("sha256", `resume:${process.env.AUTH_SECRET ?? ""}`).update(body).digest("base64url");
}

export function signResumeToken(p: { org: string; priceId: string; amount: string }): string {
  const payload: ResumeTokenPayload = { ...p, jti: randomBytes(12).toString("base64url"), exp: Date.now() + RESUME_TOKEN_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${mac(body)}`;
}

export function verifyResumeToken(token: string | null | undefined): ResumeTokenPayload | null {
  if (!process.env.AUTH_SECRET || !token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(mac(body));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let p: ResumeTokenPayload;
  try {
    p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ResumeTokenPayload;
  } catch {
    return null;
  }
  if (!p || typeof p.exp !== "number" || Date.now() > p.exp) return null;
  if (typeof p.jti !== "string" || !p.jti || typeof p.amount !== "string" || !p.amount) return null;
  return p;
}

export const RESUME_PENDING_LOCK = (organizationId: string) => `billing-resume-pending:${organizationId}`;

/** Kurucu C1 (10-17): büyük yazı + altında küçük yazıyla tahsilat cümlesi. Tek kaynak (arayüz ve test). */
export function resumeConfirmText(planName: string, amount: string, annual = false): { headline: string; fine: string } {
  return {
    headline: `${planName} planınız hemen açılır.`,
    fine: `${amount} kayıtlı kartınızdan şimdi tahsil edilecek${annual ? " (yıllık ödeme)" : ""}.`,
  };
}

export const RESUME_TEXT = {
  declined: "Ödeme alınamadı. Kart bilgilerinizi güncelleyin.",
  amountUnknown: "Tutar şu anda hesaplanamadı; ödeme alınmadı. Birkaç dakika sonra tekrar deneyin.",
  failed: "Aboneliğiniz devam ettirilemedi; ödeme alınmadı. Lütfen tekrar deneyin, sorun sürerse bize yazın.",
  // Belirsiz sonuç: sonuç VAAT edilmez (ödeme alınmış da olabilir, alınmamış da) — Haiku 10-17.
  pending: "İşleminiz ödeme sağlayıcısına iletildi; sonucu bekleniyor. Birkaç dakika sonra sayfayı yenileyin.",
  statusUnknown: "Aboneliğinizin durumu şu anda doğrulanamadı; ödeme alınmadı. Birkaç dakika sonra tekrar deneyin.",
  alreadyActive: "Aboneliğiniz zaten etkin. Birkaç dakika sonra sayfayı yenileyin.",
  notResumable: "Aboneliğiniz şu anda devam ettirilemiyor. Bize yazın, birlikte halledelim.",
  inProgress: "Önceki işleminiz hâlâ işleniyor. Birkaç dakika sonra sayfayı yenileyin.",
  tokenExpired: "Tutar onayının süresi doldu. Yeniden \"Aboneliği devam ettir\" deyip tutarı tekrar onaylayın.",
  tokenUsed: "Bu onay zaten kullanıldı. Sayfayı yenileyin.",
  amountChanged: "Tutar değişti. Yeni tutarı kontrol edip yeniden onaylayın.",
} as const;
