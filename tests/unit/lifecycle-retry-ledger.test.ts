import { describe, it, expect } from "vitest";
import {
  AUTOMATED_SEND_RETENTION_MS,
  LIFECYCLE_RETRY_BASE_MS,
  LIFECYCLE_RETRY_CAP_MS,
  automatedBodyHash,
  discardAutomatedSend,
  lifecycleRetryDelayMs,
  loadFailedSendLedger,
} from "@/lib/automated-sends";

// ---------------------------------------------------------------------------
// S8 (kurucu kararı 11-11) — YENİDEN DENEME DEFTERİ, saf kısım. Sağlayıcının kesin reddettiği otomatik mesaj her turda (2 dakikada bir)
// yeniden deneniyordu. Bekleme süresi artık var olan otomatik gönderim kaydından türetilir: aynı içerikle n ret → 90 sn · 2^(n−1), tavan
// 6 saat, ±%20 sapma. Sayaç niyet başınadır (rezervasyon + tür + içerik); "bıraktım" durumu yoktur.
// ---------------------------------------------------------------------------

type Row = { organizationId: string; kind: string; state: string; externalReservationId: string; bodyHash: string; sentAt: Date };
type FindArgs = { where: { organizationId: string; kind: string; state: string; externalReservationId: { in: string[] }; sentAt: { gte: Date } } };

/** Sorgunun süzgecini GERÇEKTEN uygulayan sahte tablo (süzgeç yanlış yazılırsa testler görür). */
function fakeDb(rows: Row[], opts: { fail?: boolean } = {}) {
  const calls: FindArgs[] = [];
  const db = {
    automatedMessageSend: {
      findMany: async (args: FindArgs) => {
        calls.push(args);
        if (opts.fail) throw new Error("db down");
        const w = args.where;
        return rows.filter(
          (r) =>
            r.organizationId === w.organizationId &&
            r.kind === w.kind &&
            r.state === w.state &&
            w.externalReservationId.in.includes(r.externalReservationId) &&
            r.sentAt.getTime() >= w.sentAt.gte.getTime(),
        );
      },
      delete: async () => {
        if (opts.fail) throw new Error("db down");
        return {};
      },
    },
  };
  return { db: db as never, calls };
}

