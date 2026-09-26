import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import path from "node:path";
import { validateBaseline } from "../../scripts/audit-check.mjs";

// ---------------------------------------------------------------------------
// BAĞIMLILIK ZAFİYET TRİAJ KAYDI — biçim pini.
//
// `scripts/audit-check.mjs` bu dosyayı okuyup CI'yi kırar/geçirir, AMA o script
// ağ ister (`npm audit`) ve bu yüzden test paketinde koşamaz. Buradaki testler
// ağa çıkmadan kaydın KENDİSİNİ pinler: bozuk/eksik bir kayıt sessizce
// "muafiyet" gibi davranmasın.
//
// 🚨 Asıl korunan şey EXPIRES. Süresiz bir muafiyet, muafiyet değil unutulmuş
// bir açıktır (`security.txt`'in `Expires` alanıyla aynı ders, RFC 9116 §5.3).
// Bir kayıt `expires`'siz eklenirse script onu asla süresi-dolmuş sayamaz ve
// sonsuza kadar sessizce kabul edilir — bu test o yolu kapatır.
// ---------------------------------------------------------------------------

type Entry = {
  id: string;
  package: string;
  severity: string;
  title?: string;
  expires: string;
  reason: string;
  closedBy?: string;
};

const ROOT = path.resolve(__dirname, "../..");
const baseline = JSON.parse(readFileSync(path.join(ROOT, "security/audit-baseline.json"), "utf8")) as {
  generatedAt: string;
  accepted: Entry[];
};

/** 18 ay, milisaniye. */
const MAX_HORIZON_MS = 18 * 30 * 864e5;

