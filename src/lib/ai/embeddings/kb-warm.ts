/* ---------------------------------------------------------------------------
 * BİLGİ TABANI VEKTÖR ISITMASI — YAZMA ANINDA ve AÇILIŞTA (#189, 09-26 gece).
 *
 * Parça vektörleri süreç belleğinde ve YALNIZ arka planda üretilir (`semantic-retrieval.ts`); eksik parça varsa o karar
 * SÖZCÜKSEL kalır ("cold", YARIM HARİTA YOK). İki durumda misafirin İLK mesajı bu yüzden anlamsal aramasız kalıyordu:
 *  · her yayından / yeniden başlatmadan sonra (depo boş) — mülk başına ilk mesaj;
 *  · bilgi tabanı düzenlenince (değişen kalemin parçası depoda yok) — düzenlemeden sonraki ilk mesaj.
 * Sektör düzeni: dizin YAZMA zamanında kurulur. Burası iki tetik verir: KB yazma rotaları (kalem ekle/düzenle/sil/kopyala)
 * ve zamanlanmış senkronun süreç başına İLK geçişi. Isıtma, seçicinin göreceği metnin AYNISINI gömer: kanal yolları seçimi
 * HAM metinle yapar (yer tutucu ikamesi seçimden sonra), QR yolu nötr hitapla doldurulmuş metinle — yer tutucu taşıyan
 * kalem varsa ikinci biçim de ısıtılır.
 *
 * ASLA fırlatmaz, misafiri beklemez; saatlik ısıtma tavanı (`WARM_TEXTS_PER_HOUR`) ve parça tavanı aynen geçerli.
 * Anahtar kapalıyken (`KB_SEMANTIC_RETRIEVAL`) ya da legacy modda HİÇBİR ŞEY yapmaz (sorgu dahil).
 * ------------------------------------------------------------------------- */

import { prisma } from "@/lib/db";
import { reportError } from "@/lib/report-error";
import { kbRetrievalMode, semanticRetrievalInfo } from "@/lib/ai/retrieval/flag";
import { purgeVectorStoreForCurrentModel, warmKbVectorSets, type WarmOptions } from "@/lib/ai/embeddings/semantic-retrieval";
import { propertyWarmSets } from "@/lib/ai/embeddings/kb-warm-texts";

function warmingOn(): boolean {
  return semanticRetrievalInfo().enabled && kbRetrievalMode() === "hybrid";
}

/**
 * Tek mülkün bilgi tabanını ısıtır; kuyruğa alınan parça metni sayısını döner (test/teşhis). Fırlatmaz. `onBudgetRefused` yalnız gecikmeli
 * ısıtmanın yeniden planlaması içindir (D2).
 */
export async function warmPropertyKbVectors(propertyId: string, extra: Pick<WarmOptions, "onBudgetRefused"> = {}): Promise<number> {
  if (!warmingOn()) return 0;
  try {
    // Kümeler (ham + farklıysa QR'ın nötr hitaplı biçimi) TEK KAYNAKTAN — D3 temizliği aynı metinleri "geçerli" sayar (`kb-warm-texts.ts`).
    const ws = await propertyWarmSets(propertyId);
    if (!ws) return 0;
    // İşletme kovası (D1, anahtar açıkken) için işletme burada bilinir; kapalıyken seçenek okunmaz.
    const opts: WarmOptions = { organizationId: ws.organizationId, ...extra };
    // Kovalar açıkken dairenin kümeleri TEK iş (tek bütçe alımı, hepsi-ya-hiç); kapalıyken küme başına iş (bugünkü gibi).
    return warmKbVectorSets(ws.sets, opts);
  } catch (err) {
    void reportError("kb-semantic-warm-property", err);
    return 0;
  }
}

// ─── GECİKMELİ ISITMA (EMB tur 2 D2) ────────────────────────────────────────
// Kurucu 11-19 akşam madde 2: "Host aynı Wi-Fi kaydını art arda düzenlerse her ara sürüm için para harcamayalım; kuyrukta güncel sürüm
// kalsın". Anahtar `KB_EMBED_DEBOUNCE_ENABLED` (yalnız "1") açıkken kanca daireyi "kirli" işaretler: ısıtma SON kayıttan D saniye sonra
// koşar, her yeni kayıt saati yeniden kurar; koşunca bilgi tabanının O ANKİ hâlini okur (ara sürümler gömülmez). Bütçe reddederse iş pencere
// açılınca kendiliğinden yeniden planlanır (bugün kayboluyordu; bir sonraki misafir sorusuna / düzenlemeye kadar sözcüksel kalıyordu).
// Sınırlar: daire başına TEK zamanlayıcı (yenisi eskisini siler), art arda en çok `WARM_RETRY_MAX` yeniden deneme, zamanlayıcı süreci açık
// tutmaz (`unref`). Süreç içidir: yeniden başlatmada bekleyen iş kaybolur — açılış ısıtması (`warmAllKbVectorsOnce`) onu karşılar.
// Bu sürede bilgi tabanı güncel kayıtta SÖZCÜKSEL çalışır (eski içerik isteme girmez — EMB-1).

