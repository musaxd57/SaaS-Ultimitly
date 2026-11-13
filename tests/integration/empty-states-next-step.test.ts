import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { treeText } from "../helpers/tree-text";
import { countHref, treeHrefs } from "../helpers/tree-hrefs";

// ---------------------------------------------------------------------------
// UX-14 (kurucu 11-13: "mantıklı yap, akışı düşünerek") — boş sayfalarda TEK sonraki adım, gerçek veritabanıyla.
// İlke: boş durum sayfa başlığındaki eylemin KOPYASINI vermez (ekranda iki koyu düğme vardı); boşluğun NEDENİNİ çözen tek eylemi verir.
// Bağlantı düğmesi yalnız kurabilecek kişiye (hesap sahibi / operatör) ve gerçek hesapta.
// Sayfa fonksiyonu çağrılır, dönen React ağacı yürünür (list-pagination-pages.test.ts ile aynı desen).
// ---------------------------------------------------------------------------

vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  requireAuth: vi.fn(),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Map([["host", "localhost:3000"]]),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));
// Bağlantı durumu testin elinde (sağlayıcı kaydı kurmadan iki dalı da sınamak için).
const connected = { value: false };
vi.mock("@/lib/channels", async (orig) => ({
  ...(await orig<typeof import("@/lib/channels")>()),
  hasMessagingConnection: vi.fn(async () => connected.value),
}));

import { requireAuth } from "@/lib/auth";
import InboxPage from "@/app/(app)/inbox/page";
import PropertiesPage from "@/app/(app)/properties/page";
import TasksPage from "@/app/(app)/tasks/page";
import SentPage from "@/app/(app)/sent/page";
import SentQueuePage from "@/app/(app)/sent/queue/page";
import ReportsPage from "@/app/(app)/reports/page";
import CalendarPage from "@/app/(app)/calendar/page";
import HazirlikPage from "@/app/(app)/hazirlik/page";
import { stayDay } from "../helpers/stay-dates";

const mockAuth = vi.mocked(requireAuth);
const CONNECT = "/settings?tab=baglantilar";
const sp = <T,>(v: T) => Promise.resolve(v);

async function orgWith(role: "owner" | "manager") {
  const org = await prisma.organization.create({ data: { name: "Boş Org" } });
  const user = await prisma.user.create({ data: { email: `${role}-${org.id}@example.com`, name: role, passwordHash: "x", organizationId: org.id, role } });
  mockAuth.mockResolvedValue({
    userId: user.id,
    organizationId: org.id,
    role,
    email: user.email,
    name: role,
    sessionEpoch: 0,
  } as unknown as Awaited<ReturnType<typeof requireAuth>>);
  return org;
}

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  connected.value = false;
});

describe("Mesajlar — boş gelen kutusu", () => {
  it("hesap sahibi, bağlantı yok: boş durumda bağlantı düğmesi; 'Yeni konuşma' yalnız başlıkta (bir kez)", async () => {
    await orgWith("owner");
    const tree = await InboxPage({ searchParams: sp({}) });
    expect(countHref(tree, CONNECT)).toBe(1);
    expect(countHref(tree, "/inbox/new")).toBe(1);
  });

  it("bağlı: boş durumda düğme yok (başlıktaki eylemler yeter)", async () => {
    await orgWith("owner");
    connected.value = true;
    const tree = await InboxPage({ searchParams: sp({}) });
    expect(countHref(tree, CONNECT)).toBe(0);
    expect(countHref(tree, "/inbox/new")).toBe(1);
  });

  it("yönetici, bağlantı yok: kuramayacağı bağlantının düğmesi yok", async () => {
    await orgWith("manager");
    const tree = await InboxPage({ searchParams: sp({}) });
    expect(countHref(tree, CONNECT)).toBe(0);
  });
});

describe("Mülkler — boş liste", () => {
  it("hesap sahibi, bağlantı yok: bağlantı düğmesi + başlıktaki 'Yeni mülk' tek elle-ekleme yolu", async () => {
    await orgWith("owner");
    const tree = await PropertiesPage();
    expect(countHref(tree, CONNECT)).toBe(1);
    expect(countHref(tree, "/properties/new")).toBe(1);
    expect(treeText(tree)).not.toContain("İlk mülkü ekle");
  });

  it("yönetici: bağlantı düğmesi yok (eskiden vardı — Ayarlar'da kuramıyordu)", async () => {
    await orgWith("manager");
    const tree = await PropertiesPage();
    expect(countHref(tree, CONNECT)).toBe(0);
    expect(countHref(tree, "/properties/new")).toBe(1);
  });
});

