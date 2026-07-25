// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// (1) AUTH FORMLARI — merkezi `Field` düzeltmesi buraya HİÇ ULAŞMAMIŞTI.
//     Tur-6'da `Field` bileşenine aria-describedby/aria-invalid/role=alert
//     eklendi ve "54 çağıranın hepsi iyileşti" denildi; ama login/kayıt/şifre-
//     sıfırlama formları `Field`'i hiç KULLANMIYORDU — el yapımı
//     <Label htmlFor> + <Input> + <p> üçlüsüyle aynı işi EKSİK yapıyorlardı.
//     Yani müşterinin gördüğü İLK ÜÇ ekran kapsam dışında kalmıştı.
//
// (2) ŞABLON PANELİ — açılırken YANLIŞ BİLGİ veriyordu. Panel fetch'ten ÖNCE
//     açılıyor; gövde `templatesLoading`'i hiç okumadığı için `templates` hâlâ
//     [] iken "Şablon bulunamadı" yazıyordu. Odak da panele taşındığından ekran
//     okuyucu açılış metni olarak tam bu yanlış cümleyi okuyordu.
//     Ayrıca liste boş kalınca tetikleyici TEK YÖNLÜ şaltere dönüyordu.
// ---------------------------------------------------------------------------

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import { RegisterForm } from "@/components/auth/register-form";
import { ConversationThread } from "@/components/inbox/conversation-thread";

function reset() {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
}

describe("Kayıt formu — alan hataları kontrole PROGRAMATİK olarak bağlı", () => {
  beforeEach(reset);

  it("sunucu alan hatası dönerse aria-invalid + aria-describedby kurulur", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ fields: { email: "Bu e-posta zaten kayıtlı." } }),
          { status: 400 },
        ),
      ),
    );
    render(<RegisterForm />);

    fireEvent.change(screen.getByLabelText("İşletme adı"), { target: { value: "Nuve" } });
    fireEvent.change(screen.getByLabelText("Adınız"), { target: { value: "Musa" } });
    fireEvent.change(screen.getByLabelText("E-posta"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText("Şifre"), { target: { value: "12345678" } });
    fireEvent.click(screen.getByRole("checkbox"));

    await act(async () => {
      fireEvent.submit(screen.getByRole("button", { name: "Hesap Oluştur" }).closest("form")!);
    });

    const email = await screen.findByLabelText("E-posta");
    await waitFor(() => expect(email.getAttribute("aria-invalid")).toBe("true"));
    const describedBy = email.getAttribute("aria-describedby")!;
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy.split(" ")[0])?.textContent).toBe(
      "Bu e-posta zaten kayıtlı.",
    );
  });

  it("şifre kuralı ipucu hata belirince KAYBOLMAZ", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ fields: { password: "Çok kısa." } }), { status: 400 }),
      ),
    );
    render(<RegisterForm />);
    // Hata yokken ipucu zaten görünür.
    expect(screen.getByText("En az 8 karakter.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("İşletme adı"), { target: { value: "Nuve" } });
    fireEvent.change(screen.getByLabelText("Adınız"), { target: { value: "Musa" } });
    fireEvent.change(screen.getByLabelText("E-posta"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText("Şifre"), { target: { value: "123" } });
    fireEvent.click(screen.getByRole("checkbox"));
    await act(async () => {
      fireEvent.submit(screen.getByRole("button", { name: "Hesap Oluştur" }).closest("form")!);
    });

    // Hem hata hem kural görünür; kullanıcı kurala tam da şimdi ihtiyaç duyar.
    await screen.findByText("Çok kısa.");
    expect(screen.getByText("En az 8 karakter.")).toBeTruthy();
  });

  it("form-bazlı gönderim hatası DUYURULUR (role=alert)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "Kayıt kapalı." }), { status: 403 })),
    );
    render(<RegisterForm />);
    fireEvent.change(screen.getByLabelText("İşletme adı"), { target: { value: "Nuve" } });
    fireEvent.change(screen.getByLabelText("Adınız"), { target: { value: "Musa" } });
    fireEvent.change(screen.getByLabelText("E-posta"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText("Şifre"), { target: { value: "12345678" } });
    fireEvent.click(screen.getByRole("checkbox"));
    await act(async () => {
      fireEvent.submit(screen.getByRole("button", { name: "Hesap Oluştur" }).closest("form")!);
    });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Kayıt kapalı.");
  });
});

