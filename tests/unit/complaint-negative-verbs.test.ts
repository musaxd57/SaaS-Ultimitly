import { describe, it, expect } from "vitest";
import { classifyFallback, detectRiskType } from "@/lib/ai/fallback";
import { deriveMessageSignal } from "@/modules/intelligence/signals/derive";

// ---------------------------------------------------------------------------
// TÜRKÇE OLUMSUZ-FİİL ŞİKÂYET BOŞLUĞU (docs/ACIK-2026-09-08-turkce-sikayet-siniflandirma-eksigi.md)
//
// Ölçülen tablo (09-08): "Sıcak su yok" complaint, "Sıcak su gelmiyor" general —
// aynı şikâyet, fiil değişince sınıf değişiyordu; dil paritesi de bozuktu
// (EN "no heating" var, TR "ısıtma gelmiyor" yok). Bu dosya o tabloyu
// SÖZLEŞME olarak pinler; golden set çiftleri (tehdit + övgü tuzağı) ayrı.
// Kalıplar ÇAPALI: çıplak "gelmiyor / gitti / kesildi / su yok" listede YOK.
// ---------------------------------------------------------------------------

describe("classifyFallback — doküman tablosu (09-08 ölçümü → 09-10 sözleşme)", () => {
  it("olumsuz fiilli temel-hizmet şikâyetleri complaint (eskiden general)", () => {
    for (const m of [
      "Sıcak su gelmiyor, duş soğuk.",
      "Su akmıyor.",
      "Isıtma gelmiyor.",
      "Elektrikler gitti.",
      "Kapı açılmıyor.",
      "Klimadan soğuk hava gelmiyor.",
      "Sıcak su yok.",
      "Klima bozuk, çalışmıyor.",
      // Arıza ailesi TEK BAŞINA (başka kalıp yok — "bozuldu"/"bozulmuş" yük taşır)
      "Buzdolabı bozuldu.",
      "Çamaşır makinesi bozulmuş.",
      // Büyük harf / ASCII yazım (tr katlama + ASCII katlama) — listede ASCII ikizi YOK,
      // `includesAnyFold` kelimeyi de katlar; bu satırlar o sözleşmeyi pinler.
      "ELEKTRİKLER GİTTİ",
      "isitma gelmiyor",
      "kapi acilmiyor",
      "isiklar yanmiyor",
      "Su akmiyor, dus calismiyor.",
    ]) {
      const r = classifyFallback(m);
      expect(r.intent, m).toBe("complaint");
      expect(r.isComplaint, m).toBe(true);
      // Kapı/kilit cümlelerinde SAFETY_CRITICAL_WORDS'ün kilitli-kalma ağı önce gelir (safety_emergency);
      // ikisi de yüksek bahis, ikisi de veto — etiket ayrımı bilinçli.
      expect(["complaint", "safety_emergency"], m).toContain(detectRiskType(m));
    }
  });

  it("bilinçli kararlar KORUNUR: 'İnternet gelmiyor' wifi (bilgi tabanından yanıtlanır), 'çekmiyor' complaint değil", () => {
    expect(classifyFallback("İnternet gelmiyor.").intent).toBe("wifi");
    expect(classifyFallback("Wifi çekmiyor odada.").intent).toBe("wifi");
  });

  it("çıplak olumsuz fiil / 'yok' complaint YAPMAZ (yanlış pozitif tuzakları)", () => {
    for (const m of [
      "Yarın gelmiyoruz, ertesi gün geleceğiz.",
      "Plaja gittik, her şey harikaydı!",
      "Eksik bir şey yok, konaklama mükemmeldi.",
      "Sıcak su hemen geliyor, duş süperdi, teşekkürler!",
      "Hiçbir arıza yaşamadık, teşekkürler.",
      "Giriş çok kolaydı, teşekkürler.",
      "Sorun yok, her şey için teşekkürler!",
      "No worries, the power adapter you left was perfect!",
      "The door opened right away with the code, all good.",
    ]) {
      expect(classifyFallback(m).intent, m).not.toBe("complaint");
      expect(detectRiskType(m), m).not.toBe("complaint");
    }
  });

  it("EN paritesi: no electricity / power outage / door won't open / no water complaint", () => {
    for (const m of ["There is no electricity in the flat.", "Power outage since this morning.", "The door won't open with the code.", "There is no running water."]) {
      expect(classifyFallback(m).intent, m).toBe("complaint");
    }
  });
});

describe("V1 sinyal — olumsuz fiilli şikâyet artık sinyal ÜRETİR (eskiden general → null)", () => {
  const msg = (body: string) => ({
    id: "m1",
    direction: "inbound",
    authorType: "guest",
    body,
    createdAt: new Date("2026-09-10T09:00:00Z"),
    conversation: { id: "c1", propertyId: "p1", reservationId: "r1" },
  });

  it("'Sıcak su gelmiyor, duş soğuk.' → complaint / negative / 0.7", () => {
    const s = deriveMessageSignal("org1", msg("Sıcak su gelmiyor, duş soğuk."), null);
    expect(s).not.toBeNull();
    expect(s!.category).toBe("complaint");
    expect(s!.sentiment).toBe("negative");
    expect(s!.severity).toBe(0.7);
    // Metin sinyale TAŞINMAZ (PII'siz).
    expect(JSON.stringify(s)).not.toMatch(/Sıcak su/);
  });

  it("övgü sinyal üretmez (null kalır)", () => {
    expect(deriveMessageSignal("org1", msg("Sıcak su hemen geliyor, duş süperdi, teşekkürler!"), null)).toBeNull();
  });
});
