import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// NODE SÜRÜMÜ TEK KAYNAKTAN — üç yer de AYNI major'ı söylemeli.
//
// 🚨 Korunan sessiz arıza: CI'nın Node 22'de test ederken Dockerfile'ın Node 20
// ile üretime çıkması. O ayrışma HİÇBİR YERDE hata gibi görünmez — bütün kapılar
// yeşildir — ama üretim, hiç sınanmamış bir çalışma zamanında koşar. Bu sınıfın
// en pahalı hatası tam olarak budur.
//
// Aynı test bir de BAYATLIK sorununu kapatır: Node 20 **2026-04-30'da EOL oldu**
// (nodejs/Release schedule.json) ve depo 08-05'e kadar onu kullanıyordu — yani
// üretim çalışma zamanı üçüncü aydır güvenlik yaması almıyordu. Sürümü tek bir
// yerde değiştirmek artık imkânsız; değişiklik üçünü birden zorlar ve bu, gözden
// geçirenin "yeni sürüm hâlâ destekleniyor mu?" diye sormasını sağlar.
//
// ⚠️ Test EOL TARİHİ BİLMEZ (ağa çıkamaz, ve bir tarih listesini repoda tutmak
// kendi bayatlık sorununu doğururdu). Sadece PARİTEYİ pinler.
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** `FROM …/node:22-slim` → 22 */
function dockerfileMajor(): number {
  const m = /^FROM\s+\S*node:(\d+)[-.]/m.exec(read("Dockerfile"));
  if (!m) throw new Error("Dockerfile'da `FROM …node:<major>-…` satırı bulunamadı");
  return Number(m[1]);
}

/** `node-version: 22` (setup-node) + `image: node:22-bookworm` (container) */
function ciMajors(): { setupNode: number[]; container: number[] } {
  const ci = read(".github/workflows/ci.yml");
  const setupNode = [...ci.matchAll(/^\s*node-version:\s*(\d+)\s*$/gm)].map((m) => Number(m[1]));
  const container = [...ci.matchAll(/^\s*image:\s*node:(\d+)[-.]/gm)].map((m) => Number(m[1]));
  return { setupNode, container };
}

/** `">=22.0.0 <23"` → 22 */
function enginesMajor(): number {
  const engines = JSON.parse(read("package.json")).engines as { node?: string } | undefined;
  if (!engines?.node) throw new Error("package.json'da `engines.node` yok");
  const m = /(\d+)/.exec(engines.node);
  if (!m) throw new Error(`engines.node ayrıştırılamadı: ${engines.node}`);
  return Number(m[1]);
}

describe("Node sürümü — Dockerfile ↔ CI ↔ engines paritesi", () => {
  const docker = dockerfileMajor();
  const { setupNode, container } = ciMajors();

  it("beklenen yerler GERÇEKTEN bulundu (test kendini boşa düşürmesin)", () => {
    // Bu olmadan test vacuous olurdu: bir regex hiçbir şey eşleştirmezse boş
    // liste `every()`'den sessizce geçerdi ve pin ölü koda dönerdi.
    expect(docker).toBeGreaterThan(0);
    expect(setupNode.length).toBeGreaterThanOrEqual(4);
    expect(container.length).toBeGreaterThanOrEqual(1);
  });

  it("CI'daki HER Node pini Dockerfile ile aynı major", () => {
    // `toEqual` ile tam liste karşılaştırması: `every()` yerine bunu kullanmak,
    // hata mesajında hangi değerlerin kaydığını gösterir.
    expect(setupNode).toEqual(setupNode.map(() => docker));
    expect(container).toEqual(container.map(() => docker));
  });

  it("package.json engines de aynı major'ı bildiriyor", () => {
    expect(enginesMajor()).toBe(docker);
  });

  it("çalışan Node da aynı major (yerelde ve CI'da sınanan gerçek runtime)", () => {
    // Testleri üretimin sürümünden BAŞKA bir sürümde koşturmak, paritenin
    // amacını ortadan kaldırır: kapılar yeşil olur ama kanıt üretmezler.
    expect(Number(process.versions.node.split(".")[0])).toBe(docker);
  });
});
