import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// QR DEVİR METNİ — SÖZ, GERÇEĞE UYGUN OLMAK ZORUNDA (Codex, 2026-09-08).
//
// 🚨 ÖLÇÜLEN AÇIK: metin `QR_ESCALATION_EMAIL_ENABLED` bayrağına bakıp koşulsuz
// "Sorunuzu ev sahibine ilettim" diyordu. Oysa bayrak AÇIKKEN BİLE o e-posta
// gönderilmemiş olabilir ve KOD BUNU BİLMEZ:
//   · olay-kimliği dedupe (aynı olay için ikinci mail yok),
//   · 5 dakikalık anti-flood cooldown (kritik olmayan olaylar),
//   · alıcı yok (org alertEmail + owner boş),
//   · sağlayıcı hatası (`result.ok === false`).
// Üstelik yanıt metni `record()` içinde e-postadan ÖNCE yazılıyor ve
// `sendQrEscalationAlertBounded` `Promise<void>` döndürüyor — sonuç hiç okunmuyor.
// Canlı transkriptte dört ardışık devirde dördünde de "ilettim" yazdı; cooldown
// nedeniyle en fazla biri e-posta üretmiş olabilir.
//
// SÖZLEŞME: metin, o an GARANTİ EDİLEN şeyi söyler — mesaj kaydedildi ve ev
// sahibi sohbet ekranından görür. Gerçekleşmesi garanti olmayan bir aktarım
// ("ilettim") İDDİA EDİLMEZ.
// ---------------------------------------------------------------------------

const enabled = vi.hoisted(() => ({ value: false }));
vi.mock("@/lib/guest-chat-alerts", async (orig) => {
  const actual = await orig<typeof import("@/lib/guest-chat-alerts")>();
  return { ...actual, qrEscalationEmailEnabled: () => enabled.value };
});

import { escalationReply, isPhysicalEmergency } from "@/lib/guest-chat";
import { unverifiedActionClaims } from "../helpers/claim-detectors";
import { detectRiskType } from "@/lib/ai/fallback";

describe("QR devir metni — gerçekleşmemiş aktarım iddia etmez", () => {
  beforeEach(() => {
    enabled.value = false;
  });

  it("bayrak KAPALI: kaydedildiğini söyler, aktarım iddia etmez", () => {
    const r = escalationReply();
    expect(r).toContain("kaydedildi");
    expect(r).not.toMatch(/ilettim|iletildi/i);
  });

  it("🚨 bayrak AÇIK: yine de 'ilettim' DEMEZ (e-posta dedupe/cooldown/alıcı-yok ile bastırılmış olabilir)", () => {
    enabled.value = true;
    const r = escalationReply();
    expect(r).not.toMatch(/ilettim/i);
    // Garanti edilen kanal söylenir: host sohbet ekranından görür.
    expect(r).toMatch(/sohbet ekranından/i);
  });

  it("metin her iki bayrak durumunda da AYNI (koşullu söz kalmadı)", () => {
    const off = escalationReply();
    enabled.value = true;
    expect(escalationReply()).toBe(off);
  });
});

