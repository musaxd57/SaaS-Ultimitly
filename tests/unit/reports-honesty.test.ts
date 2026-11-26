import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TOP_TOPICS_WINDOW_DAYS } from "@/lib/reports";

// ---------------------------------------------------------------------------
// RAPORLAR — ÜÇ DÜRÜSTLÜK KUSURU (ölçüm turu, 2026-09-11).
//
// ① PERFORMANS ROZETİ HEP YEŞİLDİ. `tone="success"` SABİT literal'dı; not
//    gerçekten değişiyor (A ≥90 · B ≥75 · C ≥60 · D ≥45 · else F "Kritik") ama
//    **F bile yeşil rozette** basılıyordu — gösterge her koşulda "iyi gidiyor"
//    diyordu.
// ② "~N saat kazandırdı" = mesaj sayısı × **4 dakika**, ve bu sabitin tek
//    dayanağı bir kod yorumuydu. Ölçüm YOK; mesaj uzunluğu, dil, tekrar,
//    QR/kanal ayrımı hesaba girmiyor. Cümle bunu VARSAYIM diye söylemiyordu.
// ③ "En Çok Sorulanlar" sorgusunda hiçbir TARİH FİLTRESİ yoktu → tüm zamanlar.
//    Kardeş rapor 30 gün kuruyor ve sayfa "Her kart kendi dönemini belirtir"
//    DİYOR; kart hem farklı dönem kullanıyor hem o iddiayı yalanlıyordu.
// ---------------------------------------------------------------------------

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const PAGE = "src/app/(app)/reports/page.tsx";
const LIB = "src/lib/reports.ts";

describe("raporlar — performans notu rengi", () => {
  it("🚨 SABİT yeşil rozet GERİ GELMEZ", () => {
    expect(read(PAGE)).not.toMatch(/<Badge tone="success">\{score\.grade\}/);
  });

  it("🚨 not KENDİ rengini alır ve F kırmızıdır", () => {
    const s = read(PAGE);
    expect(s).toMatch(/GRADE_TONE\[score\.grade\]/);
    expect(s).toMatch(/F:\s*"destructive"/);
    // Aşırı uygulama kontrolü: A hâlâ yeşil (her şeyi kırmızıya çevirmedik).
    expect(s).toMatch(/A:\s*"success"/);
  });

  it("anti-vakum: 'F' notu ürünün GERÇEKTEN ürettiği bir değer", () => {
    expect(read(LIB)).toMatch(/grade = "F"/);
  });
});

describe("raporlar — 'kazandırdı' cümlesi", () => {
  it("🚨 4 dakika bir VARSAYIM olarak ADLANDIRILDI (satır içi sihirli sayı değil)", () => {
    const s = read(PAGE);
    expect(s).toContain("MINUTES_PER_MESSAGE_ASSUMPTION");
    expect(s).not.toMatch(/const savedMinutes = autoMessages \* 4;/);
  });

  it("🚨 ekrandaki cümle VARSAYIMI söyler (ölçüm gibi sunmaz)", () => {
    const s = read(PAGE);
    expect(s).toMatch(/varsayımıyla/);
    // Eski wording kesin konuşuyordu.
    expect(s).not.toMatch(/tahminen <strong[^>]*>~\{savedHours\} saat<\/strong> kazandırdı/);
  });
});

describe("raporlar — 'En Çok Sorulanlar' dönemi", () => {
  it("🚨 sorgunun ZAMAN PENCERESİ var (eskiden tüm zamanlar)", () => {
    const s = read(LIB);
    const at = s.indexOf("export async function getTopTopics");
    expect(at, "getTopTopics bulunamadı").toBeGreaterThan(-1);
    const body = s.slice(at, at + 900);
    expect(body).toContain("createdAt: { gte: since }");
    expect(body).toContain("TOP_TOPICS_WINDOW_DAYS");
  });

  it("pencere KARDEŞ raporla aynı (30 gün) ve ekranda YAZILI", () => {
    expect(TOP_TOPICS_WINDOW_DAYS).toBe(30);
    expect(read(PAGE)).toMatch(/En Çok Sorulanlar \(son \{TOP_TOPICS_WINDOW_DAYS\} gün\)/);
  });
});
