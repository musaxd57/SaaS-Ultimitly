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
