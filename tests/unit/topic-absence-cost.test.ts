import { describe, it, expect } from "vitest";
import { stripTopicAbsence } from "@/lib/conversation-items/topic-absence";
import { topicsWithSymptomsOf } from "@/lib/conversation-items/relation";

// KONU BAZLI "BİLGİM YOK" (H9) — süre pini (CLAUDE.md ReDoS dersi: model metni uzun olabilir; satır sonu temizliği eskiden
// `[ \t]+\n` kalıbıydı, uzun boşluk dizisinde karesel). Ayrı dosya: paralel kapıda süre ölçen kol en sonda tek başına koşar.

const TRASH = "Çöpleri binanın arkasındaki konteynere bırakabilirsiniz.";
const TV_ABSENT = "Televizyonla ilgili bir bilgim yok.";
const trash = topicsWithSymptomsOf("çöp nereye atılır");

describe("konu bazlı bilgim yok — süre", () => {
  it("süre: 50.000 boşluk / 50.000 harflik sözcük doğrusal (karesel iş yok)", () => {
    const base = { answeredRefs: ["R1"], answerableTopics: [{ ref: "R1", topics: trash }], heldDeviceTopics: ["tv"] };
    for (const filler of [" ".repeat(50_000), "a".repeat(50_000), " \t".repeat(25_000)]) {
      const t0 = performance.now();
      const out = stripTopicAbsence({ ...base, reply: `${TRASH}${filler}Çöp günü salıdır. ${TV_ABSENT}` });
      expect(performance.now() - t0).toBeLessThan(1_500);
      expect(out.ok).toBe(true); // boşluk dizisi KALAN metinde (eski kalıp tam burada karesel çalışırdı)
    }
  });
});
