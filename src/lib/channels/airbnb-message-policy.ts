// ---------------------------------------------------------------------------
// AIRBNB MESAJ KURALI — platform dışı iletişim (kurucu 10-22, T-d / U1: "o misafire gidecek mesajı airbnb durdurmayacağına emin olalım
// … airbnb bununla ilgili birşey yayınlamış olabilir kontrol et"). Kaynaklar, örnekler ve öğretim seti: `docs/AIRBNB-MESAJ-KURALLARI.md`
// + `evals/airbnb-message-policy.json`.
//
// Bu bir YETENEK kararı DEĞİL (değişmez 20 — gönderilebilirlik kanal etiketinden çıkmaz; `capability.ts`). Misafirin gördüğü kanalın İÇERİK
// kuralıdır: Airbnb telefon / e-posta / bağlantı / sosyal medya içeren mesajı rezervasyon ONAYINDAN önce ve çıkıştan sonraki kısa pencere
// bittikten sonra engeller (Yardım Merkezi 4155 + 147; entegre mesajlaşma için Guesty'nin aktardığı kural: çıkıştan sonra ~1 gün). Engellenen
// mesaj misafire ulaşmaz ve tekrarı hesabı riske atar → kıdemli okuyucu (`semantic/absence-judge.ts`) "platform dışı iletişim" dediğinde
// bu pencerelerde cevap otomatik GİTMEZ, ev sahibinde taslak kalır. Onaylı konaklama süresince iletişim bilgisi serbest (Airbnb de paylaşır).
// Saf; veritabanı yok.
// ---------------------------------------------------------------------------

import { containsContactValue } from "@/lib/contact-redact";

/** Çıkıştan sonra Airbnb'nin iletişim bilgisine izin verdiği pencere (ikinci el kaynak "genelde bir gün" — dar tutulur). */
export const AIRBNB_POST_CHECKOUT_CONTACT_GRACE_MS = 24 * 60 * 60 * 1000;

export interface ContactPolicyConversation {
  channel: string | null | undefined;
  reservation?: { status?: string | null; departureDate?: Date | null } | null;
}

/**
 * Bu konuşmada "platform dışı iletişim" içeren cevap tutulur mu? Yalnız Airbnb kanalında; onaylı (ya da tamamlanmış) rezervasyon yoksa
 * (ön soru, talep, iptal) ya da çıkışın üzerinden bir günden fazla geçtiyse → evet. Çıkış tarihi bilinmiyorsa onaylı konaklama serbest.
 */
export function offPlatformContactHoldsFor(conversation: ContactPolicyConversation, now: Date = new Date()): boolean {
  if (conversation.channel !== "airbnb") return false;
  const status = conversation.reservation?.status;
  if (status !== "confirmed" && status !== "completed") return true;
  const departure = conversation.reservation?.departureDate;
  if (!departure) return false;
  return now.getTime() > departure.getTime() + AIRBNB_POST_CHECKOUT_CONTACT_GRACE_MS;
}

/**
 * İmzanın iletişim satırı bu konuşmada çıkarılır mı (kurucu kararı 4-14-b, 10-28 gece: "Airbnb'de her zaman çıkarılsın … airbnbde kesin varsa
 * hostun teli airbnbde her zaman çıkarılabilir")? Airbnb kanalında HER ZAMAN: Airbnb onaylı rezervasyonda ev sahibinin numarasını rezervasyon
 * ayrıntılarında ve onay e-postasında misafire kendisi gösterir (Yardım Merkezi 4116 + 147); onaydan önce ve konaklamadan sonra zaten engeller
 * (`offPlatformContactHoldsFor`). Airbnb dışı kanalda imza aynen (bugünkü davranış). Kapının TUTMA kuralı (`signature_offplatform_contact`)
 * yine yalnız engelleme penceresinde — bu fonksiyon yalnız temizliği genişletir. Saf.
 */
export function signatureStripsContactFor(conversation: ContactPolicyConversation): boolean {
  return conversation.channel === "airbnb";
}

/**
 * Rezervasyon kanalına göre giden imza (otomatik karşılama / giriş / çıkış ve önizlemeleri; kuyruk işçisi): 4-14-b — Airbnb'de iletişim satırı
 * çıkar, öteki kanalda aynen. Boş → `undefined` (imzasız; `buildGuestMessageBody` sözleşmesi).
 */
