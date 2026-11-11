// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// DİĞER X3 / X4 (Codex 11-10) — AYAR FORMLARI.
//  X3: form bütün alanları gönderiyordu → başka sekmede (ya da başka yöneticinin ekranında) teklif metni / bir anahtar değişmişken eski
//      sekmeden yalnız bekleme süresini kaydetmek, öteki alanları da o sekmenin ESKİ değerlerine geri çeviriyordu. Artık yalnız
//      DEĞİŞEN alan gider.
//  X4: kayıt isteği sürerken alana yazılan yeni metin, başarılı yanıt gelince gönderilen eski değere geri yazılıyor ve "Kaydedildi"
//      deniyordu. Artık yeni yazılan korunur ve kaydedilmemiş değişiklik olarak görünür.
// ---------------------------------------------------------------------------

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { AutomationPrefsForm } from "@/components/settings/automation-prefs-form";
import { AiVoiceForm } from "@/components/settings/ai-voice-form";
import { AlertEmailForm } from "@/components/settings/alert-email-form";

const PROPS = {
  disclosure: true,
  holdHours: 12,
  closingReply: false,
  closingText: "",
  lateCheckoutOffer: "Geç çıkış 100 TL.",
  taskFromMessage: true,
  commitmentsAuto: true,
  supplyRequest: false,
};

type FetchMock = ReturnType<typeof vi.fn>;
const bodyOf = (f: FetchMock, i = 0) => JSON.parse(String((f.mock.calls[i][1] as RequestInit).body)) as Record<string, unknown>;
const okResponse = () => ({ ok: true, status: 200, json: async () => ({}) });

/** Cevabı testin elinde tutan istek: `release()` çağrılana kadar "kaydediliyor" durumunda kalır. */
function heldFetch() {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const f = vi.fn(async () => {
    await gate;
    return okResponse();
  });
  vi.stubGlobal("fetch", f);
  return { f: f as unknown as FetchMock, release: () => release() };
}
const saveButton = () => screen.getByRole("button", { name: /Kaydet/ }) as HTMLButtonElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
afterEach(() => cleanup());

describe("otomasyon ayarları — yalnız değişen alan gider (X3)", () => {
  it("🚨 yalnız bekleme süresi değiştiyse istekte YALNIZ o alan vardır — teklif metni ve anahtarlar gönderilmez (eski sekme onları ezemez)", async () => {
    const f = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", f);
    render(<AutomationPrefsForm {...PROPS} />);
    fireEvent.change(screen.getByLabelText(/yapay zekânın beklemesi/i), { target: { value: "24" } });
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(f).toHaveBeenCalledOnce();
    expect(bodyOf(f as unknown as FetchMock)).toEqual({ handoffHoldHours: 24 }); // ⬅️ ESKİDE sekiz alanın tamamı (lateCheckoutOfferText: "Geç çıkış 100 TL." dahil)
  });

  it("değişen her alan gider, değişmeyen gitmez; geri alınan değişiklik de gitmez", async () => {
    const f = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", f);
    render(<AutomationPrefsForm {...PROPS} />);
    fireEvent.change(screen.getByLabelText(/yapay zekânın beklemesi/i), { target: { value: "24" } });
    fireEvent.change(screen.getByLabelText(/yapay zekânın beklemesi/i), { target: { value: "12" } }); // geri alındı
    fireEvent.change(document.getElementById("late-checkout-offer") as HTMLTextAreaElement, { target: { value: "Geç çıkış 300 TL." } });
    fireEvent.click(screen.getByTestId("auto-commitments-toggle"));
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(bodyOf(f as unknown as FetchMock)).toEqual({ lateCheckoutOfferText: "Geç çıkış 300 TL.", autoCommitmentsEnabled: false });
  });

  it("KONTROL: kayıttan sonra taban güncellenir — ikinci kayıt yalnız YENİ değişikliği yollar", async () => {
    const f = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", f);
    render(<AutomationPrefsForm {...PROPS} />);
    fireEvent.change(screen.getByLabelText(/yapay zekânın beklemesi/i), { target: { value: "24" } });
    await act(async () => {
      fireEvent.click(saveButton());
    });
    await waitFor(() => expect(saveButton().disabled).toBe(true));
    expect(screen.getByText("Kaydedildi")).toBeTruthy();
    fireEvent.change(document.getElementById("late-checkout-offer") as HTMLTextAreaElement, { target: { value: "Geç çıkış 300 TL." } });
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(bodyOf(f as unknown as FetchMock, 1)).toEqual({ lateCheckoutOfferText: "Geç çıkış 300 TL." });
  });
});

