import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import React from "react";
import { prisma, resetDb } from "../helpers/db";
import { probeQueries, probeSummary } from "../helpers/query-probe";
import { stayDay } from "../helpers/stay-dates";

// ---------------------------------------------------------------------------
// SOHBET EKRANI SON 60 MESAJ (kurucu kararı 11-26 sabah, K2-S; tasarım `docs/TASARIM-2026-11-26-sohbet-ekrani-son-60.md`).
// Sayfa sunucu bileşeni gerçek test veritabanıyla çağrılır; dönen ağaçtaki `ConversationThread` / `DecisionPanel` alanları okunur
// (istemci bileşeni çalışmaz). Pinlenen:
//  · ekran yalnız en yeni 60 mesajı alır, daha eski varsa "Daha eski mesajları göster" bağlantısı (`?eski=1`) verilir; `?eski=N` pencereyi
//    N sayfa büyütür, tavanda bütün geçmiş; geçersiz değer varsayılana döner;
//  · sıra `(createdAt, id)` ile kesin: aynı zaman damgalı mesajlar pencere sınırında ne kaybolur ne iki kez görünür;
//  · geriye tarayan hesaplar (uzunluk uyarısı, karar tutuşu notu, hazır taslak, karar kartı) ilgili mesaj pencerenin DIŞINDAYKEN de
//    bütün geçmişle hesaplanan sonucu verir (davranış değişmez; değişen tek şey ekranda ilk anda görünen mesaj sayısı).
// Mesajların zamanı AÇIKÇA verilir (1 sn aralık; ekleme sırasına güvenilmez), kimlikler sabit biçimli ("m-0001").
// ---------------------------------------------------------------------------

vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  requireAuth: vi.fn(),
}));
// Öğe kipi bayrağı anlama katmanını da ister (anahtar); test paketi anahtarı boşaltır → katman "açık" sayılır (prepared-draft-page emsali).
vi.mock("@/lib/ai/semantic/understand", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/semantic/understand")>()),
  understandingEnabled: () => true,
}));
vi.mock("next/headers", () => ({
  headers: async () => new Map([["host", "localhost:3000"]]),
  cookies: async () => ({ get: () => undefined }),
}));

import { requireAuth } from "@/lib/auth";
import ConversationPage from "@/app/(app)/inbox/[id]/page";
import { ConversationThread } from "@/components/inbox/conversation-thread";
import { DecisionPanel } from "@/components/inbox/decision-panel";
import { preparedDraftOf } from "@/lib/conversation-items/prepared-draft";
import { aiSuggestExceedsLength } from "@/lib/ai/message-length";
import { requestQuoteOf } from "@/lib/decisions/card";
import { HANDOFF_NOTICE_REASON } from "@/lib/ai/output-veto";
import { SKIP_REASON_LABELS } from "@/lib/inbox-skip-labels";

const mockAuth = vi.mocked(requireAuth);

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

function textOf(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (React.isValidElement(node)) return textOf((node.props as { children?: unknown }).children);
  return "";
}

type ThreadProps = React.ComponentProps<typeof ConversationThread>;
type PanelProps = React.ComponentProps<typeof DecisionPanel>;

function propsOf<P>(tree: unknown, type: unknown): P {
  let found: P | null = null;
  walk(tree, (el) => {
    if (el.type === type) found = el.props as P;
  });
  if (!found) throw new Error("bileşen ağaçta yok");
  return found;
}

const threadOf = (tree: unknown) => propsOf<ThreadProps>(tree, ConversationThread);

interface MsgSeed {
  id: string;
  /** Saniye cinsinden göreli zaman (taban + at sn). Aynı `at` = aynı zaman damgası. */
  at: number;
  direction: "inbound" | "outbound";
  body?: string;
  authorType?: string;
  draft?: { reply: string; intent: string };
  outbox?: string;
}

const mid = (i: number) => `m-${String(i).padStart(4, "0")}`;

/** `(at, id)` sırası — sayfanın `(createdAt, id)` sırasının bağımsız karşılığı (kimlikler aynı biçimli, küçük harf + rakam). */
function expectedOrder(seeds: readonly MsgSeed[]): string[] {
  return [...seeds].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((s) => s.id);
}

/** Sıradan konuşma: misafir ve ev sahibi dönüşümlü yazar (her pencerede ikisi de var). */
function alternating(n: number): MsgSeed[] {
  return Array.from({ length: n }, (_, i) => ({
    id: mid(i),
    at: i,
    direction: i % 2 === 0 ? ("inbound" as const) : ("outbound" as const),
    body: `Mesaj ${i}`,
  }));
}

