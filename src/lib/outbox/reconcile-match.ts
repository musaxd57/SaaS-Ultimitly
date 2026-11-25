// ---------------------------------------------------------------------------
// BELİRSİZ GÖNDERİMİ KANALDAN DOĞRULAMA — SAF KARAR (kurucu 11-19 AK-1 / KU-1: "adamların mesajlarını görebiliyoruz ki … varsa gitmiştir";
// tasarım `docs/TASARIM-2026-11-19-belirsiz-gonderimi-lixus-kendisi-dogrular.md`). Veritabanı yok, ağ yok, saat yok: girdiler verilir.
//
// Kanala giden istekte bizim ürettiğimiz bir referans yok ve yanıt kopunca sağlayıcının mesaj kimliği elde değil. Bu yüzden iki kanıt türü:
//  · "id": elimizde sağlayıcı kimliği var ve kanalda o kimlikli mesaj görünüyor → gönderildi (kesin);
//  · "content": kanalda, gönderim başlangıcımızda ya da SONRA damgalı (geri pay YOK, aşağıda), birebir aynı metinli, ev sahibi tarafında
//    (giden), başka hiçbir kayda ait olmayan mesaj görünüyor → misafire ULAŞTI. Codex şartı: bu, "bizim isteğimiz başarılı oldu" iddiası DEĞİLDİR (ev sahibi aynı metni elle de
//    göndermiş olabilir) — ama her iki durumda da misafir bu metni almıştır. Kanıt türü kayda ayrı yazılır.
// Görünmüyorsa sonuç "görünmüyor"dur ve bu ASLA yeniden gönderim sebebi değildir (çağıran yeniden göndermez).
// ---------------------------------------------------------------------------

/** Kanaldan okunan mesaj (sağlayıcıdan bağımsız biçim). */
export interface ThreadMessage {
  externalId: string | null;
  direction: "inbound" | "outbound";
  body: string | null;
  createdAt: Date | null;
}

// GERİ PAY YOK (Codex 11-25, kurucu talimatı 2026-11-25): metin eşleşmesi yalnız gönderim başlangıcında ya da SONRASINDA damgalı mesajı
// kabul eder. Eskiden 2 dk "saat kayması payı" vardı: 13:59'da kanalda duran, kimsenin sahiplenmediği aynı metin 14:00 gönderimini
// "gönderildi" yapabiliyordu — oysa o mesajın bu denemeden ÖNCE zaten orada olmadığı gösterilemez. Sağlayıcı saati bizden geri kalırsa
// gerçek yankı da başlangıçtan önce damgalı görünebilir; o zaman sonuç "görünmüyor" olur — bu GÜVENLİ yöndür: satır belirsiz kalır,
// yeniden gönderilmez, ev sahibi incelemeye yönlendirilir. Sağlayıcı KİMLİĞİ eşleşmesi zamana bakmaz (kesin kanıt).
/** Gönderim başlangıcından sonra en çok bu kadar içinde yazılmış mesaj aday (daha geç görünen aynı metin başka bir gönderimdir). */
export const RECONCILE_WINDOW_MS = 24 * 3_600_000;

/**
 * Metin karşılaştırması BİÇİM farkını yok sayar, İÇERİĞİ değil: satır sonu türü, baş / son boşluk, boşluk dizileri ve Unicode birleşik /
 * ayrık yazım. Büyük-küçük harf, noktalama ve sözcükler aynen karşılaştırılır. Doğrusal (karesel iş yok).
 */
export function normalizeForReconcile(text: string): string {
  return text.normalize("NFC").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
}

export type ReconcileMatch =
  | { found: true; providerMessageId: string; evidence: "id" | "content" }
  | { found: false; evidence: "not_seen" };

/**
 * Kanal mesajları içinde bu gönderimi ara.
 * `anchor` = gönderim başlangıcı (kuyrukta "dış gönderim başladı" işareti; doğrudan yolda gönder'e basılan an).
 * `taken` = başka bir kayda ait sağlayıcı kimlikleri (başka kuyruk satırının kimliği · yerelde başka bir mesaja bağlı kimlik) — aynı metni
 * iki kez yazan ev sahibinin öteki mesajı bu gönderimi "doğrulamaz".
 * Birden çok uygun aday varsa en erken yazılanı alınır (kimlik eşitlik bozucu).
 */
export function matchSendInThread(input: {
  body: string;
  anchor: Date;
  knownProviderMessageId?: string | null;
  messages: readonly ThreadMessage[];
  taken: ReadonlySet<string>;
}): ReconcileMatch {
  const known = input.knownProviderMessageId ?? null;
  if (known && input.messages.some((m) => m.externalId === known)) return { found: true, providerMessageId: known, evidence: "id" };
  const want = normalizeForReconcile(input.body);
  if (!want) return { found: false, evidence: "not_seen" };
  const from = input.anchor.getTime();
  const to = input.anchor.getTime() + RECONCILE_WINDOW_MS;
  const candidates = input.messages
    .filter((m): m is ThreadMessage & { externalId: string; createdAt: Date; body: string } => {
      if (m.direction !== "outbound" || !m.externalId || !m.createdAt || typeof m.body !== "string") return false;
      if (input.taken.has(m.externalId)) return false;
      const t = m.createdAt.getTime();
      if (Number.isNaN(t) || t < from || t > to) return false;
      return normalizeForReconcile(m.body) === want;
    })
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.externalId < b.externalId ? -1 : a.externalId > b.externalId ? 1 : 0));
  const first = candidates[0];
  return first ? { found: true, providerMessageId: first.externalId, evidence: "content" } : { found: false, evidence: "not_seen" };
}

/** Kayda yazılan kanıt kodları (`MessageOutbox.lastErrorCode` — migration yok; yalnız teşhis / görünüm). */
export const RECONCILE_CODES = {
  /** Kanalda aynı metin görüldü: misafire ulaştı (bizim isteğimizin başarısı iddia edilmez). */
  seenByContent: "reconciled_seen_in_channel",
  /** Lixus baktı, kanalda görünmüyor (bütün bakışlar bitti). */
  notSeen: "not_seen_in_channel",
  /** Kanal okunamadı (sağlayıcı arızası / belirteç yok): doğrulanamadı. */
  unreadable: "channel_unreadable",
} as const;
