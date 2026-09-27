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
    expect(v).toEqual({ red: false, reasons: [], answered: { anchored: 1, hit: 1 }, handedOff: false, missed: null });
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

  it("🚨 'cevap kaçırıldı' ≠ 'getirme kaçırdı' (kurucu 09-27): cevap blokta varken devir BAŞARI DEĞİL, ayrı sayılır — kırmızı da değil", () => {
    const base = { group: "single_tr", answers: [{ needles: ["Toplam 54 basamak."] }], reply: "Bunu ev sahibinize iletiyorum.", unsupported: 0, allowedTexts };
    expect(caseVerdict({ ...base, inBlock: true })).toMatchObject({ red: false, missed: "answer", handedOff: true });
    expect(caseVerdict({ ...base, inBlock: false })).toMatchObject({ red: false, missed: "retrieval", handedOff: true });
    // Doğru cevapta ikisi de yok.
    expect(caseVerdict({ ...base, inBlock: true, reply: "Toplam 54 basamak var." }).missed).toBeNull();
  });

  it("🚨 dayanaksız sayı iki tür (bilgi bloğu verilince): hiçbir yerde yok → yanlis_sayi; bloktaki BAŞKA kalemin olgusu → baska_olgu", () => {
    const answers = [{ needles: ["Havuz 09:00–19:00 açık."] }];
    const blockTexts = ["Spor salonu 07:00–22:00 açık.", "Havuz 09:00–19:00 açık."];
    // Havuz sorusuna spor salonunun saatiyle cevap: bloktaki başka kalemin doğru sayısı — yanlış yere verilmiş bilgi ya da doğru ek bilgi.
    expect(caseVerdict({ group: "single_tr", answers, reply: "Açılış 07:00, kapanış 22:00.", unsupported: 0, allowedTexts, blockTexts }).reasons).toEqual(["baska_olgu"]);
    // Hiçbir yerde olmayan saat: uydurma sayı.
    expect(caseVerdict({ group: "single_tr", answers, reply: "Havuz 08:00–18:00 açık.", unsupported: 0, allowedTexts, blockTexts }).reasons).toEqual(["yanlis_sayi"]);
    // Blok verilmezse eski davranış (her dayanaksız sayı yanlis_sayi).
    expect(caseVerdict({ group: "single_tr", answers, reply: "Açılış 07:00, kapanış 22:00.", unsupported: 0, allowedTexts }).reasons).toEqual(["yanlis_sayi"]);
  });

  it("🚨 yanıtsız soruda: hiçbir yerde olmayan sayı → uydurma; yalnız bloktaki başka kalemin sayısı → baska_olgu (aday)", () => {
    const blockTexts = ["Havuz 09:00–19:00 açık."];
    expect(caseVerdict({ group: "neg", answers: [], reply: "Sauna 10:00'da açılır.", unsupported: 0, allowedTexts, blockTexts }).reasons).toEqual(["uydurma"]);
    expect(caseVerdict({ group: "neg", answers: [], reply: "Sauna bilgisi yok; havuz 09:00–19:00 açık.", unsupported: 0, allowedTexts, blockTexts }).reasons).toEqual(["baska_olgu"]);
  });

  it("iki sorulu mesaj: her sorunun sayısı ayrı sayılır", () => {
    const answers = [{ needles: ["Giriş 15:00."] }, { needles: ["Otopark günlük 250 TL."] }];
    expect(caseVerdict({ group: "multi", answers, reply: "Giriş 15:00, otopark 250 TL.", unsupported: 0, allowedTexts }).answered).toEqual({ anchored: 2, hit: 2 });
    expect(caseVerdict({ group: "multi", answers, reply: "Giriş 15:00.", unsupported: 0, allowedTexts })).toMatchObject({ red: false, handedOff: true, answered: { anchored: 2, hit: 1 } });
  });
});
