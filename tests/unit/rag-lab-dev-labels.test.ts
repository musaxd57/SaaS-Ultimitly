import { describe, it, expect } from "vitest";
import { buildScaleLab, loadScaleFile, type ScaleSetFile } from "../eval/rag-lab/scale-set";

// ---------------------------------------------------------------------------
// A9 #5 (09-27, doğrulandı): dev bilgi tabanında `d_workspace_6` ("For printing or scanning … Çınar Sokak 12") yazıcı sorusunu
// (negatif konu 12) gerçekten CEVAPLIYOR → "negatif" etiketi yanlıştı, cevaptaki "12" yabancı sayı sayılıyordu. Yalnız DEV
// bölümünde dışlanır; kimlikler kaymaz. Holdout içeriği OKUNMAZ — burada yalnız bellekte kurulan sahte bir "holdout" nesnesiyle
// dışlamanın dev'e özgü olduğu sınanır.
// ---------------------------------------------------------------------------

describe("dev seti etiket düzeltmesi — yanlış negatif", () => {
  it("dev: yazıcı sorusu (neg_12) yok, komşu negatiflerin kimliği aynı; bilgi tabanında cevaplayan kalem gerçekten var", () => {
    const file = loadScaleFile("dev");
    expect(file).not.toBeNull();
    const { queries } = buildScaleLab(file!);
    const ids = new Set(queries.map((q) => q.id));
    expect(ids.has("neg_12_tr")).toBe(false);
    expect(ids.has("neg_12_en")).toBe(false);
    expect(ids.has("neg_11_tr") && ids.has("neg_13_tr")).toBe(true);
    const printing = file!.items.find((i) => i.id === "d_workspace_6");
    expect(printing?.content).toMatch(/printing/i);
  });

  it("KONTROL — başka bölümde (bellekte kurulan sahte nesne) konu 12 dışlanmaz", () => {
    const fake: ScaleSetFile = { version: 1, split: "holdout", property: "x", items: [], facts: [] };
    const ids = new Set(buildScaleLab(fake).queries.map((q) => q.id));
    expect(ids.has("neg_12_tr")).toBe(true);
  });
});
