import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import {
  partitionTestFiles,
  isTimingSensitive,
  DB_FREE_INTEGRATION_FILES,
  DB_FILES_OUTSIDE_INTEGRATION,
  UNREACHABLE_DATABASE_URL,
} from "../test-partition.mjs";

// ---------------------------------------------------------------------------
// TEST KAPISI BÖLÜMLEMESİ (kurucu 10-16). Paralel kapı bir dosyayı ATLARSA ya da iki kez koşarsa yeşil kapı yalan söyler; bu pin her test
// dosyasının TAM BİR kolda olduğunu ve veritabanlı kolun tek sırada kaldığını sınar. (Örnek dizgiler parçalı yazılır — bu dosyanın kendisi
// süre ölçen sayılmasın.)
// ---------------------------------------------------------------------------
const CLOCK = "performance" + ".now()";
const LESS = "toBe" + "LessThan";

describe("test kapısı bölümlemesi", () => {
  const p = partitionTestFiles();

  it("her test dosyası TAM BİR kolda: dışarıda kalan ya da iki kolda koşan dosya yok", () => {
    const joined = [...p.db, ...p.nodb, ...p.timing].sort();
    expect(joined).toEqual(p.all);
    expect(new Set(joined).size).toBe(joined.length);
    expect(p.all.length).toBeGreaterThan(900); // boş liste "her şey kapsandı" demesin
    expect(p.db.length).toBeGreaterThan(300);
    expect(p.nodb.length).toBeGreaterThan(400);
    expect(p.timing.length).toBeGreaterThan(20);
  });

  it("veritabanlı kol: bütün integration dosyaları (ölçülmüş istisnalar hariç) + veritabanı isteyen unit dosyaları", () => {
    for (const f of p.all.filter((x: string) => x.startsWith("tests/integration/") && !DB_FREE_INTEGRATION_FILES.includes(x))) {
      expect(p.db).toContain(f);
    }
    for (const f of DB_FILES_OUTSIDE_INTEGRATION) expect(p.db).toContain(f);
    for (const f of [...DB_FREE_INTEGRATION_FILES, ...DB_FILES_OUTSIDE_INTEGRATION]) expect(existsSync(f)).toBe(true); // eskimiş ad kalmasın
    for (const f of DB_FREE_INTEGRATION_FILES) expect(f.startsWith("tests/integration/")).toBe(true);
  });

  it("süre ölçen dosya tanıma: ad (-cost / -perf) ya da saat farkı + üst sınır iddiası", () => {
    expect(isTimingSensitive("tests/unit/x-cost.test.ts", "")).toBe(true);
    expect(isTimingSensitive("tests/unit/x-perf.test.ts", "")).toBe(true);
    expect(isTimingSensitive("tests/unit/x.test.ts", `const t = ${CLOCK}; expect(${CLOCK} - t).${LESS}(5);`)).toBe(true);
    expect(isTimingSensitive("tests/unit/x.test.ts", `const t0 = Date.now(); expect(Date.now() - t0).${LESS}(500);`)).toBe(true);
    // KONTROL: saat okuyup süre iddiası yapmayan (ör. sabit tarih) dosya süre ölçen DEĞİL
    expect(isTimingSensitive("tests/unit/x.test.ts", "const now = Date.now(); expect(f(now)).toBe(1);")).toBe(false);
    expect(isTimingSensitive("tests/unit/x.test.ts", `expect(a).${LESS}(3);`)).toBe(false);
  });

  it("süre ölçen kol yalnız veritabanısız dosyalardan; ölçülmüş süre pinleri orada", () => {
    for (const f of p.timing) expect(p.db).not.toContain(f);
    expect(p.timing).toContain("tests/unit/claim-support-cost.test.ts"); // 10-15 ölçümünde paralelde kırmızı olan süre pini
  });

  it("veritabanısız kolların adresi ulaşılamaz (loopback, port 1) — yanlış sınıflanan veritabanlı test sessiz geçmez", () => {
    const u = new URL(UNREACHABLE_DATABASE_URL);
    expect(u.hostname).toBe("127.0.0.1");
    expect(u.port).toBe("1");
  });

  it("bu pin dosyası veritabanısız kolda (kendisi süre ölçen sayılmıyor)", () => {
    expect(p.nodb).toContain("tests/unit/test-partition.test.ts");
  });
});
