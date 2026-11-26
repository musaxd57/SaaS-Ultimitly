import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import React from "react";
import { prisma, resetDb } from "../helpers/db";
import { stayDay } from "../helpers/stay-dates";
import { treeText } from "../helpers/tree-text";

// ---------------------------------------------------------------------------
// REZERVASYON DETAY SAYFASI (kurucu 11-20 öğlen B-2; tasarım `docs/TASARIM-2026-11-20-rezervasyon-detay-ekrani.md`, B taslağı). Sayfa fonksiyonu
// GERÇEK test veritabanıyla çağrılır, dönen ağaç yürünür (`reservation-compare-page.test.ts` deseni). Sabitlenen:
//   · kart başlığı daire (daire sayfasına bağlantı) + durum rozeti; "Daire" / "Durum" satırı TEKRARLANMAZ (kurucu: "daire yerinde Lale 3 birdaha
//     yazılmasın");
//   · giriş → çıkış işletmenin takvim günüyle + gece sayısı · misafir (· kişi sayısı yalnız biliniyorsa) · kaynak (kanal adıyla) · son güncelleme;
//   · Beklemede ve İptal kayıt da açılır (kurucu); başka işletmenin kaydı ve olmayan kimlik 404 (sebep kiracı); personel `/tasks`a yönlenir;
//   · kanal kaynak kimliği ağaçta YOK (R-3); hiçbir düzenleme / iptal eylemi yok;
//   · iki dairede etkinse Dikkat satırının üç satırı + karşılaştırma bağlantısı; tek dairede ya da yalnız iptal kopyayla uyarı yok.
// ---------------------------------------------------------------------------

vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  requireAuth: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import { requireAuth } from "@/lib/auth";
import ReservationDetailPage from "@/app/(app)/reservations/[id]/page";

const mockAuth = vi.mocked(requireAuth);

function sessionFor(orgId: string, role = "owner") {
  return { userId: "user-detail-test", organizationId: orgId, role, email: "owner@test.com", name: "Owner", sessionEpoch: 0 } as unknown as Awaited<
    ReturnType<typeof requireAuth>
  >;
}

/** Ağaçtaki bağlantılar (saf alt bileşenler açılır). */
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

/** Ağaçta `<button>` ya da `<form>` var mı (salt okunur sayfa). */
function hasInteractive(root: unknown): boolean {
  let hit = false;
  const walk = (node: unknown): void => {
    if (hit || node == null || typeof node === "boolean") return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (React.isValidElement(node)) {
      if (node.type === "button" || node.type === "form") {
        hit = true;
        return;
      }
      walk((node.props as { children?: unknown }).children);
    }
  };
  walk(root);
  return hit;
}

async function world(timezone = "Europe/Istanbul") {
  const org = await prisma.organization.create({ data: { name: "Org", timezone } });
  const lale = await prisma.property.create({ data: { organizationId: org.id, name: "Lale 3" } });
  const sahil = await prisma.property.create({ data: { organizationId: org.id, name: "Sahil Evi" } });
  mockAuth.mockResolvedValue(sessionFor(org.id));
  return { orgId: org.id, lale: lale.id, sahil: sahil.id };
}

async function booking(
  propertyId: string,
  o: { channel?: string; connectionId?: string | null; guestNameSource?: string; status?: string; ref?: string; adults?: number | null; children?: number; pets?: number } = {},
) {
  return prisma.reservation.create({
    data: {
      propertyId,
      guestName: "Ada Lale",
      arrivalDate: stayDay(4),
      departureDate: stayDay(7),
      status: o.status ?? "confirmed",
      sourceReference: o.ref ?? "HM-SECRET-REF-1",
      channel: o.channel ?? "airbnb",
      connectionId: o.connectionId === undefined ? "conn-1" : o.connectionId,
      guestNameSource: o.guestNameSource ?? "channel",
      guestAdults: o.adults ?? null,
      guestChildren: o.children ?? null,
      guestPets: o.pets ?? null,
    },
    select: { id: true },
  });
}

const render = (id: string) => ReservationDetailPage({ params: Promise.resolve({ id }) });
const dayLabel = (d: Date) => d.toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

