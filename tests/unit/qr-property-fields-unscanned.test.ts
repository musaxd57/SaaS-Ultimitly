import { describe, it, expect } from "vitest";
import { buildReplyUserPrompt } from "@/lib/ai/prompts";
import { withoutSecretKbItems } from "@/lib/guest-chat";

// ---------------------------------------------------------------------------
// KARAKTERİZASYON (09-11): SIR KAPISININ KAPSAMI **KB KALEMLERİDİR**, mülk
// KİMLİK ALANLARI DEĞİL.
//
// CLAUDE.md "modele giden metin taranmıştır" diye özetliyordu; ÖLÇÜLDÜ ve bu
// ifade FAZLA GENİŞ. `withoutSecretKbItems` bir KALEM LİSTESİNİ süzer; QR rotası
// mülk adını / adresini / şehrini / giriş-çıkış saatlerini istemin AYRI bir
// bölümünde, hiçbir sır taramasından geçirmeden modele verir.
//
// Bu dosya o gerçeği OLDUĞU GİBİ pinler (davranışı DEĞİŞTİRMEZ):
//  • KB kalemindeki kod ELENİR (kapı çalışıyor),
//  • mülk ADINDAKİ/ADRESTEKİ aynı kod modele GİDER.
//
// 🚨 Bu bir GÜVENLİK KARARIDIR ve bu turda UYGULANMADI: QR halka açık bir
// yüzeydir (bağlantı dairenin içinde asılıdır, sohbeti açan kişi rezervasyon
// sahibi olmayabilir) ve sır kapısı tam bu yüzden var. Mülk adını da taramak
// gönderim politikasını değiştirir → AYRI ONAY:
//   docs/ONAY-qr-mulk-kimlik-alanlari-sir-taramasi-2026-09-11.md
// Test "böyle olmalı" DEMİYOR; "bugün böyle" diyor ve kararı görünür tutuyor.
// ---------------------------------------------------------------------------

const CODE_IN_KB = "8821";
// 🚨 AD bacağı AYRI sabit ister (inceleme turu 6): aynı sayı hem KB kaleminde hem mülk adında
// kullanılınca "ad taranmıyor" iddiası kanıtlanmış olmuyor — eleme bozulsa bile assert geçerdi.
const CODE_IN_NAME = "7734";
const CODE_IN_ADDRESS = "4590";

function promptFor(property: { name: string; address?: string | null }) {
  const kb = [{ id: "k1", category: "general", title: "Kapı", content: `Giriş kodu ${CODE_IN_KB}.` }];
  const scanned = withoutSecretKbItems(kb as never);
  return {
    scannedCount: scanned.length,
    prompt: buildReplyUserPrompt({
      guestMessage: "Merhaba, kapıyı nasıl açacağım?",
      property: {
        name: property.name,
        address: property.address ?? null,
        city: "İstanbul",
        checkInTime: "15:00",
        checkOutTime: "11:00",
      },
      reservation: null,
      verifiedActiveStay: true,
      knowledgeBase: scanned,
      knowledgeBaseDropped: kb.length - scanned.length,
    } as never),
  };
}

describe("QR: sır kapısı KB kalemlerini süzer, mülk KİMLİK alanlarını SÜZMEZ", () => {
  it("KB kalemindeki giriş kodu ELENİR (kapı gerçekten çalışıyor — anti-vacuity)", () => {
    const { scannedCount, prompt } = promptFor({ name: "Lale 5" });
    expect(scannedCount).toBe(0);
    expect(prompt).not.toContain(CODE_IN_KB);
  });

  it("🚨 mülk ADINDAKİ aynı kod modele GİDER (bugünkü davranış, ayrı onayda)", () => {
    const { prompt } = promptFor({ name: `Lale 5 - kapı kodu ${CODE_IN_NAME}` });
    expect(prompt).toContain(CODE_IN_NAME);
  });

  it("🚨 ADRESTEKİ kod da modele GİDER", () => {
    const { prompt } = promptFor({ name: "Lale 5", address: `Moda Cd. 12, zil kodu ${CODE_IN_ADDRESS}` });
    expect(prompt).toContain(CODE_IN_ADDRESS);
  });

  it("kapsam dürüstlüğü: adres misafirin ZATEN bildiği bilgidir — sorun 'adres gidiyor' değil, 'taranmamış alan var'", () => {
    // Adresin kendisi gitmeli (ürünün işi); ölçülen açık, o alanın sır TARAMASINDAN
    // geçmemesidir. İki iddiayı ayırmak, ileride yanlış "sızıntı" teşhisini önler.
    const { prompt } = promptFor({ name: "Lale 5", address: "Moda Cd. 12" });
    expect(prompt).toContain("Moda Cd. 12");
  });
});
