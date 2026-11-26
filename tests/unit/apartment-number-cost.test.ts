import { describe, it, expect } from "vitest";
import { apartmentNumberOf } from "@/lib/kb-placeholders";

// ---------------------------------------------------------------------------
// DAİRE NUMARASI OKUYUCUSU — KARESEL İŞ YOK (09-28 ReDoS denetimi, ölçüldü). `apartmentNumberOf` mülk adından `{daire}` değerini
// okur (bilgi tabanı ikamesi, karşılama mesajları). İki kalıp karesel geri izliyordu: sayının solundaki son sözcük
// (`/(\p{L}+)[^\p{L}\p{N}]*$/u`, uzun harf dizisinde her konumdan yeniden) ve etiketten sonraki `\s*[:.]?\s*` (iki bitişik boşluk
// yıldızı, uzun boşlukta rakam gelmeyince). 16.000 harflik adda 4,9 sn; ad API'de 200 karakterle sınırlı ama kanal senkronuyla
// sınırsız gelebilir. Yeniler eskileriyle aynı dili tanır (eski ↔ yeni 29.719 metin × 5 biçimde fark 0, 09-28).
// ---------------------------------------------------------------------------

function ms(f: () => unknown): number {
  const t0 = performance.now();
  f();
  return performance.now() - t0;
}

describe("süre (eski: 16k harflik adda 4,9 sn)", () => {
  it("🚨 sayının solunda uzun harf dizisi", () => {
    apartmentNumberOf("Lale 5"); // ısınma
    expect(ms(() => apartmentNumberOf(`Lale ${"a".repeat(16_000)}_x 5`))).toBeLessThan(50);
  });

  it("🚨 etiketten sonra uzun boşluk, ardından rakam yok", () => {
    for (const label of ["Daire", "Apartment", "No", "#"]) {
      expect(ms(() => apartmentNumberOf(`${label}${" ".repeat(20_000)}x`)), label).toBeLessThan(50);
    }
  });
});

describe("davranış aynı (eski kalıplarla birebir örnekler)", () => {
  it.each([
    ["Daire 5", "5"],
    ["Daire   5", "5"],
    ["Daire  :  12 Kat 3", "12"],
    ["No:12 D:5", "5"],
    ["No :  12", "12"],
    ["#  7", "7"],
    ["Daire\t\t9", "9"],
    ["Daire 5 - 2 Yatak Odalı", "5"],
    ["Cozy Studio Sleeps   4", null],
    ["Villa for 6", null],
    ["Kapasite: 8 kişi", null],
    ["Lale 3 | 2+1", null],
    ["Lale 3", "3"],
    ["café 5", "5"], // birleşen işaret sözcüğü böler: "cafe" sayaç değil
    ["Sleepś 4", null], // "Sleeps" + işaret: son sözcük yine "sleeps"
    ["𝐒𝐥𝐞𝐞𝐩𝐬 4", "4"], // matematik harfleri küçülmez → "sleeps" değil
    ["Sleeps𝐀 4", "4"], // vekil çifti TEK harf: son sözcük "sleeps𝐀" (sayaç değil) — yarım vekili harf-dışı saymak "sleeps" okurdu
    ["\ud800 5", "5"], // tek başına vekil harf değil
    ["Sleeps² 4", "4"], // ASCII olmayan rakam ("²") sözcükle sayı arasında: son sözcük yok (eski kalıp da okumuyordu)
    ["Sleeps 2 4", null], // iki sayı → belirsiz
    ["Sleeps2 4", null],
  ])("%j → %j", (name, expected) => {
    expect(apartmentNumberOf(name)).toBe(expected);
  });
});
