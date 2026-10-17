import { describe, it, expect } from "vitest";
import { nameMaskHidesEmergency, promptRedactionNames, redactGuestNamesForPrompt } from "@/lib/ai/prompt-name-redaction";
import { buildUnderstandingUserContent, MASKED_EMERGENCY_NOTE } from "@/lib/ai/semantic/understand";

// ---------------------------------------------------------------------------
// AD MASKESİ ACİL SÖZCÜĞÜ GİZLERSE KOD NOTU (Codex önerisi 09-28) — KURAL 09-30 (kurucu kararı): ad artık YALNIZ kimlik konumunda
// maskelenir ("adım …", "ben …", "I'm …", imza; `guest-identity-mask.ts`). Adı "Yangın Kaya" olan misafirin "Dairede yangın var!"
// mesajında "yangın" SİLİNMEZ — model acil sözcüğünü doğrudan görür, not gerekmez. Not yalnız kimlik konumundaki maske bir acil
// sözcüğünü gizlediğinde ("Merhaba, ben Yangın" — ad mı olay mı belirsiz → güvenli taraf). Kapı ham metni taramayı sürdürür.
// ---------------------------------------------------------------------------

const KAYA = ["Yangın Kaya"];

describe("nameMaskHidesEmergency — doğruluk tablosu", () => {
  it.each([
    ["Merhaba, ben Yangın", KAYA, true], // kimlik konumu: ad mı olay mı belirsiz → güvenli taraf (kelime ağı ham metinde de acil der)
    ["Ben Yangın, mutfakta duman var", KAYA, true], // maskelenen anahtar kendisi acil sözcüğü
    ["Otopark var mı? Teşekkürler, Yangın", KAYA, true], // imza konumu
  ])("%j (%j) → not VAR", (text, names, expected) => {
    expect(nameMaskHidesEmergency(text, names)).toBe(expected);
  });

  it.each([
    ["Dairede yangın var!", KAYA], // 🚨 kurucu kararı 09-30: kimlik konumu değil → silinmez, model "yangın"ı görür
    ["Dairede yangın var, duman çıkıyor", KAYA],
    ["Dairede yangın var!", ["Kaya Yangın", "Yangın"]],
    ["Adım Yangın Kaya", KAYA], // adın kendisi: olay değil
    ["Merhaba, adım Yangın Kaya. Wi-Fi şifresi nedir?", KAYA],
    ["Dairede duman var", KAYA],
    ["Dairede yangın var!", ["Ayşe Yılmaz"]],
    ["Wi-Fi şifresi nedir?", KAYA],
    ["Dairede yangın var!", []],
    ["Dairede yangın var!", [null, undefined, "", "A"]],
    ["Eski misafir yangın var diyor", ["Eski misafir"]],
    ["", KAYA],
  ] as [string, (string | null | undefined)[]][])("%j (%j) → not YOK", (text, names) => {
    expect(nameMaskHidesEmergency(text, names)).toBe(false);
  });

  it("anti-vakum: 'Adım Yangın Kaya' ham metinde gerçekten acil sayılıyor (not yokluğu kuralın işi, ağın körlüğü değil)", async () => {
    const { isSafetyEmergencyText } = await import("@/lib/ai/fallback");
    expect(isSafetyEmergencyText("Adım Yangın Kaya")).toBe(true);
    expect(redactGuestNamesForPrompt("Adım Yangın Kaya", promptRedactionNames(KAYA))).toBe("Adım [Misafir]");
  });
});

