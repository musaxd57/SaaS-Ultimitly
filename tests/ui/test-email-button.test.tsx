// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TestEmailButton } from "@/components/settings/test-email-button";

// Kullanıcı isteği (07-16): test maili BİR KEZ başarıyla gönderilince buton +
// açıklama kalıcı olarak kalksın (localStorage bayrağı); başarısız denemede
// kalsın ki tekrar denenebilsin.

describe("TestEmailButton (UI)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("başarılı gönderimde buton kaybolur, onay satırı kalır, bayrak yazılır", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true, to: "a@b.com" }), { status: 200 })),
    );
    render(<TestEmailButton />);
    await userEvent.click(screen.getByRole("button", { name: /Test e-postası gönder/ }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Test e-postası gönder/ })).toBeNull();
    });
    expect(screen.getByText(/Test e-postası gönderildi/)).toBeTruthy();
    expect(localStorage.getItem("lixus-test-email-sent")).toBe("1");
  });

  it("BAŞARISIZ gönderimde buton KALIR (tekrar denenebilir) ve bayrak yazılmaz", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "SMTP yok" }), { status: 500 })),
    );
    render(<TestEmailButton />);
    await userEvent.click(screen.getByRole("button", { name: /Test e-postası gönder/ }));
    await waitFor(() => expect(screen.getByText(/SMTP yok/)).toBeTruthy());
    expect(screen.getByRole("button", { name: /Test e-postası gönder/ })).toBeTruthy();
    expect(localStorage.getItem("lixus-test-email-sent")).toBeNull();
  });

  it("daha önce gönderilmişse (bayrak var) blok hiç render edilmez", async () => {
    localStorage.setItem("lixus-test-email-sent", "1");
    render(<TestEmailButton />);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Test e-postası gönder/ })).toBeNull();
    });
    expect(screen.queryByText(/doğrulamak için bir test maili/)).toBeNull();
  });
});