export function signatureForChannel(signature: string | null | undefined, channel: string | null | undefined): string | undefined {
  return signatureForContactWindow(signature, signatureStripsContactFor({ channel })) ?? undefined;
}

/** Yalnız iletişim ETİKETİ olan satır ("Tel:", "📞 WhatsApp", "E-posta:") — değeri çıkarılınca tek başına kalırsa kırık satırdır. */
const CONTACT_LABELS = new Set([
  "tel", "telefon", "phone", "telephone", "téléphone", "tél", "mobile", "mobil", "cep", "gsm", "handy", "whatsapp", "eposta", "email",
  "mail", "web", "website", "instagram", "facebook", "telegram", "iletişim", "contact", "kontakt", "телефон",
]);
const lettersOf = (line: string) => line.replace(/[^\p{L}]/gu, "");
const isLabelOnly = (line: string) => {
  const l = lettersOf(line);
  return l.length > 0 && (CONTACT_LABELS.has(l.toLocaleLowerCase("tr")) || CONTACT_LABELS.has(l.toLowerCase()));
};

/**
 * İmza SATIRINDA Airbnb'nin engellediği ama `containsContactValue`in (metin içi yanlış pozitiften kaçınmak için) saymadığı iki biçim (öz-inceleme
 * 10-28): sosyal medya kullanıcı adı ("Instagram: @lalekonaklama" — e-posta değil) ve çıplak alan adı ("lalekonaklama.com", yaygın uzantılar).
 * Yalnız imza satırında okunur: imza satırı cümle değildir, "Lale Apt. 2" / "Kat 2." uzantı listesine girmez.
 */
const SIGNATURE_HANDLE = /(?<![\p{L}\p{N}._%+-])@[\p{L}\p{N}._]{2,30}/u;
const SIGNATURE_BARE_DOMAIN =
  /(?<![\p{L}\p{N}@.\-])[\p{L}\p{N}-]{2,63}(?:\.[\p{L}\p{N}-]{1,63}){0,3}\.(?:com|net|org|info|biz|io|co|me|app|site|online|store|travel|rentals|house|homes|holiday|apartments|villas|tr|de|uk|fr|es|it|nl|ru|eu)(?![\p{L}\p{N}-])/iu;
const isContactLine = (line: string) => containsContactValue(line) || SIGNATURE_HANDLE.test(line) || SIGNATURE_BARE_DOMAIN.test(line);

/**
 * İmza, platform dışı iletişim penceresinde (kurucu kararı 4.14, 10-28: "Telefon satırı çıkarılıp cevap gitsin"). Pencere AÇIKSA
 * (`offPlatformContactHoldsFor`) iletişim değeri (telefon / e-posta / bağlantı, `containsContactValue`; imza satırında ayrıca sosyal medya
 * kullanıcı adı ve çıplak alan adı) taşıyan SATIRLAR çıkarılır, kalan
 * satırlar sırasıyla aynen; o durumda değeri giden etiket / emoji satırı ("📞", "Tel:") da çıkar. Satırın yalnız numarası silinmez:
 * "Bize 0532 … 'den ulaşın" yarım cümle bırakırdı (kurucu: kırık cümle asla) — ad ile numara aynı satırdaysa satırın tamamı gider.
 * Hiç satır kalmazsa `null` (imzasız). Pencere kapalıyken imza AYNEN (onaylı konaklamada iletişim serbest). Satırlara bölünmüş numara
 * satır satır görünmez → çıktı yine iletişim değeri taşıyabilir; gönderim kapısı (`signature_offplatform_contact`) onu TUTAR. Saf.
 */
export function signatureForContactWindow(signature: string | null | undefined, contactHolds: boolean): string | null {
  const sig = signature?.trim();
  if (!sig) return null;
  if (!contactHolds) return sig;
  const lines = sig.split(/\r?\n/);
  const kept = lines.filter((line) => !isContactLine(line));
  if (kept.length === lines.length) return sig;
  const out = kept
    .filter((line) => line.trim() === "" || (/[\p{L}\p{N}]/u.test(line) && !isLabelOnly(line)))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return out || null;
}
