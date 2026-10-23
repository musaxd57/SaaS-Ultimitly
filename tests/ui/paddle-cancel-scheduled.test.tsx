// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// YENİLEME İPTAL EDİLDİ (kurucu 10-17: "ayın 1'inde aldı, iptal etti → ayın 1'ine kadar aldığı paketi kullanmaya devam edebilir, ekranda
// yazsın … tam planı iptal et denince gözüksün, onun dışında gözükmesine gerek yok"). Yalnız iptal planlanmışsa kutu; tarih sunucudan.
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { PaddlePlans } from "@/components/settings/paddle-plans";

const plans = [
  {
    code: "pro",
    name: "Pro",
    priceMinor: 89900,
    annualPriceMinor: 899000,
    annualMonthlyEquivalentMinor: 74917,
    currency: "TRY",
    propertyLimit: 7,
    priceId: "pri_pro",
    annualPriceId: "pri_pro_yil",
  },
];

function renderPlans(props: { cancelScheduledUntil?: string | null; subscriptionStatus?: string | null }) {
  return render(
    <PaddlePlans
      clientToken="ctok"
      environment="sandbox"
      email="o@x.com"
      organizationId="org1"
      currentPlanCode="pro"
      currentPlanName="Pro"
      grandfathered={false}
      active
      manageable
      plans={plans}
      locale="tr-TR"
      currency="TRY"
      {...props}
    />,
  );
}

afterEach(() => cleanup());

describe("PaddlePlans — yenileme iptal edildi", () => {
  it("🚨 iptal planlandı → 'o tarihe kadar Pro paketinin tüm özelliklerini kullanmaya devam' + 'ücret alınmaz'", () => {
    renderPlans({ cancelScheduledUntil: "17 Kasım 2026", subscriptionStatus: "active" });
    const box = screen.getByTestId("cancel-scheduled-notice");
    expect(box.textContent).toBe(
      "Aboneliğinizin yenilenmesi iptal edildi. 17 Kasım 2026 tarihine kadar Pro paketinin tüm özelliklerini kullanmaya devam edebilirsiniz. Bu tarihten sonra ücret alınmaz.",
    );
    // Yönetim düğmesi yine görünür (kart / iptal sayfası).
    expect(screen.getByRole("button", { name: /Aboneliği yönet/u })).toBeTruthy();
  });

  it("deneme sürerken iptal → deneme bitişi + ücret alınmayacak", () => {
    renderPlans({ cancelScheduledUntil: "31 Ekim 2026", subscriptionStatus: "trialing" });
    expect(screen.getByTestId("cancel-scheduled-notice").textContent).toBe(
      "Aboneliğinizin yenilenmesi iptal edildi. Deneme süreniz 31 Ekim 2026 tarihinde bitecek ve ücret alınmayacak. O tarihe kadar Pro paketinin tüm özelliklerini kullanabilirsiniz.",
    );
  });

  it("KONTROL: iptal yoksa kutu GÖRÜNMEZ ('onun dışında gözükmesine gerek yok')", () => {
    renderPlans({ cancelScheduledUntil: null, subscriptionStatus: "active" });
    expect(screen.queryByTestId("cancel-scheduled-notice")).toBeNull();
  });
});