async function seed(
  messages: readonly MsgSeed[],
  opts: { skippedReason?: string; withReservation?: boolean; orgName?: string } = {},
): Promise<{ orgId: string; conversationId: string; propertyId: string; reservationId: string | null; base: number }> {
  const org = await prisma.organization.create({ data: { name: opts.orgName ?? "Pencere Org", timezone: "Europe/Istanbul" } });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "Lale 3", checkInTime: "15:00", checkOutTime: "11:00" },
  });
  const reservation = opts.withReservation
    ? await prisma.reservation.create({
        data: {
          propertyId: property.id,
          guestName: "Ada Yılmaz",
          arrivalDate: stayDay(1),
          departureDate: stayDay(4),
          status: "confirmed",
          channel: "airbnb",
        },
      })
    : null;
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      reservationId: reservation?.id ?? null,
      channel: "airbnb",
      externalReservationId: "res-1",
      guestIdentifier: "Ada",
      status: "new",
      skippedReason: opts.skippedReason ?? null,
      lastMessageAt: new Date(),
    },
  });
  // Taban iki gün önce: göreli zamanlar (en çok birkaç yüz saniye) "şimdi"den önce kalır; saatin kaç olduğuna bakan bir iddia yok.
  const base = Date.now() - 2 * 86_400_000;
  await prisma.message.createMany({
    data: messages.map((m) => ({
      id: m.id,
      conversationId: conversation.id,
      direction: m.direction,
      senderName: m.direction === "inbound" ? "Ada" : "Ev sahibi",
      authorType: m.authorType ?? (m.direction === "inbound" ? "guest" : "host"),
      body: m.body ?? `Mesaj ${m.id}`,
      createdAt: new Date(base + m.at * 1000),
      ...(m.draft ? { aiSuggestedReply: m.draft.reply, aiIntent: m.draft.intent, aiConfidence: 0.9 } : {}),
    })),
  });
  const withOutbox = messages.filter((m) => m.outbox);
  if (withOutbox.length > 0) {
    await prisma.messageOutbox.createMany({
      data: withOutbox.map((m) => ({
        organizationId: org.id,
        conversationId: conversation.id,
        messageId: m.id,
        channel: "airbnb",
        body: m.body ?? "x",
        idempotencyKey: `k-${m.id}`,
        status: m.outbox!,
      })),
    });
  }
  return { orgId: org.id, conversationId: conversation.id, propertyId: property.id, reservationId: reservation?.id ?? null, base };
}

function asOwner(orgId: string) {
  mockAuth.mockResolvedValue({ userId: "u-pencere", organizationId: orgId, role: "owner", email: "pencere@example.com" } as never);
}

async function render(conversationId: string, searchParams: Record<string, string | string[]> = {}) {
  return ConversationPage({ params: Promise.resolve({ id: conversationId }), searchParams: Promise.resolve(searchParams) } as never);
}

const ids = (t: ThreadProps) => t.messages.map((m) => m.id);

