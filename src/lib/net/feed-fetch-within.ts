import { isPrivateHost, resolvesToPrivate } from "@/lib/net/private-host";
import { fetchFeedText } from "@/lib/net/pinned-fetch";

/**
 * Takvim beslemesini TEK TOPLAM süre içinde çeker: DNS ön kontrolü + bağlantı + gövde (K27-K15, Codex 11-25 akşam).
 *
 * Eskiden `syncCalendarSource` SSRF ön kontrolünü (`resolvesToPrivate` — `getaddrinfo`, süresiz) `fetchFeedText`in 15 sn'lik toplam
 * süresi BAŞLAMADAN önce bekliyordu → asılı / yavaş bir DNS cevabı kaynağın süresini sınırsız uzatıyordu; zamanlanmış geçiş ve
 * `syncDueCalendarSourcesForOrg` ise "tek kaynağın tavanı 15 sn" varsayımına dayanıyor. Artık süre TEK noktadan başlar: ön kontrol kalan
 * süreyle yarışır, `fetchFeedText` KALAN süreyi alır (onun kendi bağlantı + gövde son anı da bu kalanla kurulur).
 *
 * SSRF korumalarının HİÇBİRİ gevşemedi: dize kontrolü (`isPrivateHost`) ve DNS ön kontrolü aynen, ön kontrol özel adres görürse yine
 * "blocked private host"; yetkili koruma hâlâ `fetchFeedText`in sabitlenmiş (pinned) çözümlemesidir (özel / link-local / IPv6 multicast
 * engeli, yalnız 443, yönlendirme yok). Ön kontrol süre içinde bitmezse istek HİÇ açılmaz ("feed deadline exceeded" — `fetchFeedText`in
 * kendi son an hatasıyla aynı ileti, aynı sınıflandırma). Not: süresi dolan `getaddrinfo` iptal edilemez (libuv iş parçacığında biter);
 * bekleyen taraf yalnız onu beklemeyi bırakır.
 */
export async function fetchPublicFeedWithin(
  feedUrl: string,
  opts: { totalMs: number; maxBytes: number; userAgent: string },
): Promise<string> {
  const startedAt = Date.now();
  const feedHost = new URL(feedUrl).hostname;
  if (isPrivateHost(feedHost)) throw new Error("blocked private host");

  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<"deadline">((resolve) => {
    timer = setTimeout(() => resolve("deadline"), opts.totalMs);
  });
  let verdict: boolean | "deadline";
  try {
    verdict = await Promise.race([resolvesToPrivate(feedHost), deadline]);
  } finally {
    clearTimeout(timer);
  }
  if (verdict === "deadline") throw new Error("feed deadline exceeded");
  if (verdict) throw new Error("blocked private host");

  const remainingMs = opts.totalMs - (Date.now() - startedAt);
  if (remainingMs <= 0) throw new Error("feed deadline exceeded");
  return fetchFeedText(feedUrl, { maxBytes: opts.maxBytes, timeoutMs: remainingMs, userAgent: opts.userAgent });
}
