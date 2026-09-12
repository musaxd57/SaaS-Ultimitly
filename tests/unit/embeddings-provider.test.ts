import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  embedTexts,
  embedText,
  cosineOfUnit,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_BATCH_MAX,
  EMBEDDING_INPUT_MAX_CHARS,
} from "@/lib/ai/embeddings/provider";

// ---------------------------------------------------------------------------
// EMBEDDING SAĞLAYICISI (E1) — kurucu kararı 09-12 ("embeddingi açalım").
//
// 🚨 BU DİLİMDE ÜCRETLİ SERVİSE TEK BİR İSTEK GİTMEZ: modülün ÜRETİMDE HİÇBİR
// ÇAĞIRANI YOK (mimari pin ↓) ve bu dosyadaki her çağrı `fetch` MOCK'ludur.
//
// Ölçülen gerekçe (embedding NEDEN): bugünkü seçim tamamen sözcüksel; Rusça ve
// Arapça sorguların TAMAMI `no_lexical_hits`e düşüyor. Maliyet gerekçe DEĞİL
// (tüm KB 0,18 sent) — KAPSAM gerekçe.
// ---------------------------------------------------------------------------

const unit = (n = EMBEDDING_DIMENSIONS) => Array.from({ length: n }, (_, i) => (i === 0 ? 3 : 0));
const okBody = (count: number, dims = EMBEDDING_DIMENSIONS) => ({
  data: Array.from({ length: count }, (_, index) => ({ index, embedding: unit(dims) })),
});
const mockFetch = (body: unknown, ok = true, status = 200) =>
  vi.fn().mockResolvedValue({ ok, status, json: async () => body });

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("embedTexts — mutlu yol", () => {
  it("vektör döner ve L2 NORMALİZE edilmiştir (kosinüs = nokta çarpımı)", async () => {
    vi.stubGlobal("fetch", mockFetch(okBody(1)));
    const out = await embedTexts(["havlular nerede"]);
    expect(out).not.toBeNull();
    expect(out![0]).toHaveLength(EMBEDDING_DIMENSIONS);
    // Girdi [3,0,0,…] idi → normalize [1,0,0,…]
    expect(out![0][0]).toBeCloseTo(1, 10);
    const norm = Math.sqrt(out![0].reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 10);
  });

  it("🚨 SIRA `index` alanından kurulur — sağlayıcı karışık dönse bile", async () => {
    // Sıraya körü körüne güvenmek SESSİZ EŞLEŞME HATASI üretirdi: "2. parçanın
    // vektörü" aslında 3. parçanınki olurdu ve hiçbir test bunu görmezdi.
    const a = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0));
    const b = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 1 ? 1 : 0));
    vi.stubGlobal(
      "fetch",
      mockFetch({ data: [{ index: 1, embedding: b }, { index: 0, embedding: a }] }),
    );
    const out = await embedTexts(["birinci", "ikinci"]);
    expect(out![0][0]).toBeCloseTo(1, 10); // birinci → a
    expect(out![1][1]).toBeCloseTo(1, 10); // ikinci  → b
  });

  it("boş liste ağa ÇIKMADAN boş döner", async () => {
    const f = mockFetch(okBody(0));
    vi.stubGlobal("fetch", f);
    expect(await embedTexts([])).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("🚨 FAIL-OPEN — her arıza `null`, ASLA fırlatma", () => {
  it("anahtar YOKSA ağa çıkmaz (ücretli servis yok)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const f = mockFetch(okBody(1));
    vi.stubGlobal("fetch", f);
    expect(await embedTexts(["x"])).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("HTTP hatası → null", async () => {
    vi.stubGlobal("fetch", mockFetch({}, false, 429));
    expect(await embedTexts(["x"])).toBeNull();
  });

  it("ağ/timeout fırlatsa bile null (çağıran çökmez)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    await expect(embedTexts(["x"])).resolves.toBeNull();
  });

  it("🚨 BOYUT UYUŞMAZLIĞI reddedilir (sessizce kabul = bozuk indeks)", async () => {
    vi.stubGlobal("fetch", mockFetch(okBody(1, 768)));
    expect(await embedTexts(["x"])).toBeNull();
  });

  it("eksik satır → TAMAMI null (kısmi sonuç DÖNMEZ)", async () => {
    vi.stubGlobal("fetch", mockFetch({ data: [{ index: 0, embedding: unit() }] }));
    expect(await embedTexts(["a", "b"])).toBeNull();
  });

  it("NaN/Infinity taşıyan vektör reddedilir", async () => {
    const bad = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? NaN : 0));
    vi.stubGlobal("fetch", mockFetch({ data: [{ index: 0, embedding: bad }] }));
    expect(await embedTexts(["x"])).toBeNull();
  });

  it("SIFIR vektör reddedilir (normalize edilemez)", async () => {
    const zero = new Array(EMBEDDING_DIMENSIONS).fill(0);
    vi.stubGlobal("fetch", mockFetch({ data: [{ index: 0, embedding: zero }] }));
    expect(await embedTexts(["x"])).toBeNull();
  });
});

