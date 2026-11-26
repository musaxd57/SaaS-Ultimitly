import { describe, it, expect } from "vitest";
import { unfilledTemplateTokens } from "@/lib/kb-placeholders";
import { vetoOutgoingReply } from "@/lib/ai/output-veto";

// ---------------------------------------------------------------------------
// TANINMAYAN YER TUTUCU MİSAFİRE GİTMEZ (10-01, 15 ajan incelemesi A08 — ölçüldü). Kurucu kuralı "doldurulmamış alan → gönderilmez"
// (09-11) yalnız `[…]` / `{{…}}` / `{isim}`·`{daire}`i tanıyordu → "Kapı kodu: {kod}", "{wifi}", "{guest_name}", "%KOD%" karşılama /
// giriş / çıkış mesajında misafire HAM gidiyordu. Yaşam döngüsü kapısı ve Bilgi Tabanı rozeti AYNI yüklemi kullanır. Yapay zekâ cevabı
// önceki kararla kapsam dışı (tanınmayan süslü parantez cevapta veto sebebi değil); gerçek cevap külliyatında (docs/olcum, 3.031) bu biçim
// 0 kez geçiyor.
// ---------------------------------------------------------------------------

describe("unfilledTemplateTokens", () => {
  it.each([
    ["Kapı kodu: {kod}", ["{kod}"]],
    ["Wi-Fi şifresi {wifi_sifre}", ["{wifi_sifre}"]],
    ["Merhaba {guest_name}", ["{guest_name}"]],
    ["Kapı: { KOD }", ["{ KOD }"]],
    ["Kapı kodu {kapı kodu}", ["{kapı kodu}"]],
    ["Wi-Fi: %WIFI%", ["%WIFI%"]],
    ["Adres: {adres}, kod: %KAPI_KODU%", ["{adres}", "%KAPI_KODU%"]],
  ])("🚨 %j → doldurulmamış %j", (metin, beklenen) => {
    expect(unfilledTemplateTokens(metin)).toEqual(beklenen);
  });

  it.each([
    "Merhaba {isim}, daireniz {daire}.",
    "Hi {name}, apartment {apt}.",
    "Seçenek {1} ya da {2}",
    "Kampanya: %50 indirim, %100 iade",
    "Giriş 15:00, çıkış 11:00.",
  ])("KONTROL — bilinen / harfsiz belirteç doldurulmamış SAYILMAZ: %j", (metin) => {
    expect(unfilledTemplateTokens(metin)).toEqual([]);
  });
});

describe("yapay zekâ cevabı — ÖNCEKİ KARAR korunur", () => {
  it("tanınmayan süslü parantez cevap metninde veto sebebi DEĞİL (pin `apartment-unresolved.test.ts`; genişletme Sabah Kararları sorusu)", () => {
    expect(vetoOutgoingReply("Kahvaltı {sabah} 9'da.")).toBeNull();
  });
});
