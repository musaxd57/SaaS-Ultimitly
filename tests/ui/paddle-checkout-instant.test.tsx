// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// ÖDEME EKRANI TAMAMLANDI → ANINDA DOĞRULAMA (kurucu 11-18 akşam: "doğrulanır doğrulanmaz plan açılmalı. 10 dakika bir bekleme kuralı
// olmamalı … panel sayfayı yenilemeden güncellenmeli"; tasarım `docs/TASARIM-2026-11-18-odeme-aninda-dogrulama.md` §3). Anahtar açıkken
// ekran `POST /api/billing/checkout-verify` sorar: `active` → "Planınız etkin." + "Panele dön", tek tazeleme; `awaiting` / `unverified` →
// 3 / 6 / 12 sn'de yeniden sorar. Uç yoksa / kimlik yoksa / ağ düştüyse bugünkü akış (`checkout-pending` + sayfa yenileme). Anahtar
// kapalıyken bugünkü ekran (`paddle-checkout-pending.test.tsx` değişmeden yeşil).
// ---------------------------------------------------------------------------

const { router } = vi.hoisted(() => ({ router: { refresh: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { PaddlePlans } from "@/components/settings/paddle-plans";
import { CHECKOUT_PENDING_MESSAGE } from "@/lib/billing/checkout-pending-shared";
import {
  CHECKOUT_VERIFY_ACTIVE_MESSAGE,
  CHECKOUT_VERIFY_AWAITING_MESSAGE,
  CHECKOUT_VERIFY_DASHBOARD_LABEL,
  CHECKOUT_VERIFY_SLOW_AFTER_MS,
  CHECKOUT_VERIFY_SLOW_DELAY_MS,
  CHECKOUT_VERIFY_SUPPORT_AFTER_MS,
  CHECKOUT_VERIFY_SUPPORT_LABEL,
  checkoutVerifyDelay,
  checkoutVerifyStep,
  shortTrackingId,
} from "@/components/settings/checkout-verify-poll";
import { shortCorrelationId } from "@/lib/correlation";
import { SELLER } from "@/lib/legal-entity";
import { checkAllCheckoutConsents } from "../helpers/checkout-consent-ui";

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

const TXN = "txn_01lale";
// Gerçek biçim (sunucu `newCorrelationId` = UUID v4): ekranda ilk 8 karakter, kopyalama düğmesi TAMAMINI taşır.
const TRACKING = "3f2a9c1e-7b4d-4e8a-9c2f-1a2b3c4d5e6f";

const plansEl = (instantCheckoutLink: boolean) => (
  <PaddlePlans
    clientToken="ctok"
    environment="sandbox"
    email="o@x.com"
    organizationId="org1"
    currentPlanCode="free"
    currentPlanName="Ücretsiz"
    grandfathered={false}
    active={false}
    trialDaysLeft={12}
    plans={plans}
    locale="tr-TR"
    currency="TRY"
    instantCheckoutLink={instantCheckoutLink}
  />
);

type VerifyAnswer = { status: number; state?: string; headers?: Record<string, string> } | "network" | Promise<never>;

function response(status: number, body: unknown, headers: Record<string, string> = {}) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(headers), json: async () => body };
}

describe("PaddlePlans — ödeme tamamlanınca anında doğrulama", () => {
  let eventCallback: ((ev: { name?: string; data?: { transaction_id?: unknown } }) => void) | undefined;
  let open: ReturnType<typeof vi.fn>;
  // Sıradaki `checkout-verify` cevapları; liste bitince son cevap tekrarlanır.
  let verifyAnswers: VerifyAnswer[];
  let visibility: DocumentVisibilityState;

  beforeEach(() => {
    vi.clearAllMocks();
    eventCallback = undefined;
    open = vi.fn();
    verifyAnswers = [{ status: 200, state: "awaiting" }];
    visibility = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    (window as unknown as { Paddle: unknown }).Paddle = {
      Environment: { set: vi.fn() },
      Initialize: vi.fn((opts: { eventCallback?: (ev: { name?: string; data?: { transaction_id?: unknown } }) => void }) => {
        eventCallback = opts.eventCallback;
      }),
      Checkout: { open },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/billing/consent") return response(201, { ok: true, consentId: "cons_1" });
        if (url === "/api/billing/checkout-verify") {
          const next = verifyAnswers.length > 1 ? verifyAnswers.shift()! : verifyAnswers[0]!;
          if (next === "network") throw new TypeError("Failed to fetch");
          if (next instanceof Promise) return next;
          return response(next.status, next.state ? { state: next.state } : { error: "x" }, next.headers ?? {});
        }
        return response(200, { ok: true });
      }),
    );
  });
  afterEach(() => {
    cleanup();
    delete (window as unknown as { Paddle?: unknown }).Paddle;
    delete (document as unknown as { visibilityState?: unknown }).visibilityState;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const urls = () => vi.mocked(fetch).mock.calls.map(([url]) => String(url));
  const verifyCalls = () => urls().filter((u) => u === "/api/billing/checkout-verify").length;
  const pendingCalls = () => vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/billing/checkout-pending");
  const tick = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  /** Ödeme ekranını gerçek saatle açar, sonra saati taklide çevirir (tamamlanmadan sonraki zamanlayıcılar sahte). */
  async function payOnce(instant = true) {
    const view = render(plansEl(instant));
    await checkAllCheckoutConsents();
    const btn = (await screen.findByRole("button", { name: /bu planı seç/i })) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
    fireEvent.click(btn);
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    return { btn, view };
  }
  async function complete(data: { transaction_id?: unknown } = { transaction_id: TXN }) {
    act(() => eventCallback?.({ name: "checkout.completed", data }));
    await tick(0);
  }

  it("🚨 active → 'Planınız etkin.' + 'Panele dön' (/dashboard), sayfa BİR kez tazelenir, sorma durur, eski sinyal gitmez", async () => {
    verifyAnswers = [{ status: 200, state: "active" }];
    const { btn } = await payOnce();
    await complete();
    expect(screen.getByText(CHECKOUT_VERIFY_ACTIVE_MESSAGE)).toBeTruthy();
    const link = screen.getByRole("link", { name: CHECKOUT_VERIFY_DASHBOARD_LABEL });
    expect(link.getAttribute("href")).toBe("/dashboard");
    expect(router.refresh).toHaveBeenCalledTimes(1);
    const call = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/billing/checkout-verify");
    expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({ consentId: "cons_1", transactionId: TXN });
    await tick(5 * 60_000);
    act(() => void document.dispatchEvent(new Event("visibilitychange"))); // sekmeye dönüş de yeniden sordurmaz
    await tick(0);
    expect(verifyCalls()).toBe(1);
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(pendingCalls()).toHaveLength(0);
    expect(screen.queryByText(CHECKOUT_PENDING_MESSAGE)).toBeNull();
    expect(btn.disabled).toBe(true); // ikinci ödeme ekranı açılmaz
  });

  it.each(["awaiting", "unverified"])("🚨 %s → bekleme metni; 3 / 6 / 12 sn'de yeniden sorar, active gelince durur", async (state) => {
    verifyAnswers = [{ status: 200, state }, { status: 200, state }, { status: 200, state }, { status: 200, state: "active" }];
    const { btn } = await payOnce();
    await complete();
    expect(verifyCalls()).toBe(1);
    expect(screen.getByText(CHECKOUT_VERIFY_AWAITING_MESSAGE)).toBeTruthy();
    expect(screen.queryByText(CHECKOUT_PENDING_MESSAGE)).toBeNull(); // "birkaç dakika" sözü yok
    expect(btn.disabled).toBe(true);
    await tick(2_999);
    expect(verifyCalls()).toBe(1);
    await tick(1);
    expect(verifyCalls()).toBe(2); // 3 sn
    await tick(5_999);
    expect(verifyCalls()).toBe(2);
    await tick(1);
    expect(verifyCalls()).toBe(3); // +6 sn
    await tick(11_999);
    expect(verifyCalls()).toBe(3);
    await tick(1);
    expect(verifyCalls()).toBe(4); // +12 sn → active
    expect(screen.getByText(CHECKOUT_VERIFY_ACTIVE_MESSAGE)).toBeTruthy();
    expect(router.refresh).toHaveBeenCalledTimes(1);
    await tick(10 * 60_000);
    expect(verifyCalls()).toBe(4);
    expect(pendingCalls()).toHaveLength(0);
    // Kural: bekleme süresince sayfa yenilenmez (yalnız uç sorulur).
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("12 sn'den sonra aralık 12 sn'de kalır (beşinci ve altıncı istek)", async () => {
    await payOnce();
    await complete();
    await tick(3_000 + 6_000 + 12_000);
    expect(verifyCalls()).toBe(4);
    await tick(12_000);
    expect(verifyCalls()).toBe(5);
    await tick(12_000);
    expect(verifyCalls()).toBe(6);
  });

  it("🚨 uç 404 (anahtar sunucuda kapalı) → BUGÜNKÜ akış: checkout-pending işlem kimliğiyle gider, eski metin, sorma durur", async () => {
    verifyAnswers = [{ status: 404 }];
    await payOnce();
    await complete();
    expect(pendingCalls()).toHaveLength(1);
    expect(JSON.parse(String((pendingCalls()[0]![1] as RequestInit).body))).toEqual({ consentId: "cons_1", transactionId: TXN });
    expect(screen.getByText(CHECKOUT_PENDING_MESSAGE)).toBeTruthy();
    expect(screen.queryByText(CHECKOUT_VERIFY_AWAITING_MESSAGE)).toBeNull();
    await tick(60_000);
    expect(verifyCalls()).toBe(1);
    expect(router.refresh).toHaveBeenCalled(); // bugünkü sayfa yenileme
  });

  it("🚨 ilk istekte ağ hatası → bugünkü akış", async () => {
    verifyAnswers = ["network"];
    await payOnce();
    await complete();
    expect(pendingCalls()).toHaveLength(1);
    expect(screen.getByText(CHECKOUT_PENDING_MESSAGE)).toBeTruthy();
    await tick(60_000);
    expect(verifyCalls()).toBe(1);
  });

  it("KONTROL: bekleme sırasında geçici ağ hatası / 5xx bugünkü akışa düşürmez, sorma sürer", async () => {
    verifyAnswers = [{ status: 200, state: "awaiting" }, "network", { status: 503 }, { status: 200, state: "active" }];
    await payOnce();
    await complete();
    await tick(3_000 + 6_000 + 12_000);
    expect(verifyCalls()).toBe(4);
    expect(pendingCalls()).toHaveLength(0);
    expect(screen.getByText(CHECKOUT_VERIFY_ACTIVE_MESSAGE)).toBeTruthy();
  });

  it("🚨 olay işlem kimliği taşımıyorsa doğrulama sorulmaz → bugünkü akış (yalnız onay kaydı)", async () => {
    await payOnce();
    await complete({});
    expect(verifyCalls()).toBe(0);
    expect(pendingCalls()).toHaveLength(1);
    expect(JSON.parse(String((pendingCalls()[0]![1] as RequestInit).body))).toEqual({ consentId: "cons_1" });
    expect(screen.getByText(CHECKOUT_PENDING_MESSAGE)).toBeTruthy();
  });

  it("🚨 anahtar KAPALI → doğrulama hiç sorulmaz, bugünkü ekran", async () => {
    await payOnce(false);
    await complete();
    expect(verifyCalls()).toBe(0);
    expect(pendingCalls()).toHaveLength(1);
    expect(screen.getByText(CHECKOUT_PENDING_MESSAGE)).toBeTruthy();
    expect(screen.queryByText(CHECKOUT_VERIFY_AWAITING_MESSAGE)).toBeNull();
    // ÖD-1 / ÖD-3 yalnız anında doğrulama yolunda: anahtar kapalıyken destek alanı ne başta ne 2 dakikadan sonra çizilir.
    expect(screen.queryByTestId("checkout-verify-support")).toBeNull();
    await tick(CHECKOUT_VERIFY_SUPPORT_AFTER_MS);
    expect(screen.queryByTestId("checkout-verify-support")).toBeNull();
    expect(screen.queryByText(CHECKOUT_VERIFY_SUPPORT_LABEL)).toBeNull();
  });

  it("🚨 bileşen kaldırılınca zamanlayıcı kalmaz, yeni istek gitmez", async () => {
    const { view } = await payOnce();
    await complete();
    expect(verifyCalls()).toBe(1);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    await tick(10 * 60_000);
    expect(verifyCalls()).toBe(1);
  });

  it("🚨 aynı anda tek istek: cevap gelmeden görünürlük olayı ve zaman ikinci istek attırmaz", async () => {
    let settle: (v: unknown) => void = () => {};
    const hanging = new Promise<never>((resolve) => {
      settle = resolve as (v: unknown) => void;
    });
    verifyAnswers = [hanging, { status: 200, state: "active" }];
    await payOnce();
    await complete();
    expect(verifyCalls()).toBe(1);
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    await tick(60_000);
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(verifyCalls()).toBe(1);
    settle(response(200, { state: "awaiting" }));
    await tick(0);
    await tick(3_000);
    expect(verifyCalls()).toBe(2);
    expect(screen.getByText(CHECKOUT_VERIFY_ACTIVE_MESSAGE)).toBeTruthy();
  });

  it("🚨 sekme gizliyken sorulmaz; görünür olunca HEMEN bir kez sorulur", async () => {
    await payOnce();
    await complete();
    expect(verifyCalls()).toBe(1);
    visibility = "hidden";
    await tick(5 * 60_000);
    expect(verifyCalls()).toBe(1);
    verifyAnswers = [{ status: 200, state: "active" }];
    visibility = "visible";
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    await tick(0);
    expect(verifyCalls()).toBe(2);
    expect(screen.getByText(CHECKOUT_VERIFY_ACTIVE_MESSAGE)).toBeTruthy();
  });

  // ÖD-1 / ÖD-3 (kurucu 11-19): "İki dakika makul ama yalnızca destek seçeneğini öne çıkarma eşiği olarak. Normal destek bağlantısı baştan
  // erişilebilir olsun. Gecikirse `Destekle iletişime geç` ve yanında kopyalanabilir kısa bir Lixus takip numarası gösterelim."
  it("🚨 ÖD-1: destek e-posta bağlantısı BAŞTAN görünür (2 dakika dolmadan), takip numarası henüz yok", async () => {
    verifyAnswers = [{ status: 200, state: "awaiting", headers: { "X-Correlation-ID": TRACKING } }];
    await payOnce();
    await complete();
    expect(screen.getByText(CHECKOUT_VERIFY_AWAITING_MESSAGE)).toBeTruthy();
    const support = screen.getByTestId("checkout-verify-support");
    const mail = support.querySelector("a[href^='mailto:']") as HTMLAnchorElement;
    expect(mail.getAttribute("href")).toBe(`mailto:${SELLER.eposta}`);
    expect(mail.textContent).toBe(SELLER.eposta);
    expect(screen.queryByText(CHECKOUT_VERIFY_SUPPORT_LABEL)).toBeNull();
    expect(screen.queryByText(shortTrackingId(TRACKING))).toBeNull();
    expect(screen.queryByRole("button", { name: "Takip numarasını kopyala" })).toBeNull();
  });

  it("🚨 ÖD-3: 2 dakikadan sonra bağlantı 'Destekle iletişime geç' olur, yanında kısa takip numarası (metin) + kopyalama düğmesi", async () => {
    verifyAnswers = [{ status: 200, state: "awaiting", headers: { "X-Correlation-ID": TRACKING } }];
    await payOnce();
    await complete();
    await tick(CHECKOUT_VERIFY_SUPPORT_AFTER_MS - 1);
    expect(screen.queryByText(CHECKOUT_VERIFY_SUPPORT_LABEL)).toBeNull();
    await tick(1);
    const support = screen.getByTestId("checkout-verify-support");
    const mail = support.querySelector("a[href^='mailto:']") as HTMLAnchorElement;
    expect(mail.getAttribute("href")).toBe(`mailto:${SELLER.eposta}`);
    expect(mail.textContent).toBe(CHECKOUT_VERIFY_SUPPORT_LABEL);
    expect(CHECKOUT_VERIFY_SUPPORT_LABEL).toBe("Destekle iletişime geç");
    expect(support.textContent).toContain("3f2a9c1e");
    expect(support.textContent).not.toContain(TRACKING); // ekranda kısa biçim; tamamı yalnız kopyalama düğmesinde
    expect(screen.getByRole("button", { name: "Takip numarasını kopyala" })).toBeTruthy();
    expect(screen.getByText(CHECKOUT_VERIFY_AWAITING_MESSAGE)).toBeTruthy();
  });

  it("ÖD-3: kopyalama düğmesi takip numarasının TAMAMINI panoya yazar (kurucu kararı 10-10: kısa ekranda, tamamı kopyada)", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    verifyAnswers = [{ status: 200, state: "awaiting", headers: { "X-Correlation-ID": TRACKING } }];
    await payOnce();
    await complete();
    await tick(CHECKOUT_VERIFY_SUPPORT_AFTER_MS);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Takip numarasını kopyala" }));
    });
    expect(writeText).toHaveBeenCalledWith(TRACKING);
    delete (navigator as unknown as { clipboard?: unknown }).clipboard;
  });

  it("KONTROL: 2 dakikadan sonra takip numarası hiç gelmediyse (başlık yok) bağlantı yine 'Destekle iletişime geç', numara / düğme yok", async () => {
    verifyAnswers = [{ status: 200, state: "awaiting" }];
    await payOnce();
    await complete();
    await tick(CHECKOUT_VERIFY_SUPPORT_AFTER_MS);
    const mail = screen.getByTestId("checkout-verify-support").querySelector("a[href^='mailto:']") as HTMLAnchorElement;
    expect(mail.textContent).toBe(CHECKOUT_VERIFY_SUPPORT_LABEL);
    expect(screen.queryByRole("button", { name: "Takip numarasını kopyala" })).toBeNull();
  });

  it("KONTROL: 2 dakika dolmadan plan açılırsa destek alanı kalkar, 'Destekle iletişime geç' hiç görünmez", async () => {
    verifyAnswers = [{ status: 200, state: "awaiting" }, { status: 200, state: "active" }];
    await payOnce();
    await complete();
    await tick(CHECKOUT_VERIFY_SUPPORT_AFTER_MS * 2);
    expect(screen.queryByTestId("checkout-verify-support")).toBeNull();
    expect(screen.queryByText(CHECKOUT_VERIFY_SUPPORT_LABEL)).toBeNull();
    expect(screen.getByText(CHECKOUT_VERIFY_ACTIVE_MESSAGE)).toBeTruthy();
  });

  it("kısa takip numarası sunucunun kısa biçimiyle AYNI kural (ilk 8 karakter)", () => {
    expect(shortTrackingId(TRACKING)).toBe(shortCorrelationId(TRACKING));
    expect(shortTrackingId(TRACKING)).toBe("3f2a9c1e");
  });

  it("bekleme sırasında uç 404 olursa (anahtar kapatıldı) bugünkü akışa geçilir, sorma durur", async () => {
    verifyAnswers = [{ status: 200, state: "awaiting" }, { status: 404 }];
    await payOnce();
    await complete();
    await tick(3_000);
    expect(verifyCalls()).toBe(2);
    expect(pendingCalls()).toHaveLength(1);
    expect(screen.getByText(CHECKOUT_PENDING_MESSAGE)).toBeTruthy();
    await tick(60_000);
    expect(verifyCalls()).toBe(2);
  });
});

describe("checkoutVerifyDelay / checkoutVerifyStep (saf kurallar)", () => {
  it("3 / 6 / 12 sn, sonra 12 sn; 10 dakikadan sonra 30 sn; Retry-After'dan erken değil", () => {
    expect([0, 1, 2, 3, 9].map((a) => checkoutVerifyDelay(a, 0))).toEqual([3_000, 6_000, 12_000, 12_000, 12_000]);
    expect(checkoutVerifyDelay(40, CHECKOUT_VERIFY_SLOW_AFTER_MS - 1)).toBe(12_000);
    expect(checkoutVerifyDelay(40, CHECKOUT_VERIFY_SLOW_AFTER_MS)).toBe(CHECKOUT_VERIFY_SLOW_DELAY_MS);
    // Bütçe: ilk saatte sunucu kovasının (saatte 120) altında kalır.
    let t = 0;
    let n = 0;
    while (t < 3_600_000) {
      t += checkoutVerifyDelay(n, t);
      n += 1;
    }
    expect(n).toBeLessThan(120);
    expect(checkoutVerifyDelay(0, 0, 90_000)).toBe(90_000);
    expect(checkoutVerifyDelay(0, 0, 1_000)).toBe(3_000);
  });

  it("ilk istekte geçerli durum yoksa bugünkü akış; sonra yalnız 404 / 400 bugünkü akışa düşürür", () => {
    expect(checkoutVerifyStep({ firstAttempt: true, status: 200, state: "active" })).toBe("active");
    expect(checkoutVerifyStep({ firstAttempt: true, status: 200, state: "awaiting" })).toBe("wait");
    expect(checkoutVerifyStep({ firstAttempt: true, status: 200, state: "unverified" })).toBe("wait");
    expect(checkoutVerifyStep({ firstAttempt: true, status: 404, state: undefined })).toBe("legacy");
    expect(checkoutVerifyStep({ firstAttempt: true, status: null, state: undefined })).toBe("legacy");
    expect(checkoutVerifyStep({ firstAttempt: true, status: 200, state: "bilinmeyen" })).toBe("legacy");
    expect(checkoutVerifyStep({ firstAttempt: false, status: 503, state: undefined })).toBe("wait");
    expect(checkoutVerifyStep({ firstAttempt: false, status: 429, state: undefined })).toBe("wait");
    expect(checkoutVerifyStep({ firstAttempt: false, status: null, state: undefined })).toBe("wait");
    expect(checkoutVerifyStep({ firstAttempt: false, status: 404, state: undefined })).toBe("legacy");
    expect(checkoutVerifyStep({ firstAttempt: false, status: 400, state: undefined })).toBe("legacy");
    // 404 gövdesinde "active" yazsa bile başarısız durum plan açıldı sayılmaz.
    expect(checkoutVerifyStep({ firstAttempt: false, status: 404, state: "active" })).toBe("legacy");
  });
});