describe("girdi kapıları — ağa ÇIKMADAN eler (maliyet + gürültü)", () => {
  it.each([
    ["boş metin", [""]],
    ["yalnız boşluk", ["   "]],
    ["tavanı aşan metin", ["x".repeat(EMBEDDING_INPUT_MAX_CHARS + 1)]],
    ["parti tavanını aşan liste", new Array(EMBEDDING_BATCH_MAX + 1).fill("x")],
  ])("%s → null", async (_ad, input) => {
    const f = mockFetch(okBody(1));
    vi.stubGlobal("fetch", f);
    expect(await embedTexts(input as string[])).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});

describe("cosineOfUnit", () => {
  it("aynı vektör → 1, dik vektör → 0", () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineOfUnit(a, a)).toBeCloseTo(1, 10);
    expect(cosineOfUnit(a, b)).toBeCloseTo(0, 10);
  });

  it("🚨 boyut uyuşmazlığı `null` — 0 DEĞİL", () => {
    // 0 dönmek "hiç benzemiyor" diye okunurdu; gerçek durum "karşılaştırılamaz".
    expect(cosineOfUnit([1, 0], [1, 0, 0])).toBeNull();
    expect(cosineOfUnit([], [])).toBeNull();
  });

  it("sonuç [-1,1] aralığına kelepçelenir (kayan nokta taşması)", () => {
    const v = [1.0000000001, 0];
    expect(cosineOfUnit(v, v)!).toBeLessThanOrEqual(1);
  });
});

describe("embedText — tek metin sarmalayıcı", () => {
  it("tek vektör döner", async () => {
    vi.stubGlobal("fetch", mockFetch(okBody(1)));
    const v = await embedText("wifi şifresi");
    expect(v).toHaveLength(EMBEDDING_DIMENSIONS);
  });
});