/** Bekleme (kurucu sorusu E-5) — öneri 20 sn. */
export const KB_EMBED_DEBOUNCE_SECONDS_DEFAULT = 20;
/** Art arda reddedilen yeniden denemelerin tavanı (saatlik pencerede ≈ bir gün). Sonra iş bir sonraki kayda / misafir sorusuna kalır. */
export const WARM_RETRY_MAX = 24;

/** Anahtar yalnız tam "1" ile açılır. */
export function debouncedWarmEnabled(): boolean {
  return process.env.KB_EMBED_DEBOUNCE_ENABLED === "1";
}

export function warmDebounceMs(): number {
  const raw = process.env.KB_EMBED_DEBOUNCE_SECONDS?.trim();
  const n = raw && /^\d{1,4}$/.test(raw) ? Number(raw) : KB_EMBED_DEBOUNCE_SECONDS_DEFAULT;
  return Math.min(Math.max(n, 1), 3_600) * 1_000;
}

const pendingWarm = new Map<string, ReturnType<typeof setTimeout>>();
const scheduledRuns = new Set<Promise<void>>();
let scheduledRunCount = 0;

function scheduleWarmLater(propertyId: string, delayMs: number, refusals: number): void {
  const prev = pendingWarm.get(propertyId);
  if (prev) clearTimeout(prev);
  const timer = setTimeout(() => {
    pendingWarm.delete(propertyId);
    const run = runScheduledWarm(propertyId, refusals);
    scheduledRuns.add(run);
    void run.finally(() => scheduledRuns.delete(run));
  }, delayMs);
  timer.unref?.();
  pendingWarm.set(propertyId, timer);
}

async function runScheduledWarm(propertyId: string, refusals: number): Promise<void> {
  scheduledRunCount += 1;
  let rescheduled = false;
  await warmPropertyKbVectors(propertyId, {
    onBudgetRefused: (retryAfterMs) => {
      // Bu arada yeni bir kayıt zamanlayıcıyı kurduysa o kazanır; aynı koşunun ikinci reddi (QR biçimi) ikinci zamanlayıcı kurmaz.
      if (rescheduled || pendingWarm.has(propertyId) || retryAfterMs === null || refusals >= WARM_RETRY_MAX) return;
      rescheduled = true;
      scheduleWarmLater(propertyId, Math.max(retryAfterMs, warmDebounceMs()), refusals + 1);
    },
  });
}

/** KB yazma rotaları için: beklemeden başlatır (yanıtı geciktirmez), asla fırlatmaz. Gecikmeli ısıtma açıkken daireyi kirli işaretler. */
export function warmPropertyKbVectorsBestEffort(propertyId: string | null | undefined): void {
  if (!propertyId || !warmingOn()) return;
  if (debouncedWarmEnabled()) {
    scheduleWarmLater(propertyId, warmDebounceMs(), 0);
    return;
  }
  void warmPropertyKbVectors(propertyId);
}

/** Test: bekleyen zamanlayıcıları sil. */
export function __resetWarmScheduler(): void {
  for (const t of pendingWarm.values()) clearTimeout(t);
  pendingWarm.clear();
  scheduledRunCount = 0;
}

/** Test: zamanlayıcının başlattığı koşu sayısı. */
export function __scheduledWarmRunCount(): number {
  return scheduledRunCount;
}

/** Test: bekleyen (zamanlayıcısı kurulmuş) daireler. */
export function __pendingWarmTimers(): ReadonlyMap<string, ReturnType<typeof setTimeout>> {
  return pendingWarm;
}

/** Test: zamanlayıcının başlattığı koşuların bitmesini bekler. */
export async function __awaitScheduledWarms(): Promise<void> {
  while (scheduledRuns.size > 0) await Promise.all([...scheduledRuns]);
}

let bootWarmStarted = false;

/**
 * Süreç başına BİR KEZ: aktif bilgi tabanı olan tüm mülkleri sırayla ısıtır (zamanlanmış senkronun ilk geçişi çağırır).
 * Yalnız retrieval gerçekten koşacak (legacy tavanını aşan) bilgi tabanları vektör üretir — küçük KB'de `warmKbVectors`
 * hiçbir şey yapmaz. Fırlatmaz; ikinci çağrı no-op.
 */
export function warmAllKbVectorsOnce(): void {
  if (bootWarmStarted || !warmingOn()) return;
  bootWarmStarted = true;
  void (async () => {
    try {
      // Kalıcı depo (anahtar açıkken): başka model / tarifin satırları silinir — model değişince eski vektörler kalmasın.
      await purgeVectorStoreForCurrentModel();
      const rows = await prisma.knowledgeBaseItem.groupBy({ by: ["propertyId"], where: { isActive: true }, _count: { _all: true } });
      for (const r of rows) {
        if (r.propertyId) await warmPropertyKbVectors(r.propertyId);
      }
    } catch (err) {
      void reportError("kb-semantic-warm-boot", err);
    }
  })();
}

/** Test kancası. */
export function __resetBootWarm(): void {
  bootWarmStarted = false;
}
