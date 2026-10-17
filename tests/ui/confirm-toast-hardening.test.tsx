// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup, within } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// MERKEZİ DİYALOG/BİLDİRİM ALTYAPISI — sertleştirme (Codex final denetimi).
//
// 41 çağrı yeri tek bir altyapıya bağlandı; o altyapının kendisi kırılırsa
// hepsi birden kırılır. Bu dosya, "yeşil CI" ile yetinilmeyecek 6 sözleşmeyi
// ayrı ayrı pinler:
//   1. onay → işlem TAM BİR KEZ; vazgeç/Escape → HİÇ.
//   2. eşzamanlı iki confirm birbirinin resolver'ını EZMEZ.
//   3. host unmount olursa bekleyen söz false ile KAPANIR (asılı kalmaz).
//   4. art arda bildirimler birbirini SESSİZCE yutmaz.
//   5. odak diyaloğa girer, HAPSOLUR, kapanınca tetikleyiciye döner.
//   6. hata ve ipucu BİRLİKTEYKEN aria-describedby İKİSİNİ de gösterir.
// ---------------------------------------------------------------------------

import { confirmDialog, __resetConfirmForTest } from "@/lib/confirm";
import { ConfirmHost } from "@/components/confirm-host";
import { toast, __resetToastsForTest } from "@/lib/toast";
import { Toaster } from "@/components/toaster";

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/" }));

import { DeleteButton } from "@/components/delete-button";
import { DeleteConversationButton } from "@/components/inbox/delete-conversation-button";

/**
 * Bir sözün BELİRLİ bir sürede çözülüp çözülmediğini söyler.
 * Asılı kalan söz testi 5sn timeout'a düşürüp anlamsız bir hata verirdi;
 * böylece "PENDING" açık bir bulguya dönüşür.
 */
async function settled<T>(p: Promise<T>): Promise<T | "PENDING"> {
  return Promise.race([p, new Promise<"PENDING">((r) => setTimeout(() => r("PENDING"), 50))]);
}

function resetAll() {
  cleanup();
  __resetConfirmForTest();
  __resetToastsForTest();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
}

// ===========================================================================
// 2. EŞZAMANLI İKİ CONFIRM
// ===========================================================================
describe("ConfirmHost — eşzamanlı çağrılar", () => {
  beforeEach(resetAll);

  it("ikinci çağrı birincinin resolver'ını EZMEZ; sırayla sorulur", async () => {
    render(<ConfirmHost />);
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    await act(async () => {
      first = confirmDialog({ title: "BİRİNCİ soru" });
      second = confirmDialog({ title: "İKİNCİ soru" });
    });

    // Önce BİRİNCİ sorulur (kuyruk FIFO).
    expect(screen.getByRole("dialog").textContent).toContain("BİRİNCİ soru");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Onayla" }));
    });
    // Birinci söz GERÇEKTEN çözülür — eskiden sessizce asılı kalıyordu.
    expect(await settled(first)).toBe(true);

    // Sıradaki soru ekrana gelir.
    expect(screen.getByRole("dialog").textContent).toContain("İKİNCİ soru");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    });
    expect(await settled(second)).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("üç çağrı da çözülür — hiçbiri kaybolmaz", async () => {
    render(<ConfirmHost />);
    const results: Promise<boolean>[] = [];
    await act(async () => {
      for (const t of ["A", "B", "C"]) results.push(confirmDialog({ title: `Soru ${t}` }));
    });
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: i === 1 ? "Vazgeç" : "Onayla" }));
      });
    }
    expect(await Promise.all(results.map(settled))).toEqual([true, false, true]);
  });
});

// ===========================================================================
// 3. UNMOUNT
// ===========================================================================
describe("ConfirmHost — unmount", () => {
  beforeEach(resetAll);

  it("host unmount olursa bekleyen confirm FALSE ile kapanır (söz asılı kalmaz)", async () => {
    const view = render(<ConfirmHost />);
    let pendingConfirm!: Promise<boolean>;
    await act(async () => {
      pendingConfirm = confirmDialog({ title: "Silinsin mi?", destructive: true });
    });
    await act(async () => {
      view.unmount();
    });
    // Yıkıcı işlem için güvenli yön: REDDET.
    expect(await settled(pendingConfirm)).toBe(false);
  });

  it("unmount kuyruktaki TÜM bekleyenleri kapatır", async () => {
    const view = render(<ConfirmHost />);
    const all: Promise<boolean>[] = [];
    await act(async () => {
      for (const t of ["A", "B", "C"]) all.push(confirmDialog({ title: t }));
    });
    await act(async () => {
      view.unmount();
    });
    expect(await Promise.all(all.map(settled))).toEqual([false, false, false]);
  });
});