describe("Görevler — boş pano", () => {
  it("hiç mülk yok: boş durum mülk eklemeye götürür; 'Yeni görev' yalnız başlıkta", async () => {
    await orgWith("owner");
    const tree = await TasksPage({ searchParams: sp({}) });
    expect(countHref(tree, "/properties/new")).toBe(1);
    expect(countHref(tree, "/tasks/new")).toBe(1);
    expect(treeText(tree)).not.toContain("Görev ekle");
  });

  it("mülk var, görev yok: boş durumda düğme yok, açıklama 'aşağıdan' demiyor", async () => {
    const org = await orgWith("owner");
    await prisma.property.create({ data: { organizationId: org.id, name: "Lale" } });
    const tree = await TasksPage({ searchParams: sp({}) });
    expect(countHref(tree, "/properties/new")).toBe(0);
    expect(countHref(tree, "/tasks/new")).toBe(1);
    expect(treeText(tree)).not.toContain("aşağıdan");
  });
});

describe("Gönderilenler — hiç gönderim yok", () => {
  it("bağlantı yok (hesap sahibi): bağlantı düğmesi", async () => {
    await orgWith("owner");
    const tree = await SentPage({ searchParams: sp({}) });
    expect(countHref(tree, CONNECT)).toBe(1);
    expect(countHref(tree, "/settings?tab=ai-otomasyon")).toBe(0);
  });

  it("bağlı ama dört otomatik gönderimin hiçbiri açık değil: anahtarların yerine götürür", async () => {
    await orgWith("owner");
    connected.value = true;
    const tree = await SentPage({ searchParams: sp({}) });
    expect(countHref(tree, CONNECT)).toBe(0);
    expect(countHref(tree, "/settings?tab=ai-otomasyon")).toBe(1);
    expect(treeText(tree)).toContain("Otomatik gönderimi açın");
  });

  it("bağlı ve bir gönderim açık: düğme yok (bekleme durumu)", async () => {
    const org = await orgWith("owner");
    await prisma.organization.update({ where: { id: org.id }, data: { autoWelcome: true } });
    connected.value = true;
    const tree = await SentPage({ searchParams: sp({}) });
    expect(countHref(tree, CONNECT)).toBe(0);
    expect(countHref(tree, "/settings?tab=ai-otomasyon")).toBe(0);
  });
});

describe("Gönderim kuyruğu — kayıt yok", () => {
  it("bağlantı yoksa (hesap sahibi) bağlantı düğmesi; bağlıysa yok", async () => {
    await orgWith("owner");
    expect(countHref(await SentQueuePage({ searchParams: sp({}) }), CONNECT)).toBe(1);
    connected.value = true;
    expect(countHref(await SentQueuePage({ searchParams: sp({}) }), CONNECT)).toBe(0);
  });
});

describe("Raporlar — 'bağlantı kurulunca dolar' kutusu", () => {
  it("hiç veri yokken görünür ve hesap sahibine bağlantı düğmesi verir", async () => {
    await orgWith("owner");
    const tree = await ReportsPage();
    expect(treeText(tree)).toContain("bağlantısı kurulunca bu raporlar");
    expect(countHref(tree, CONNECT)).toBe(1);
  });

  it("🚨 veri varken (takvim / dosya ile çalışan hesap: mülk satırı) kutu GİZLİ — eskiden verinin üstünde 'kurulunca dolar' diyordu", async () => {
    const org = await orgWith("owner");
    await prisma.property.create({ data: { organizationId: org.id, name: "Lale" } });
    const tree = await ReportsPage();
    expect(treeText(tree)).not.toContain("bağlantısı kurulunca bu raporlar");
    expect(treeHrefs(tree)).not.toContain(CONNECT);
  });

  it("yönetici: kutu cümlesi var, düğme yok", async () => {
    await orgWith("manager");
    const tree = await ReportsPage();
    expect(treeText(tree)).toContain("bağlantısı kurulunca bu raporlar");
    expect(countHref(tree, CONNECT)).toBe(0);
  });
});

describe("Takvim — boş ay", () => {
  it("hiç mülk yok: 'İlk daireyi ekleyin'", async () => {
    await orgWith("owner");
    const tree = await CalendarPage({ searchParams: sp({}) });
    expect(countHref(tree, "/properties/new")).toBeGreaterThanOrEqual(1);
    expect(treeText(tree)).toContain("İlk daireyi ekleyin");
  });

  it("mülk var, hiç rezervasyon yok: hesap sahibine bağlantı; yöneticiye mülkün takvim kartı", async () => {
    const org = await orgWith("owner");
    const p = await prisma.property.create({ data: { organizationId: org.id, name: "Lale" } });
    expect(countHref(await CalendarPage({ searchParams: sp({}) }), CONNECT)).toBeGreaterThanOrEqual(1);

    const asManager = { userId: "m", organizationId: org.id, role: "manager", email: "m@example.com", sessionEpoch: 0 };
    mockAuth.mockResolvedValue(asManager as unknown as Awaited<ReturnType<typeof requireAuth>>);
    const tree = await CalendarPage({ searchParams: sp({}) });
    expect(treeHrefs(tree)).not.toContain(CONNECT);
    expect(treeHrefs(tree)).toContain(`/properties/${p.id}#kanal-takvimleri`);
  });

  it("rezervasyon var ama bu ay boş: düğme yok (ay okları yeter)", async () => {
    const org = await orgWith("owner");
    const p = await prisma.property.create({ data: { organizationId: org.id, name: "Lale" } });
    await prisma.reservation.create({
      data: { propertyId: p.id, guestName: "Misafir", arrivalDate: new Date("2020-01-10T12:00:00Z"), departureDate: new Date("2020-01-12T12:00:00Z"), status: "confirmed" },
    });
    const tree = await CalendarPage({ searchParams: sp({}) });
    expect(treeHrefs(tree)).not.toContain(CONNECT);
    expect(treeHrefs(tree).some((h) => h.includes("#kanal-takvimleri") || h === "/properties/new")).toBe(false);
  });
});

