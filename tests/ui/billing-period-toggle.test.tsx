// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PricingTiers } from "@/components/marketing/pricing-tiers";

afterEach(cleanup);

const TIERS = [
  { name: "Pro", planCode: "pro", desc: "3–7 daire", features: ["A"], highlight: true },
];
const PRICES = {
  pro: { monthly: "₺899", monthlyEquivalent: "₺749", annualTotal: "₺8.990" },
};

function renderTiers() {
  return render(<PricingTiers tiers={TIERS} prices={PRICES} annualAvailable />);
}

describe("aylık/yıllık seçici — landing fiyat kartları", () => {
  it("VARSAYILAN aylıktır (yıllık sessizce seçili gelmez)", () => {
    renderTiers();
    expect(screen.getByRole("button", { name: "Aylık" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Yıllık" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("₺899")).toBeTruthy();
  });

  it("yıllığa geçince AYLIK KARŞILIK gösterilir, yıllık toplam DEĞİL", () => {
    // 🚨 Başlıkta ₺8.990 yazsaydı yıllık ilk bakışta 10 kat pahalı görünürdü;
    // toggle'ın kazanmak için var olduğu kıyas tam olarak burada kaybedilir.
    renderTiers();
    fireEvent.click(screen.getByRole("button", { name: "Yıllık" }));
    expect(screen.getByText("₺749")).toBeTruthy();
    expect(screen.queryByText("₺899")).toBeNull();
  });

  it("🚨 yıllıkta GERÇEK tahsil edilen tutar da yazılı (yuvarlama gizlenmez)", () => {
    // ₺749 × 12 = ₺8.988 ≠ ₺8.990. Alt satır olmadan kart, ödenenden az bir
    // rakam vaat etmiş olurdu. Bu satır opsiyonel DEĞİL.
    renderTiers();
    fireEvent.click(screen.getByRole("button", { name: "Yıllık" }));
    expect(screen.getByText(/yıllık ₺8\.990 olarak faturalanır/)).toBeTruthy();
  });

  it("aylığa dönünce alt satır kaybolur ve fiyat geri gelir (ters yön)", () => {
    renderTiers();
    fireEvent.click(screen.getByRole("button", { name: "Yıllık" }));
    fireEvent.click(screen.getByRole("button", { name: "Aylık" }));
    expect(screen.getByText("₺899")).toBeTruthy();
    expect(screen.queryByText(/olarak faturalanır/)).toBeNull();
  });

  it("indirim TEK bir rozetle söylenir — ÜSTÜ ÇİZİLİ fiyat YOK", () => {
    // Türkiye'de üstü çizili fiyat bir İNDİRİM iddiasıdır ve referans dönemde
    // gerçekten uygulanmış bir "eski fiyat" ister. ₺899 eski fiyat değil —
    // toggle'ın diğer konumunda HÂLÂ satılan güncel fiyat.
    const { container } = renderTiers();
    // 🚨 ROZET DÖNEME GÖRE KONUŞUR. Sabit "2 ay bedava" iken aylık seçiliyken
    // serbest duruyordu ve AYLIK fiyatın içinde iki ay hediye varmış gibi
    // okunuyordu (kullanıcı bildirdi). Aylıkta DAVET, yıllıkta ONAY.
    expect(screen.getByText(/Yıllığa geçin, 2 ay bedava/)).toBeTruthy();
    expect(container.querySelector("s, del, .line-through")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Yıllık" }));
    expect(screen.getByText(/2 ay bedava — yıllık seçildi/)).toBeTruthy();
    expect(container.querySelector("s, del, .line-through")).toBeNull();
  });

  it("🚨 aylık seçiliyken rozet BAŞINA BUYRUK '2 ay bedava' DEMEZ", () => {
    // Mutasyon koruması: metin sabite döndürülürse bu kırmızı olur.
    renderTiers();
    const rozet = screen.getByText(/2 ay bedava/);
    expect(rozet.textContent).toMatch(/Yıllığa geçin/);
  });

  it("erişilebilirlik: role=group + aria-pressed, ve değişim DUYURULUR", () => {
    // Depoda `radiogroup`/`tablist`/`switch` deseni YOK; iki `aria-pressed`
    // butonu mevcut desenle (calendar-sources, auto-reply-toggle) aynı.
    renderTiers();
    expect(screen.getByRole("group", { name: "Faturalandırma dönemi" })).toBeTruthy();
    // Odak butonda kalırken kartlardaki fiyatlar sessizce değişiyordu.
    expect(screen.getByText("Aylık fiyatlar gösteriliyor")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Yıllık" }));
    expect(screen.getByText("Yıllık fiyatlar gösteriliyor")).toBeTruthy();
  });
});

describe("yıllık env'siz yüzeyler", () => {
  it("🚨 LANDING: annualAvailable=false iken seçici ve rozet HİÇ çizilmez", () => {
    // Landing, ayarların SATABİLDİĞİNDEN fazlasını vaat etmemeli. Kapı yokken
    // ziyaretçi "Yıllık"ı seçip Ayarlar'a gidiyor ve orada yalnız aylık
    // buluyordu (env'siz yerel/.eu kurulumu ya da biri env'i silerse).
    render(<PricingTiers tiers={TIERS} prices={PRICES} />);
    expect(screen.queryByRole("group", { name: "Faturalandırma dönemi" })).toBeNull();
    expect(screen.queryByText(/2 ay bedava/)).toBeNull();
    // ...ve aylık fiyat normal şekilde görünmeye devam eder.
    expect(screen.getByText("₺899")).toBeTruthy();
  });


  it("PaddlePlans: annualAvailable=false iken seçici HİÇ çizilmez", async () => {
    vi.doMock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
    const { PaddlePlans } = await import("@/components/settings/paddle-plans");
    render(
      <PaddlePlans
        clientToken="ctok"
        environment="sandbox"
        email="o@x.com"
        organizationId="org"
        currentPlanCode="free"
        currentPlanName="Başlangıç"
        grandfathered={false}
        active={false}
        locale="tr-TR"
        currency="TRY"
        plans={[
          {
            code: "pro",
            name: "Pro",
            priceMinor: 89900,
            annualPriceMinor: 899000,
            annualMonthlyEquivalentMinor: 74917,
            currency: "TRY",
            propertyLimit: 7,
            priceId: "pri_pro",
            annualPriceId: "",
          },
        ]}
      />,
    );
    // Yıllık fiyat id'si yokken seçici gösterilirse müşteri, checkout'ta boş
    // bir priceId ile karşılaşır — buton sessizce çalışmaz.
    expect(screen.queryByRole("group", { name: "Faturalandırma dönemi" })).toBeNull();
  });
});
