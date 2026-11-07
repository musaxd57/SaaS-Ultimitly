// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { DeleteButton } from "@/components/delete-button";

// Görsel inceleme 10-21 #9: mülk sayfasında "Mülkü sil" dolu kırmızı en göze çarpan düğmeydi → çağıran görünümü yumuşatabilir;
// verilmezse eski görünüm (dolu kırmızı) aynen kalır.
afterEach(() => cleanup());

describe("DeleteButton görünümü", () => {
  it("className verilirse düğmeye eklenir", () => {
    render(<DeleteButton endpoint="/api/x" label="Mülkü sil" className="bg-transparent text-destructive" />);
    const btn = screen.getByRole("button", { name: /Mülkü sil/ });
    expect(btn.className).toContain("bg-transparent");
    expect(btn.className).not.toContain("bg-destructive ");
  });

  it("KONTROL: className yoksa dolu kırmızı (destructive) görünüm değişmez", () => {
    render(<DeleteButton endpoint="/api/x" />);
    expect(screen.getByRole("button", { name: /Sil/ }).className).toContain("bg-destructive");
  });
});