describe("sohbet ekranı — son 60 mesaj penceresi", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("(a) 150 mesajlı konuşma: ekrana yalnız en yeni 60 mesaj gelir (sırayla) ve üstte 'daha eski' bağlantısı ?eski=1", async () => {
    const seeds = alternating(150);
    const s = await seed(seeds);
    asOwner(s.orgId);
    const t = threadOf(await render(s.conversationId));
    expect(ids(t)).toEqual(expectedOrder(seeds).slice(-60));
    expect(t.olderHref).toBe(`/inbox/${s.conversationId}?eski=1`);
  });

  it("(a) veritabanından da yalnız pencere okunur: mesaj tablosuna giden her okuma sınırlı (LIMIT), mesaj sorgusu bir tane + son gelen mesaj", async () => {
    const s = await seed(alternating(150));
    asOwner(s.orgId);
    const r = await probeQueries(() => render(s.conversationId));
    const messageReads = r.sqlTexts.filter((q) => /^\s*SELECT/i.test(q) && /FROM "public"\."Message"/.test(q));
    // Anti-vakumluk: pencere okuması VE son misafir mesajı okuması ölçüldü.
    expect(messageReads.length, probeSummary(r)).toBe(2);
    for (const q of messageReads) expect(q, q).toMatch(/\bLIMIT\b/);
    expect(r.byOp["Message.findMany"] ?? 0, probeSummary(r)).toBe(0);
  });

  it("(b) ?eski=1 → en yeni 120 mesaj, bağlantı ?eski=2; geri hedefi (from) bağlantıda korunur", async () => {
    const seeds = alternating(150);
    const s = await seed(seeds);
    asOwner(s.orgId);
    const t = threadOf(await render(s.conversationId, { eski: "1", from: "/inbox?status=problem" }));
    expect(ids(t)).toEqual(expectedOrder(seeds).slice(-120));
    expect(t.olderHref).toBe(`/inbox/${s.conversationId}?from=${encodeURIComponent("/inbox?status=problem")}&eski=2`);
  });

  it("(b) tavan (?eski=20) bütün geçmişi gösterir, bağlantı kalkar; geçersiz değerler varsayılan 60'a döner", async () => {
    const seeds = alternating(150);
    const s = await seed(seeds);
    asOwner(s.orgId);
    const all = threadOf(await render(s.conversationId, { eski: "20" }));
    expect(ids(all)).toEqual(expectedOrder(seeds));
    expect(all.olderHref ?? null).toBeNull();
    for (const bad of ["-1", "0", "abc", "1.5", "999", "21", "", " 1", "1e1", "0x2"]) {
      const t = threadOf(await render(s.conversationId, { eski: bad }));
      expect(t.messages.length, `eski=${JSON.stringify(bad)}`).toBe(60);
      expect(t.olderHref, `eski=${JSON.stringify(bad)}`).toBe(`/inbox/${s.conversationId}?eski=1`);
    }
    // Yinelenen parametre: ilki okunur (`from` ile aynı kural).
    expect(threadOf(await render(s.conversationId, { eski: ["1", "5"] })).messages.length).toBe(120);
  });

  it("(c) 60 ve altı mesaj: hepsi görünür, bağlantı yok", async () => {
    for (const n of [60, 59, 1]) {
      await resetDb();
      const seeds = alternating(n);
      const s = await seed(seeds);
      asOwner(s.orgId);
      const t = threadOf(await render(s.conversationId));
      expect(ids(t), `n=${n}`).toEqual(expectedOrder(seeds));
      expect(t.olderHref ?? null, `n=${n}`).toBeNull();
    }
  });

  it("(c) 61 mesaj: en eski tek mesaj gizli, bağlantı var; ?eski=1 hepsini gösterir ve bağlantı kalkar", async () => {
    const seeds = alternating(61);
    const s = await seed(seeds);
    asOwner(s.orgId);
    const t = threadOf(await render(s.conversationId));
    expect(ids(t)).toEqual(expectedOrder(seeds).slice(1));
    expect(t.olderHref).toBe(`/inbox/${s.conversationId}?eski=1`);
    const t1 = threadOf(await render(s.conversationId, { eski: "1" }));
    expect(ids(t1)).toEqual(expectedOrder(seeds));
    expect(t1.olderHref ?? null).toBeNull();
  });

  it("(d) aynı zaman damgalı mesajlar: sıra (createdAt, id); pencere sınırı bir eşitlik grubunun ortasına düşse de mesaj ne kaybolur ne iki kez görünür", async () => {
    // 130 mesaj, 8'li gruplar aynı saniyede; kimlikler grup içinde ekleme sırasının TERSİNE (yalnız createdAt ile okuyan sorgu eşitlikte
    // veritabanının döndürdüğü sırayı verirdi). 60'lık pencere 70. sıradan başlar (64–71 grubunun ortası), 120'lik pencere 10. sıradan (8–15).
    const seeds: MsgSeed[] = Array.from({ length: 130 }, (_, i) => ({
      id: mid(1000 - i),
      at: Math.floor(i / 8),
      direction: i % 2 === 0 ? ("inbound" as const) : ("outbound" as const),
    }));
    const order = expectedOrder(seeds);
    const s = await seed(seeds);
    asOwner(s.orgId);
    const p0 = ids(threadOf(await render(s.conversationId)));
    const p1 = ids(threadOf(await render(s.conversationId, { eski: "1" })));
    const p2 = threadOf(await render(s.conversationId, { eski: "2" }));
    expect(p0).toEqual(order.slice(-60));
    expect(p1).toEqual(order.slice(-120));
    expect(p1.slice(-60)).toEqual(p0);
    expect(ids(p2)).toEqual(order);
    expect(p2.olderHref ?? null).toBeNull();
    expect(new Set(ids(p2)).size).toBe(130);
  });
});

