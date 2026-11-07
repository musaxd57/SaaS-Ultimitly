import { describe, it, expect } from "vitest";
import sharp from "sharp";

// ---------------------------------------------------------------------------
// SHARP GÖRÜNTÜ BORU HATTI — yükseltmenin GERÇEKTEN çalıştığının kanıtı
// (Codex itirazı, 2026-09-09).
//
// 🚨 İTİRAZ HAKLIYDI ve bir AYRIM gerektiriyor:
// "/_next/image 404 pini tek başına BAŞARI yolunu doğrulamıyor."
// Doğru. Ama bu uygulamada `/_next/image`in bir başarı yolu YOKTUR ve
// olmaması BİLİNÇLİDİR: `next.config.mjs` `images: { unoptimized: true }`.
// O uçtan 200 aldırmak, `images.unoptimized`i kapatmak demektir — yani
//   (a) kurucunun bu tura koyduğu "güvenlik bayrağı değişikliği yapma"
//       sınırının dışına çıkmak,
//   (b) audit baseline'ının sharp gerekçesini (ULAŞILAMAZ, çünkü optimizer
//       kapalı) kendi elimizle geçersiz kılmak olurdu.
// Bu yüzden itirazın ÖZÜ — "kodek gerçekten çalışıyor mu, çözümlenebilir
// çıktı üretiyor mu" — başarı yolunun MEŞRU olarak var olduğu katmanda,
// sentetik görüntüyle burada ölçülüyor. `/_next/image` tarafında ise e2e
// testi 404'ün SEBEBİNİ bağlıyor (kaynak görsel 200 dönüyor → 404 yalnız
// optimizer kapalı olduğu için).
//
// 🚨 NEDEN SADECE `require("sharp")` YETMEZ: modül yüklenip native ikili
// yarım kurulmuş olabilir (0.35'te kodekler ayrı @img/* paketlerinde gelir).
// Yükseltmenin gerçekten indiğini yalnız ÇALIŞAN bir kodlama-çözme turu
// gösterir.
// ---------------------------------------------------------------------------

/** `GHSA-rgj7-g3m4-5g8c` (libheif) bu sürümde kapandı — altına düşülemez. */
const MIN_SAFE_SHARP = [0, 35, 4] as const;

function parseVersion(v: string): number[] {
  return v.split(".").map((p) => Number.parseInt(p, 10));
}

/** a >= b (sayısal semver karşılaştırması; sürüm dizesi ASLA metin olarak kıyaslanmaz). */
function gte(a: number[], b: readonly number[]): boolean {
  for (let i = 0; i < b.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i];
    if (x > y) return true;
    if (x < y) return false;
  }
  return true;
}

const W = 32;
const H = 24;

function synthetic() {
  // Sentetik görüntü: repoya ikili dosya eklemeden, her koşuda AYNI girdi.
  return sharp({ create: { width: W, height: H, channels: 3, background: { r: 10, g: 120, b: 200 } } });
}

describe("sharp — kurulu sürüm güvenli VE boru hattı çalışıyor", () => {
  it("sürüm zafiyetli aralığın DIŞINDA (metin değil sayısal karşılaştırma)", () => {
    const installed = parseVersion(sharp.versions.sharp);
    expect(
      gte(installed, MIN_SAFE_SHARP),
      `sharp ${sharp.versions.sharp} < ${MIN_SAFE_SHARP.join(".")} — GHSA-rgj7 (libheif) hala acik`,
    ).toBe(true);
    // 🚨 Metin karşılaştırması "0.35.10" < "0.35.4" derdi; sayısal olmak zorunda.
    expect(gte(parseVersion("0.35.10"), MIN_SAFE_SHARP)).toBe(true);
    expect(gte(parseVersion("0.34.5"), MIN_SAFE_SHARP)).toBe(false);
  });

  it("native ikili GERÇEKTEN yüklü (libvips ayakta)", () => {
    // Modülün import edilebilmesi yetmez; libvips sürümü ancak native katman
    // başlatıldıysa okunur.
    expect(sharp.versions.vips).toMatch(/^\d+\.\d+\.\d+/);
  });

  for (const [format, expectedRead] of [
    ["png", "png"],
    ["webp", "webp"],
    // AVIF = `GHSA-rgj7`in konusu olan libheif ailesi; sharp bunu geri
    // okurken "heif" diye raporlar.
    ["avif", "heif"],
  ] as const) {
    it(`${format}: kodlanıyor, geri okunuyor ve ÇÖZÜMLENEBİLİR piksel veriyor`, async () => {
      const encoded = await synthetic()
        .clone()
        .toFormat(format, format === "avif" ? { effort: 0 } : {})
        .toBuffer();
      expect(encoded.length, "kodlayici bos cikti verdi").toBeGreaterThan(0);

      // 1) Beklenen içerik türü: geri okunan format doğru mu?
      const meta = await sharp(encoded).metadata();
      expect(meta.format).toBe(expectedRead);
      expect(meta.width).toBe(W);
      expect(meta.height).toBe(H);

      // 2) ÇÖZÜMLENEBİLİR ÇIKTI: baytlar gerçekten piksele dönüyor mu?
      // (Bozuk bir kodek "geçerli başlık + çözülemeyen gövde" üretebilir;
      // metadata'ya bakmak bunu yakalamaz, ham piksele bakmak yakalar.)
      const raw = await sharp(encoded).raw().toBuffer();
      expect(raw.length).toBe(W * H * (meta.channels ?? 3));
    });
  }

  it("bozuk girdi süreci çökertmez — REDDEDER", async () => {
    const garbage = Buffer.from("bu bir goruntu degil, duz metin".repeat(8), "utf8");
    await expect(sharp(garbage).metadata()).rejects.toThrow();
  });
});
