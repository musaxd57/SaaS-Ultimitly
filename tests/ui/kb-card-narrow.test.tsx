// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Bilgi tabanı kartı 320 px telefonda (görsel inceleme 10-22, Chromium'da ölçüldü): dört işlem düğmesi (~172 px) yanında başlığa ~60 px
// kalıyordu, başlık düğmelerin ALTINA giriyordu ("Konum bağlantısı" kalem simgesiyle üst üste). Başlık satırı artık sarar: düğmeler sığmazsa
// alt satıra iner, sağa yaslı; rozetler de sarar. Ölçüm: 320 / 360 / 390 / 430 / 768 / 1280 px'te çakışma 0, 768+ tek satır (eskisi gibi).
// jsdom düzen hesaplamaz — sınıf sözleşmesi pinlenir.
// ---------------------------------------------------------------------------

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/" }));

import { KbManager } from "@/components/knowledge/kb-manager";

const PROPS = [{ id: "p1", name: "Lale 1" }];
const URL = "https://www.google.com/maps/place/Galata+Kulesi/@41.0256,28.9741,17z/data=!3m1!4b1!4m6!3m5!1s0x14cab9e7a7777c43";

describe("bilgi tabanı kartı dar ekranda", () => {
  beforeEach(() => {
    cleanup();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ fromTemplates: [] }) })));
  });

  it("başlık satırı sarar, işlem düğmeleri sağa yaslı alt satıra inebilir; içerik uzun bağlantıyı böler", () => {
    render(
      <KbManager
        properties={PROPS}
        items={[{ id: "k1", propertyId: "p1", propertyName: "Lale 1", category: "location", title: "Konum bağlantısı", content: `Yol: ${URL}`, language: "tr", isActive: true }]}
      />,
    );
    const actions = screen.getByRole("button", { name: "Düzenle" }).parentElement!;
    const header = actions.parentElement!;
    const titleGroup = header.firstElementChild as HTMLElement;
    const cls = (el: Element) => el.className.split(/\s+/);

    expect(cls(header)).toEqual(expect.arrayContaining(["flex", "flex-wrap"]));
    expect(cls(actions)).toContain("ml-auto");
    expect(cls(titleGroup)).toEqual(expect.arrayContaining(["min-w-0", "flex-wrap"]));
    // Satır kırma kararı başlığın tam genişliğiyle değil sabit tabanla: uzun başlık masaüstünde düğmeleri alt satıra itmez.
    expect(cls(titleGroup)).toEqual(expect.arrayContaining(["flex-1", "basis-32"]));
    expect(titleGroup.textContent).toContain("Konum bağlantısı");

    const body = screen.getByText(/^Yol: https:/);
    expect(cls(body)).toContain("break-words");
  });
});
