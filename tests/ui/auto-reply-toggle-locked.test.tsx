// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { AutoReplyToggle } from "@/components/inbox/auto-reply-toggle";

// UX incelemesi 10-21 G: abonelik kapalıyken anahtar devre dışı bir çipti, plana giden yol yoktu. Hesap sahibine bağlantı; başka rol
// (Faturalandırma sekmesini görmeyen) eski devre dışı çipi görür.
afterEach(() => cleanup());

describe("oto-yanıt anahtarı kilitliyken", () => {
  it("sahipte plan sayfasına bağlantı", () => {
    render(<AutoReplyToggle field="autoReplyHospitable" label="Oto-yanıt (7/24)" enabled={false} locked upgradeHref="/settings?tab=faturalandirma" />);
    const link = screen.getByRole("link", { name: /planınızı seçin/ });
    expect(link.getAttribute("href")).toBe("/settings?tab=faturalandirma");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("KONTROL: bağlantı verilmezse eski devre dışı çip", () => {
    render(<AutoReplyToggle field="autoReplyHospitable" label="Oto-yanıt (7/24)" enabled={false} locked />);
    const btn = screen.getByRole("button", { name: /yükseltin/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("KONTROL: kilitli değilse bağlantı verilse de anahtar", () => {
    render(<AutoReplyToggle field="autoReplyHospitable" label="Oto-yanıt (7/24)" enabled locked={false} upgradeHref="/settings?tab=faturalandirma" />);
    expect(screen.getByRole("button", { name: /Açık/ })).toBeTruthy();
  });
});
