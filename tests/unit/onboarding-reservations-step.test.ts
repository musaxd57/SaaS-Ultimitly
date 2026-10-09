import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { reservationsConnectedStepDone } from "@/lib/onboarding-steps";

// ---------------------------------------------------------------------------
// Başlangıç rehberi "Rezervasyonlarınızı bağlayın" (kurucu kararı 10-09; talimat 09-07 kapı 2 "Hospitable olmadan Lixus'un büyük
// bölümü çalışacak"). Eskiden adım YALNIZ kanal bağlantısıyla tamamlanıyordu → yalnız takvim (iCal) bağlayan host rehberi hiç
// bitiremiyordu.
// ---------------------------------------------------------------------------

describe("reservationsConnectedStepDone", () => {
  it("🚨 yalnız takvim bağlantısı (kanal yok) → tamam", () => {
    expect(reservationsConnectedStepDone({ channelConnected: false, calendarSourceCount: 1 })).toBe(true);
  });
  it("kanal bağlantısı (takvim yok) → tamam (eski davranış korunur)", () => {
    expect(reservationsConnectedStepDone({ channelConnected: true, calendarSourceCount: 0 })).toBe(true);
  });
  it("KONTROL: ikisi de yok → tamam DEĞİL (adım her zaman işaretli değil)", () => {
    expect(reservationsConnectedStepDone({ channelConnected: false, calendarSourceCount: 0 })).toBe(false);
  });
});

describe("panel bağlantısı (yapısal; kararın kendisi yukarıda)", () => {
  const src = readFileSync(path.resolve(__dirname, "../../src/app/(app)/dashboard/page.tsx"), "utf8");
  it("ilk adım saf kuralı ve org'un takvim bağlantısı sayısını kullanır", () => {
    expect(src).toMatch(/done: reservationsConnectedStepDone\(\{ channelConnected, calendarSourceCount \}\)/);
    expect(src).toMatch(/prisma\.calendarSource\.count\(\{ where: \{ property: \{ organizationId: orgId \} \} \}\)/);
    expect(src).toContain('title: "Rezervasyonlarınızı bağlayın"');
  });
  it("görünen metinler sağlayıcı (PMS) adı taşımaz (alan adı `autoReplyHospitable` metin değil)", () => {
    expect(src).not.toMatch(/["'`][^"'`\n]*Hospitable[^"'`\n]*["'`]/);
  });
});