// ---------------------------------------------------------------------------
// ACİL DURUM ≠ SIRADAN İSTEK (kurucu, 2026-09-11: "acil durum ile istekleri ayır").
//
// 🚨 ÖLÇÜLEN AÇIK: yangın/gaz kaçağı ile "bir yastık daha alabilir miyiz?" misafire
// KARAKTERİ KARAKTERİNE aynı cümleyi aldırıyordu. Üstelik ürün acil durumda ne
// diyeceğini ZATEN biliyor (`prompts.ts` ÖRNEK 12 modele tam bu yönergeyi
// öğretiyor) — kapı `model_risk_type` ile devredince o metin ATILIYOR ve yerine
// jenerik cümle konuyordu.
// ---------------------------------------------------------------------------
describe("QR devir metni — acil durumda güvenlik yönergesi eklenir", () => {
  beforeEach(() => {
    enabled.value = false;
  });

  it("🚨 critical: güvenlik yönergesi EKLENİR ve çapa cümlesi AYNEN korunur", () => {
    const normal = escalationReply();
    const critical = escalationReply({ critical: true });
    expect(critical).not.toBe(normal);
    // Çapa kaybolmaz — "kaydedildi + host görebilir" garantisi her iki dalda da var.
    expect(critical).toContain(normal);
    expect(critical).toMatch(/güvenli bir alana/i);
    expect(critical).toMatch(/acil servis/i);
  });

  it("🚨 acil metin de AYNI sözleşmeye tabi: makbuzsuz iddia yok, ünlem yok, kurumsal dil yok", () => {
    const critical = escalationReply({ critical: true });
    // Yönerge misafire VERİLEN bir talimattır; bizim yaptığımız bir eylem iddiası DEĞİL.
    expect(unverifiedActionClaims(critical), critical).toEqual([]);
    expect(critical).not.toMatch(/!/);
    expect(critical).not.toMatch(/yöneticimiz|operatörümüz|işletme ekib/i);
    // TERS YÖN — dedektör ölü assert değil.
    expect(unverifiedActionClaims("Durumu itfaiyeye ilettim; ev sahibiniz size dönecek."))
      .toEqual(expect.arrayContaining(["past_action", "future_commitment"]));
  });

  it("critical:false ve argümansız çağrı BİREBİR aynı (eski pinler korunur)", () => {
    expect(escalationReply({ critical: false })).toBe(escalationReply());
    expect(escalationReply({})).toBe(escalationReply());
  });

  it("🚨 ÖLÇÜT DAR yüklem — fiziksel acil durum yakalanır", () => {
    for (const m of [
      "Yangın var, duman geliyor!",
      "Mutfakta gaz kokusu var, ne yapmalıyız?",
      "Kombiden gaz kaçağı var galiba",
      "Banyoyu su bastı",
      "Prize dokununca elektrik çarptı",
      "There is a fire in the kitchen",
      "I think there's a gas leak",
      "The bathroom is flooded",
    ]) {
      expect(isPhysicalEmergency(m), m).toBe(true);
    }
  });

  // 🚨 BU BLOK BİR GERİLEMENİN PİNİDİR. İlk yazımda ölçüt
  // `detectRiskType(message) === "safety_emergency"` idi; inceleme turu İKİ
  // ölçülmüş kusur çıkardı ve ikisi de ürünün KENDİ yazılı kurallarına aykırıydı.
  it("🚨 ÖZ-ZARAR acil dalına DÜŞMEZ — ürünün kendi istem kuralı bunu yasaklıyor", () => {
    // `prompts.ts`: "bir kriz-danışmanlığı metni de KURGULAMAZ … Taslak yalnızca
    // NÖTR olsun … söz/teşhis/ACİL-TALİMAT İÇERMEZ. Asıl yönlendirmeyi (yerel
    // acil servise başvuru) EV SAHİBİNE söyle."
    for (const m of ["Ölmek istiyorum", "I want to kill myself", "Kendime zarar vereceğim"]) {
      // Kapı bunları hâlâ acil sayar (devir olur, host alarm alır) …
      expect(detectRiskType(m), m).toBe("safety_emergency");
      // … ama misafire GİDEN metin acil yönergesi TAŞIMAZ.
      expect(isPhysicalEmergency(m), m).toBe(false);
    }
  });

  it("🚨 `SAFETY_CRITICAL_WORDS`in AŞIRI EŞLEŞMELERİ acil metni tetiklemez", () => {
    // O liste BİLEREK geniştir ve gerekçesi kendi yorumunda yazılı: "over-matching
    // is the safe side — it only ever withholds a holding-ack". O maliyet modeli
    // misafire GİDEN metin için GEÇERSİZDİR. Ölçülmüş çarpışmalar:
    for (const m of [
      "İnternet düştü, bağlanamıyoruz",
      "Havuz ne zaman açılıyor?",
      "Polis merkezi nerede acaba?",
      "Kaza ile bardağı kırdım, özür dilerim",
      "Şöminede ateş yakabilir miyiz?",
      "Selam, iyi akşamlar",
      "Gazoz var mı buzdolabında?",
      "Is there a fireplace in the living room?",
    ]) {
      expect(isPhysicalEmergency(m), m).toBe(false);
    }
  });

  it("sıradan istek acil dalına DÜŞMEZ", () => {
    expect(isPhysicalEmergency("Bir yastık daha alabilir miyiz?")).toBe(false);
    expect(isPhysicalEmergency("Geç çıkış mümkün mü?")).toBe(false);
  });
});
