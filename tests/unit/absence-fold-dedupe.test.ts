import { afterEach, describe, expect, it, vi } from "vitest";
import { admitsMissingKnowledge, hostContactKindOf, namesInternalSource } from "@/lib/ai/absence";

// ---------------------------------------------------------------------------
// "BİLGİM YOK" / EV SAHİBİNE YÖNLENDİRME OKUYUCULARI — AYNI KATLAMA İKİ KEZ TARANMAZ (O3 optimizasyon turu, 11-19). Okuyucular metni iki
// katlamayla okur (standart + Türkçe yerelli: "I" → "ı"); metinde I / İ yoksa iki katlama aynıdır ve ikinci tarama birincinin tekrarıydı.
// Artık aynı katlama bir kez taranır. Sayılan iş: `RegExp.prototype.test` çağrıları. Ölçüt ORANDIR (kalıp listesi büyüdükçe kırılmaz):
// her cümlesinde büyük "I" olan metin (iki katlama farklı) ile aynı metnin "ı" ile yazılmışı (iki katlama aynı) — eskiden iş eşitti.
// Hüküm pinleri (I / İ büyük harfli itiraflar hâlâ yakalanır) aşağıda; geniş davranış pinleri `absence-*.test.ts`, `host-contact-*.test.ts`.
// ---------------------------------------------------------------------------

function regexTests(run: () => unknown): number {
  const spy = vi.spyOn(RegExp.prototype, "test");
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

// İki metin harf harf aynı, yalnız "I" ↔ "ı": birincide iki katlama aynı, ikincide her cümlede farklı.
const SAME = "ılık su var. ısıtma açık. ıslak havlu kurutulur.";
const DIFF = "Ilık su var. Isıtma açık. Islak havlu kurutulur.";

describe("aynı katlama tek tarama", () => {
  it("admitsMissingKnowledge: iki katlama aynıysa kalıp taraması yarıya iner", () => {
    expect(admitsMissingKnowledge(SAME)).toBe(false);
    expect(admitsMissingKnowledge(DIFF)).toBe(false);
    const same = regexTests(() => admitsMissingKnowledge(SAME));
    const diff = regexTests(() => admitsMissingKnowledge(DIFF));
    expect(same).toBeGreaterThan(0);
    // Yeni: same ≈ diff / 2. Eski: same = diff.
    expect(same * 3).toBeLessThan(diff * 2);
  });

  it("hostContactKindOf: cümle okuyucuları da (yönlendirme · koşullu başvurma · yedi dilli başvurma)", () => {
    expect(hostContactKindOf(SAME)).toBeNull();
    expect(hostContactKindOf(DIFF)).toBeNull();
    const same = regexTests(() => hostContactKindOf(SAME));
    const diff = regexTests(() => hostContactKindOf(DIFF));
    expect(same).toBeGreaterThan(0);
    expect(same * 3).toBeLessThan(diff * 2);
  });

  it("namesInternalSource: aynı", () => {
    const same = regexTests(() => namesInternalSource(SAME));
    const diff = regexTests(() => namesInternalSource(DIFF));
    expect(same * 3).toBeLessThan(diff * 2);
  });
});

describe("hüküm aynı — iki katlamanın gerektiği vakalar", () => {
  it("İngilizce büyük I (standart katlama) ve Türkçe büyük İ (yerelli katlama) itirafları yakalanır", () => {
    expect(admitsMissingKnowledge("I have no information on that.")).toBe(true);
    expect(admitsMissingKnowledge("IT IS NOT IN MY RECORDS.")).toBe(true);
    expect(admitsMissingKnowledge("BU KONUDA BİLGİM YOK.")).toBe(true);
    expect(admitsMissingKnowledge("Bu konuda bilgim yok.")).toBe(true);
    expect(admitsMissingKnowledge("Havuz her gün 09:00–20:00 arası açık.")).toBe(false);
  });

  it("yönlendirme: koşul büyük harfle de okunur ('If' → Türkçe katlamada 'ıf')", () => {
    expect(hostContactKindOf("For the sauna hours, please ask your host.")).toBe("referral");
    expect(hostContactKindOf("Sauna saatleri için lütfen ev sahibinize sorun.")).toBe("referral");
    expect(hostContactKindOf("Havuz her gün 09:00–20:00 arası açık.")).toBeNull();
  });
});
