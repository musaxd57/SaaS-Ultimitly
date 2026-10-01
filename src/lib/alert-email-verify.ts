import { createHmac, timingSafeEqual } from "crypto";
import { identityEmailShell, plainLinkFallback } from "@/lib/email-shell";

// ---------------------------------------------------------------------------
// UYARI ADRESİ DOĞRULAMASI (kurucu kararı 09-30, seçim "Doğrulama bağlantısı"; bayrak `ALERT_EMAIL_VERIFY_ENABLED`,
// varsayılan KAPALI — ilk gerçek deneme kurucuyla birlikte).
//
// Uyarı adresi bugün yalnız bu işletmedeki bir kullanıcının e-postası olabilir (açık e-posta rölesi kapatıldı: konu ve
// gövde müşteri kontrolünde, adres serbest olsaydı alan adımızdan üçüncü kişilere metin gönderilirdi). Ekip dışı bir
// adres ancak O ADRESİN SAHİBİ onaylarsa kaydedilir:
//   · Ayarlarda ekip dışı adres → adres KAYDEDİLMEZ; o adrese imzalı, 24 saat geçerli bir bağlantı gider.
//   · E-posta KİŞİSELLEŞTİRİLMEZ (işletme adı, kullanıcı metni yok): kimse bu yolla başkasına kendi yazdığı metni
//     gönderemez; gönderim günlük tavanlıdır (işletme başına ve alıcı başına).
//   · Belirteç parçada (`#t=`) → sunucu kayıtlarına / Referer'a girmez; e-posta tarayıcılarının bağlantıyı otomatik
//     açması onay DEĞİLDİR (sayfa açık bir "Onayla" tıklaması + POST ister).
//   · Belirteç istek anındaki eski adrese BAĞLIDIR (CAS): arada adres değiştiyse eski bağlantı geçersizdir — tekrar
//     kullanılan bir bağlantı sonradan seçilmiş başka bir adresi geri alamaz.
//   · 🚨 CAS TEK BAŞINA YETMİYORDU (15 ajan A13 F2, 10-01): adres belirtecin "eski adres" değerine DÖNÜNCE (dış adresi kaldırıp
//     boşaltmak = varsayılan) son 24 saatin her bağlantısı yeniden geçerli oluyordu — kaldırılan dış alıcı aynı bağlantıyı açıp
//     sessizce yeniden uyarı alıcısı olabiliyordu. Belirteç artık işletmenin uyarı adresi KUŞAĞINI taşır (`alert-email-generation.ts`,
//     `SystemLock`'ta sayaç): her yeni istek ve her doğrudan adres değişikliği kuşağı artırır, onay onu tüketir.
// Migration YOK (imza + `SystemLock` sayacı).
// ---------------------------------------------------------------------------

export const ALERT_EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
/** İmza alanı ayrımı: aynı `AUTH_SECRET` ile imzalanan başka bir belirteç (ör. plan değişikliği) burada geçmez. */
const DOMAIN = "lixus/alert-email-verify/v1";

export function alertEmailVerifyEnabled(): boolean {
  return process.env.ALERT_EMAIL_VERIFY_ENABLED === "1";
}

export interface AlertEmailClaim {
  organizationId: string;
  email: string;
  /** İstek anındaki kayıtlı uyarı adresi (yoksa null) — onayda karşılaştırılır. */
  previous: string | null;
  /**
   * İşletmenin uyarı adresi KUŞAĞI (`alert-email-generation.ts`; 15 ajan A13 F2): her yeni doğrulama isteği ve her doğrudan adres
   * değişikliği kuşağı artırır, onay onu TÜKETİR → bağlantı tek kullanımlık, en son istek geçerli; adres eski değerine dönünce
   * (kaldırma / temizleme) eski bağlantılar yeniden geçerli OLMAZ.
   */
  generation: number;
}

type Payload = { p: "alert-email"; o: string; e: string; v: string | null; g: number; x: number };

function secret(): string {
  return process.env.AUTH_SECRET ?? "";
}

function mac(body: string): string {
  return createHmac("sha256", secret()).update(`${DOMAIN}.${body}`).digest("base64url");
}

/** İmzalı belirteç; sır tanımlı değilse `null` (akış kapalı kalır — imzasız belirteç asla üretilmez). */
export function signAlertEmailToken(claim: AlertEmailClaim, now: Date = new Date()): string | null {
  if (!secret()) return null;
  const payload: Payload = {
    p: "alert-email",
    o: claim.organizationId,
    e: claim.email,
    v: claim.previous,
    g: claim.generation,
    x: now.getTime() + ALERT_EMAIL_VERIFY_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${mac(body)}`;
}

/** İmza + süre + biçim; geçersizse `null` (sebep söylenmez). */
export function verifyAlertEmailToken(token: unknown, now: Date = new Date()): AlertEmailClaim | null {
  if (!secret() || typeof token !== "string" || token.length > 2_000) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(mac(body));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let payload: Partial<Payload>;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<Payload>;
  } catch {
    return null;
  }
  if (
    !payload ||
    payload.p !== "alert-email" ||
    typeof payload.o !== "string" ||
    payload.o.length === 0 ||
    typeof payload.e !== "string" ||
    payload.e.length === 0 ||
    !(payload.v === null || typeof payload.v === "string") ||
    typeof payload.g !== "number" ||
    !Number.isSafeInteger(payload.g) ||
    payload.g < 1 ||
    typeof payload.x !== "number" ||
    now.getTime() > payload.x
  ) {
    return null;
  }
  return { organizationId: payload.o, email: payload.e, previous: payload.v, generation: payload.g };
}

/**
 * Doğrulama e-postası — KİŞİSELLEŞTİRİLMEZ (işletme adı / kullanıcı metni yok; kayıt doğrulamasıyla aynı kural).
 * Yalnız sabit metin + bağlantı.
 */
export function alertEmailVerifyHtml(url: string): string {
  return identityEmailShell({
    heading: "Uyarı adresinizi doğrulayın",
    intro:
      "Bu e-posta adresi bir Lixus AI hesabında misafir uyarılarının gönderileceği adres olarak girildi. Onaylıyorsanız aşağıdaki butona tıklayın.",
    action: { label: "Adresi onayla", url },
    footnote: `${plainLinkFallback(url)}<br><br>Bu bağlantı <strong>24 saat</strong> geçerlidir. Bu isteği siz yapmadıysanız bu e-postayı yok sayabilirsiniz: onaylamazsanız adres eklenmez.`,
  });
}

export const ALERT_ADDRESS_VERIFY_SUBJECT = "Lixus AI uyarı adresi doğrulaması";
