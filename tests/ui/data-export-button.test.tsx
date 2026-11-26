// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { DataExportButton } from "@/components/settings/data-export-button";

// ---------------------------------------------------------------------------
// U10 (kurucu 10-22, "şifre sorulsun"): KVKK dökümü düz bağlantı değil — düğme şifre alanını açar, POST + JSON ile ister; hatalı şifrede
// alan hata gösterir (dosya inmez), doğru şifrede dosya iner ve "e-postanıza bilgi gönderildi" duyurulur.
// ---------------------------------------------------------------------------

beforeEach(() => {
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = vi.fn(() => "blob:x");
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DataExportButton", () => {
  it("önce şifre ister; boş şifrede istek gitmez", () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    render(<DataExportButton />);
    fireEvent.click(screen.getByRole("button", { name: /Verilerimi indir/ }));
    expect(screen.getByLabelText("Şifreniz")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /İndir/ }));
    expect(f).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/şifrenizi girin/);
  });

  it("hatalı şifre: sunucunun alan hatası gösterilir, dosya inmez", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "Doğrulama hatası", fields: { password: "Şifre hatalı." } }) }),
    );
    render(<DataExportButton />);
    fireEvent.click(screen.getByRole("button", { name: /Verilerimi indir/ }));
    fireEvent.change(screen.getByLabelText("Şifreniz"), { target: { value: "yanlis" } });
    fireEvent.click(screen.getByRole("button", { name: /İndir/ }));
    await screen.findByText("Şifre hatalı.");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("doğru şifre: POST + JSON, dosya iner, bilgi e-postası duyurulur", async () => {
    const f = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'attachment; filename="lixus-verilerim-x.json"' },
      blob: async () => new Blob(["{}"]),
    });
    vi.stubGlobal("fetch", f);
    render(<DataExportButton />);
    fireEvent.click(screen.getByRole("button", { name: /Verilerimi indir/ }));
    fireEvent.change(screen.getByLabelText("Şifreniz"), { target: { value: "secret123" } });
    fireEvent.click(screen.getByRole("button", { name: /İndir/ }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/e-posta adresinize bilgi/));
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("/api/account/export");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ password: "secret123" });
    expect(URL.createObjectURL).toHaveBeenCalled();
  });
});
