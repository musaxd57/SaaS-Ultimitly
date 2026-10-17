import { describe, it, expect, beforeEach, vi } from "vitest";
import { treeText } from "../helpers/tree-text";
import React from "react";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// Takvim ekranı — mobil görünüm + gizlenen hareketlerin DÜRÜSTLÜĞÜ.
//
// (Codex P2) Aylık grid `min-w-[860px]` ile sabitlenmişti: telefonda (≈390px)
// ve hatta sol menülü masaüstünde (≈704px içerik) yatay kaydırma zorunluydu —
// host takvimini iki elle sürükleyerek okuyordu.
//
// (bu turda kod-doğrulanan İKİNCİ hata) Hücre giriş ve çıkışları AYRI AYRI
// 3'te kırpıyor ama "+N diğer" satırını yalnız `giriş+çıkış > 6` iken basıyordu.
// Yani 5 giriş / 0 çıkış olan bir günde 2 giriş SESSİZCE kayboluyordu; satır
// göründüğünde de sayı yanlıştı (kırpılan değil, toplam-6 hesaplanıyordu).
//
// Desen: list-pagination-pages.test.ts ile aynı — sayfa fonksiyonu GERÇEK test
// DB'siyle çağrılır, dönen React ağacı yürünür.
// ---------------------------------------------------------------------------

vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  requireAuth: vi.fn(),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Map([["host", "localhost:3000"]]),
  cookies: async () => ({ get: () => undefined }),
}));

import { requireAuth } from "@/lib/auth";
import CalendarPage from "@/app/(app)/calendar/page";

const mockAuth = vi.mocked(requireAuth);
/** Ağaçtaki tüm className değerleri (duyarlı görünürlük sınıflarını pinlemek için). */
function classNames(root: unknown): string[] {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (node == null || typeof node === "boolean") return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    if (React.isValidElement(node)) {
      const props = node.props as { className?: unknown; children?: unknown };
      if (typeof props.className === "string") found.push(props.className);
      walk(props.children);
    }
  };
  walk(root);
  return found;
}

function sessionFor(orgId: string, role = "owner") {
  return {
    userId: "user-calendar-test",
    organizationId: orgId,
    role,
    email: "owner@test.com",
    name: "Owner",
    sessionEpoch: 0,
  } as unknown as Awaited<ReturnType<typeof requireAuth>>;
}

const sp = <T,>(v: T) => Promise.resolve(v);

/** Gün ortası UTC — Istanbul gün-anahtarında sınır belirsizliği olmaz. */
const noon = (iso: string) => new Date(`${iso}T12:00:00.000Z`);

async function seedOrg(name: string) {
  const org = await prisma.organization.create({ data: { name, timezone: "Europe/Istanbul" } });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "Daire A" },
  });
  return { org, property };
}

async function addStay(propertyId: string, guestName: string, arrival: string, departure: string) {
  return prisma.reservation.create({
    data: {
      propertyId,
      guestName,
      arrivalDate: noon(arrival),
      departureDate: noon(departure),
      status: "confirmed",
    },
  });
}

describe("Takvim — mobil ajanda (yatay kaydırma yok)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  it("tek bir 860px grid DEĞİL: küçük ekranda ajanda, md+ ekranda grid", async () => {
    const { org } = await seedOrg("Cal Org");
    mockAuth.mockResolvedValue(sessionFor(org.id));

    const tree = await CalendarPage({ searchParams: sp({ month: "2026-08" }) });
    const classes = classNames(tree).join(" ");

    // Telefonu 860px'e zorlayan sabit genişlik kalkmalı.
    expect(classes).not.toContain("min-w-[860px]");
    // İki görünüm de var ve birbirini dışlıyor.
    expect(classes).toContain("md:hidden");
    expect(classes).toMatch(/hidden[^"]*md:block/);
  });

  it("ajanda hareketli günleri KIRPMADAN listeler", async () => {
    const { org, property } = await seedOrg("Cal Org 2");
    mockAuth.mockResolvedValue(sessionFor(org.id));
    // Aynı güne 5 giriş: grid'de yalnız 3'ü sığar, ajandada hepsi görünmeli.
    for (let i = 1; i <= 5; i++) {
      await addStay(property.id, `MisafirGiris${i}`, "2026-08-10", "2026-08-14");
    }

    const tree = await CalendarPage({ searchParams: sp({ month: "2026-08" }) });
    const text = treeText(tree);

    // Grid'in kırptığı 4. ve 5. misafir ajandada MUTLAKA var.
    expect(text).toContain("MisafirGiris4");
    expect(text).toContain("MisafirGiris5");
  });

  it("hareketsiz ay dürüst bir boş durum gösterir", async () => {
    const { org } = await seedOrg("Cal Org 3");
    mockAuth.mockResolvedValue(sessionFor(org.id));

    const tree = await CalendarPage({ searchParams: sp({ month: "2026-08" }) });
    expect(treeText(tree)).toContain("Bu ayda giriş veya çıkış yok");
  });
});