describe("🚨 E1 MİMARİ PİN — ÜRETİMDE HİÇBİR ÇAĞIRAN YOK ($0)", () => {
  it("provider yalnız TESTLERDEN import edilir", () => {
    // Bu satır E1'in TANIMIDIR: sözleşme kurulur, ücretli servis ÇAĞRILMAZ.
    // E3/E5'te bağlanınca bu test BİLİNÇLİ olarak güncellenir — sessizce
    // bağlanamaz. Aksi hâlde "ücretli servis yok" iddiası sessizce ölürdü.
    const out = execImporters();
    expect(out, `üretimde çağıran belirdi: ${out.join(", ")}`).toEqual([]);
  });

  it("anti-vakum: tarama GERÇEKTEN çalışıyor (BU dosya bulunuyor)", () => {
    // 🚨 FAIL-OPEN YOK: "tarama çalışmadı" sessizce "çağıran yok" diye
    // okunamaz. Bu dosyanın KENDİSİ provider'ı import ediyor — bulunmuyorsa
    // yukarıdaki boş-küme iddiası da anlamsızdır.
    const all = execImporters(true);
    expect(all).toContain("tests/unit/embeddings-provider.test.ts");
  });

  it("🚨 İKİNCİ KATMAN TEK BAŞINA da aynı hükmü veriyor (git yoksa/çalışmazsa)", () => {
    // 🚨 BU TEST GİT'İN VARLIĞINI ŞART KOŞMAZ — ilk yazımda koşuyordu ve o,
    // düzeltmeye çalıştığım ortam bağımlılığının ta kendisiydi (ölçüldü: git'i
    // 128 döndüren bir stub'la değiştirince YALNIZ bu satır kırmızıya döndü,
    // mimari pin doğru çalışmaya devam etti).
    const viaWalk = walkFiles(REPO)
      .filter((f) => /\.tsx?$/.test(f) && f.startsWith("src/"))
      .filter((f) => !f.endsWith("src/lib/ai/embeddings/provider.ts"))
      .filter((f) => {
        try {
          return /from\s+"@\/lib\/ai\/embeddings\/provider"/.test(readFileSync(join(REPO, f), "utf8"));
        } catch {
          return false;
        }
      });
    // Hüküm AYNI: üretimde çağıran yok. Git çalışsa da çalışmasa da.
    expect(viaWalk).toEqual([]);
    // Anti-vakumluk: tarama gerçekten dosya görüyor (boş dizin değil).
    expect(walkFiles(REPO).length).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------
// 🚨 ORTAM BAĞIMSIZLIĞI — CI'DA ÖLÇÜLDÜ (koşu #1076, commit `4c5262c`).
//
// İlk yazımda düz `git ls-files` kullandım ve CI KIRMIZI verdi:
//   fatal: detected dubious ownership in repository at '/__w/…'
// Checkout'u yapan kullanıcı ile testi koşan kullanıcı farklı. Yerelde yeşildi.
//
// ⚠️ BU DERS REPODA ZATEN YAZILIYDI: `brand-name-absent.test.ts` AYNI hatayı
// koşu #1058'de ölçmüş ve çözümünü kendi başlığına yazmıştı; ben yeni bir
// git tabanlı pin yazarken o satırları okumadım. İdiom oradan AYNEN alındı:
//   1) `safe.directory` KOMUT kapsamında verilir (`git -c …`) — global/system
//      git ayarına DOKUNULMAZ.
//   2) Git herhangi bir sebeple çalışmazsa DOSYA SİSTEMİ TARAMASI devreye girer.
// 🚨 FAIL-OPEN YOK: iki katman da boş dönerse anti-vakumluk testi kırmızıdır —
// "tarama çalışmadı" sessizce "çağıran yok" diye okunamaz.
// ---------------------------------------------------------------------------

const REPO = join(__dirname, "..", "..");
const SKIP_DIRS = new Set([
  ".git", "node_modules", ".next", "dist", "build", "coverage",
  "playwright-report", "test-results", ".turbo", ".vercel",
]);

/** Katman 1 — takip edilen dosyalar. Başarısızsa `null` (istisna DEĞİL). */
function trackedFiles(): string[] | null {
  try {
    const out = execFileSync("git", ["-c", `safe.directory=${REPO}`, "ls-files", "-z"], {
      cwd: REPO,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    const files = out.split("\0").filter(Boolean);
    return files.length > 0 ? files : null;
  } catch {
    return null;
  }
}

/** Katman 2 — dosya sistemi taraması (git yoksa / çalışmazsa). */
function walkFiles(dir: string, rel = ""): string[] {
  const acc: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      acc.push(...walkFiles(join(dir, entry.name), relPath));
    } else if (entry.isFile()) {
      acc.push(relPath);
    }
  }
  return acc;
}

/** `embeddings/provider` import eden dosyalar; varsayılan olarak yalnız `src/`. */
function execImporters(includeTests = false): string[] {
  return (trackedFiles() ?? walkFiles(REPO))
    .filter((f) => /\.tsx?$/.test(f) && (f.startsWith("src/") || f.startsWith("tests/")))
    .filter((f) => {
      if (f.endsWith("src/lib/ai/embeddings/provider.ts")) return false;
      if (!includeTests && f.startsWith("tests/")) return false;
      try {
        return /from\s+"@\/lib\/ai\/embeddings\/provider"/.test(readFileSync(join(REPO, f), "utf8"));
      } catch {
        return false;
      }
    });
}
