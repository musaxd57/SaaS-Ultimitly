import { describe, it, expect } from "vitest";
import { nameMaskHidesEmergency, promptRedactionNames, redactGuestNamesForPrompt } from "@/lib/ai/prompt-name-redaction";
import { buildUnderstandingUserContent, MASKED_EMERGENCY_NOTE } from "@/lib/ai/semantic/understand";

// ---------------------------------------------------------------------------
// AD MASKESİ ACİL SÖZCÜĞÜ GİZLERSE KOD NOTU (Codex önerisi 09-28, kurucu "mantıklıysa yap"): misafirin adı modele HİÇ gitmez —
// güvenlik sözcüğü taşısa da ("Yangın Kaya"). Silme bir acil durum sözcüğünü de götürdüyse model bunu ayrı bir kod notundan öğrenir.
// Adın kendisi ("Adım Yangın Kaya") olay DEĞİLDİR → not yok. Karar kelime ağıyla (`isSafetyEmergencyText`) ve ad silmenin AYNI
// anahtarlarıyla verilir; kapı ham metni taramayı sürdürür.
// ---------------------------------------------------------------------------

const KAYA = ["Yangın Kaya"];

describe("nameMaskHidesEmergency — doğruluk tablosu", () => {
  it.each([
    ["Dairede yangın var!", KAYA, true],
    ["Dairede yangın var, duman çıkıyor", KAYA, true], // duman görünür kalsa da yangın sözcüğü gizlendi
    ["Merhaba, ben Yangın Kaya. Dairede yangın var!", KAYA, true],
    ["Dairede yangın var!", ["Kaya Yangın", "Yangın"], true], // soyadı önde + kanalın ayrı adı
    ["Merhaba, ben Yangın", KAYA, true], // tek sözcük: ad mı olay mı belirsiz → güvenli taraf (kelime ağı ham metinde de acil der)
  ])("%j (%j) → not VAR", (text, names, expected) => {
    expect(nameMaskHidesEmergency(text, names)).toBe(expected);
  });

  it.each([
    ["Adım Yangın Kaya", KAYA], // adın kendisi: olay değil
    ["Merhaba, adım Yangın Kaya. Wi-Fi şifresi nedir?", KAYA],
    ["Dairede duman var", KAYA], // maske hiçbir acil sözcüğü gizlemedi
    ["Dairede yangın var!", ["Ayşe Yılmaz"]], // ad acil sözcüğü değil → gizlenen yok
    ["Wi-Fi şifresi nedir?", KAYA],
    ["Dairede yangın var!", []],
    ["Dairede yangın var!", [null, undefined, "", "Al"]], // anahtar olamayan adlar
    ["Eski misafir yangın var diyor", ["Eski misafir"]], // saklama sentineli anahtar değil
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

describe("promptRedactionNames — güvenlik sözcüğü taşıyan ad da ANAHTAR (ad modele gitmez)", () => {
  it("'Yangın Kaya' silinir; yer tutucu / sentinel / kısa ad anahtar değil (ayrı ad kalitesi kuralı)", () => {
    expect(promptRedactionNames(["Yangın Kaya", "Rezervasyon HM4K2", "Misafir", "Eski misafir", "Al", null])).toEqual(["Yangın Kaya"]);
    expect(redactGuestNamesForPrompt("Dairede yangın var!", promptRedactionNames(KAYA))).toBe("Dairede [Misafir] var!");
  });
});

describe("anlama katmanı — kod notu yalnız gizleme olduğunda, ayracın DIŞINDA", () => {
  const base = { stayTimes: { checkIn: "15:00", checkOut: "11:00" } };

  it("🚨 'Dairede yangın var' (ad 'Yangın Kaya'): ad yok, not VAR (ayraçtan sonra)", () => {
    const content = buildUnderstandingUserContent({ ...base, guestMessage: "Dairede yangın var!", names: KAYA });
    expect(content).toContain(`<<<Dairede [Misafir] var!>>> ${MASKED_EMERGENCY_NOTE}`);
    expect(content.toLocaleLowerCase("tr")).not.toContain("yangın");
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
        { direction: "inbound", body: "Dün mutfakta yangın vardı" },
        { direction: "outbound", body: "Geçmiş olsun." },
      ],
    });
    expect(answered).not.toContain(MASKED_EMERGENCY_NOTE);
    const pending = buildUnderstandingUserContent({
      ...base,
      names: KAYA,
      guestMessage: "Lütfen acele edin",
      history: [{ direction: "inbound", body: "Mutfakta yangın var" }],
    });
    expect(pending).toContain(`<<<Mutfakta [Misafir] var>>> ${MASKED_EMERGENCY_NOTE}`);
  });
});
