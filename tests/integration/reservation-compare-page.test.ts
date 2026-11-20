import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import React from "react";
import { prisma, resetDb } from "../helpers/db";
import { stayDay } from "../helpers/stay-dates";
import { treeText } from "../helpers/tree-text";

// ---------------------------------------------------------------------------
// "Kayıtları karşılaştır" SAYFASI (kurucu 11-19 akşam, madde 3 ve 4). Sayfa fonksiyonu GERÇEK test veritabanıyla çağrılır, dönen ağaç yürünür
// (`calendar-page.test.ts` deseni). Sabitlenen:
//   · çakışma sürerken açıklama Dikkat satırıyla aynı (kurucu 11-20 sabah B-1): "Aynı rezervasyon birden fazla dairede görünüyor" · daire
//     adları " · " ile + " · Giriş: <gün>" (ek takılmaz) · "Otomatik gönderim durduruldu" YALNIZ tutma gerçekten bir mesajı durduruyorsa;
//   · çakışma çözülünce (son kopya yanıtından sonra liste yenilenince de) "Rezervasyonu aç" görünür ve DOĞRUDAN kalan kaydın detay sayfasına
//     gider (kurucu 11-20 öğlen B-2: "takvime değil, bu ekranda doğrudan kalan kayda");
//   · etkin kayıt hiç kalmadıysa sayfanın kendi kaydı açılır ("Beklemede veya İptal olsa da açılabilsin"); çakışma sürerken yok.
// ---------------------------------------------------------------------------

vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  requireAuth: vi.fn(),
}));
vi.mock("@/lib/hospitable-credentials", async (orig) => ({
  ...(await orig<typeof import("@/lib/hospitable-credentials")>()),
  getConnectionInfo: vi.fn().mockResolvedValue({ connected: true }),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Map([["host", "localhost:3000"]]),
  cookies: async () => ({ get: () => undefined }),
}));

import { requireAuth } from "@/lib/auth";
import CompareBookingRecordsPage from "@/app/(app)/reservations/compare/[key]/page";
import { seedAutoMessage } from "../helpers/auto-message";

const mockAuth = vi.mocked(requireAuth);

function sessionFor(orgId: string) {
  return {
    userId: "user-compare-test",
    organizationId: orgId,
    role: "owner",
    email: "owner@test.com",
    name: "Owner",
    sessionEpoch: 0,
  } as unknown as Awaited<ReturnType<typeof requireAuth>>;
}

/** Ağaçtaki bağlantılar ve görünen metinleri (saf alt bileşenler açılır; `tree-hrefs.ts` ile aynı yürüyüş). */
function treeLinks(root: unknown): { href: string; text: string }[] {
  const found: { href: string; text: string }[] = [];
  const walk = (node: unknown): void => {
    if (node == null || typeof node === "boolean") return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    if (React.isValidElement(node)) {
      if (typeof node.type === "function") {
        try {
          const out = (node.type as (p: unknown) => unknown)(node.props);
          if (out && typeof (out as { then?: unknown }).then !== "function") {
            walk(out);
            return;
          }
        } catch {
          /* açılamadı → prop'lardan oku */
        }
      }
      const props = node.props as { href?: unknown; children?: unknown };
      if (typeof props.href === "string") found.push({ href: props.href, text: treeText(props.children) });
      walk(props.children);
    }
  };
  walk(root);
  return found;
}

async function world() {
  const org = await prisma.organization.create({ data: { name: "Org", timezone: "Europe/Istanbul" } });
  const lale = await prisma.property.create({ data: { organizationId: org.id, name: "Lale 3" } });
  const sahil = await prisma.property.create({ data: { organizationId: org.id, name: "Sahil Evi" } });
  mockAuth.mockResolvedValue(sessionFor(org.id));
  return { orgId: org.id, lale: lale.id, sahil: sahil.id };
}

async function booking(propertyId: string, o: { channel: string; connectionId?: string; guestNameSource?: string; status?: string }) {
  return prisma.reservation.create({
    data: {
      propertyId,
      guestName: "Ada Lale",
      arrivalDate: stayDay(4),
      departureDate: stayDay(7),
      status: o.status ?? "confirmed",
      sourceReference: "HM-1",
      channel: o.channel,
      connectionId: o.connectionId ?? null,
      guestNameSource: o.guestNameSource ?? null,
    },
    select: { id: true },
  });
}

const render = (key: string) => CompareBookingRecordsPage({ params: Promise.resolve({ key }) });
/** Varış günü (yalnız tarih, 00:00Z → takvimin gün kuralıyla UTC tarihi), panelin biçimiyle ("5 Ara"). */
const arrivalLabel = stayDay(4).toLocaleDateString("tr-TR", { day: "numeric", month: "short", timeZone: "UTC" });

