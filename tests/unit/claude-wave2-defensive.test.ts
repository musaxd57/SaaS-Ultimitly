import { describe, it, expect } from "vitest";
import path from "node:path";
import { buildReplyPrompt } from "@/lib/ai/prompts";
import type { SuggestReplyInput } from "@/lib/ai/types";
import { dropSuperseded } from "@/lib/ai/retrieval/rerank";
import { connectionHealth } from "@/lib/channels/health";
import { guardedOutputPath } from "@/lib/eval-real/labeling";
import { hasMoneyStatement } from "@/lib/ai/stay-money";

// ---------------------------------------------------------------------------
// Claude 2. dalga (10-21) — Haiku'nun kodla doğruladığı küçük savunma derinliği kusurları. Her biri kırmızı-önce yazıldı; davranışın
// değişmeyen yarısı KONTROL olarak pinli.
// ---------------------------------------------------------------------------

const base: SuggestReplyInput = {
  guestMessage: "Çıkış saati nedir?",
  property: { name: "Lale", checkInTime: "15:00", checkOutTime: "11:00", address: null, city: null },
  reservation: {
    guestName: "Test Misafir",
    arrivalDate: new Date("2026-09-23T00:00:00.000Z"),
    departureDate: new Date("2026-09-26T00:00:00.000Z"),
    status: "confirmed",
    guestCheckoutTime: "14:30",
  },
  knowledgeBase: [],
  tone: "warm",
  language: "tr",
  timeZone: "Europe/Istanbul",
  now: new Date("2026-09-24T09:00:00.000Z"),
};

describe("#81 / #82 — iddia desteği dayanağı: misafir beyanı ve asistanın kendi cevabı OLGU değildir", () => {
  it("misafirin yazdığı çıkış saati (14:30) olgu listesine girmez; istem yine görür", () => {
    const { text, claimContext } = buildReplyPrompt(base);
    expect(text).toContain("14:30");
    expect(claimContext.facts.join("\n")).not.toContain("14:30");
    expect(claimContext.facts.join("\n")).toContain("Durum: confirmed"); // KONTROL: rezervasyon olgusu duruyor
  });

  it("asistanın eski cevabı operatör dayanağı değildir; ev sahibinin cevabı dayanaktır", () => {
    const { claimContext } = buildReplyPrompt({
      ...base,
      history: [
        { direction: "inbound", body: "Havuz kaçta kapanıyor?", author: "guest" },
        { direction: "outbound", body: "Havuz 23:00'te kapanır.", author: "ai" },
        { direction: "outbound", body: "Otopark ücretsizdir.", author: "host" },
      ],
    } as SuggestReplyInput);
    expect(claimContext.operator).not.toContain("Havuz 23:00'te kapanır.");
    expect(claimContext.operator).toContain("Otopark ücretsizdir.");
  });
});

describe("#29 — sürüm kuralı bozuk veride bütün kalemleri düşürmez", () => {
  it("kendine işaret eden halef kalemi düşürmez", () => {
    expect(dropSuperseded([{ id: "a", supersededById: "a" }]).kept.map((i) => i.id)).toEqual(["a"]);
  });
  it("karşılıklı döngüde ikisi de kalır", () => {
    expect(dropSuperseded([{ id: "a", supersededById: "b" }, { id: "b", supersededById: "a" }]).kept.map((i) => i.id)).toEqual(["a", "b"]);
  });
  it("KONTROL: gerçek halef eskiyi düşürür", () => {
    expect(dropSuperseded([{ id: "a", supersededById: "b" }, { id: "b", supersededById: null }]).kept.map((i) => i.id)).toEqual(["b"]);
  });
});

describe("#32 — bağlantı hata türü: nesne prototipi anahtarı tür sayılmaz", () => {
  const now = new Date("2026-10-21T12:00:00Z");
  it.each(["constructor", "toString", "__proto__"])("%s → unknown", (kind) => {
    const h = connectionHealth({ lastReadOkAt: null, lastReadErrorAt: now, lastReadErrorKind: kind }, now);
    expect(h.errorKind).toBe("unknown");
  });
});

describe("#60 — ölçüm çıktı yolu: '..' ile BAŞLAYAN dosya adı depo içidir", () => {
  const repo = "/repo";
  it("'..adaylar.json' depo içi sayılır (yoksay listesinde değilse reddedilir — dışarı yazım sanılıp atlanmaz)", () => {
    expect(() => guardedOutputPath(repo, "..adaylar.json", () => false)).toThrow(/reddedildi/);
  });
  it("KONTROL: gerçek dışarı yol yine dışarı", () => {
    let insideSeen = false;
    try {
      guardedOutputPath(repo, path.join("..", "out.json"), () => {
        insideSeen = true;
        return true;
      });
    } catch {
      /* karar fonksiyonunun kendi kuralı */
    }
    expect(insideSeen).toBe(false); // depo dışı yol için yoksay sorusu hiç sorulmaz
  });
});

describe("#90 — birimsiz tutar kalıbı boşluk dizisinde karesel değil, sonuç aynı", () => {
  it("'fee is : 45' ve 'ücreti 500' okunur", () => {
    expect(hasMoneyStatement("The fee is : 45")).toBe(true);
    expect(hasMoneyStatement("Temizlik ücreti 500")).toBe(true);
    expect(hasMoneyStatement("The fee is=45")).toBe(true);
    expect(hasMoneyStatement("Kahvaltı 12:00 de")).toBe(false);
  });
  it("50.000 boşluk + ücret sözcüğü tekrarı 1 sn altında", () => {
    const t0 = performance.now();
    hasMoneyStatement(`fee${" ".repeat(50_000)}x ${"fee ".repeat(5_000)}`);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
