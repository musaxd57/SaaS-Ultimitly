import { describe, it, expect } from "vitest";
import { buildUnderstandingUserContent } from "@/lib/ai/semantic/understand";

// G1 (kurucu kararı 10-13 "Evet, kredi gelince ölç"): anlama katmanı otomatik şablon mesajını "Host:" diye görüyordu → model onu ev
// sahibinin kendi sözü sanabilirdi. Örnek: "Hoş geldiniz! Giriş 15:00" → önce "Host: <<<Hoş geldiniz…>>>", sonra "Automated message: …".
describe("anlama katmanı — otomatik şablon mesajı etiketi", () => {
  const history = [
    { direction: "inbound" as const, body: "Merhaba, otopark var mı?" },
    { direction: "outbound" as const, body: "Hoş geldiniz! Giriş 15:00", author: "automation" },
    { direction: "outbound" as const, body: "Evet, bina altında.", author: "host" },
    { direction: "inbound" as const, body: "Wifi şifresi nedir?" },
  ];

  it("otomatik mesaj 'Automated message' etiketi taşır, ev sahibi cevabı 'Host' kalır", () => {
    const content = buildUnderstandingUserContent({ guestMessage: "Wifi şifresi nedir?", history });
    expect(content).toContain("Automated message: <<<Hoş geldiniz! Giriş 15:00>>>");
    expect(content).toContain("Host: <<<Evet, bina altında.>>>");
    expect(content).not.toContain("Host: <<<Hoş geldiniz");
  });

  it("KONTROL: yazar bilgisi yoksa (eski çağıran) bugünkü etiket aynen", () => {
    const content = buildUnderstandingUserContent({
      guestMessage: "Wifi şifresi nedir?",
      history: history.map(({ author: _a, ...m }) => m),
    });
    expect(content).toContain("Host: <<<Evet, bina altında.>>>");
    expect(content).not.toContain("Automated message");
  });

  it("G1b (ölçüm 10-14): son cevaptan SONRA gelen şablon cevapsız mesajların ARASINA, kronolojik yerine, numarasız yazılır", () => {
    const content = buildUnderstandingUserContent({
      guestMessage: "Tamam, 12'de geliriz.",
      history: [
        { direction: "outbound", body: "Evet, otopark var.", author: "host" },
        { direction: "inbound", body: "Erken gelebilir miyiz?" },
        { direction: "outbound", body: "Hoş geldiniz! Giriş 15:00.", author: "automation" },
        { direction: "inbound", body: "Tamam, 12'de geliriz." },
      ],
    } as never);
    const lines = content.split("\n");
    const i1 = lines.findIndex((l) => l.startsWith("[1]") && l.includes("Erken gelebilir"));
    const it = lines.findIndex((l) => l.startsWith("Automated message (not an answer)") && l.includes("Giriş 15:00"));
    const i2 = lines.findIndex((l) => l.startsWith("[2]") && l.includes("12'de geliriz"));
    expect(i1).toBeGreaterThan(-1);
    expect(it).toBeGreaterThan(i1);
    expect(i2).toBeGreaterThan(it);
    // Bağlamda yalnız gerçek cevap; şablon numara almaz.
    expect(content).not.toMatch(/\[\d+\][^\n]*Giriş 15:00/u);
  });
  it("G1b: şablonlar bağlam tavanından yer YEMEZ, en çok son 2 şablon görünür", () => {
    const history = [
      ...Array.from({ length: 6 }, (_, i) => ({ direction: i % 2 ? ("outbound" as const) : ("inbound" as const), body: `gerçek ${i}`, ...(i % 2 ? { author: "host" } : {}) })),
      ...Array.from({ length: 4 }, (_, i) => ({ direction: "outbound" as const, body: `şablon ${i}`, author: "automation" })),
      { direction: "inbound" as const, body: "Soru?" },
    ];
    const content = buildUnderstandingUserContent({ guestMessage: "Soru?", history } as never);
    for (let i = 1; i < 6; i++) expect(content).toContain(`gerçek ${i}`);
    expect(content).not.toContain("şablon 0");
    expect(content).not.toContain("şablon 1");
    expect(content).toContain("şablon 2");
    expect(content).toContain("şablon 3");
  });

  it("G1b: son misafir mesajından SONRA yazılan şablon en sona, numarasız gider (AI öner yolu)", () => {
    const content = buildUnderstandingUserContent({
      guestMessage: "Wi-Fi şifresi neydi?",
      history: [
        { direction: "outbound", body: "Evet.", author: "host" },
        { direction: "inbound", body: "Wi-Fi şifresi neydi?" },
        { direction: "outbound", body: "Yarın çıkış 11:00.", author: "automation" },
      ],
    } as never);
    const lines = content.split("\n");
    const i1 = lines.findIndex((l) => l.startsWith("[1]") && l.includes("Wi-Fi şifresi"));
    const it = lines.findIndex((l) => l.startsWith("Automated message (not an answer)") && l.includes("Yarın çıkış"));
    expect(i1).toBeGreaterThan(-1);
    expect(it).toBe(lines.length - 1);
    expect(it).toBeGreaterThan(i1);
  });
  it("G1b: cevapsız pencere kesildiğinde konum kaymaz; pencere öncesindeki şablon [1]'in önüne düşer", () => {
    const g = (n: number) => ({ direction: "inbound" as const, body: `misafir ${n}` });
    const t = (x: string) => ({ direction: "outbound" as const, body: x, author: "automation" });
    // 7 cevapsız misafir mesajı (tavan 5 → ilk 2 görünmez); şablon A G1–G2 arası (pencere öncesi), şablon B G4–G5 arası.
    const history = [{ direction: "outbound" as const, body: "Hoş geldiniz.", author: "host" }, g(1), t("şablon A"), g(2), g(3), g(4), t("şablon B"), g(5), g(6), g(7)];
    const content = buildUnderstandingUserContent({ guestMessage: "misafir 7", history } as never);
    const lines = content.split("\n");
    const at = (needle: string) => lines.findIndex((l) => l.includes(needle));
    expect(lines.some((l) => l.startsWith("[1]") && l.includes("misafir 3"))).toBe(true);
    // Pencere öncesindeki şablon DÜŞMEZ (görünür) ve [1]'in önündedir.
    expect(at("şablon A")).toBeGreaterThan(-1);
    expect(at("şablon B")).toBeGreaterThan(-1);
    expect(at("şablon A")).toBeLessThan(at("misafir 3"));
    expect(at("şablon B")).toBeGreaterThan(at("misafir 4"));
    expect(at("şablon B")).toBeLessThan(at("misafir 5"));
  });
  it("G1b: yazıldığı an damgası şablon satırına da gider (bayrak açıkken)", () => {
    const at = new Date("2026-10-14T18:00:00Z");
    const content = buildUnderstandingUserContent({
      guestMessage: "Kartı bulamadık.",
      history: [
        { direction: "outbound", body: "Wi-Fi bilgileri kartta.", author: "automation", at },
        { direction: "inbound", body: "Kartı bulamadık.", at: new Date("2026-10-14T19:00:00Z") },
      ],
      writtenStamp: (d: Date) => d.toISOString().slice(11, 16),
    } as never);
    expect(content).toMatch(/Automated message \(not an answer\) \(written 18:00\): <<<Wi-Fi bilgileri kartta\.>>>/u);
  });
});
