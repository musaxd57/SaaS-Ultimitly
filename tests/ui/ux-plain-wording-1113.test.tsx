// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, cleanup } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { HospitableConnectCard } from "@/components/settings/hospitable-connect-card";
import type { HospitableConnectionInfo } from "@/lib/hospitable-credentials";

// ---------------------------------------------------------------------------
// UX denetimi 11-13 — kurucu onaylı sade dil:
//  · UX-7: bağlantı kartında Hospitable'ın ne olduğu tek küçük cümleyle yazar; anahtarın her yerde TEK adı "bağlantı anahtarı"
//    (eskiden aynı kartta "Access Token", "Personal Access Token", "access token", "Token" dört ayrı ad). "uçtan uca şifreli" iddiası
//    doğru değildi (anahtar sunucuda şifreli saklanır) → "şifreli".
//  · UX-13: QR sohbet listesi ve ayrıntısında acil işaret "Yanıtınızı bekliyor" (eskiden "Ev sahibine iletildi" — okuyan zaten ev sahibi).
// ---------------------------------------------------------------------------

afterEach(() => cleanup());

const base: HospitableConnectionInfo = {
  connected: false,
  ownToken: false,
  envAvailable: false,
  label: null,
  connectedAt: null,
  state: "never_connected",
  credentialSource: null,
  connectionId: null,
  revokedReason: null,
  disconnectedAt: null,
  revokedAt: null,
};

const textOf = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ");
const INTRO = "Airbnb ve Booking mesajlarınızı Hospitable adlı hizmet üzerinden alıyoruz.";

describe("UX-7 — bağlantı kartı tek ad, dürüst ifade", () => {
  it("bağlı değilken: açıklama cümlesi en üstte; alan etiketi ve yer tutucu 'bağlantı anahtarı'", () => {
    const { container, getByLabelText } = render(<HospitableConnectCard info={base} />);
    const intro = container.querySelector("[data-hospitable-intro]");
    expect(intro).not.toBeNull();
    expect(textOf(intro!).trim()).toBe(INTRO);
    // Kartın İLK öğesi: durum satırından önce okunur.
    expect(container.firstElementChild!.firstElementChild).toBe(intro);
    const input = getByLabelText("Hospitable bağlantı anahtarı") as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(input.placeholder).toBe("Bağlantı anahtarını buraya yapıştırın");
  });

  it("bağlıyken de açıklama durur ve kilitli alanın etiketi aynı addır", () => {
    const { container, getByLabelText } = render(
      <HospitableConnectCard info={{ ...base, connected: true, ownToken: true, state: "connected", credentialSource: "db" }} />,
    );
    expect(textOf(container.querySelector("[data-hospitable-intro]")!).trim()).toBe(INTRO);
    expect((getByLabelText("Hospitable bağlantı anahtarı") as HTMLInputElement).disabled).toBe(true);
  });

  it.each([
    ["bağlı değil", base],
    ["bağlı", { ...base, connected: true, ownToken: true, state: "connected" as const, credentialSource: "db" as const }],
  ])("🚨 %s: görünen metinde eski adlar ve 'uçtan uca' iddiası yok", (_name, info) => {
    const { container } = render(<HospitableConnectCard info={info} />);
    const shown = textOf(container);
    const attrs = [...container.querySelectorAll("input")].map((i) => `${i.placeholder} ${i.getAttribute("aria-label") ?? ""}`).join(" ");
    for (const gone of ["Personal Access Token", "Access Token)", "access token", "uçtan uca", "Token "]) {
      expect(shown).not.toContain(gone);
      expect(attrs).not.toContain(gone);
    }
    // Hospitable'ın KENDİ menü adları (kullanıcı o ekranda arayacak) bağlı değilken adımda aynen durur.
    if (!info.connected) expect(shown).toContain("Access tokens");
  });
});

describe("UX-13 — QR sohbet acil işareti okuyanın diliyle", () => {
  const pages = ["src/app/(app)/guest-chats/page.tsx", "src/app/(app)/guest-chats/[id]/page.tsx"];
  it.each(pages)("%s: işaret 'Yanıtınızı bekliyor', eski metin yok", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src.match(/<AlertTriangle[^>]*\/>\s*Yanıtınızı bekliyor/g)).toHaveLength(1);
    expect(src).not.toContain("Ev sahibine iletildi");
  });
});