describe("sohbet ekranı penceresi — geriye tarayan hesaplar pencere dışındaki mesajla da aynı sonucu verir", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });
  afterEach(() => vi.unstubAllEnvs());

  const WARNING = "Mesaj çok uzun (8.000 karakterden fazla)";
  const LONG = "Merhaba, uzun bir mesaj. ".repeat(330);

  it("(e) uzunluk uyarısı: 8.000+ karakterlik cevapsız misafir mesajı pencerenin DIŞINDA (ardından 69 cevapsız mesaj) → uyarı yine görünür", async () => {
    // 70 misafir mesajı, hiç cevap yok. Uzun mesaj 9. sırada; 8–12 aynı saniyede → pencere (10–69) sınırı eşitlik grubunun ortasında:
    // yalnız `createdAt <` ile eski mesaj okuyan bir sorgu 8–9'u kaçırırdı.
    const seeds: MsgSeed[] = Array.from({ length: 70 }, (_, i) => ({
      id: mid(i),
      at: i >= 8 && i <= 12 ? 8 : i,
      direction: "inbound" as const,
      body: i === 9 ? LONG : `Kısa mesaj ${i}`,
    }));
    const order = expectedOrder(seeds);
    expect(order.indexOf(mid(9))).toBe(9);
    // Anti-vakumluk: yalnız pencereyle hesaplansaydı uyarı ÇIKMAZDI, bütün geçmişle çıkar.
    const byId = new Map(seeds.map((m) => [m.id, { direction: m.direction, body: m.body ?? null, authorType: "guest" }]));
    expect(aiSuggestExceedsLength(order.slice(-60).map((id) => byId.get(id)!))).toBe(false);
    expect(aiSuggestExceedsLength(order.map((id) => byId.get(id)!))).toBe(true);
    const s = await seed(seeds);
    asOwner(s.orgId);
    const tree = await render(s.conversationId);
    expect(textOf(tree)).toContain(WARNING);
    // Ekrana yine yalnız pencere gelir.
    expect(ids(threadOf(tree))).toEqual(order.slice(-60));
  });

  it("(e) KONTROL: uzun mesajdan SONRA bir cevap varsa (pencerenin içinde) uyarı yok — eski okuma tetiklenmez, sonuç bütün geçmişle aynı", async () => {
    const seeds: MsgSeed[] = Array.from({ length: 70 }, (_, i) => ({
      id: mid(i),
      at: i,
      direction: i === 40 ? ("outbound" as const) : ("inbound" as const),
      body: i === 5 ? LONG : `Kısa ${i}`,
    }));
    const s = await seed(seeds);
    asOwner(s.orgId);
    const r = await probeQueries(() => render(s.conversationId));
    expect(textOf(r.result)).not.toContain(WARNING);
    expect(r.byOp["Message.findMany"] ?? 0, probeSummary(r)).toBe(0);
  });

  it("(e) karar tutuşu notu: son misafir mesajı pencerenin DIŞINDA (ardından 65 ev sahibi mesajı) → not son misafir mesajının kaydından", async () => {
    const seeds: MsgSeed[] = [
      { id: mid(0), at: 0, direction: "inbound", body: "Otopark var mı?" },
      ...Array.from({ length: 65 }, (_, i) => ({ id: mid(i + 1), at: i + 1, direction: "outbound" as const, body: `Bilgi ${i}` })),
    ];
    const s = await seed(seeds, { skippedReason: "low_confidence_or_risky" });
    await prisma.riskEvent.create({
      data: {
        organizationId: s.orgId,
        conversationId: s.conversationId,
        surface: "auto_reply",
        triggerId: mid(0),
        finalDecision: "human_review",
        reason: HANDOFF_NOTICE_REASON,
      },
    });
    asOwner(s.orgId);
    const tree = await render(s.conversationId);
    expect(textOf(tree)).toContain(SKIP_REASON_LABELS[HANDOFF_NOTICE_REASON]);
    const t = threadOf(tree);
    expect(t.lastInboundMessageId).toBe(mid(0));
    expect(ids(t)).not.toContain(mid(0));
  });

  it("(e) hazır taslak: son iptalsiz cevap ve misafirin ilk isteği pencerenin DIŞINDA, pencerede yalnız İPTAL edilmiş cevap → taslak bütün geçmişle aynı", async () => {
    vi.stubEnv("AI_CONVERSATION_ITEMS_ENABLED", "1");
    const DRAFT = { reply: "Tabii, saat 12:00'de gelebilirsiniz.", intent: "general" };
    const seeds: MsgSeed[] = [
      { id: mid(0), at: 0, direction: "outbound", body: "Hoş geldiniz." },
      { id: mid(1), at: 1, direction: "inbound", body: "Erken giriş yapabilir miyiz?" },
      ...Array.from({ length: 63 }, (_, i) => ({ id: mid(i + 2), at: i + 2, direction: "inbound" as const, body: `Bir de şunu soracaktım ${i}` })),
      { id: mid(65), at: 65, direction: "outbound", body: "Eski yapay zekâ taslağı", authorType: "ai", outbox: "canceled" },
      ...Array.from({ length: 3 }, (_, i) => ({ id: mid(66 + i), at: 66 + i, direction: "inbound" as const, body: `Ek soru ${i}` })),
      { id: mid(69), at: 69, direction: "inbound", body: "Saat kaçta gelelim?", draft: DRAFT },
    ];
    const order = expectedOrder(seeds);
    const toDraftMsg = (id: string) => {
      const m = seeds.find((x) => x.id === id)!;
      return {
        id,
        direction: m.direction,
        body: m.body ?? "",
        authorType: m.authorType ?? (m.direction === "inbound" ? "guest" : "host"),
        aiSuggestedReply: m.draft?.reply ?? null,
        aiIntent: m.draft?.intent ?? null,
        aiConfidence: m.draft ? 0.9 : null,
      };
    };
    const opts = { stayTimes: { checkIn: "15:00", checkOut: "11:00" }, hostOfferText: null };
    const visible = (list: string[]) => list.filter((id) => id !== mid(65)).map(toDraftMsg);
    const full = preparedDraftOf(visible(order), opts);
    // Anti-vakumluk: pencereyle hesaplansaydı müsaitlik uyarısı FARKLI olurdu (ilk istek pencerenin dışında).
    expect(full).not.toBeNull();
    expect(preparedDraftOf(visible(order.slice(-60)), opts)).not.toEqual(full);
    const s = await seed(seeds);
    asOwner(s.orgId);
    expect(threadOf(await render(s.conversationId)).initialDraft).toEqual(full);
  });

  it("(e) karar kartı: talebin mesajı pencerenin DIŞINDA → alıntı ve 'sonra yazdı' bilgisi bütün geçmişle aynı", async () => {
    vi.stubEnv("HOST_DECISIONS_ENABLED", "1");
    const REQUEST = "Saat 13:00'te giriş yapabilir miyiz?";
    const seeds: MsgSeed[] = [
      { id: mid(0), at: 0, direction: "inbound", body: REQUEST },
      ...alternating(70).map((m, i) => ({ ...m, id: mid(i + 1), at: i + 1 })),
    ];
    const order = expectedOrder(seeds);
    const lastInbound = [...order].reverse().find((id) => seeds.find((m) => m.id === id)!.direction === "inbound")!;
    const s = await seed(seeds, { withReservation: true });
    const item = await prisma.conversationItem.create({
      data: { organizationId: s.orgId, conversationId: s.conversationId, messageId: mid(0), kind: "early_checkin", sources: "understanding", status: "pending_host" },
    });
    await prisma.decisionRequest.create({
      data: {
        organizationId: s.orgId,
        conversationId: s.conversationId,
        messageId: mid(0),
        itemId: item.id,
        reservationId: s.reservationId,
        kind: "early_checkin",
        requestedTime: "13:00",
        dayKey: stayDay(1).toISOString().slice(0, 10),
        lang: "tr",
      },
    });
    asOwner(s.orgId);
    const tree = await render(s.conversationId);
    expect(ids(threadOf(tree))).not.toContain(mid(0));
    const panel = propsOf<PanelProps>(tree, DecisionPanel);
    expect(panel.decisions).toHaveLength(1);
    expect(panel.decisions[0].requestQuote).toBe(requestQuoteOf(REQUEST));
    expect(panel.decisions[0].laterGuestMessageId).toBe(lastInbound);
  });
});

describe("sohbet ekranı penceresi — kiracı sınırı", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  it("(f) başka işletmenin konuşması (eski parametresiyle de) 404", async () => {
    const a = await seed(alternating(150), { orgName: "A" });
    const b = await prisma.organization.create({ data: { name: "B" } });
    asOwner(b.id);
    const variants: Record<string, string>[] = [{}, { eski: "1" }, { eski: "20" }];
    for (const sp of variants) {
      await expect(render(a.conversationId, sp)).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    }
  });
});
