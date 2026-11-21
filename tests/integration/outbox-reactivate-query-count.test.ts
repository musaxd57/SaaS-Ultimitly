import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// `reactivateBlockedOutbox` — SORGU MALİYETİ + DAVRANIŞ EŞDEĞERLİĞİ (O1 optimizasyonu, 11-19).
//
// Zamanlanmış geçiş her BAŞARILI senkrondan sonra işletme başına bu fonksiyonu çağırır (2 dakikada bir). İki `updateMany` her birinde
// BEGIN / UPDATE / COMMIT (6 SQL) koşuyordu — kuyrukta `blocked` satır HİÇ yokken de (bugün her işletmenin olağan hâli). Artık önce tek
// dizinli okuma (`organizationId, status` dizini): `blocked` satır yoksa yazma yok.
// Eşdeğerlik: eski uygulama bu dosyada KÂHİN olarak durur; aynı fikstürde eski ve yeni yolun dönen sayısı ve satırların son hâli birebir.
// Ön okuma yazmaların WHERE'inin ÜST KÜMESİdir (aynı işletme + `blocked`) → okuma boş diyorsa iki yazma o anda da hiçbir satıra
// dokunmazdı; sonuç, eski yolun okuma anında koşmuş hâliyle aynıdır (yeni sonuç türü yok).
// ---------------------------------------------------------------------------

const counter = vi.hoisted(() => ({ on: false, rows: [] as string[] }));
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const client = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
  (client as unknown as { $on(e: string, cb: (e: { query: string }) => void): void }).$on("query", (e) => {
    if (counter.on) counter.rows.push(e.query);
  });
  return { prisma: client };
});

import { prisma, resetDb } from "../helpers/db";
import { flushQueryEvents } from "../helpers/query-event-barrier";
import { ANON_BODY } from "@/lib/data-retention";
import { reactivateBlockedOutbox, CHANNEL_PAUSED_STALE_MARK } from "@/lib/outbox/worker";

/** KÂHİN: değişiklikten ÖNCEKİ uygulama, satırı satırına (yalnız `prisma` yerel). */
async function oracleReactivate(organizationId: string, now: Date): Promise<number> {
  const stale = await prisma.messageOutbox.updateMany({
    where: { organizationId, status: "blocked", cancelRequestedAt: null, body: { not: ANON_BODY }, messageType: { in: ["ai", "holding_ack"] } },
    data: {
      status: "pending",
      attemptCount: 0,
      availableAt: now,
      claimedBy: null,
      claimExpiresAt: null,
      lastErrorKind: null,
      lastErrorCode: CHANNEL_PAUSED_STALE_MARK,
    },
  });
  const res = await prisma.messageOutbox.updateMany({
    where: { organizationId, status: "blocked", cancelRequestedAt: null, body: { not: ANON_BODY } },
    data: {
      status: "pending",
      attemptCount: 0,
      availableAt: now,
      claimedBy: null,
      claimExpiresAt: null,
      lastErrorKind: null,
      lastErrorCode: null,
    },
  });
  return res.count + stale.count;
}

const T0 = new Date("2026-03-01T10:00:00.000Z");

/** Aynı biçimli fikstür (her işletmeye ayrı): reaktive edilecek / edilmeyecek her sınıftan bir satır. */
async function seedRows(organizationId: string, tag: string) {
  const base = {
    organizationId,
    channel: "airbnb",
    externalReservationId: `ext-${tag}`,
    attemptCount: 3,
    availableAt: T0,
    claimedBy: "w-1",
    claimExpiresAt: T0,
    lastErrorKind: "definitive_failure",
    lastErrorCode: "HTTP 402",
  };
  const rows: { key: string; data: Record<string, unknown> }[] = [
    { key: "blocked-ai", data: { status: "blocked", messageType: "ai", body: "Merhaba" } },
    { key: "blocked-ack", data: { status: "blocked", messageType: "holding_ack", body: "Bakıyoruz" } },
    { key: "blocked-welcome", data: { status: "blocked", messageType: "welcome", body: "Hoş geldiniz" } },
    { key: "blocked-manual", data: { status: "blocked", messageType: "manual", body: "Elle" } },
    { key: "blocked-legacy", data: { status: "blocked", messageType: null, body: "Eski" } },
    { key: "blocked-cancel-req", data: { status: "blocked", messageType: "ai", body: "İptal istendi", cancelRequestedAt: T0 } },
    { key: "blocked-anon", data: { status: "blocked", messageType: "ai", body: ANON_BODY } },
    { key: "pending", data: { status: "pending", messageType: "ai", body: "Bekleyen" } },
    { key: "failed", data: { status: "failed", messageType: "welcome", body: "Düşen" } },
    { key: "review", data: { status: "review", messageType: "ai", body: "İnceleme" } },
  ];
  for (const r of rows) {
    await prisma.messageOutbox.create({ data: { ...base, ...r.data, idempotencyKey: `${tag}:${r.key}` } as never });
  }
}

