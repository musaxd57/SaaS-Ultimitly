import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// DEMO (inceleme) HESABI GÖRÜNTÜ KAPILARI — sunucu bileşenleri oturum ister, davranışsal render
// testi ağır; bu YAPISAL pin kararın her yüzeyde durduğunu korur (tek yönlü: yalnız kapının
// SİLİNMESİNİ yakalar). Kararın kendisi tek kaynakta: `isDemoOrg` (birim testli).
// ---------------------------------------------------------------------------

const read = (rel: string) => readFileSync(path.resolve(__dirname, "../..", rel), "utf8");

const GATES: Array<[string, RegExp, string]> = [
  ["src/app/(app)/layout.tsx", /isDemoOrg\(session\.organizationId\)\s*\?\s*\(\s*<DemoBanner \/>/, "örnek hesap bandı"],
  ["src/app/(app)/dashboard/page.tsx", /isDemoOrg\(orgId\) \? null : <OnboardingGuide/, "kurulum rehberi gizli"],
  ["src/app/(app)/inbox/page.tsx", /\{demo \? null : <HospitableSyncButton \/>\}/, "'Mesajları çek' gizli"],
  ["src/app/(app)/inbox/page.tsx", /\{demo \? null : <AutoReplyTestButton/, "oto-yanıt önizlemesi gizli"],
  ["src/app/(app)/reports/page.tsx", /!connection\.connected && !isDemoOrg\(organizationId\)/, "rapor bağlantı ipucu gizli"],
  ["src/app/(app)/properties/page.tsx", /\.\.\.\(demo \? \[\] : \[\{ label: "Kanal bağlantısı/, "hazırlık listesinde kanal adımı yok"],
  ["src/app/(app)/settings/page.tsx", /isDemoOrg\(session\.organizationId\) \?/, "ayarlarda demo metni"],
  ["src/app/(app)/admin/page.tsx", /orgs\.filter\(\(o\) => !isDemoOrg\(o\.id\)\)\.length/, "operatör sayısı demo'yu saymaz"],
];

describe("demo görüntü kapıları", () => {
  it.each(GATES)("%s — %s", (file, re) => {
    expect(read(file)).toMatch(re);
  });

  it("arayüz metinlerinde PMS adı geçmez (hazırlık maddesi, takvim ipucu, çek düğmesi)", () => {
    expect(read("src/app/(app)/properties/page.tsx")).not.toMatch(/Hospitable\/iCal/);
    expect(read("src/components/properties/calendar-sources.tsx")).not.toMatch(/Hospitable bağlıysa/);
    expect(read("src/components/inbox/hospitable-sync-button.tsx")).not.toMatch(/title="[^"]*Hospitable/);
  });
});
