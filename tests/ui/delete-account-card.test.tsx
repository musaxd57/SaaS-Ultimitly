// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { DeleteAccountCard } from "@/components/settings/delete-account-card";

describe("DeleteAccountCard — silinir/saklanır transparency (KVKK)", () => {
  afterEach(() => cleanup());

  it("states what is permanently deleted AND what is retained (redacted)", () => {
    render(<DeleteAccountCard />);
    // deleted list (matches the actual deleteAccountData cascade)
    expect(screen.getByText(/Kalıcı olarak silinir/i)).toBeTruthy();
    expect(screen.getByText(/misafir adı, telefon, e-posta/i)).toBeTruthy();
    expect(screen.getByText(/Hospitable bağlantı/i)).toBeTruthy();
    // retained-but-redacted (the surviving Paddle financial skeleton)
    expect(screen.getByText(/Yasa gereği saklanır/i)).toBeTruthy();
    expect(screen.getByText(/finansal iskeleti/i)).toBeTruthy();
    // the irreversible action is still present
    expect(screen.getByRole("button", { name: /kalıcı olarak sil/i })).toBeTruthy();
  });

  it("labels the confirm password input for screen readers (a11y)", () => {
    render(<DeleteAccountCard />);
    fireEvent.click(screen.getByRole("button", { name: /kalıcı olarak sil/i }));
    // getByLabelText matches the aria-label (NOT the placeholder) → pins the label.
    expect(screen.getByLabelText("Şifreniz")).toBeTruthy();
  });
});
