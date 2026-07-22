import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// KVKK silme kartı GÖRÜNÜRLÜK smoke'u (Codex 07-22): properties/[id] bir server
// component — jsdom'da TAM render etmek ağır client bileşenlerini (QR, formlar)
// sürüklerdi. Bunun yerine sayfa fonksiyonu GERÇEK test DB'siyle çağrılır ve
// DÖNEN React element ağacı yürünür: rol+flag kapısı, kartın varlığı ve sayfalı
// geçmişin ERİŞİM garantisi (son-5 dışındaki eski konaklama da listelenir)
// birebir pinlenir. Client bileşenler hiç ÇALIŞMAZ (ağaçta yalnız tip olarak
// dururlar) — bu test sunucu tarafındaki görünürlük mantığını sabitler.
// ---------------------------------------------------------------------------

// requireAuth: sayfanın tek oturum kaynağı — role'ü testten yönetiyoruz.
// importOriginal spread'i: @/lib/auth'un diğer export'ları (transitif tüketiciler
// için) gerçek kalır; yalnız requireAuth kontrollü.
vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  requireAuth: vi.fn(),
}));
// next/headers: sayfa host'u okur; auth modülü de cookies import eder (çağrılmaz).
vi.mock("next/headers", () => ({
  headers: async () => new Map([["host", "localhost:3000"]]),
  cookies: async () => ({ get: () => undefined }),
}));

import { requireAuth } from "@/lib/auth";
import PropertyDetailPage from "@/app/(app)/properties/[id]/page";
import { GuestErasureControl } from "@/components/properties/guest-erasure-control";

const mockAuth = vi.mocked(requireAuth);

/** Ağaçtaki tüm elementleri ziyaret et (fragment/array/children dahil). */
function walk(node: unknown, visit: (el: React.ReactElement) => void): void {
  if (node == null || typeof node === "boolean") return;
  if (Array.isArray(node)) {
    for (const n of node) walk(n, visit);
    return;
  }
  if (React.isValidElement(node)) {
    visit(node);
    walk((node.props as { children?: unknown }).children, visit);
  }
}

function treeText(root: unknown): string {
  const parts: string[] = [];
  const collect = (node: unknown): void => {
    if (node == null || typeof node === "boolean") return;
    if (typeof node === "string" || typeof node === "number") {
      parts.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      for (const n of node) collect(n);
      return;
    }
    if (React.isValidElement(node)) collect((node.props as { children?: unknown }).children);
  };
  collect(root);
  return parts.join("");
}

function erasureControls(root: unknown): { reservationId: string }[] {
  const found: { reservationId: string }[] = [];
  walk(root, (el) => {
    if (el.type === GuestErasureControl) found.push(el.props as { reservationId: string });
  });
  return found;
}

async function seedPropertyWithHistory() {
  const org = await prisma.organization.create({ data: { name: "Erasure Reach Org" } });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "Reach Daire", icalToken: "tok-reach-test" },
  });
  // 7 rezervasyon, en yenisi bugün: son-5 listesi Guest-1..5'i gösterir;
  // Guest-6/7 YALNIZ geçmiş kartından erişilebilir (fix'in varlık sebebi).
  const day = 24 * 60 * 60 * 1000;
  for (let i = 1; i <= 7; i++) {
    await prisma.reservation.create({
      data: {
        propertyId: property.id,
        guestName: `ReachGuest-${i}`,
        arrivalDate: new Date(Date.now() - i * 30 * day),
        departureDate: new Date(Date.now() - i * 30 * day + 3 * day),
        status: "completed",
        channel: "airbnb",
        sourceReference: `reach-src-${i}`,
      },
    });
  }
  return { org, property };
}

function sessionFor(orgId: string, role: string) {
  return {
    userId: "user-reach",
    organizationId: orgId,
    role,
    email: "reach@example.com",
  } as never;
}

async function renderPage(propertyId: string) {
  return PropertyDetailPage({
    params: Promise.resolve({ id: propertyId }),
    searchParams: Promise.resolve({}),
  });
}

describe("properties/[id] — KVKK silme kartı görünürlüğü (server-side gate)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    // QR/PIN yüzeyleri kapalı: varsayılan liste = son-5 (kartın erişim iddiasını
    // tam da bu mod üzerinde pinliyoruz).
    vi.stubEnv("GUEST_CHAT_ENABLED", "");
    vi.stubEnv("QR_PIN_ENABLED", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("flag KAPALI: owner bile olsa kart YOK, hiçbir silme kontrolü render edilmez", async () => {
    vi.stubEnv("GUEST_ERASURE_ENABLED", "");
    const { org, property } = await seedPropertyWithHistory();
    mockAuth.mockResolvedValue(sessionFor(org.id, "owner"));
    const tree = await renderPage(property.id);
    expect(treeText(tree)).not.toContain("KVKK Silme");
    expect(erasureControls(tree)).toHaveLength(0);
  });

  it("flag AÇIK + owner: kart VAR ve son-5 DIŞINDAKİ eski konaklamalar da silme kontrolüyle erişilebilir", async () => {
    vi.stubEnv("GUEST_ERASURE_ENABLED", "1");
    const { org, property } = await seedPropertyWithHistory();
    mockAuth.mockResolvedValue(sessionFor(org.id, "owner"));
    const tree = await renderPage(property.id);
    const text = treeText(tree);
    expect(text).toContain("Tüm Rezervasyonlar");
    expect(text).toContain("KVKK Silme");
    // Erişim garantisi: son-5'in gösterMEdiği 6. ve 7. konaklamalar geçmiş
    // kartında listelenir — eski misafirin m.11 talebi artık UI'dan işlenebilir.
    expect(text).toContain("ReachGuest-6");
    expect(text).toContain("ReachGuest-7");
    // Ana liste 5 + geçmiş sayfası 7 satır = 12 silme kontrolü; 7 BENZERSİZ
    // rezervasyonun HEPSİ en az bir kontrolle kapsanır.
    const controls = erasureControls(tree);
    expect(controls).toHaveLength(12);
    expect(new Set(controls.map((c) => c.reservationId)).size).toBe(7);
  });

  it.each(["manager", "staff"])("flag AÇIK + %s: kart YOK (owner-only yüzey)", async (role) => {
    vi.stubEnv("GUEST_ERASURE_ENABLED", "1");
    const { org, property } = await seedPropertyWithHistory();
    mockAuth.mockResolvedValue(sessionFor(org.id, role));
    const tree = await renderPage(property.id);
    expect(treeText(tree)).not.toContain("KVKK Silme");
    expect(erasureControls(tree)).toHaveLength(0);
  });
});
