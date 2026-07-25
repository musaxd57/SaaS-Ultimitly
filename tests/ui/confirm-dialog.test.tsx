// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup, waitFor, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Ortak onay diyaloğu (Codex P3'ün ikinci yarısı: dağınık native confirm).
//
// Yıkıcı işlemler `window.confirm()` ile soruluyordu: markasız sistem kutusu,
// tek satır metin (ne silineceğinin bağlamı yok), stil yok, mobilde sayfayı
// donduruyor.
//
// EN KRİTİK SÖZLEŞME — bu dosyanın asıl varlık sebebi:
//   Senkron `if (!confirm()) return;` yapısı asenkron bir diyaloğa taşınırken
//   yapılabilecek EN KÖTÜ hata, işlemin onay beklenmeden çalışmasıdır. Aşağıda
//   hem "onaylanmadan İŞ YAPILMAZ" hem de "hiç host mount edilmemişse SESSİZCE
//   onaylamaz, native confirm'e düşer" ayrı ayrı pinlenir.
// ---------------------------------------------------------------------------

import { confirmDialog, __resetConfirmForTest } from "@/lib/confirm";
import { ConfirmHost } from "@/components/confirm-host";

describe("confirmDialog — fail-safe", () => {
  beforeEach(() => {
    cleanup();
    __resetConfirmForTest();
    vi.unstubAllGlobals();
  });

  it("host mount edilmemişse SESSİZCE onaylamaz — native confirm'e düşer", async () => {
    const native = vi.fn(() => false);
    vi.stubGlobal("confirm", native);

    await expect(confirmDialog({ title: "Silinsin mi?" })).resolves.toBe(false);
    expect(native).toHaveBeenCalledTimes(1);
  });

  it("native confirm de yoksa REDDEDER (fail-closed, asla sessiz onay)", async () => {
    vi.stubGlobal("confirm", undefined);
    await expect(confirmDialog({ title: "Silinsin mi?" })).resolves.toBe(false);
  });
});

describe("ConfirmHost — diyalog sözleşmesi", () => {
  beforeEach(() => {
    cleanup();
    __resetConfirmForTest();
    vi.unstubAllGlobals();
  });

  async function open(title = "Bu görevi silmek istiyor musunuz?") {
    const trigger = document.createElement("button");
    trigger.textContent = "tetikleyici";
    document.body.appendChild(trigger);
    trigger.focus();

    render(<ConfirmHost />);
    let result: Promise<boolean>;
    await act(async () => {
      result = confirmDialog({ title, body: "Bu işlem geri alınamaz.", destructive: true });
    });
    return { trigger, result: result! };
  }

  it("adlandırılmış bir modal dialog açar ve BAĞLAM gösterir", async () => {
    await open();
    const dialog = await screen.findByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const labelId = dialog.getAttribute("aria-labelledby")!;
    expect(document.getElementById(labelId)?.textContent).toContain(
      "Bu görevi silmek istiyor musunuz?",
    );
    // Native confirm'in veremediği şey: ikinci satır açıklama.
    expect(dialog.textContent).toContain("Bu işlem geri alınamaz.");
  });

  it("onaylanınca true, vazgeçilince false döner", async () => {
    const a = await open();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Onayla" }));
    });
    await expect(a.result).resolves.toBe(true);

    cleanup();
    __resetConfirmForTest();
    const b = await open();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    });
    await expect(b.result).resolves.toBe(false);
  });

  it("Escape vazgeçme sayılır ve odak tetikleyiciye döner", async () => {
    const { trigger, result } = await open();
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    await expect(result).resolves.toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("açılınca odak diyaloğa girer", async () => {
    await open();
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });
});

// ---------------------------------------------------------------------------
// Gerçek bir çağıran üzerinden uçtan uca: onaysız İŞ YAPILMAZ.
// ---------------------------------------------------------------------------
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
import { DeleteButton } from "@/components/delete-button";

describe("DeleteButton — onay olmadan silme İSTEĞİ GİTMEZ", () => {
  beforeEach(() => {
    cleanup();
    __resetConfirmForTest();
    vi.unstubAllGlobals();
  });

  it("vazgeçilirse fetch HİÇ çağrılmaz", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(
      <>
        <ConfirmHost />
        <DeleteButton endpoint="/api/x/1" confirmText="Silinsin mi?" />
      </>,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Sil/ }));
    });
    await screen.findByRole("dialog");
    expect(fetchSpy).not.toHaveBeenCalled(); // henüz onay YOK

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("onaylanırsa istek gider", async () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    render(
      <>
        <ConfirmHost />
        <DeleteButton endpoint="/api/x/1" confirmText="Silinsin mi?" />
      </>,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Sil/ }));
    });
    // Diyaloğun onay düğmesi de "Sil" der (çağıranın etiketi taşınır), o yüzden
    // sorgu diyaloğun İÇİNE kapsanır — tetikleyiciyle karışmasın.
    const dialog = await screen.findByRole("dialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Sil" }));
    });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
  });
});