// ===========================================================================
// 5. ODAK: içeri gir → HAPSOL → tetikleyiciye dön
// ===========================================================================
describe("ConfirmHost — odak yönetimi", () => {
  beforeEach(resetAll);

  async function openWithTrigger() {
    const trigger = document.createElement("button");
    trigger.textContent = "tetikleyici";
    document.body.appendChild(trigger);
    const outside = document.createElement("button");
    outside.textContent = "disarida";
    document.body.appendChild(outside);
    trigger.focus();

    render(<ConfirmHost />);
    let result!: Promise<boolean>;
    await act(async () => {
      result = confirmDialog({ title: "Soru", destructive: true });
    });
    return { trigger, outside, result };
  }

  it("Tab son öğeden BAŞA sarar — odak diyalogtan kaçmaz", async () => {
    await openWithTrigger();
    const dialog = screen.getByRole("dialog");
    const buttons = within(dialog).getAllByRole("button");
    const first = buttons[0];
    const last = buttons[buttons.length - 1];

    last.focus();
    await act(async () => {
      fireEvent.keyDown(document, { key: "Tab" });
    });
    expect(document.activeElement).toBe(first);
  });

  it("Shift+Tab ilk öğeden SONA sarar", async () => {
    await openWithTrigger();
    const dialog = screen.getByRole("dialog");
    const buttons = within(dialog).getAllByRole("button");
    buttons[0].focus();
    await act(async () => {
      fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    });
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
  });

  it("odak bir şekilde DIŞARI kaçtıysa Tab onu geri içeri çeker", async () => {
    const { outside } = await openWithTrigger();
    outside.focus();
    expect(document.activeElement).toBe(outside);
    await act(async () => {
      fireEvent.keyDown(document, { key: "Tab" });
    });
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
  });

  it("kapanınca odak TETİKLEYİCİYE döner", async () => {
    const { trigger } = await openWithTrigger();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    });
    expect(document.activeElement).toBe(trigger);
  });
});

// ===========================================================================
// 1. TAM BİR KEZ / HİÇ — gerçek çağrı yerleri üzerinden
// ===========================================================================
describe("çağrı yerleri — onay TAM BİR KEZ, vazgeç/Escape HİÇ", () => {
  beforeEach(resetAll);

  function renderDelete() {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    render(
      <>
        <ConfirmHost />
        <DeleteButton endpoint="/api/x/1" confirmText="Silinsin mi?" />
      </>,
    );
    return fetchSpy;
  }

  it("onay düğmesine ÇİFT tıklamak isteği iki kez göndermez", async () => {
    const fetchSpy = renderDelete();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Sil/ }));
    });
    const dialog = screen.getByRole("dialog");
    const confirmBtn = within(dialog).getByRole("button", { name: "Sil" });
    await act(async () => {
      fireEvent.click(confirmBtn);
      fireEvent.click(confirmBtn); // kullanıcı iki kez bastı
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("Escape ile kapatılırsa istek HİÇ gitmez", async () => {
    const fetchSpy = renderDelete();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Sil/ }));
    });
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("konuşma silme: vazgeç → istek yok; onay → tam bir istek", async () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    render(
      <>
        <ConfirmHost />
        <DeleteConversationButton conversationId="conv-1" />
      </>,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Sil/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Sil/ }));
    });
    await act(async () => {
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Sil" }));
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith("/api/conversations/conv-1", { method: "DELETE" });
  });
});

// ===========================================================================
// 4. BİLDİRİMLER BİRBİRİNİ YUTMAZ
// ===========================================================================
describe("Toaster — art arda bildirimler", () => {
  beforeEach(resetAll);

  it("görünür kapasitenin üstündeki HATALAR sessizce kaybolmaz", () => {
    render(<Toaster />);
    act(() => {
      for (let i = 1; i <= 6; i++) toast.error(`Hata ${i}`);
    });

    // Eskiden slice(-4) ilk ikisini iz bırakmadan siliyordu.
    // Artık en yeniler görünür VE geride kalan sayısı EKRANDA yazar.
    expect(screen.getByText(/\+2/)).toBeTruthy();
  });

  it("görünenler kapatılınca ESKİ hatalar ortaya çıkar (hiçbiri kaybolmamış)", () => {
    render(<Toaster />);
    act(() => {
      for (let i = 1; i <= 6; i++) toast.error(`Hata ${i}`);
    });
    // Kullanıcı en üstteki (EN YENİ) bildirimi okuyup kapatır; 4 kez.
    // (En eskiyi kapatmak zaten görünenleri tüketirdi — kuyruğun ucundan
    //  ilerlemek gerçek kullanım sırası.)
    for (let i = 0; i < 4; i++) {
      act(() => {
        const buttons = screen.getAllByRole("button", { name: /Bildirimi kapat/ });
        fireEvent.click(buttons[buttons.length - 1]);
      });
    }
    expect(screen.getByText("Hata 1")).toBeTruthy();
    expect(screen.getByText("Hata 2")).toBeTruthy();
  });
});

// ===========================================================================
// 6. FIELD — hata VE ipucu birlikte
// ===========================================================================
import { Field } from "@/components/form-field";
import { Input } from "@/components/ui/input";