describe("promptRedactionNames + maske (kurucu kararı 09-30)", () => {
  it("yer tutucu / sentinel / tek harf anahtar değil; kısa ad (Al) kimlik konumu için anahtar", () => {
    expect(promptRedactionNames(["Yangın Kaya", "Rezervasyon HM4K2", "Misafir", "Eski misafir", "Al", "A", null])).toEqual(["Yangın Kaya", "Al"]);
  });

  it("🚨 anlamlı sözcük silinmez: 'Dairede yangın var!', 'Deniz manzarası', '15 Nisan'", () => {
    expect(redactGuestNamesForPrompt("Dairede yangın var!", promptRedactionNames(KAYA))).toBe("Dairede yangın var!");
    expect(redactGuestNamesForPrompt("Deniz manzarası var mı?", promptRedactionNames(["Deniz Kaya"]))).toBe("Deniz manzarası var mı?");
    expect(redactGuestNamesForPrompt("15 Nisan'da gelebilir miyiz?", promptRedactionNames(["Nisan Er"]))).toBe("15 Nisan'da gelebilir miyiz?");
  });

  it("🚨 açık kimlik ifadeleri ve imza maskelenir", () => {
    const n = promptRedactionNames(["Deniz Kaya"]);
    expect(redactGuestNamesForPrompt("Merhaba, benim adım Deniz. Deniz manzarası var mı?", n)).toBe(
      "Merhaba, benim adım [Misafir]. Deniz manzarası var mı?",
    );
    expect(redactGuestNamesForPrompt("Hi, I'm Deniz! Is there parking?", n)).toBe("Hi, I'm [Misafir]! Is there parking?");
    expect(redactGuestNamesForPrompt("Otopark var mı?\nTeşekkürler,\nDeniz", n)).toBe("Otopark var mı?\nTeşekkürler,\n[Misafir]");
    expect(redactGuestNamesForPrompt("Deniz Kaya olarak yazıyorum", n)).toBe("[Misafir] olarak yazıyorum");
  });

  it("🚨 bizim metnimizde yalnız hitap konumu", () => {
    const n = promptRedactionNames(["Deniz Kaya"]);
    expect(redactGuestNamesForPrompt("Merhaba Deniz,\n\nDeniz manzaralı balkon mevcut.", n, "ours")).toBe(
      "Merhaba [Misafir],\n\nDeniz manzaralı balkon mevcut.",
    );
    expect(redactGuestNamesForPrompt("Deniz Hanım, giriş 15:00.", n, "ours")).toBe("[Misafir] Hanım, giriş 15:00.");
  });
});

describe("anlama katmanı — kod notu yalnız gizleme olduğunda, ayracın DIŞINDA", () => {
  const base = { stayTimes: { checkIn: "15:00", checkOut: "11:00" } };

  it("🚨 'Dairede yangın var' (ad 'Yangın Kaya'): acil sözcüğü GÖRÜNÜR, not gerekmez (kurucu kararı 09-30)", () => {
    const content = buildUnderstandingUserContent({ ...base, guestMessage: "Dairede yangın var!", names: KAYA });
    expect(content).toContain("<<<Dairede yangın var!>>>");
    expect(content).not.toContain(MASKED_EMERGENCY_NOTE);
  });

  it("🚨 'Merhaba, ben Yangın': kimlik konumu maskelenir, not VAR (ayraçtan sonra)", () => {
    const content = buildUnderstandingUserContent({ ...base, guestMessage: "Merhaba, ben Yangın", names: KAYA });
    expect(content).toContain(`<<<Merhaba, ben [Misafir]>>> ${MASKED_EMERGENCY_NOTE}`);
  });

  it("🚨 'Adım Yangın Kaya': ad yok, not YOK", () => {
    const content = buildUnderstandingUserContent({ ...base, guestMessage: "Adım Yangın Kaya, Wi-Fi şifresi nedir?", names: KAYA });
    expect(content).toContain("<<<Adım [Misafir], Wi-Fi şifresi nedir?>>>");
    expect(content).not.toContain(MASKED_EMERGENCY_NOTE);
    expect(content.toLocaleLowerCase("tr")).not.toContain("yangın");
  });

  it("gizleme yoksa içerik (ve önbellek anahtarı) bayt bayt eskisi: not metni hiç geçmez", () => {
    for (const [msg, names] of [
      ["Wi-Fi şifresi nedir?", ["Ayşe Yılmaz"]],
      ["Dairede duman var", KAYA],
      ["Dairede yangın var!", ["Ayşe Yılmaz"]],
    ] as [string, string[]][]) {
      expect(buildUnderstandingUserContent({ ...base, guestMessage: msg, names })).not.toContain("code note");
    }
  });

  it("cevaplanmış eski mesaj not ALMAZ; cevapsız önceki mesaj alır", () => {
    const answered = buildUnderstandingUserContent({
      ...base,
      names: KAYA,
      guestMessage: "Wi-Fi şifresi nedir?",
      history: [
        { direction: "inbound", body: "Ben Yangın, dün mutfakta duman vardı" },
        { direction: "outbound", body: "Geçmiş olsun." },
      ],
    });
    expect(answered).not.toContain(MASKED_EMERGENCY_NOTE);
    const pending = buildUnderstandingUserContent({
      ...base,
      names: KAYA,
      guestMessage: "Lütfen acele edin",
      history: [{ direction: "inbound", body: "Ben Yangın, mutfakta duman var" }],
    });
    expect(pending).toContain(`<<<Ben [Misafir], mutfakta duman var>>> ${MASKED_EMERGENCY_NOTE}`);
  });
});