describe("Takvim — gizlenen hareketler sessizce kaybolmaz", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  it("5 giriş / 0 çıkış: kırpılan 2 giriş SAYILIR (eskiden hiç söylenmiyordu)", async () => {
    const { org, property } = await seedOrg("Cal Org 4");
    mockAuth.mockResolvedValue(sessionFor(org.id));
    for (let i = 1; i <= 5; i++) {
      await addStay(property.id, `Giris${i}`, "2026-08-10", "2026-08-14");
    }

    const text = treeText(await CalendarPage({ searchParams: sp({ month: "2026-08" }) }));
    // 5 giriş − 3 gösterilen = 2 gizli. Eski kod 5 > 6 olmadığı için SUSUYORDU.
    expect(text).toContain("+2 diğer");
  });

  it("10 giriş / 1 çıkış: sayı GERÇEKTEN gizlenen kadar (toplam−6 değil)", async () => {
    const { org, property } = await seedOrg("Cal Org 5");
    mockAuth.mockResolvedValue(sessionFor(org.id));
    for (let i = 1; i <= 10; i++) {
      await addStay(property.id, `Giris${i}`, "2026-08-10", "2026-08-14");
    }
    // 10 Ağustos'ta çıkan tek konaklama.
    await addStay(property.id, "Cikan", "2026-08-05", "2026-08-10");

    const text = treeText(await CalendarPage({ searchParams: sp({ month: "2026-08" }) }));
    // Gösterilen: 3 giriş + 1 çıkış. Gizlenen: 7 giriş + 0 çıkış = 7.
    // Eski formül (10+1)−6 = 5 derdi: 2 misafir sayılmadan kayboluyordu.
    expect(text).toContain("+7 diğer");
    expect(text).not.toContain("+5 diğer");
  });
});

// ---------------------------------------------------------------------------
// TEK TARİH KURALI (09-26): rezervasyonun takvim günü `calendarDateOf` ile — yalnız-tarih çapası (D 00:00Z / D 12:00Z)
// UTC tarihidir. Ham `toLocaleDateString(tz)` New York'ta her Hospitable girişini BİR GÜN ERKEN gösteriyordu.
// ---------------------------------------------------------------------------
describe("Takvim — rezervasyon günü tek tarih kuralıyla", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  /** Mobil ajandada bir günün satırının metni (React anahtarı = gün); o gün hareket yoksa null. */
  function agendaDay(root: unknown, key: string): string | null {
    let found: string | null = null;
    const walk = (node: unknown): void => {
      if (found !== null || node == null || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const n of node) walk(n);
        return;
      }
      if (React.isValidElement(node)) {
        if (node.type === "li" && node.key === key) {
          found = treeText(node);
          return;
        }
        for (const v of Object.values((node.props ?? {}) as Record<string, unknown>)) walk(v);
      }
    };
    walk(root);
    return found;
  }

  async function stayIn(timezone: string, guestName: string) {
    const org = await prisma.organization.create({ data: { name: "Tz Org", timezone } });
    const property = await prisma.property.create({ data: { organizationId: org.id, name: "Daire T" } });
    await prisma.reservation.create({
      data: {
        propertyId: property.id,
        guestName,
        arrivalDate: new Date("2026-09-26T00:00:00.000Z"),
        departureDate: new Date("2026-09-29T00:00:00.000Z"),
        status: "confirmed",
      },
    });
    mockAuth.mockResolvedValue(sessionFor(org.id));
  }

  it("🚨 New York: 26 Eylül (00:00Z) girişi 26'sında, çıkışı 29'unda — 25'inde DEĞİL", async () => {
    await stayIn("America/New_York", "NyMisafir");
    const tree = await CalendarPage({ searchParams: sp({ month: "2026-09" }) });
    expect(agendaDay(tree, "2026-09-26")).toContain("NyMisafir");
    expect(agendaDay(tree, "2026-09-29")).toContain("NyMisafir");
    expect(agendaDay(tree, "2026-09-25")).toBeNull();
    expect(agendaDay(tree, "2026-09-28")).toBeNull();
  });

  it("İstanbul: aynı kayıt aynı günlerde (eskisiyle birebir)", async () => {
    await stayIn("Europe/Istanbul", "IstMisafir");
    const tree = await CalendarPage({ searchParams: sp({ month: "2026-09" }) });
    expect(agendaDay(tree, "2026-09-26")).toContain("IstMisafir");
    expect(agendaDay(tree, "2026-09-29")).toContain("IstMisafir");
    expect(agendaDay(tree, "2026-09-25")).toBeNull();
  });
});