describe("otomasyon ayarları — kayıt sürerken yazılan kaybolmaz (X4)", () => {
  it("🚨 istek beklerken teklif alanına yazılan yeni metin yerinde kalır; 'Kaydedildi' DENMEZ, Kaydet yeniden açılır ve yeni metni yollar", async () => {
    const { f, release } = heldFetch();
    render(<AutomationPrefsForm {...PROPS} />);
    const offer = document.getElementById("late-checkout-offer") as HTMLTextAreaElement;
    fireEvent.change(offer, { target: { value: "Geç çıkış 300 TL." } });
    fireEvent.click(saveButton());
    // İstek sürerken kullanıcı yazmaya devam etti.
    fireEvent.change(offer, { target: { value: "Geç çıkış 500 TL." } });
    await act(async () => {
      release();
    });
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    expect(offer.value).toBe("Geç çıkış 500 TL."); // ⬅️ ESKİDE "Geç çıkış 300 TL." (yazılan silinmişti)
    expect(screen.queryByText("Kaydedildi")).toBeNull(); // ⬅️ ESKİDE gösteriliyordu
    expect(bodyOf(f)).toEqual({ lateCheckoutOfferText: "Geç çıkış 300 TL." });

    vi.stubGlobal("fetch", vi.fn(async () => okResponse()));
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(bodyOf(fetch as unknown as FetchMock)).toEqual({ lateCheckoutOfferText: "Geç çıkış 500 TL." }); // taban = kaydedilen 300 → yalnız yeni metin gider
  });

  it("KONTROL: istek sürerken dokunulmayan metin sunucunun kırpılmış hâline çevrilir ve 'Kaydedildi' görünür", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okResponse()));
    render(<AutomationPrefsForm {...PROPS} />);
    const offer = document.getElementById("late-checkout-offer") as HTMLTextAreaElement;
    fireEvent.change(offer, { target: { value: "  Geç çıkış 300 TL.  " } });
    await act(async () => {
      fireEvent.click(saveButton());
    });
    await waitFor(() => expect(offer.value).toBe("Geç çıkış 300 TL."));
    expect(screen.getByText("Kaydedildi")).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
  });
});

describe("yapay zekânın sesi — değişen alan + kayıt sürerken yazılan (X3 / X4)", () => {
  it("🚨 yalnız imza değiştiyse ton gönderilmez", async () => {
    const f = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", f);
    render(<AiVoiceForm tone="warm" signature="Lale" />);
    fireEvent.change(screen.getByLabelText(/İmza/), { target: { value: "Lale Ekibi" } });
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(bodyOf(f as unknown as FetchMock)).toEqual({ aiSignature: "Lale Ekibi" }); // ⬅️ ESKİDE { aiReplyTone: "warm", aiSignature: … }
  });

  it("🚨 istek sürerken yazılan imza korunur", async () => {
    const { release } = heldFetch();
    render(<AiVoiceForm tone="warm" signature="Lale" />);
    const sig = screen.getByLabelText(/İmza/) as HTMLInputElement;
    fireEvent.change(sig, { target: { value: "Lale Ekibi" } });
    fireEvent.click(saveButton());
    fireEvent.change(sig, { target: { value: "Lale Konuk Evi" } });
    await act(async () => {
      release();
    });
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    expect(sig.value).toBe("Lale Konuk Evi"); // ⬅️ ESKİDE "Lale Ekibi"
    expect(screen.queryByText("Kaydedildi")).toBeNull();
  });
});

describe("uyarı adresi — kayıt sürerken yazılan korunur (X4)", () => {
  it("🚨 istek sürerken yazılan adres yerinde kalır ve kaydedilmemiş görünür", async () => {
    const { f, release } = heldFetch();
    render(<AlertEmailForm initial="eski@ornek.com" />);
    const input = document.getElementById("alert-email") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "yeni@ornek.com" } });
    fireEvent.click(saveButton());
    fireEvent.change(input, { target: { value: "baska@ornek.com" } });
    await act(async () => {
      release();
    });
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    expect(input.value).toBe("baska@ornek.com"); // ⬅️ ESKİDE "yeni@ornek.com"
    expect(bodyOf(f)).toEqual({ alertEmail: "yeni@ornek.com" });
    expect(saveButton().textContent).toContain("Kaydet");
    expect(saveButton().textContent).not.toContain("Kaydedildi");
  });
});