describe("Rezervasyon detay sayfası (gerçek PostgreSQL)", () => {
  beforeEach(async () => {
    await resetDb();
    mockAuth.mockReset();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("🚨 kart: daire başlıkta (bağlantı) + rozet; satırlar giriş → çıkış · gece, misafir, kaynak (kanal adıyla), son güncelleme; Daire / Durum tekrarı YOK", async () => {
    const w = await world();
    const r = await booking(w.lale);
    const tree = await render(r.id);
    const text = treeText(tree);

    expect(text).toContain("Rezervasyon");
    expect(text).toContain(`${dayLabel(stayDay(4))} → ${dayLabel(stayDay(7))} · 3 gece`);
    expect(text).toContain("Kanaldan geliyor · Airbnb");
    expect(text).toContain("Onaylı");
    expect(text).toContain("Son güncelleme");
    // Kurucu: daire adı ve misafir adı sayfada BİRER kez — "Daire" / "Durum" satırı yok, açıklama satırı da tekrar etmez.
    expect(text).not.toContain("Daire");
    expect(text).not.toContain("Durum");
    // (`treeText` bir bileşenin hem özelliklerini hem çıktısını toplar — sayım yerine eski açıklama biçiminin yokluğu ölçülür.)
    expect(text.split("Lale 3").length - 1).toBe(1);
    expect(text).not.toContain("Ada Lale · Lale 3");
    expect(treeLinks(tree).filter((l) => l.text === "Lale 3").map((l) => l.href)).toEqual([`/properties/${w.lale}`]);
    // Kanal kaynak kimliği gösterilmez (R-3); sayfa salt okunur.
    expect(text).not.toContain("HM-SECRET-REF-1");
    expect(hasInteractive(tree)).toBe(false);
  });

  it("kişi sayısı yalnız biliniyorsa ('Ada Lale · 3 kişi · 1 evcil hayvan'); bilinmiyorsa yalnız ad", async () => {
    const w = await world();
    const known = await booking(w.lale, { adults: 2, children: 1, pets: 1, ref: "R-K" });
    expect(treeText(await render(known.id))).toContain("Ada Lale · 3 kişi · 1 evcil hayvan");
    const unknown = await booking(w.sahil, { ref: "R-U" });
    const t = treeText(await render(unknown.id));
    expect(t).toContain("Ada Lale");
    expect(t).not.toContain("kişi");
  });

  it.each([
    ["pending", "Beklemede"],
    ["cancelled", "İptal"],
    ["completed", "Tamamlandı"],
  ])("🚨 %s kayıt da açılır (rozet %s)", async (status, label) => {
    const w = await world();
    const r = await booking(w.lale, { status });
    const tree = await render(r.id);
    expect(treeText(tree)).toContain(label);
  });

  it("🚨 başka işletmenin kaydı 404 (kayıt VAR, sebep kiracı); olmayan kimlik 404", async () => {
    const other = await world();
    const foreign = await booking(other.lale);
    await world(); // oturum artık ikinci işletmenin
    await expect(render(foreign.id)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(await prisma.reservation.count({ where: { id: foreign.id } })).toBe(1);
    await expect(render("yok-boyle-bir-kayit")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("personel /tasks'a yönlenir (yönetici sayfa kapısı)", async () => {
    const w = await world();
    const r = await booking(w.lale);
    mockAuth.mockResolvedValue(sessionFor(w.orgId, "staff"));
    await expect(render(r.id)).rejects.toThrow("NEXT_REDIRECT:/tasks");
  });

  it("🚨 iki dairede etkin: Dikkat satırının üç satırı + karşılaştırma bağlantısı (bu kaydın kimliğiyle)", async () => {
    const w = await world();
    const r = await booking(w.lale);
    await booking(w.sahil, { channel: "manual", connectionId: null, guestNameSource: "host" });
    const tree = await render(r.id);
    const text = treeText(tree);
    expect(text).toContain("Aynı rezervasyon birden fazla dairede görünüyor");
    expect(text).toContain(`Lale 3 · Sahil Evi · Giriş: ${stayDay(4).toLocaleDateString("tr-TR", { day: "numeric", month: "short", timeZone: "UTC" })}`);
    // Otomatik mesajlar bu işletmede kapalı → tutma bir gönderimi durdurmuyor → söz yok.
    expect(text).not.toContain("Otomatik gönderim durduruldu");
    expect(treeLinks(tree).filter((l) => l.text === "Kayıtları karşılaştır").map((l) => l.href)).toEqual([`/reservations/compare/${r.id}`]);
  });

  it("aşırı uygulama yok: öteki kopya iptal edilmişse (etkin kayıt tek dairede) uyarı YOK", async () => {
    const w = await world();
    const r = await booking(w.lale);
    await booking(w.sahil, { channel: "manual", connectionId: null, guestNameSource: "host", status: "cancelled" });
    const text = treeText(await render(r.id));
    expect(text).not.toContain("Aynı rezervasyon birden fazla dairede görünüyor");
  });

  it("gün işletmenin takvim gününden: an olarak saklı varış (21:30Z) İstanbul'da ertesi gün", async () => {
    const w = await world("Europe/Istanbul");
    const arrival = new Date(Date.UTC(2031, 2, 9, 21, 30)); // İstanbul'da 10 Mart 00:30
    const departure = new Date(Date.UTC(2031, 2, 12, 9, 0));
    const r = await prisma.reservation.create({
      data: { propertyId: w.lale, guestName: "Ada Lale", arrivalDate: arrival, departureDate: departure, status: "confirmed", channel: "manual", guestNameSource: "host" },
      select: { id: true },
    });
    expect(treeText(await render(r.id))).toContain("10 Mar 2031 → 12 Mar 2031 · 2 gece");
  });
});
