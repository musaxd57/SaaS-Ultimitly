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

import { escalationReply } from "@/lib/guest-chat";
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

  it("🚨 ÖLÇÜT deterministik `detectRiskType` — sıradan istek acil dalına DÜŞMEZ", () => {
    // Rota `criticalEvent = detectRiskType(message) === "safety_emergency"` kullanır;
    // burada o yüklemin sınıfı ayırdığını ölçüyoruz (rotanın kendi pini ayrı).
    expect(detectRiskType("Yangın var, duman geliyor!")).toBe("safety_emergency");
    expect(detectRiskType("Bir yastık daha alabilir miyiz?")).not.toBe("safety_emergency");
    expect(detectRiskType("Geç çıkış mümkün mü?")).not.toBe("safety_emergency");
  });
});