async function snapshot(organizationId: string, tag: string) {
  const rows = await prisma.messageOutbox.findMany({
    where: { organizationId },
    select: {
      idempotencyKey: true,
      status: true,
      attemptCount: true,
      availableAt: true,
      claimedBy: true,
      claimExpiresAt: true,
      lastErrorKind: true,
      lastErrorCode: true,
      body: true,
      messageType: true,
      cancelRequestedAt: true,
    },
    orderBy: { idempotencyKey: "asc" },
  });
  return rows.map((r) => ({ ...r, idempotencyKey: r.idempotencyKey.slice(tag.length + 1) }));
}

async function newOrg(name: string) {
  return (await prisma.organization.create({ data: { name } })).id;
}

async function countQueries<T>(fn: () => Promise<T>): Promise<{ result: T; queries: string[] }> {
  counter.rows = [];
  counter.on = true;
  try {
    const result = await fn();
    await flushQueryEvents(prisma, counter); // son sorgunun olayı sonuçtan sonra gelebilir (CI 1841)
    return { result, queries: [...counter.rows] };
  } finally {
    counter.on = false;
  }
}

describe("reactivateBlockedOutbox — kâhinle eşdeğerlik", () => {
  beforeEach(resetDb);

  it("her satır sınıfında dönen sayı ve satırların son hâli eski uygulamayla birebir", async () => {
    const oracleOrg = await newOrg("Kâhin");
    const subjectOrg = await newOrg("Yeni");
    const bystander = await newOrg("Komşu");
    await seedRows(oracleOrg, "o");
    await seedRows(subjectOrg, "s");
    await seedRows(bystander, "b");
    const now = new Date("2026-03-02T08:00:00.000Z");

    const expected = await oracleReactivate(oracleOrg, now);
    const got = await reactivateBlockedOutbox(subjectOrg, now);

    expect(got).toBe(expected);
    // ai + holding_ack (bayat işaretiyle) + welcome + manual + eski (messageType yok); iptal istenmiş ve gövdesi silinmiş satır dirilmez.
    expect(got).toBe(5);
    expect(await snapshot(subjectOrg, "s")).toEqual(await snapshot(oracleOrg, "o"));
    // Komşu işletmenin satırlarına dokunulmadı (kiracı sınırı).
    expect((await snapshot(bystander, "b")).filter((r) => r.status === "blocked")).toHaveLength(7);
  });

  it("blocked satır yokken eski ve yeni yol aynı (0, hiçbir satır değişmez)", async () => {
    const oracleOrg = await newOrg("Kâhin");
    const subjectOrg = await newOrg("Yeni");
    for (const [org, tag] of [
      [oracleOrg, "o"],
      [subjectOrg, "s"],
    ] as const) {
      await prisma.messageOutbox.create({
        data: { organizationId: org, channel: "airbnb", body: "Bekleyen", idempotencyKey: `${tag}:p`, status: "pending", availableAt: T0 },
      });
    }
    const now = new Date("2026-03-02T08:00:00.000Z");
    expect(await reactivateBlockedOutbox(subjectOrg, now)).toBe(await oracleReactivate(oracleOrg, now));
    expect(await snapshot(subjectOrg, "s")).toEqual(await snapshot(oracleOrg, "o"));
  });
});

describe("reactivateBlockedOutbox — sorgu sayısı pini", () => {
  beforeEach(resetDb);

  it("🚨 blocked satır YOKKEN tek okuma, YAZMA YOK (eskiden 2 × BEGIN/UPDATE/COMMIT)", async () => {
    const org = await newOrg("Boş kuyruk");
    // Başka işletmenin `blocked` satırı ve bu işletmenin başka durumdaki satırları ön okumayı yanıltmaz.
    const other = await newOrg("Komşu");
    await seedRows(other, "b");
    await prisma.messageOutbox.create({
      data: { organizationId: org, channel: "airbnb", body: "x", idempotencyKey: "p", status: "pending", availableAt: T0 },
    });
    const { result, queries } = await countQueries(() => reactivateBlockedOutbox(org));
    expect(result).toBe(0);
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatch(/^SELECT/);
    expect(queries.some((q) => /^\s*UPDATE/i.test(q))).toBe(false);
  });

  it("blocked satır VARKEN iki koşullu yazma aynen koşar (ön okuma + eski iki updateMany)", async () => {
    const org = await newOrg("Dolu kuyruk");
    await seedRows(org, "s");
    const { result, queries } = await countQueries(() => reactivateBlockedOutbox(org));
    expect(result).toBe(5);
    expect(queries.filter((q) => /^\s*UPDATE/i.test(q))).toHaveLength(2);
  });
});
