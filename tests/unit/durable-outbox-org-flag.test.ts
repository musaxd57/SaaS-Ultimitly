import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { durableOutboxEnabled, durableOutboxEnabledFor } from "@/lib/outbox/flag";

// ---------------------------------------------------------------------------
// O1 İLK DENEME LİSTESİ (kurucu 10-16: "liste anahtarı ekle"). Misafir mesajı kuyruğu önce yalnız seçilen işletmelerde açılır:
// `DURABLE_OUTBOX_ENABLED=1` ana anahtar, `DURABLE_OUTBOX_ORG_IDS` (virgüllü) yalnız listedekileri, `*` bütün işletmeleri açar.
// Ana anahtar kapalıyken liste hiçbir şey AÇMAZ; liste yoksa / boşsa KİMSE açılmaz (güvenli yön = bugünkü yol); bütün işletmeler = "*".
// ---------------------------------------------------------------------------

afterEach(() => vi.unstubAllEnvs());

describe("durableOutboxEnabledFor", () => {
  it("ana anahtar kapalı → liste dolu olsa da kapalı (liste tek başına hiçbir şey açmaz)", () => {
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "org_a");
    expect(durableOutboxEnabledFor("org_a")).toBe(false);
  });

  it("🚨 Opus F10: ana anahtar açık + liste YOK / boş → KİMSE açılmaz (listeyi silmek kuyruğu herkese açmaz)", () => {
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "");
    expect(durableOutboxEnabledFor("org_a")).toBe(false);
    delete process.env.DURABLE_OUTBOX_ORG_IDS;
    expect(durableOutboxEnabledFor("org_a")).toBe(false);
  });

  it("ana anahtar açık + liste '*' → bütün işletmeler (tek başına ya da kimliklerle birlikte)", () => {
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
    expect(durableOutboxEnabledFor("org_a")).toBe(true);
    expect(durableOutboxEnabledFor("org_b")).toBe(true);
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "org_a, *");
    expect(durableOutboxEnabledFor("org_z")).toBe(true);
  });

  it("ana anahtar açık + liste dolu → YALNIZ listedekiler; boşluklar ve boş öğeler tolere edilir", () => {
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", " org_a , ,org_c ");
    expect(durableOutboxEnabledFor("org_a")).toBe(true);
    expect(durableOutboxEnabledFor("org_c")).toBe(true);
    expect(durableOutboxEnabledFor("org_b")).toBe(false);
    // Önek / parça eşleşmesi YOK (tam kimlik).
    expect(durableOutboxEnabledFor("org")).toBe(false);
    expect(durableOutboxEnabledFor("org_a2")).toBe(false);
  });

  it("liste yazılmış ama içinde kimlik yok (',') → KİMSE açılmaz (yanlış yazımda herkese açılmak yerine bugünkü yol)", () => {
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", ",");
    expect(durableOutboxEnabledFor("org_a")).toBe(false);
    expect(durableOutboxEnabled()).toBe(true); // ana anahtar (okuma süzgeçleri + boşaltma) yine açık
  });

  it("ana anahtar yalnız tam '1' (\"true\" açmaz — STRICT_ONE_FLAGS ile aynı)", () => {
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "true");
    expect(durableOutboxEnabledFor("org_a")).toBe(false);
  });
});

// GÖNDERİM KARARI veren her yer işletmeye göre karar verir; küresel `durableOutboxEnabled()` yalnız OKUMA süzgeçlerinde ve boşaltma
// işçisinde kalır (listede olmayan işletmenin kuyruk satırı yoktur, süzgeç boş döner; boşaltma bekleyen her satırı gönderir).
// Yeni bir gönderim yolu küresel anahtarla eklenirse liste dışındaki işletmenin mesajı da kuyruğa düşerdi → bu pin kırmızı olur.
describe("O1 liste anahtarı — gönderim kararları işletmeye göre (kaynak pini)", () => {
  const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
  const globalCalls = (src: string) => (src.match(/durableOutboxEnabled\(\)/g) ?? []).length;

  it("gönderim yolları: hiç küresel çağrı yok, işletme çağrısı var", () => {
    for (const p of ["src/lib/host-send.ts", "src/lib/early-checkin/workflow.ts"]) {
      const src = read(p);
      expect(globalCalls(src), p).toBe(0);
      expect(src, p).toMatch(/durableOutboxEnabledFor\(/);
    }
  });

  it("automation.ts: küresel anahtar çağrısı YOK — okuma süzgeci kuyruk varlığına bağlı (Opus F3), gönderim dalları işletmeye göre", () => {
    const src = read("src/lib/automation.ts");
    expect(globalCalls(src)).toBe(0);
    expect(src).toMatch(/const anyUndeliveredOutbound =\s*\n\s*\(await undeliveredFilterActive\(\)\) &&/);
    // Gönderim dalları: nezaket, kanal oto-yanıtı, karşılama / giriş / çıkış (her biri iki satır: silme bekçisi + kuyruk) = 8.
    expect((src.match(/durableOutboxEnabledFor\(/g) ?? []).length).toBe(8);
  });

  it("operator-replies.ts: selam sayımı süzgeci de kuyruk varlığına bağlı (anahtar kapatılınca kapanmaz)", () => {
    const src = read("src/lib/operator-replies.ts");
    expect(globalCalls(src)).toBe(0);
    expect(src).toMatch(/if \(!\(await undeliveredFilterActive\(\)\)\) return \[\];/);
  });
});
