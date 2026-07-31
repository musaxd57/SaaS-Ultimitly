import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// YANIT ÖNBELLEK POLİTİKASI — kaynak-tarama pin testi (export secret-scan emsali).
//
// Tehdit: kiracıya özel bir JSON yanıtının paylaşımlı bir önbellekte (CDN/proxy)
// saklanabilir hâle gelmesi. O an bir müşterinin verisi başka birine servis
// edilebilir ve bu, kodda hiçbir yerde "hata" gibi görünmez.
//
// Bugün güvendeyiz ama YAPISAL olarak değil, üç ayrı tesadüfün üstünde duruyoruz:
// Next 15 route handler'ları varsayılan olarak cache'lemiyor, hassas rotalar
// açıkça `no-store` diyor ve origin paylaşımlı bir CDN arkasında değil. Bu test
// üçüncüsünü koruyamaz ama BİZİM elimizde olanı pinler: hiçbir API rotası
// kendini cache'lenebilir ilan etmesin.
//
// (Codex "cache poisoning" turunun kodda karşılığı olan kısmı budur. Aynı turdaki
// "ETag uzunluk karşılaştırması" maddesinin hedefi yok: kaynak kodda tek bir
// `etag`/`if-none-match` geçişi yok — aşağıda o da pinlendi ki biri ETag mantığı
// eklerse bu testi görüp zamanlama-güvenli karşılaştırmayı düşünsün.)
// ---------------------------------------------------------------------------

const API_DIR = path.resolve(__dirname, "../../src/app/api");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** `max-age` / `s-maxage` with a NON-zero value, or an explicit `public`. */
const CACHEABLE = /(^|[\s,;"'])public([\s,;"']|$)|(s-)?max-age\s*=\s*[1-9]/i;

describe("API yanıtları paylaşımlı önbelleğe girmez", () => {
  const files = walk(API_DIR);

  it("taranan rota dosyası bulundu (test kendini boşa düşürmesin)", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("hiçbir API rotası cache'lenebilir Cache-Control yazmıyor", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const line of src.split("\n")) {
        if (!/cache-control/i.test(line)) continue;
        if (CACHEABLE.test(line)) offenders.push(`${path.relative(API_DIR, file)}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("ETag/If-None-Match mantığı YOK — varsa zamanlama-güvenli karşılaştırma düşünülmeli", () => {
    const hits = files.filter((f) => /\betag\b|if-none-match/i.test(readFileSync(f, "utf8")));
    expect(hits.map((f) => path.relative(API_DIR, f))).toEqual([]);
  });
});

describe("global güvenlik başlıkları (next.config.mjs)", () => {
  it("her yanıta giden blok cache'lenebilir Cache-Control EKLEMİYOR", async () => {
    const config = (await import("../../next.config.mjs")).default;
    const blocks = await config.headers!();
    const global = blocks.find((b) => b.source === "/(.*)");
    expect(global).toBeDefined();
    const cache = global!.headers.find((h) => h.key.toLowerCase() === "cache-control");
    expect(cache).toBeUndefined();
  });

  it("public,max-age YALNIZ marka görsellerinde (dışarıdan gömülmesi İSTENEN dosyalar)", async () => {
    const config = (await import("../../next.config.mjs")).default;
    const blocks = await config.headers!();
    const cacheable = blocks.filter((b) =>
      b.headers.some((h) => h.key.toLowerCase() === "cache-control" && CACHEABLE.test(h.value)),
    );
    expect(cacheable.map((b) => b.source).sort()).toEqual(["/lixus-logo-icon.png", "/lixus-logo.png"]);
  });

  it("ENFORCE edilen CSP form-action 'self' içeriyor (enjekte edilen formla veri sızdırma)", async () => {
    const config = (await import("../../next.config.mjs")).default;
    const blocks = await config.headers!();
    const global = blocks.find((b) => b.source === "/(.*)")!;
    const csp = global.headers.find((h) => h.key === "Content-Security-Policy")!.value;
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("frame-ancestors 'self'");
    // script-src enforce EDİLMEZ — nonce altyapısı gelmeden panelin tamamını kırar.
    expect(csp).not.toContain("script-src");
  });

  it("report-only politika uygulamayı DOĞRU anlatıyor (Paddle adlandırılmış)", async () => {
    const config = (await import("../../next.config.mjs")).default;
    const blocks = await config.headers!();
    const global = blocks.find((b) => b.source === "/(.*)")!;
    const ro = global.headers.find((h) => h.key === "Content-Security-Policy-Report-Only")!.value;
    // Ayarlar sayfası Paddle.js'i cdn.paddle.com'dan yüklüyor. Report-only bunu
    // saymazsa "hedef politika" hiçbir zaman açılamayacak bir politikadır.
    expect(ro).toContain("https://cdn.paddle.com");
    expect(ro).toContain("connect-src 'self' https://*.paddle.com");
  });
});
