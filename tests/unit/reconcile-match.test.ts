import { describe, it, expect } from "vitest";
import {
  RECONCILE_WINDOW_MS,
  matchSendInThread,
  normalizeForReconcile,
  type ThreadMessage,
} from "@/lib/outbox/reconcile-match";

// ---------------------------------------------------------------------------
// BELİRSİZ GÖNDERİMİ KANALDAN DOĞRULAMA — saf karar (kurucu 11-19 AK-1; `src/lib/outbox/reconcile-match.ts`). Kanıt: aynı metin, giden,
// gönderim başlangıcında ya da SONRA (geri pay YOK — Codex 11-25; 24 saat pencere), başka hiçbir kayda ait değil. Görünmüyorsa "not_seen" — çağıran
// yeniden göndermez.
// ---------------------------------------------------------------------------

const ANCHOR = new Date("2026-11-19T10:00:00.000Z");
const at = (ms: number) => new Date(ANCHOR.getTime() + ms);
const out = (id: string, body: string, ms: number): ThreadMessage => ({ externalId: id, direction: "outbound", body, createdAt: at(ms) });
const BODY = "Havluları getiriyoruz.";

describe("kanaldan doğrulama — saf karar", () => {
  it("🚨 aynı metin gönderimden SONRA kanalda (giden, kimse sahiplenmemiş) → misafire ulaştı ('content'), o mesajın kimliği", () => {
    expect(matchSendInThread({ body: BODY, anchor: ANCHOR, messages: [out("m1", BODY, 3_000)], taken: new Set() })).toEqual({
      found: true,
      providerMessageId: "m1",
      evidence: "content",
    });
  });

  it("elimizde sağlayıcı kimliği varsa ve kanalda görünüyorsa → 'id' (metin farklı olsa da)", () => {
    expect(matchSendInThread({ body: BODY, anchor: ANCHOR, knownProviderMessageId: "m9", messages: [out("m9", "başka metin", 0)], taken: new Set() })).toEqual({
      found: true,
      providerMessageId: "m9",
      evidence: "id",
    });
  });

  it("🚨 GÖRÜNMEYEN durumlar 'not_seen': aynı metin gönderimden ÖNCE (pay dışı) · 24 saatten SONRA · gelen (misafir) · başka kayda ait · metin farklı · zamansız · kimliksiz", () => {
    const cases: Array<[string, ThreadMessage[], Set<string>]> = [
      ["önce", [out("a", BODY, -1)], new Set()],
      ["pencere sonrası", [out("b", BODY, RECONCILE_WINDOW_MS + 1)], new Set()],
      ["gelen", [{ externalId: "c", direction: "inbound", body: BODY, createdAt: at(1_000) }], new Set()],
      ["başka kayda ait", [out("d", BODY, 1_000)], new Set(["d"])],
      ["metin farklı", [out("e", "Havluları getiriyoruz!", 1_000)], new Set()],
      ["büyük-küçük harf farklı", [out("f", "havluları getiriyoruz.", 1_000)], new Set()],
      ["zamansız", [{ externalId: "g", direction: "outbound", body: BODY, createdAt: null }], new Set()],
      ["kimliksiz", [{ externalId: null, direction: "outbound", body: BODY, createdAt: at(1_000) }], new Set()],
      ["gövdesiz", [{ externalId: "h", direction: "outbound", body: null, createdAt: at(1_000) }], new Set()],
    ];
    for (const [label, messages, taken] of cases) {
      expect(matchSendInThread({ body: BODY, anchor: ANCHOR, messages, taken }), label).toEqual({ found: false, evidence: "not_seen" });
    }
    // Kimlik var ama kanalda o kimlik yok ve metin de yok → görünmüyor.
    expect(matchSendInThread({ body: BODY, anchor: ANCHOR, knownProviderMessageId: "zz", messages: [], taken: new Set() }).found).toBe(false);
  });

  it("🚨 gönderim başlangıcından ÖNCE damgalı aynı metin kanıt DEĞİL (Codex 11-25: 13:59'daki mesaj 14:00 gönderiminin kanıtı olamaz) — geri pay YOK", () => {
    // Eski kural 2 dk geri pay veriyordu: 1 dk önceki, kimsenin sahiplenmediği aynı metin yeni gönderimi "gönderildi" yapıyordu.
    for (const ms of [-60_000, -1, -2 * 60_000, -10 * 60_000]) {
      expect(matchSendInThread({ body: BODY, anchor: ANCHOR, messages: [out("p", BODY, ms)], taken: new Set() }), String(ms)).toEqual({
        found: false,
        evidence: "not_seen",
      });
    }
    // Önce damgalı eski mesaj, sonra damgalı gerçek yankı birlikteyse yankı seçilir (eski mesaj en erken diye seçilmez).
    expect(matchSendInThread({ body: BODY, anchor: ANCHOR, messages: [out("old", BODY, -30_000), out("echo", BODY, 5_000)], taken: new Set() })).toEqual({
      found: true,
      providerMessageId: "echo",
      evidence: "content",
    });
    // Sağlayıcı KİMLİĞİ kesin kanıttır: zaman damgası ne olursa olsun (önce damgalı da) kimlik eşleşmesi doğrular.
    expect(matchSendInThread({ body: BODY, anchor: ANCHOR, knownProviderMessageId: "k1", messages: [out("k1", BODY, -60_000)], taken: new Set() }).evidence).toBe("id");
  });

  it("sınırlar: tam gönderim anında (0) ve tam pencere sonunda (+24 sa) aday", () => {
    expect(matchSendInThread({ body: BODY, anchor: ANCHOR, messages: [out("s", BODY, 0)], taken: new Set() }).found).toBe(true);
    expect(matchSendInThread({ body: BODY, anchor: ANCHOR, messages: [out("t", BODY, RECONCILE_WINDOW_MS)], taken: new Set() }).found).toBe(true);
  });

  it("biçim farkı yok sayılır (satır sonu, baş / son boşluk, boşluk dizisi, Unicode birleşik / ayrık), içerik değil", () => {
    const decomposed = "Hoş geldiniz\r\n  Kapı kodu  1234 ";
    expect(normalizeForReconcile(decomposed)).toBe(normalizeForReconcile("Hoş geldiniz\nKapı kodu 1234"));
    expect(matchSendInThread({ body: "Hoş geldiniz\nKapı kodu 1234", anchor: ANCHOR, messages: [out("u", decomposed, 1)], taken: new Set() }).found).toBe(true);
    expect(matchSendInThread({ body: "   ", anchor: ANCHOR, messages: [out("v", "   ", 1)], taken: new Set() }).found).toBe(false); // boş metin hiçbir şeyi doğrulamaz
  });

  it("birden çok aday → en erken yazılan (eşit zamanda kimlik sırası)", () => {
    const r = matchSendInThread({ body: BODY, anchor: ANCHOR, messages: [out("z2", BODY, 5_000), out("z1", BODY, 2_000), out("y", BODY, 2_000)], taken: new Set() });
    expect(r).toEqual({ found: true, providerMessageId: "y", evidence: "content" });
  });
});