describe("zafiyet triaj kaydı (security/audit-baseline.json)", () => {
  it("boş değil (test kendini boşa düşürmesin)", () => {
    expect(Array.isArray(baseline.accepted)).toBe(true);
    expect(baseline.accepted.length).toBeGreaterThan(0);
  });

  it.each(["id", "package", "severity", "expires", "reason"] as const)(
    "her kayıtta `%s` dolu",
    (field) => {
      const missing = baseline.accepted.filter((a) => typeof a[field] !== "string" || !a[field].trim());
      expect(missing.map((a) => a.id ?? "(id yok)")).toEqual([]);
    },
  );

  it("kimlikler GHSA (ya da betiğin NO-GHSA yedeği) biçiminde ve TEKİL — kural betikle TEK kaynak", () => {
    // ⚠️ Anahtar paket adı DEĞİL danışma kimliği: aynı paket birden çok danışma
    // taşıyabilir (postcss'te 4 tane var) ve paket bazlı bir kabul, o pakete
    // gelecek YENİ danışmayı da sessizce yutardı.
    // F12 (09-26): şema kuralı betiğin kendisinde (`validateBaseline`); bu pin onu ÇAĞIRIR, kopyalamaz. Betik 09-23'ten
    // beri GHSA'sız danışmayı `NO-GHSA:` kimliğiyle sayıyor — o kimlik de triaj edilebilmeli (eski GHSA-only regex
    // böyle bir danışmayı SONSUZA KADAR kırmızı bırakırdı).
    expect(validateBaseline(baseline)).toEqual([]);
    const ids = baseline.accepted.map((a) => a.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it("`expires` geçerli bir ISO tarih ve makul bir ufukta", () => {
    // ⚠️ Bu test SÜRESİ DOLMUŞ kaydı KIRMIZI YAPMAZ — o dal bilerek yalnız
    // `scripts/audit-check.mjs` içinde (CI). Buraya koymak, test paketini bir
    // takvim bombasına çevirirdi: acil bir düzeltmeyi push etmek isteyen kişi,
    // alâkasız bir zafiyet kaydının tarihi geçtiği için kapıda kalırdı.
    // Buradaki tek soru "kayıt İŞLETİLEBİLİR mi".
    for (const a of baseline.accepted) {
      expect(a.expires, a.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const ms = Date.parse(a.expires + "T00:00:00Z");
      expect(Number.isNaN(ms), `${a.id} ayrıştırılamayan tarih`).toBe(false);
      // 🚨 ÜST SINIR mekanizmanın ta kendisi: "2099-01-01" yazmak kaydı süresiz
      // muafiyete çevirir ve scriptin bayatlık dalını ölü koda dönüştürürdü.
      // Ölçüm BUGÜNDEN yapılır (`generatedAt`'ten değil): yenilenen bir kayıt
      // geçerli kalsın, ama uzak gelecek hep reddedilsin.
      expect(ms - Date.now(), `${a.id} çok uzak bir expires (${a.expires})`).toBeLessThanOrEqual(MAX_HORIZON_MS);
    }
  });

  it("`generatedAt` var ve ISO biçiminde (kaydın ne zaman gözden geçirildiği)", () => {
    expect(baseline.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("gerekçe GERÇEKTEN yazılmış (tek kelimelik 'kabul' geçmez)", () => {
    // Kabulün değeri gerekçesindedir: "ulaşılamaz, çünkü …" bir sonraki kişinin
    // kararı yeniden değerlendirebilmesini sağlar. Boş/klişe gerekçe, kaydı
    // düşünmeden kopyalanan bir onay damgasına çevirir.
    for (const a of baseline.accepted) expect(a.reason.length, a.id).toBeGreaterThan(60);
  });
});

// ---------------------------------------------------------------------------
// DEPENDABOT ↔ CI SÖZLEŞMESİ.
//
// `dependabot.yml`'nin KENDİ yorumu "CI (ci.yml) runs typecheck + tests on each
// PR" diyordu ama `ci.yml`'de `pull_request` tetikleyicisi YOKTU (yalnız
// `push` + `workflow_dispatch`) → Dependabot PR'ları HİÇ CI görmeden
// birleştirilebiliyordu. Bir bağımlılık güncellemesini doğrulamasız almak,
// tedarik zinciri saldırısının en ucuz yoludur.
// ---------------------------------------------------------------------------
describe("Dependabot PR'ları CI görür", () => {
  const ci = readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");

  it("ci.yml `pull_request` tetikleyicisi taşır", () => {
    // `on:` bloğunda, iş adımlarının içinde değil — `pull_request` kelimesi
    // yorumda da geçebilir, o yüzden satır başındaki iki-boşluk girintili
    // anahtar aranır.
    expect(ci).toMatch(/^ {2}pull_request:/m);
  });

  it("FORK PR'ları koşmaz (repo PUBLIC — yabancı kodu runner'da çalışmasın)", () => {
    // 🚨 `pull_request` eklendiğinde repo PRIVATE'ti; PR açabilen tek kişi sahibiydi.
    // Repo public olunca aynı tetikleyici İNTERNETTEKİ HERKESİN kodunu runner'da
    // çalıştırılabilir hale getirdi: dört job `npm ci` koşuyor ve saldırganın
    // değiştirdiği package.json'ın postinstall script'leri çalışır.
    // ⚠️ `npm ci --ignore-scripts` DEĞERLENDİRİLDİ ve REDDEDİLDİ — saldırgan kodunu
    // çalıştırmamak yerine kısıtlamaya çalışıyor ve ÖLÇÜLDÜ: `sharp/build` ile
    // `.prisma/client` üretilmiyor, yani kendi push koşularımızı da bozardı.
    expect(ci).toContain("github.event.pull_request.head.repo.full_name == github.repository");
    // Dependabot ETKİLENMEZ: dalları fork değil, bu deponun içinde açılır.
    expect(ci).toMatch(/^ {2}pull_request:/m);
  });

  it("workflow ASGARİ token izniyle koşar (depo ayarından bağımsız)", () => {
    // Blok yokken kapsam depo ayarından gelir ve o ayar repodan GÖRÜLEMEZ.
    // Hiçbir job repoya yazmıyor (checkout + npm + test), yani `contents: read`
    // fonksiyonel risk taşımıyor.
    const cfg = parseYaml(ci) as { permissions?: Record<string, string> };
    expect(cfg.permissions).toEqual({ contents: "read" });
  });

  it("deploy dalının uzun ömürlü PR'ı ÇİFT koşmasın diye dışlanmış", () => {
    // Tetikleyiciyi geri eklerken çözülmesi gereken asıl sorun buydu: deploy
    // dalının açık kalıcı bir PR'ı var, `pull_request` filtresiz eklenirse her
    // push İKİNCİ kez (merge ref'ine karşı) koşar. Dışlama `head_ref` üzerinden
    // yapılır — hedef dala bağlı değildir.
    expect(ci).toContain("github.head_ref != 'claude/great-edison-3zqpZ'");
  });
});
