import { describe, it, expect } from "vitest";
import { caseVerdict } from "../eval/rag-lab/answer-acceptance";

// ---------------------------------------------------------------------------
// CEVAP DÜZEYİ VAKA KABULÜ — TASLAK (kurucu kararı 09-27): müşteriye giden cevap kodla denetlenir; kırmızı sebepleri kapalı küme.
// Kuru koşuda (09-27, dev) ~%50 isabetli → kırmızılar ADAY, kapı değil (task #202). Bu pinler kuralın bugünkü hâlini sabitler.
// ---------------------------------------------------------------------------

const allowedTexts = ["15:00", "11:00", "Soru?"];

describe("vaka kabulü — kırmızı sebepleri", () => {
  it("doğru cevap (kendi sayısı yanıtta) → yeşil; fazladan dayanaklı bilgi yeşili bozmaz", () => {
    const v = caseVerdict({ group: "single_tr", answers: [{ needles: ["Havuz 09:00–20:00 açık."] }], reply: "Havuz 09:00–20:00 arası açık.", unsupported: 0, allowedTexts });
    expect(v).toEqual({ red: false, reasons: [], answered: { anchored: 1, hit: 1 }, handedOff: false });
  });

  it("🚨 kendi sayısı yok, dayanaksız sayı var → yanlis_sayi (başka olguyla cevaplamış)", () => {
    const v = caseVerdict({ group: "single_tr", answers: [{ needles: ["Toplam 54 basamak."] }], reply: "Toplam 52 basamak.", unsupported: 0, allowedTexts });
    expect(v.reasons).toEqual(["yanlis_sayi"]);
  });

  it("kendi sayısı yok, dayanaksız sayı da yok → kırmızı DEĞİL, dürüst devir sayılır", () => {
    const v = caseVerdict({ group: "single_tr", answers: [{ needles: ["Toplam 54 basamak."] }], reply: "Bunu ev sahibinize ilettim.", unsupported: 0, allowedTexts });
    expect(v).toMatchObject({ red: false, handedOff: true });
  });

  it("🚨 üretimin iddia denetimi dayanaksız somut iddia bulduysa → kanitsiz_iddia (her grupta)", () => {
    expect(caseVerdict({ group: "neg", answers: [], reply: "Acil servis 24 saat açık.", unsupported: 1, allowedTexts }).reasons).toContain("kanitsiz_iddia");
  });

  it("🚨 yanıtsız soruda dayanaksız sayı → uydurma; sayısız dürüst cevap yeşil", () => {
    expect(caseVerdict({ group: "neg", answers: [], reply: "Yazıcı 12 numaralı odada.", unsupported: 0, allowedTexts }).reasons).toEqual(["uydurma"]);
    expect(caseVerdict({ group: "neg", answers: [], reply: "Bu konuda ev sahibinize iletiyorum.", unsupported: 0, allowedTexts }).red).toBe(false);
  });

  it("🚨 çelişkide herhangi bir çelişen saati yazmak → celiskide_kesin; saatsiz cevap yeşil", () => {
    const answers = [{ needles: ["Çıkış 11:00."] }, { needles: ["Çıkış 12:00."] }];
    expect(caseVerdict({ group: "conflict", conflict: true, answers, reply: "Çıkış saatiniz 12:00.", unsupported: 0, allowedTexts }).reasons).toEqual(["celiskide_kesin"]);
    expect(caseVerdict({ group: "conflict", conflict: true, answers, reply: "Çıkış saatiyle ilgili kayıtlarım tutarsız.", unsupported: 0, allowedTexts }).red).toBe(false);
  });

  it("🚨 eski sürümün değeri cevapta → sizinti; yeni değer yeşil", () => {
    const base = { group: "version", answers: [{ needles: ["Wi-Fi şifresi 7788."] }], forbiddenNeedles: ["Wi-Fi şifresi 4455."], unsupported: 0, allowedTexts };
    expect(caseVerdict({ ...base, reply: "Şifre 4455." }).reasons).toContain("sizinti");
    expect(caseVerdict({ ...base, reply: "Şifre 7788." }).red).toBe(false);
  });

  it("iki sorulu mesaj: her sorunun sayısı ayrı sayılır", () => {
    const answers = [{ needles: ["Giriş 15:00."] }, { needles: ["Otopark günlük 250 TL."] }];
    expect(caseVerdict({ group: "multi", answers, reply: "Giriş 15:00, otopark 250 TL.", unsupported: 0, allowedTexts }).answered).toEqual({ anchored: 2, hit: 2 });
    expect(caseVerdict({ group: "multi", answers, reply: "Giriş 15:00.", unsupported: 0, allowedTexts })).toMatchObject({ red: false, handedOff: true, answered: { anchored: 2, hit: 1 } });
  });
});
