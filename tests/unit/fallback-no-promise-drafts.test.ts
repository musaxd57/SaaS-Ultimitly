import { describe, it, expect } from "vitest";
import { suggestReplyFallback } from "@/lib/ai/fallback";
import type { SuggestReplyInput } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// 3d (kurucu 11-11): YAPAY ZEKÂ ÇALIŞMIYORKEN SÖZ VEREN TASLAK YOK.
// "Talebinizi aldım… en kısa sürede size dönüş yapacağım — bu direk hatalı, bu tarz bir cümle gitmemeli; host 'talebi aldım' buna yazmaz ki."
// Yedek yol (model yok / hata) yalnız ev sahibinin panelinde taslak üretir. Eskiden 15 konunun çoğu yapılmamış işi bildiriyor
// ("ekibimize ilettim") ya da söz veriyordu ("en kısa sürede size döneceğim", "kendisi sizinle iletişime geçecektir"). Artık karar / söz
// isteyen konuda taslak BOŞ; yalnız kayıtlı SOMUT bilgi taslak olur ve sonuna söz eklenmez.
// ---------------------------------------------------------------------------

const PROMISE =
  /ilettim|iletece|döneceğim|dönüş yapaca|iletişime geçece|paylaşacağım|bilgi vereceğim|netleştireceğim|planlayıp|kontrol edip|get back to you|let you know|I'll share|I've passed|I've notified|I've received|I'll check|I'll confirm|I'll arrange|get in touch/i;

const KB = [
  { category: "wifi", title: "Wi-Fi", content: "Ağ LaleApt, şifre 12345678" },
  { category: "parking", title: "Otopark", content: "Binanın arkasında ücretsiz açık otopark var." },
  { category: "location", title: "Konum", content: "Metro çıkışından 200 metre, eczanenin yanı." },
  { category: "cleaning", title: "Temizlik", content: "Ara temizlik 400 TL, bir gün önceden haber verilir." },
  { category: "general", title: "Ekipman", content: "Ütü ve ütü masası dolapta." },
  { category: "checkin", title: "Giriş", content: "Anahtar kutusu kapının sağında." },
];

function input(guestMessage: string, over: Partial<SuggestReplyInput> = {}): SuggestReplyInput {
  return {
    guestMessage,
    property: { name: "Lale 7", checkInTime: "15:00", checkOutTime: "11:00", address: "Lale Sokak 7", city: "İstanbul" },
    knowledgeBase: [],
    reservation: { guestName: "Ayşe Yılmaz", arrivalDate: new Date(), departureDate: new Date(), status: "confirmed" },
    history: [],
    tone: "warm",
    language: "tr",
    ...over,
  } as SuggestReplyInput;
}

describe("model yokken taslak — söz yok (3d)", () => {
  it("🚨 karar / söz isteyen konularda taslak BOŞ: şikâyet, iade, erken ayrılış, insan talebi, erken giriş, geç çıkış, sınıflanamayan (TR + EN)", () => {
    const cases: [string, string][] = [
      ["Klima çalışmıyor, içerisi çok sıcak!", "complaint"],
      ["The air conditioning is not working at all!", "complaint"],
      ["Paramı geri istiyorum lütfen.", "refund"],
      ["I want a refund please.", "refund"],
      ["Yarın ayrılmak zorundayız, rezervasyonu kısaltabilir miyiz?", "early_departure"],
      ["Ev sahibiyle konuşmak istiyorum.", "human_request"],
      ["I would like to speak to the host.", "human_request"],
      ["Erken giriş yapabilir miyim?", "early_checkin"],
      ["Geç çıkış mümkün mü?", "late_checkout"],
      ["Merhaba, nasılsınız?", "general"],
    ];
    for (const [msg, intent] of cases) {
      const r = suggestReplyFallback(input(msg, { knowledgeBase: KB }));
      expect(r.intent, msg).toBe(intent);
      expect(r.reply, msg).toBe(""); // ⬅️ ESKİDE hazır cümle: "…ilettim; en kısa sürede size döneceğim." vb.
      expect(r.usedSources, msg).toEqual([]);
      expect(r.source, msg).toBe("fallback");
    }
  });

  it("ev sahibine giden bilgi KALIR: risk notu, risk düzeyi ve 'sizin için not' (taslak boşken de)", () => {
    const refund = suggestReplyFallback(input("Paramı geri istiyorum lütfen."));
    expect(refund.reply).toBe("");
    expect(refund.risk).toContain("İade");
    expect(refund.riskLevel).toBe("medium");
    expect(refund.actionSuggestion).toBeTruthy();
    const human = suggestReplyFallback(input("Ev sahibiyle konuşmak istiyorum."));
    expect(human.actionSuggestion).toContain("ev sahibiyle görüşmek istiyor");
  });

  it("kayıtlı SOMUT bilgi taslak olur; sonuna söz cümlesi EKLENMEZ", () => {
    const cases: [string, string][] = [
      ["Wifi şifresi nedir?", "12345678"],
      ["Otopark var mı?", "ücretsiz açık otopark"],
      ["Adres nedir?", "Metro çıkışından 200 metre"],
      ["Havlu değişimi mümkün mü?", "Ara temizlik 400 TL"],
      ["Nasıl giriş yapacağım?", "Anahtar kutusu kapının sağında"],
      ["Ne zaman çıkış yapmalıyız?", "11:00"],
    ];
    for (const [msg, expected] of cases) {
      const r = suggestReplyFallback(input(msg, { knowledgeBase: KB }));
      expect(r.reply, msg).toContain(expected);
      expect(r.reply, msg).not.toMatch(PROMISE);
      expect((r.usedSources ?? []).length, msg).toBeGreaterThan(0);
    }
  });

  it("bilgi YOKSA taslak da yok — 'kontrol edip paylaşacağım' sözü yerine boş taslak + eksik bilgi notu", () => {
    const wifi = suggestReplyFallback(input("Wifi şifresi nedir?"));
    expect(wifi.reply).toBe("");
    expect(wifi.missingInfo).toEqual(["Wi-Fi bilgisi"]);
    const parking = suggestReplyFallback(input("Otopark var mı?"));
    expect(parking.reply).toBe("");
    expect(parking.missingInfo).toEqual(["otopark bilgisi"]);
    expect(suggestReplyFallback(input("Havlu değişimi mümkün mü?")).reply).toBe("");
    // Giriş / çıkış saati daire kaydındadır: bilgi tabanı boşken de somut cümle kalır, "…sizinle paylaşacağım" kuyruğu olmadan.
    const checkin = suggestReplyFallback(input("Nasıl giriş yapacağım?")).reply;
    expect(checkin).toContain("Giriş saatimiz 15:00.");
    expect(checkin).not.toMatch(PROMISE);
    const checkout = suggestReplyFallback(input("Ne zaman çıkış yapmalıyız?")).reply;
    expect(checkout).toContain("Çıkış saatimiz 11:00.");
    expect(checkout).not.toMatch(PROMISE);
  });

  it("adres yalnız doğrulanmış konaklamada; yanında 'yol tarifini paylaşacağım' sözü yok", () => {
    const ask = "Dairenin adresini yazar mısınız?";
    const r = suggestReplyFallback(input(ask));
    expect(r.intent).toBe("location");
    expect(r.reply).toContain("Adresimiz: Lale Sokak 7, İstanbul.");
    expect(r.reply).not.toMatch(PROMISE);
    const prospective = suggestReplyFallback(input(ask, { reservation: null } as Partial<SuggestReplyInput>));
    expect(prospective.reply).toBe(""); // rezervasyon yok → adres verilmez, söz de verilmez
  });
});
