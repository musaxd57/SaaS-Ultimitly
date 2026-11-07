// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Operatör "Hesaba gir" düğmesi (10-10 gece, Haiku incelemesi): bürünme ucu artık operatör kimliğine bağlı hız sınırı taşıyor
// (30/saat). Sınıra takılınca düğme genel "Hesaba girilemedi." yerine sunucunun "çok fazla istek" metnini gösterir — operatör neden
// giremediğini bilir; diğer hatalar eski metinde kalır.
// ---------------------------------------------------------------------------

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/confirm", () => ({ confirmDialog: vi.fn(async () => true) }));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { toast } from "@/lib/toast";
import { ImpersonateButton } from "@/components/admin/impersonate-button";

const respond = (status: number, body: unknown) =>
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })));

describe("ImpersonateButton", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("🚨 429: sunucunun 'çok fazla istek' metni gösterilir (genel hata değil)", async () => {
    respond(429, { error: "Çok fazla istek gönderildi. Lütfen kısa bir süre bekleyip tekrar deneyin." });
    render(<ImpersonateButton organizationId="o1" orgName="Lale" />);
    fireEvent.click(screen.getByRole("button", { name: /hesaba gir/i }));
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Çok fazla istek gönderildi. Lütfen kısa bir süre bekleyip tekrar deneyin.");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("KONTROL: başka hata eski genel metinde; başarı panele gider", async () => {
    respond(400, { error: "Doğrulama hatası", fields: { organizationId: "x" } });
    render(<ImpersonateButton organizationId="o1" orgName="Lale" />);
    fireEvent.click(screen.getByRole("button", { name: /hesaba gir/i }));
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Hesaba girilemedi."));
    cleanup();

    respond(200, { ok: true });
    render(<ImpersonateButton organizationId="o1" orgName="Lale" />);
    fireEvent.click(screen.getByRole("button", { name: /hesaba gir/i }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/dashboard"));
  });
});
