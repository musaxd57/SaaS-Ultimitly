import { describe, it, expect } from "vitest";
import { bodyMentionsTime } from "@/components/inbox/decision-panel";

// Host Karar Motoru paneli: ev sahibi hazır metni düzenlediyse ve seçtiği saat metinde geçmiyorsa uyarı çıkar (gönderimi
// durdurmaz). Saat yazımları: "13:00", "13.00", baştaki sıfırsız "9:30"; başka sayının parçası ("113:00", "13:005") sayılmaz.
describe("düzenlenmiş karar metninde seçilen saat", () => {
  it("yaygın yazımlar tanınır", () => {
    expect(bodyMentionsTime("13:00'te girebilirsiniz.", "13:00")).toBe(true);
    expect(bodyMentionsTime("Saat 13.00 olur.", "13:00")).toBe(true);
    expect(bodyMentionsTime("9:30 itibarıyla", "09:30")).toBe(true);
    expect(bodyMentionsTime("09.30 gibi", "09:30")).toBe(true);
  });
  it("saat yoksa ya da başka bir sayının parçasıysa uyarı", () => {
    expect(bodyMentionsTime("Erken girebilirsiniz.", "13:00")).toBe(false);
    expect(bodyMentionsTime("Saat 14:00'te girebilirsiniz.", "13:00")).toBe(false);
    expect(bodyMentionsTime("Kod 113:00", "13:00")).toBe(false);
    expect(bodyMentionsTime("13:005", "13:00")).toBe(false);
    expect(bodyMentionsTime("13x00", "13:00")).toBe(false);
  });
});