const threadProps = {
  conversationId: "conv-1",
  messages: [
    {
      id: "m1",
      direction: "inbound",
      body: "Merhaba",
      createdAt: new Date("2026-01-01T10:00:00Z"),
      senderName: "Ada",
    },
  ],
  status: "new",
  priority: "standard",
  propertyId: "prop-1",
  templateVars: {},
  canReply: true,
} as unknown as React.ComponentProps<typeof ConversationThread>;

describe("Şablon paneli — yüklenirken YANLIŞ bilgi vermez", () => {
  beforeEach(reset);

  it("istek sürerken 'bulunamadı' DEĞİL, 'yükleniyor' der", async () => {
    // Fetch bilerek asılı bırakılır: yükleme ANINDAKİ ekranı görmek istiyoruz.
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<ConversationThread {...threadProps} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Şablonlar/ }));
    });

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Şablonlar yükleniyor");
    expect(dialog.textContent).not.toContain("Şablon bulunamadı");
  });

  it("liste GERÇEKTEN boşsa boş durumu gösterir", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    render(<ConversationThread {...threadProps} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Şablonlar/ }));
    });
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.textContent).toContain("Şablon bulunamadı"));
  });

  it("şablon listesi BOŞ olsa bile aynı düğme paneli KAPATIR (tek yönlü şalter değil)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    render(<ConversationThread {...threadProps} />);
    const trigger = screen.getByRole("button", { name: /Şablonlar/ });

    await act(async () => {
      fireEvent.click(trigger);
    });
    await screen.findByRole("dialog");

    await act(async () => {
      fireEvent.click(trigger);
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

// ---------------------------------------------------------------------------
// Konuşma ekranındaki kalan doğrulanmış a11y bulguları.
// ---------------------------------------------------------------------------
describe("Konuşma ekranı — duyurular ve ayırt edilebilir düğme adları", () => {
  beforeEach(reset);

  it("her 'Çevir' düğmesinin adı BENZERSİZ (rotorda ayırt edilebilir)", () => {
    const props = {
      ...threadProps,
      messages: [
        { id: "m1", direction: "inbound", body: "A", senderName: "Ada", createdAtLabel: "1 Oca 10:00" },
        { id: "m2", direction: "inbound", body: "B", senderName: "Ada", createdAtLabel: "1 Oca 11:00" },
      ],
    } as unknown as React.ComponentProps<typeof ConversationThread>;
    render(<ConversationThread {...props} />);

    const buttons = screen.getAllByRole("button", { name: /Çevir/ });
    expect(buttons).toHaveLength(2);
    const names = buttons.map((b) => b.textContent);
    expect(new Set(names).size).toBe(2); // eskiden ikisi de sadece "Çevir" idi
    // Görünür metin adın BAŞINDA kalır (sesle kontrol "Çevir" diyerek tıklar).
    expect(names[0]!.startsWith("Çevir")).toBe(true);
  });

  it("AI öneri hatası DUYURULUR (role=alert) — eskiden sessizdi", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "AI şu an yanıt veremedi." }), { status: 500 })),
    );
    render(<ConversationThread {...threadProps} />);
    await act(async () => {
      // İki tetikleyici var (bekleyen-misafir kartı + ana düğme); ikisi de
      // handleSuggest çağırır, ilkini kullanmak yeter.
      fireEvent.click(screen.getAllByRole("button", { name: /AI cevap öner|AI ile cevapla/ })[0]);
    });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("AI şu an yanıt veremedi.");
  });
});