describe("Field — hata ve ipucu birlikte", () => {
  beforeEach(resetAll);

  it("ikisi de gösterilir ve aria-describedby İKİSİNİ de içerir", () => {
    render(
      <Field label="Tampon" htmlFor="f-buf" error="Sayı olmalı" hint="Temizliğe ayrılan süre.">
        <Input id="f-buf" />
      </Field>,
    );
    const input = screen.getByLabelText("Tampon");
    // İpucu, hata belirdi diye KAYBOLMAZ — kullanıcı ona tam o an ihtiyaç duyar.
    expect(screen.getByText("Temizliğe ayrılan süre.")).toBeTruthy();

    const ids = input.getAttribute("aria-describedby")!.split(" ");
    expect(ids).toHaveLength(2);
    const texts = ids.map((id) => document.getElementById(id)?.textContent);
    expect(texts).toContain("Sayı olmalı");
    expect(texts).toContain("Temizliğe ayrılan süre.");
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("hata ÖNCE duyurulur (describedby sırası)", () => {
    render(
      <Field label="Tampon" htmlFor="f-buf2" error="Sayı olmalı" hint="İpucu.">
        <Input id="f-buf2" />
      </Field>,
    );
    const ids = screen.getByLabelText("Tampon").getAttribute("aria-describedby")!.split(" ");
    expect(document.getElementById(ids[0])?.textContent).toBe("Sayı olmalı");
  });
});

// ===========================================================================
// YAPISAL PİNLER — "iyileşmeyen çağrı" ve "sonucu yok sayılan confirm" olmasın
// ===========================================================================
describe("yapısal pinler", () => {
  function tsxFiles(dir: string): string[] {
    const out: string[] = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...tsxFiles(full));
      else if (e.name.endsWith(".tsx") || e.name.endsWith(".ts")) out.push(full);
    }
    return out;
  }
  const files = tsxFiles(path.join(process.cwd(), "src"));

  it("HER <Field> çağrısı htmlFor verir — bağlanamayan tek bir alan bile yok", () => {
    const missing: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, "utf-8");
      for (const m of src.matchAll(/<Field\b/g)) {
        // Açılış etiketinin sonunu bul (JSX ifade parantezlerini sayarak).
        let i = m.index! + m[0].length;
        let depth = 0;
        while (i < src.length) {
          const c = src[i];
          if (c === "{") depth++;
          else if (c === "}") depth--;
          else if (c === ">" && depth === 0) break;
          i++;
        }
        const tag = src.slice(m.index!, i + 1);
        if (!tag.includes("htmlFor")) {
          missing.push(`${path.relative(process.cwd(), file)}:${src.slice(0, m.index).split("\n").length}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("confirmDialog HİÇBİR yerde sonucu yok sayılarak çağrılmaz", () => {
    const bare: string[] = [];
    for (const file of files) {
      if (file.includes(path.join("src", "lib", "confirm"))) continue;
      const src = fs.readFileSync(file, "utf-8");
      src.split("\n").forEach((line, idx) => {
        if (!line.includes("confirmDialog(")) return;
        if (line.trimStart().startsWith("*") || line.trimStart().startsWith("//")) return;
        // Sonucu kullanan tek kabul edilen iki şekil: "= await confirmDialog"
        // ya da "if (!(await confirmDialog(".
        const consumed = /=\s*await\s+confirmDialog\(/.test(line) || /\(\s*await\s+confirmDialog\(/.test(line);
        if (!consumed) bare.push(`${path.relative(process.cwd(), file)}:${idx + 1}`);
      });
    }
    expect(bare).toEqual([]);
  });
});

// ===========================================================================
// ÖRTÜ (backdrop) — native confirm'in yerine geçen KORUMA
// ===========================================================================
describe("ConfirmHost — tam ekran örtü", () => {
  beforeEach(resetAll);

  it("diyalog açıkken arkadaki sayfayı KAPATAN bir örtü vardır", async () => {
    render(<ConfirmHost />);
    await act(async () => {
      void confirmDialog({ title: "Silinsin mi?", destructive: true });
    });

    const dialog = screen.getByRole("dialog");
    const backdrop = dialog.parentElement!;
    const cls = backdrop.className;

    // NEDEN KRİTİK: native window.confirm girişi BLOKLAR, bu yüzden çağrı
    // yerlerindeki "busy" bayrağı onaydan SONRA kurulsa bile ikinci bir tık
    // hiç gelmiyordu. Asenkron diyalogda o koruma YOK — yerini bu örtü alır:
    // tetikleyici örtünün ALTINDA kalır, ikinci tık ona ulaşamaz. Örtü
    // kaldırılır/şeffaflaştırılırsa "iki kez sil" penceresi yeniden açılır.
    expect(cls).toContain("fixed");
    expect(cls).toContain("inset-0");
    expect(cls).toMatch(/z-\[\d+\]/);
    // Tıklamayı geçiren bir sınıf EKLENMEMELİ.
    expect(cls).not.toContain("pointer-events-none");
    // Örtünün kendisi kapatmaz: yıkıcı işlemde yanlışlıkla dışarı tıklamak
    // "vazgeç" saymamalı — çıkış yolları AÇIK düğmeler ve Escape.
    expect(backdrop.onclick).toBeFalsy();
  });
});