describe("Hazırlık — boş durumlar", () => {
  it("giriş yok, 7 gün: '14 güne bakın'; 14 gün: 'Takvimi açın'", async () => {
    await orgWith("owner");
    // Aralık seçicisi "/hazirlik?gun=14"ü HER ZAMAN çizer → boş durumun kendi düğmesi metniyle sınanır.
    const t7 = await HazirlikPage({ searchParams: sp({}) });
    expect(treeText(t7)).toContain("14 güne bakın");
    expect(countHref(t7, "/hazirlik?gun=14")).toBe(2); // seçici + boş durum düğmesi
    const t14 = await HazirlikPage({ searchParams: sp({ gun: "14" }) });
    expect(treeText(t14)).toContain("Takvimi açın");
    expect(treeHrefs(t14)).toContain("/calendar");
  });

  it("girişler var ama profil yok: o dairenin malzeme profili kartına doğrudan bağlantı (oklu yol tarifi yok)", async () => {
    const org = await orgWith("owner");
    const p = await prisma.property.create({ data: { organizationId: org.id, name: "Lale" } });
    await prisma.reservation.create({
      data: { propertyId: p.id, guestName: "Misafir", arrivalDate: stayDay(1), departureDate: stayDay(3), status: "confirmed" },
    });
    const tree = await HazirlikPage({ searchParams: sp({}) });
    expect(treeHrefs(tree)).toContain(`/properties/${p.id}#malzeme-profili`);
    expect(treeText(tree)).toContain("Malzeme adetlerini girin");
    expect(treeText(tree)).not.toContain("Mülkler →");
  });
});

describe("Mülk kartı — eksik maddeler tıklanır (esnetilmiş bağlantı)", () => {
  it("her eksik madde onu tamamlayan yere gider; kart yine mülk sayfasına; bağlantı içinde bağlantı yok", async () => {
    const org = await orgWith("owner");
    const p = await prisma.property.create({ data: { organizationId: org.id, name: "Lale" } });
    const tree = await PropertiesPage();
    const hrefs = treeHrefs(tree);
    expect(hrefs).toContain(`/properties/${p.id}`);
    expect(hrefs).toContain(`/knowledge?property=${p.id}&category=wifi`);
    expect(hrefs).toContain(`/knowledge?property=${p.id}&category=rules`);
    expect(hrefs.filter((h) => h === `/properties/${p.id}#otomatik-mesajlar`)).toHaveLength(2); // giriş talimatı + çıkış mesajı
    expect(hrefs).toContain(CONNECT); // hesap sahibi, hesapta bağlantı yok

    // Bağlantı içinde bağlantı (geçersiz HTML) yok: hiçbir href'li öğenin altında başka href'li öğe bulunmaz.
    const nested = (node: unknown, insideLink: boolean): boolean => {
      if (node == null || typeof node !== "object") return false;
      if (Array.isArray(node)) return node.some((n) => nested(n, insideLink));
      const el = node as { props?: { href?: unknown; children?: unknown }; type?: unknown };
      if (!el.props) return false;
      const isLink = typeof el.props.href === "string";
      if (isLink && insideLink) return true;
      let expanded: unknown = null;
      if (typeof el.type === "function") {
        try {
          expanded = (el.type as (p: unknown) => unknown)(el.props);
        } catch {
          expanded = null;
        }
      }
      return nested(el.props.children, insideLink || isLink) || (expanded && typeof (expanded as { then?: unknown }).then !== "function" ? nested(expanded, insideLink) : false);
    };
    expect(nested(tree, false)).toBe(false);
  });

  it("hesap bağlıyken kanal maddesi mülkün takvim kartına gider", async () => {
    const org = await orgWith("owner");
    connected.value = true;
    const p = await prisma.property.create({ data: { organizationId: org.id, name: "Lale" } });
    const hrefs = treeHrefs(await PropertiesPage());
    expect(hrefs).toContain(`/properties/${p.id}#kanal-takvimleri`);
    expect(hrefs).not.toContain(CONNECT);
  });
});