describe("Kayıtları karşılaştır sayfası (gerçek PostgreSQL)", () => {
  beforeEach(async () => {
    await resetDb();
    mockAuth.mockReset();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("🚨 çakışma sürerken: başlık sabit + daire adları ' · ' ile (ek yok); 'Rezervasyonu aç' YOK", async () => {
    const w = await world();
    const manual = await booking(w.lale, { channel: "manual", guestNameSource: "host" });
    await booking(w.sahil, { channel: "airbnb", connectionId: "conn-1", guestNameSource: "channel" });

    const text = treeText(await render(manual.id));

    expect(text).toContain("Aynı rezervasyon birden fazla dairede görünüyor");
    expect(text).toContain(`Lale 3 · Sahil Evi · Giriş: ${arrivalLabel}`);
    expect(text).not.toMatch(/Evi'(n?d|t)[ae]|3'(t|d)[ae]/);
    expect(text).not.toContain("Kayıtlar artık tek dairede.");
    expect(text).not.toContain("Rezervasyonu aç");
    // Otomatik mesajlar bu işletmede kapalı: tutma hiçbir gönderimi durdurmuyor → söz yok. Eski cümle de yok.
    expect(text).not.toContain("Otomatik gönderim durduruldu");
    expect(text).not.toContain("bekletiliyor");
  });

  it("🚨 çakışma sürerken tutma gerçekten bir gönderimi durduruyorsa: üçüncü satır 'Otomatik gönderim durduruldu'", async () => {
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    try {
      const w = await world();
      await prisma.organization.update({ where: { id: w.orgId }, data: { autoCheckin: true, autoCheckinEnabledAt: new Date(0) } });
      await prisma.property.update({ where: { id: w.sahil }, data: { createdAt: new Date(Date.now() - 30 * 86_400_000) } });
      await seedAutoMessage(w.sahil, "checkin", "Merhaba {isim}, giriş bilgileri.");
      const manual = await booking(w.lale, { channel: "manual", guestNameSource: "host" });
      await booking(w.sahil, { channel: "airbnb", connectionId: "conn-1", guestNameSource: "channel" });

      const text = treeText(await render(manual.id));

      expect(text).toContain(`Lale 3 · Sahil Evi · Giriş: ${arrivalLabel}`);
      expect(text).toContain("Otomatik gönderim durduruldu");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("🚨 çakışma çözülünce (öteki kopya gitti): çözüldü cümlesi + 'Rezervasyonu aç' → kalan kaydın detay sayfası (tek bağlantı)", async () => {
    const w = await world();
    const manual = await booking(w.lale, { channel: "manual", guestNameSource: "host" });
    const other = await booking(w.sahil, { channel: "airbnb", connectionId: "conn-1", guestNameSource: "channel" });
    await prisma.reservation.delete({ where: { id: other.id } });

    const tree = await render(manual.id);
    const text = treeText(tree);

    expect(text).toContain("Kayıtlar artık tek dairede. Otomatik mesajlar olağan akışa döndü.");
    expect(text).not.toContain("Aynı rezervasyon birden fazla dairede görünüyor");
    const open = treeLinks(tree).filter((l) => l.text === "Rezervasyonu aç");
    expect(open.map((l) => l.href)).toEqual([`/reservations/${manual.id}`]);
  });

  it("çözülmüş, etkin kayıt kalmamış (ikisi de iptal): 'Rezervasyonu aç' sayfanın KENDİ kaydını açar (iptal kayıt da açılır)", async () => {
    const w = await world();
    const manual = await booking(w.lale, { channel: "manual", guestNameSource: "host", status: "cancelled" });
    await booking(w.sahil, { channel: "airbnb", connectionId: "conn-1", guestNameSource: "channel", status: "cancelled" });

    const tree = await render(manual.id);

    expect(treeText(tree)).toContain("Kayıtlar artık tek dairede.");
    expect(treeLinks(tree).filter((l) => l.text === "Rezervasyonu aç").map((l) => l.href)).toEqual([`/reservations/${manual.id}`]);
  });

  it("KONTROL: çözülmüş sayfada iptal edilmiş satır yerine ETKİN kalan kayıt açılır", async () => {
    const w = await world();
    await booking(w.lale, { channel: "manual", guestNameSource: "host", status: "cancelled" });
    const live = await booking(w.sahil, { channel: "airbnb", connectionId: "conn-1", guestNameSource: "channel" });

    const tree = await render(live.id);

    const open = treeLinks(tree).filter((l) => l.text === "Rezervasyonu aç");
    expect(open.map((l) => l.href)).toEqual([`/reservations/${live.id}`]);
  });
});
