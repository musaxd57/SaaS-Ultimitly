import { describe, it, expect } from "vitest";
import { admitsMissingKnowledge } from "@/lib/ai/absence";
import { vetoOutgoingReply } from "@/lib/ai/output-veto";
import { hasEmergencyCallDirective } from "@/lib/ai/hazard-evidence";

// ---------------------------------------------------------------------------
// GECE-4 S4-07: modelin CEVABINA giren görünmez karakter (sıfır genişlikli boşluk, yumuşak tire, biçim karakteri, boş braille) — bilgi
// tabanından yapıştırılmış metin ya da QR misafirinin modele yazdırdığı — "bilgim yok", devir cümlesi ve 112 yönergesi denetimlerini
// atlatıyordu. Eşleşme kopyasından silinir; gönderilen metin aynen kalır (denetim yalnız tutar / izin vermez).
// ---------------------------------------------------------------------------

const ZW = ["​", "­", "⁠", "⠀", "﻿"];

describe("cevap denetimleri görünmez karakterle atlatılamaz", () => {
  it.each(ZW)("'bilgim yok' (%j) yine tutulur", (z) => {
    expect(admitsMissingKnowledge(`Bu konuda bilgim${z} yok.`)).toBe(true);
    expect(admitsMissingKnowledge(`Çıkış için özel talimat${z}ımız yok.`)).toBe(true);
  });
  it.each(ZW)("devir cümlesi (%j) yine veto edilir", (z) => {
    const plain = vetoOutgoingReply("Talebiniz ev sahibine iletildi.");
    expect(plain).not.toBeNull();
    expect(vetoOutgoingReply(`Talebiniz ev sahibine ilet${z}ildi.`)).toBe(plain);
  });
  it.each(ZW)("112 yönergesi (%j) yine yakalanır", (z) => {
    expect(hasEmergencyCallDirective("Lütfen hemen 112'yi arayın.")).toBe(true);
    expect(hasEmergencyCallDirective(`Lütfen hemen 112'yi ar${z}ayın.`)).toBe(true);
  });
  it("KONTROL: görünmez karakterli SIRADAN cevap tutulmaz / veto edilmez", () => {
    expect(admitsMissingKnowledge("Check-in saati 15:00​, anahtar kutuda.")).toBe(false);
    expect(vetoOutgoingReply("Wi-Fi şifresi kartta yazıyor​.")).toBeNull();
    expect(hasEmergencyCallDirective("Kombi düğmesi​ sağda.")).toBe(false);
  });
});
