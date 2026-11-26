import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { LEGACY_AI_SENDER_NAMES, LEGACY_AI_RESUME_SENDER } from "@/lib/message-author";

// ─────────────────────────────────────────────────────────────────────────────
// STİL PROFİLİ BOTUN KENDİ YANITLARINI ÖRNEKLEMEZ (denetim, 08-09)
//
// `refreshStyleProfile` "host'un gerçek yanıtları" diye örnek toplarken filtre
// olarak YALNIZ `senderName: { not: "GuestOps AI" }` kullanıyordu — tek bir
// ESKİ sihirli string. Oysa QR concierge kendi AI yanıtlarını
// `senderName: "Lixus AI", authorType: "ai"` diye yazıyor: bot çıktısı "host
// sesi" sayılıp profile damıtılıyordu.
//
// Zarar iki katmanlı:
//  (a) Model kendi çıktısıyla besleniyor — geri besleme döngüsü.
//  (b) Profil prompt'a bir CEVAP KAYNAĞI olarak giriyor ("bu rehberdeki sık
//      sorulan sorular kısmı açıkça karşılıyorsa o cevabı temel al"). Yani bir
//      misafirin QR sohbetinde bota söylettiği politika cümlesi, org genelinde
//      BAŞKA misafirlere OTOMATİK giden yanıtlara sızabiliyordu — üstelik
//      `usedSources` onu "history" diye etiketlediği için arayüzde doğrulanmış
//      kanıt gibi görünüyordu.
//
// Doğru filtre bir dosya ötede zaten vardı (`quality-audit.ts`): `authorType`
// birincil, `senderName` yalnız damgasız ESKİ satırlar için.
//
// ⚠️ Bu bir KAYNAK TARAMASIDIR ve tek yönlüdür (deponun kendi kuralı): sorguyu
// gerçekten koşturmaz. Yakaladığı şey, filtrenin tek-ada geri dönmesidir —
// gerilemenin gözlenen biçimi tam olarak buydu.
// ─────────────────────────────────────────────────────────────────────────────

function styleProfileQuery(): string {
  const src = readFileSync("src/lib/automation.ts", "utf8");
  const start = src.indexOf("export async function refreshStyleProfile");
  expect(start).toBeGreaterThan(-1); // çapa kayarsa test SESSİZCE no-op olmasın
  const from = src.indexOf("prisma.message.findMany", start);
  expect(from).toBeGreaterThan(-1);
  const to = src.indexOf("take: 40", from);
  expect(to).toBeGreaterThan(-1);
  return src
    .slice(from, to)
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
    .join("\n");
}

describe("refreshStyleProfile — örnek kaynağı", () => {
  it("AI adlarının TAMAMI tek kaynaktan gelir, elle yazılmış tek ad DEĞİL", () => {
    const q = styleProfileQuery();
    expect(q).toContain("LEGACY_AI_SENDER_NAMES");
    // Elle yazılmış çıplak ad = eski hatanın ta kendisi. Liste büyüdüğünde
    // (ör. üçüncü bir marka adı) buradaki filtre kendiliğinden genişlemeli.
    expect(q).not.toMatch(/"GuestOps AI"/);
    expect(q).not.toMatch(/"Lixus AI"/);
  });

  it("`authorType` birincil sinyaldir (senderName yalnız damgasız eski satırlar için)", () => {
    const q = styleProfileQuery();
    expect(q).toContain("authorType");
    // Pozitif seçim: "host" damgalı satırlar açıkça istenir. Kara liste yazmak
    // `authorType:"system"`i (QR "AI devam ediyor" işaretçisi) elemezdi.
    expect(q).toMatch(/authorType:\s*"host"/);
  });

  it("QR devam-işaretçisi de örneklenmez", () => {
    expect(styleProfileQuery()).toContain("LEGACY_AI_RESUME_SENDER");
  });

  it("ÖN KOŞUL: sabitler gerçekten iki AI adını ve devam işaretçisini taşıyor", () => {
    // Bu olmadan yukarıdaki testler boş bir listeye karşı yeşil kalabilirdi.
    expect(LEGACY_AI_SENDER_NAMES).toContain("GuestOps AI");
    expect(LEGACY_AI_SENDER_NAMES).toContain("Lixus AI");
    expect(LEGACY_AI_RESUME_SENDER).toBe("__lixus_ai_resumed__");
  });
});
