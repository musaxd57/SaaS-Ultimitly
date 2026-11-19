import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyFallback, reportsDeviceFault } from "@/lib/ai/fallback";

// ---------------------------------------------------------------------------
// KATLAMA İŞİ SAYACI (O3 optimizasyon turu, 11-19). Kelime ağlarının katlamaları (`foldTurkishLower` / `foldTurkishLowerTr` /
// `foldTurkishAscii`) hepsi `String.prototype.toLowerCase` çağırır; bir çağrıdaki toLowerCase sayısı o çağrının yaptığı katlama işinin
// saati okumayan, makineden bağımsız ölçüsüdür. Bu pinle kapanan gereksiz iş:
//   · `hasNegativeVerbComplaint` (`reportsDeviceFault` + şikâyet kararı) aday biçimleri önbellekli `foldedCandidatesOf` yerine yeniden
//     katlıyor ve statik listenin HER sözcüğünü her çağrıda `foldTurkishAscii`den geçiriyordu (liste kimliğine bağlı önbellek var).
// Anlam aynıdır (saf fonksiyonların aynı girdiyle tekrarı kalktı); davranış pinleri `ai-fallback`, `complaint-negative-verbs`,
// `golden-scenarios` vb. dosyalarda — bu dosya yalnız İŞ MİKTARINI pinler. Sınırlar kalıp / sözcük listesinin UZUNLUĞUNDAN bağımsızdır:
// liste büyüdükçe sayı artarsa (yeniden çağrı başına katlama) pin kırmızıdır.
// ---------------------------------------------------------------------------

function lowerCalls(run: () => unknown): number {
  const spy = vi.spyOn(String.prototype, "toLowerCase");
  try {
    run();
    return spy.mock.calls.length;
  } finally {
    spy.mockRestore();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("kelime ağlarında katlama işi kalıp / sözcük listesi uzunluğuna bağlı değil", () => {
  it("reportsDeviceFault: olumsuz fiil listesi çağrı başına yeniden katlanmaz, aday biçimleri önbellekten gelir", () => {
    reportsDeviceFault("ısınma çağrısı"); // statik listelerin tek seferlik katlaması ölçüme girmesin
    // Tek belirteç, tek aday, cihaz yok: cihaz bacağı belirteci üç katlamadan geçirir (3), olumsuz fiil bacağı aday biçimlerini bir kez
    // katlar (3). Listenin her sözcüğünü yeniden katlamak bunun üstüne liste uzunluğu kadar çağrıydı.
    const cold = lowerCalls(() => expect(reportsDeviceFault("Merhaba")).toBe(false));
    expect(cold).toBeLessThanOrEqual(6);
    // Aynı mesaj art arda (kapı ve sınıflandırıcı aynı mesajı birkaç kez okur): aday biçimleri tek girişli önbellekten.
    const warm = lowerCalls(() => expect(reportsDeviceFault("Merhaba")).toBe(false));
    expect(warm).toBeLessThanOrEqual(3);
  });

  it("olumsuz fiil şikâyeti ve koşul eki hükmü aynı (önbellekli biçimlerle)", () => {
    expect(reportsDeviceFault("Sıcak su gelmiyor.")).toBe(true);
    expect(reportsDeviceFault("SICAK SU GELMIYOR")).toBe(true);
    expect(reportsDeviceFault("Su gelmiyorsa ne yapmamız gerekiyor?")).toBe(false);
    expect(classifyFallback("Isıtma gelmiyor, çok üşüyoruz").isComplaint).toBe(true);
  });
});
