// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// KİMLİK A3 / A4 / A5 (Codex 11-10) — üç küçük ekran hatası.
//  A3: şifre sıfırlama sayfası AÇIKKEN yeni bağlantı aynı sekmede açılırsa adresin yalnız `#` kısmı değişir; sayfa yeniden yüklenmez ve
//      parça yalnız ilk kurulumda okunduğu için yeni bağlantı hiç okunmuyordu.
//  A4: e-posta doğrulama (ve uyarı adresi onayı) sayfası "bağlantı geçersiz" gösterirken geçerli bağlantı aynı sekmede açılırsa, hiçbir
//      işlem yapılmadan eski hata ekranı kalıyordu.
//  A5: giriş ekranında "tekrar gönder"e basılınca düğmenin yerini bekleme metni alıyor, 10 dakika dolunca düğme geri gelmiyordu.
// ---------------------------------------------------------------------------

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

import { LoginForm } from "@/components/auth/login-form";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { VerifyEmailForm } from "@/components/auth/verify-email-form";
import { AlertEmailVerifyForm } from "@/components/auth/alert-email-verify-form";
import { VERIFY_RESEND_QUIET_MS, VERIFY_RESEND_REQUESTED_TEXT } from "@/lib/auth/verify-resend-window";

/** Aynı sekmede bağlantı açma: adresin yalnız parçası değişir ve tarayıcı `hashchange` yayar (sayfa yüklenmez). */
async function openLinkInSameTab(path: string, hash: string) {
  await act(async () => {
    window.history.pushState({}, "", `${path}${hash}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

function bodies(fetchMock: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
  return fetchMock.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit | undefined)?.body ?? "{}")));
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("A3 — şifre sıfırlama: aynı sekmede açılan yeni bağlantı okunur", () => {
  const OLD = "a".repeat(64);
  const NEW = "b".repeat(64);

  it("🚨 açık sayfaya ikinci bağlantı gelince istek YENİ anahtarla gider; yazılmış eski kod ve şifre temizlenir, adres çubuğu yine silinir", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", `/sifremi-unuttum#t=${OLD}`);
    render(<ForgotPasswordForm />);
    const code = (await screen.findByLabelText(/Doğrulama kodu/)) as HTMLInputElement;
    fireEvent.change(code, { target: { value: "11111111" } });
    fireEvent.change(screen.getByLabelText(/Yeni şifre/), { target: { value: "eski-baglanti-sifresi" } });

    await openLinkInSameTab("/sifremi-unuttum", `#t=${NEW}`);
    expect(window.location.hash).toBe(""); // yeni anahtar da adres çubuğunda kalmaz
    expect((screen.getByLabelText(/Doğrulama kodu/) as HTMLInputElement).value).toBe(""); // önceki bağlantının kodu
    expect((screen.getByLabelText(/Yeni şifre/) as HTMLInputElement).value).toBe("");

    fireEvent.change(screen.getByLabelText(/Doğrulama kodu/), { target: { value: "22222222" } });
    fireEvent.change(screen.getByLabelText(/Yeni şifre/), { target: { value: "yeni-sifre-12345" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Şifreyi sıfırla" }));
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(bodies(fetchMock)[0]).toMatchObject({ action: "confirm", token: NEW, code: "22222222" }); // ⬅️ ESKİDE token: OLD
  });

  it("🚨 e-posta adımındayken (anahtarsız açılmış sayfa) bağlantı aynı sekmede açılırsa kod ekranına geçilir", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    window.history.replaceState({}, "", "/sifremi-unuttum");
    render(<ForgotPasswordForm />);
    expect(screen.queryByLabelText(/Doğrulama kodu/)).toBeNull();
    await openLinkInSameTab("/sifremi-unuttum", `#t=${NEW}`);
    expect(await screen.findByLabelText(/Doğrulama kodu/)).toBeTruthy(); // ⬅️ ESKİDE e-posta adımında kalıyordu
  });

  it("KONTROL: anahtar taşımayan parça değişikliği açık formu bozmaz — kod ve anahtar yerinde kalır", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", `/sifremi-unuttum#t=${OLD}`);
    render(<ForgotPasswordForm />);
    fireEvent.change(await screen.findByLabelText(/Doğrulama kodu/), { target: { value: "11111111" } });
    fireEvent.change(screen.getByLabelText(/Yeni şifre/), { target: { value: "yeni-sifre-12345" } });
    await openLinkInSameTab("/sifremi-unuttum", "#baska");
    expect((screen.getByLabelText(/Doğrulama kodu/) as HTMLInputElement).value).toBe("11111111");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Şifreyi sıfırla" }));
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(bodies(fetchMock)[0]).toMatchObject({ token: OLD, code: "11111111" });
  });

  it("🚨 'şifreyi sıfırla' isteği sürerken yeni bağlantı açılırsa ESKİ isteğin geç gelen hatası yeni bağlantının ekranına yazılmaz", async () => {
    let release!: (r: Response) => void;
    const pending = new Promise<Response>((r) => (release = r));
    const fetchMock = vi.fn(() => pending);
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", `/sifremi-unuttum#t=${OLD}`);
    render(<ForgotPasswordForm />);
    fireEvent.change(await screen.findByLabelText(/Doğrulama kodu/), { target: { value: "11111111" } });
    fireEvent.change(screen.getByLabelText(/Yeni şifre/), { target: { value: "eski-baglanti-sifresi" } });
    fireEvent.click(screen.getByRole("button", { name: /Şifreyi sıfırla|Gönderiliyor|Sıfırlanıyor/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await openLinkInSameTab("/sifremi-unuttum", `#t=${NEW}`);
    await act(async () => {
      release(new Response(JSON.stringify({ fields: { code: "Bu kod artık kullanılamıyor." } }), { status: 400 }));
    });
    expect(screen.queryByText("Bu kod artık kullanılamıyor.")).toBeNull(); // ⬅️ eski bağlantının hatası yeni ekranda görünmez
    expect((screen.getByLabelText(/Doğrulama kodu/) as HTMLInputElement).value).toBe("");
  });

  it("sayfa kapanınca dinleyici kaldırılır (kapalı form sonraki bağlantıyı yutmaz)", async () => {
    window.history.replaceState({}, "", "/sifremi-unuttum");
    const { unmount } = render(<ForgotPasswordForm />);
    unmount();
    await openLinkInSameTab("/sifremi-unuttum", `#t=${NEW}`);
    expect(window.location.hash).toBe(`#t=${NEW}`); // kimse okumadı / silmedi
    window.history.replaceState({}, "", "/sifremi-unuttum");
  });
});

describe("A4 — e-posta doğrulama: hata ekranı açıkken gelen geçerli bağlantı işlenir", () => {
  it("🚨 anahtarsız açılan sayfa hata gösterirken geçerli bağlantı aynı sekmede açılırsa form gelir ve istek o anahtarla gider", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, requiresLogin: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", "/verify-email");
    render(<VerifyEmailForm />);
    await waitFor(() => expect(screen.queryByLabelText("Şifreniz")).toBeNull());
    expect(screen.queryByRole("button", { name: /Doğrula|Onayla|Hesabımı/i })).toBeNull();

    await openLinkInSameTab("/verify-email", "#t=gecerli-anahtar-1");
    const pw = (await screen.findByLabelText("Şifreniz")) as HTMLInputElement; // ⬅️ ESKİDE hata ekranı kalıyordu
    expect(window.location.hash).toBe("");
    fireEvent.change(pw, { target: { value: "sifre12345" } });
    await act(async () => {
      fireEvent.submit(pw.closest("form")!);
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(bodies(fetchMock)[0]).toEqual({ token: "gecerli-anahtar-1", password: "sifre12345" });
  });

  it("açık formdayken ikinci bağlantı gelirse yazılmış şifre temizlenir ve istek YENİ anahtarla gider", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ reason: "password" }), { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", "/verify-email#t=ilk-anahtar");
    render(<VerifyEmailForm />);
    fireEvent.change(await screen.findByLabelText("Şifreniz"), { target: { value: "ilk-sifre-123" } });
    await openLinkInSameTab("/verify-email", "#t=ikinci-anahtar");
    const pw = screen.getByLabelText("Şifreniz") as HTMLInputElement;
    expect(pw.value).toBe("");
    fireEvent.change(pw, { target: { value: "ikinci-sifre-123" } });
    await act(async () => {
      fireEvent.submit(pw.closest("form")!);
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(bodies(fetchMock)[0]).toEqual({ token: "ikinci-anahtar", password: "ikinci-sifre-123" });
  });

  it("KONTROL: anahtar taşımayan parça değişikliği açık formu hata ekranına çevirmez", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    window.history.replaceState({}, "", "/verify-email#t=ilk-anahtar");
    render(<VerifyEmailForm />);
    fireEvent.change(await screen.findByLabelText("Şifreniz"), { target: { value: "ilk-sifre-123" } });
    await openLinkInSameTab("/verify-email", "#baska");
    expect((screen.getByLabelText("Şifreniz") as HTMLInputElement).value).toBe("ilk-sifre-123");
  });

  it("🚨 uyarı adresi onayı: hata ekranı açıkken gelen geçerli bağlantı onay düğmesini getirir", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", "/alert-email/verify");
    render(<AlertEmailVerifyForm />);
    await screen.findByText(/Bağlantıda onay anahtarı yok/);
    await openLinkInSameTab("/alert-email/verify", "#t=uyari-anahtari");
    const btn = await screen.findByRole("button"); // ⬅️ ESKİDE hata ekranı kalıyordu
    expect(screen.queryByText(/Bağlantıda onay anahtarı yok/)).toBeNull();
    await act(async () => {
      fireEvent.click(btn);
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(bodies(fetchMock)[0]).toEqual({ token: "uyari-anahtari" });
  });
});

describe("A5 — giriş ekranı: bekleme dolunca 'tekrar gönder' düğmesi geri gelir", () => {
  async function requestOnce(fetchMock: ReturnType<typeof vi.fn>) {
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", "/login?verify=expired");
    render(<LoginForm />);
    await screen.findByText(/Doğrulama bağlantısı geçersiz/);
    fireEvent.change(screen.getByLabelText(/E-posta/), { target: { value: "musa@ornek.com" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /tekrar gönder/ }));
    });
    await screen.findByText(VERIFY_RESEND_REQUESTED_TEXT);
  }

  it("🚨 10 dakika dolunca düğme geri gelir ve AYNI adrese ikinci istek gidebilir", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    await requestOnce(fetchMock);
    await act(async () => {
      vi.advanceTimersByTime(VERIFY_RESEND_QUIET_MS);
    });
    const again = screen.getByRole("button", { name: /tekrar gönder/ }); // ⬅️ ESKİDE düğme hiç dönmüyordu
    expect(screen.queryByText(VERIFY_RESEND_REQUESTED_TEXT)).toBeNull();
    await act(async () => {
      fireEvent.click(again);
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(bodies(fetchMock).map((b) => b.email)).toEqual(["musa@ornek.com", "musa@ornek.com"]);
  });

  it("KONTROL: süre dolmadan (9 dk 59 sn) düğme GELMEZ — sunucunun sessiz penceresi içinde boşa istek attırılmaz", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await requestOnce(vi.fn(async () => new Response("{}", { status: 200 })));
    await act(async () => {
      vi.advanceTimersByTime(VERIFY_RESEND_QUIET_MS - 1000);
    });
    expect(screen.queryByRole("button", { name: /tekrar gönder/ })).toBeNull();
    expect(screen.getByText(VERIFY_RESEND_REQUESTED_TEXT)).toBeTruthy();
  });
});