const NOW = new Date("2026-11-11T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MIN = 60_000;
const BODY = "Merhaba Ada, rezervasyonunuz için teşekkürler.";
const failed = (ref: string, at: Date, over: Partial<Row> = {}): Row => ({
  organizationId: "org1",
  kind: "welcome",
  state: "failed",
  externalReservationId: ref,
  bodyHash: automatedBodyHash(BODY),
  sentAt: at,
  ...over,
});

describe("lifecycleRetryDelayMs — aralık katlanarak büyür, tavanda kalır", () => {
  it("deneme yoksa bekleme yok", () => {
    expect(lifecycleRetryDelayMs(0, "x")).toBe(0);
    expect(lifecycleRetryDelayMs(-3, "x")).toBe(0);
    expect(lifecycleRetryDelayMs(Number.NaN, "x")).toBe(0);
  });

  it("n. retten sonra 90 sn · 2^(n−1) (±%20), tavan 6 saat (±%20)", () => {
    for (const seed of ["welcome:res-1", "checkin:HMABC", "checkout:x", ""]) {
      for (let n = 1; n <= 40; n++) {
        const nominal = Math.min(LIFECYCLE_RETRY_CAP_MS, LIFECYCLE_RETRY_BASE_MS * 2 ** (n - 1));
        const d = lifecycleRetryDelayMs(n, seed);
        expect(d, `${seed} n=${n}`).toBeGreaterThanOrEqual(Math.round(nominal * 0.8));
        expect(d, `${seed} n=${n}`).toBeLessThan(nominal * 1.2);
      }
    }
  });

  it("ilk yeniden deneme bir sonraki turda (2 dakika) yapılabilir: ilk bekleme her zaman 2 dakikanın altında", () => {
    for (let i = 0; i < 500; i++) expect(lifecycleRetryDelayMs(1, `welcome:ref-${i}`)).toBeLessThan(2 * MIN);
  });

  it("tavanda günde en çok ~5 deneme: bekleme hiçbir zaman 4,8 saatin altına inmez", () => {
    for (let i = 0; i < 500; i++) expect(lifecycleRetryDelayMs(12, `checkin:ref-${i}`)).toBeGreaterThanOrEqual(LIFECYCLE_RETRY_CAP_MS * 0.8);
  });

  it("aynı girdi aynı sonucu verir; sapma rezervasyona göre değişir (aynı ana yığılma yok)", () => {
    expect(lifecycleRetryDelayMs(4, "welcome:res-1")).toBe(lifecycleRetryDelayMs(4, "welcome:res-1"));
    const spread = new Set(Array.from({ length: 50 }, (_, i) => lifecycleRetryDelayMs(4, `welcome:res-${i}`)));
    expect(spread.size).toBeGreaterThan(10);
  });
});

describe("loadFailedSendLedger — deneme sayısı ve son deneme anı kayıtlardan türetilir", () => {
  it("kayıt yoksa hiçbir aday bekletilmez; rezervasyon listesi boşsa sorgu da yapılmaz", async () => {
    const { db, calls } = fakeDb([]);
    const none = await loadFailedSendLedger(db, { organizationId: "org1", kind: "welcome" }, [], NOW);
    expect(none.notDue("res-1", BODY, NOW)).toBe(false);
    expect(calls).toHaveLength(0);
    const empty = await loadFailedSendLedger(db, { organizationId: "org1", kind: "welcome" }, ["res-1"], NOW);
    expect(empty.notDue("res-1", BODY, NOW)).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("🚨 bir ret: bekleme dolmadan vadesi gelmemiş, dolunca gelmiş (sınır: tam vade anı = vadesi geldi)", async () => {
    const delay = lifecycleRetryDelayMs(1, "welcome:res-1");
    const { db } = fakeDb([failed("res-1", ago(delay - 1_000))]);
    const ledger = await loadFailedSendLedger(db, { organizationId: "org1", kind: "welcome" }, ["res-1"], NOW);
    expect(ledger.notDue("res-1", BODY, NOW)).toBe(true);
    expect(ledger.notDue("res-1", BODY, new Date(NOW.getTime() + 999))).toBe(true);
    expect(ledger.notDue("res-1", BODY, new Date(NOW.getTime() + 1_000))).toBe(false);
  });

  it("🚨 ret sayısı arttıkça bekleme uzar ve SON denemeden sayılır (ilk denemeden değil)", async () => {
    const rows = [failed("res-1", ago(5 * 60 * MIN)), failed("res-1", ago(3 * 60 * MIN)), failed("res-1", ago(60 * MIN)), failed("res-1", ago(4 * MIN))];
    const { db } = fakeDb(rows);
    const ledger = await loadFailedSendLedger(db, { organizationId: "org1", kind: "welcome" }, ["res-1"], NOW);
    const delay = lifecycleRetryDelayMs(4, "welcome:res-1"); // 12 dk ± %20
    expect(delay).toBeGreaterThan(9 * MIN);
    expect(ledger.notDue("res-1", BODY, NOW)).toBe(true); // son deneme 4 dk önce
    expect(ledger.notDue("res-1", BODY, new Date(NOW.getTime() - 4 * MIN + delay - 1))).toBe(true);
    expect(ledger.notDue("res-1", BODY, new Date(NOW.getTime() - 4 * MIN + delay))).toBe(false);
  });

  it("🚨 içerik değişince sayaç sıfırdan başlar: ev sahibi metni düzeltti → hemen denenir", async () => {
    const { db } = fakeDb(Array.from({ length: 6 }, (_, i) => failed("res-1", ago(i * MIN))));
    const ledger = await loadFailedSendLedger(db, { organizationId: "org1", kind: "welcome" }, ["res-1"], NOW);
    expect(ledger.notDue("res-1", BODY, NOW)).toBe(true);
    expect(ledger.notDue("res-1", "Merhaba Ada, düzeltilmiş metin.", NOW)).toBe(false);
    // Özet normalize edilmiş gövdeden: satır sonu / sondaki boşluk farkı "yeni içerik" sayılmaz.
    expect(ledger.notDue("res-1", `${BODY}  \r\n`, NOW)).toBe(true);
  });

  it("🚨 niyet başına: başka rezervasyonun, başka türün, başka işletmenin reddi bu adayı bekletmez", async () => {
    const rows = [
      failed("res-2", ago(10_000)),
      failed("res-1", ago(10_000), { kind: "checkin" }),
      failed("res-1", ago(10_000), { organizationId: "org2" }),
    ];
    const { db } = fakeDb(rows);
    const ledger = await loadFailedSendLedger(db, { organizationId: "org1", kind: "welcome" }, ["res-1", "res-2"], NOW);
    expect(ledger.notDue("res-1", BODY, NOW)).toBe(false);
    expect(ledger.notDue("res-2", BODY, NOW)).toBe(true);
  });

  it("yalnız KESİN ret sayılır: gönderilmiş / belirsiz / bekleyen iz bekletmez", async () => {
    const rows = [failed("res-1", ago(10_000), { state: "sent" }), failed("res-1", ago(10_000), { state: "unverified" }), failed("res-1", ago(10_000), { state: "pending" })];
    const { db } = fakeDb(rows);
    const ledger = await loadFailedSendLedger(db, { organizationId: "org1", kind: "welcome" }, ["res-1"], NOW);
    expect(ledger.notDue("res-1", BODY, NOW)).toBe(false);
  });

  it("iz ömründen (14 gün) eski retler sayılmaz", async () => {
    const { db, calls } = fakeDb([failed("res-1", ago(AUTOMATED_SEND_RETENTION_MS + MIN))]);
    const ledger = await loadFailedSendLedger(db, { organizationId: "org1", kind: "welcome" }, ["res-1"], NOW);
    expect(ledger.notDue("res-1", BODY, NOW)).toBe(false);
    expect(calls[0].where.sentAt.gte.getTime()).toBe(NOW.getTime() - AUTOMATED_SEND_RETENTION_MS);
  });

  it("sorgu tekilleştirilmiş kimliklerle, işletme + tür + 'failed' süzgeciyle yapılır", async () => {
    const { db, calls } = fakeDb([]);
    await loadFailedSendLedger(db, { organizationId: "org1", kind: "checkout" }, ["a", "b", "a"], NOW);
    expect(calls[0].where).toMatchObject({ organizationId: "org1", kind: "checkout", state: "failed", externalReservationId: { in: ["a", "b"] } });
  });

  it("🚨 defter okunamazsa BOŞ sayılır (gönderici bugünkü gibi dener — okuma arızası mesajı sessizce bekletmez)", async () => {
    const { db } = fakeDb([failed("res-1", ago(1_000))], { fail: true });
    const ledger = await loadFailedSendLedger(db, { organizationId: "org1", kind: "welcome" }, ["res-1"], NOW);
    expect(ledger.notDue("res-1", BODY, NOW)).toBe(false);
  });
});

describe("discardAutomatedSend — en iyi çaba", () => {
  it("kimlik yoksa hiçbir şey yapmaz; silme düşerse fırlatmaz", async () => {
    await expect(discardAutomatedSend(fakeDb([], { fail: true }).db, null)).resolves.toBeUndefined();
    await expect(discardAutomatedSend(fakeDb([], { fail: true }).db, "id1")).resolves.toBeUndefined();
  });
});
