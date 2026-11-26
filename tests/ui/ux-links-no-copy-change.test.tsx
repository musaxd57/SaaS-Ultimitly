// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import SecurityPolicyPage from "@/app/(legal)/guvenlik/page";
import { SECTIONS, SECURITY_CONTACT } from "@/app/(legal)/guvenlik/content";
import { HospitableConnectCard } from "@/components/settings/hospitable-connect-card";
import type { HospitableConnectionInfo } from "@/lib/hospitable-credentials";

// ---------------------------------------------------------------------------
// UX denetimi 11-13 — YAZI DEĞİŞMEDEN tıklanabilir yapılan iki adres:
//  · Güvenlik açığı bildirimi sayfasında bildirim e-postası düz yazıydı (kopyalayıp yapıştırmak gerekiyordu).
//  · Bağlantı kartındaki "anahtar nasıl alınır" adımında site adresi kalın düz yazıydı.
// İkisinde de görünen metin AYNI kalır; yalnız bağlantı olur.
// ---------------------------------------------------------------------------

afterEach(() => cleanup());

describe("güvenlik sayfası — bildirim adresi tıklanabilir, metin aynı", () => {
  it("adresin geçtiği her yer mailto bağlantısıdır", () => {
    const { container } = render(<SecurityPolicyPage />);
    const links = [...container.querySelectorAll(`a[href="mailto:${SECURITY_CONTACT}"]`)];
    const expected = SECTIONS.flatMap((s) => [...(s.body ?? []), ...(s.list ?? [])]).reduce((n, text) => n + (text.split(SECURITY_CONTACT).length - 1), 0);
    expect(expected).toBeGreaterThan(1);
    expect(links).toHaveLength(expected);
    for (const a of links) expect(a.textContent).toBe(SECURITY_CONTACT);
  });

  it("🚨 görünen metin değişmedi: her paragraf ve madde içerik dosyasındaki dizeyle birebir", () => {
    const { container } = render(<SecurityPolicyPage />);
    const shown = [...container.querySelectorAll("section p, section li")].map((el) => el.textContent);
    const source = SECTIONS.flatMap((s) => [...(s.body ?? []), ...(s.list ?? [])]);
    expect(shown).toEqual(source);
  });
});

describe("bağlantı kartı — adımdaki site adresi tıklanabilir, metin aynı", () => {
  const info: HospitableConnectionInfo = {
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

  it("adres yeni sekmede açılan güvenli bir dış bağlantıdır; adım cümlesi aynen durur", () => {
    const { container } = render(<HospitableConnectCard info={info} />);
    const a = container.querySelector('a[href="https://my.hospitable.com"]');
    expect(a).not.toBeNull();
    expect(a!.textContent).toBe("my.hospitable.com");
    expect(a!.getAttribute("target")).toBe("_blank");
    expect(a!.getAttribute("rel")).toBe("noopener noreferrer");
    const step = a!.closest("li")!.textContent!.replace(/\s+/g, " ").trim();
    expect(step).toBe("my.hospitable.com'da giriş yapın; kenar menüden Apps (veya Settings → Integrations) → API access → Access tokens sekmesine gidin.");
  });
});
