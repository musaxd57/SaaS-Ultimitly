import { rateLimit } from "@/lib/rate-limit";
import { tooManyRequests, type SessionPayload } from "@/lib/api";

// ---------------------------------------------------------------------------
// EV SAHİBİ YAZMA HIZ SINIRI (altyapı envanteri 10-21 madde 75, kurucu "olur").
//
// Oturumlu yazma rotalarının (görev, bilgi tabanı, mülk ayarı, QR cevabı …) çoğunda kendi sınırı yoktu. Tek ortak kova: kişi başına
// dakikada HOST_WRITE_LIMIT yazma. Ölçek: en hızlı gerçek kullanım (toplu düzenleme) saniyede bir iki tıklama; 120/dk yalnız bozuk bir
// döngüyü / tarayıcı eklentisini / çalınmış oturumla toplu yazmayı keser. Okuma (GET/HEAD/OPTIONS) sınırlanmaz.
// Kova kişiye bağlıdır (bürünmede gerçek operatör; bürünme zaten salt-okunur). Kendi sıkı sınırı olan rotalar (giriş, AI deneme,
// içe aktarma) o sınırı korur; bu kova onların ÜSTÜNE gelen genel tavandır.
// ---------------------------------------------------------------------------

export const HOST_WRITE_LIMIT = 120;
export const HOST_WRITE_WINDOW_MS = 60_000;

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Yazma isteği kovayı aştıysa 429 yanıtı; aksi hâlde null. Okuma isteği hiç saymaz. */
export async function hostWriteLimited(session: Pick<SessionPayload, "userId" | "actorUserId">, method: string): Promise<Response | null> {
  if (READ_METHODS.has(method.toUpperCase())) return null;
  const who = session.actorUserId || session.userId;
  const verdict = await rateLimit(`host-write:${who}`, HOST_WRITE_LIMIT, HOST_WRITE_WINDOW_MS);
  return verdict.ok ? null : tooManyRequests(verdict.retryAfter);
}
