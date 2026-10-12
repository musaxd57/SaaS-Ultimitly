// ---------------------------------------------------------------------------
// MADDE 10 — kesit öncesi cevap toplamları (`conversationStatePriorTotals`) SQL'de sayılır; kural `replyAuthor` (JS) ile BİREBİR
// olmalı: giden · sistem olayı değil (boş dize = yok, JS doğruluk kuralı) · gövde `trim()` sonrası boş değil (JS boşluk kümesi:
// WhiteSpace + LineTerminator + Unicode Zs — U+0085 ve U+200B BOŞLUK DEĞİL) · yazar yapay zekâ / ev sahibi (yazar alanı boş dize
// ise görünen ad kuralı). Özellik testi: tohumlu rastgele satırlar gerçek PostgreSQL'e yazılır, her sınırda iki sayım eşit.
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeAll } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { replyAuthor } from "@/lib/ai/conversation-state";
import { conversationStatePriorTotals } from "@/lib/ai/conversation-state-loader";

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)];

// JS `trim()` boşlukları + tuzaklar (boşluk OLMAYAN görünmezler).
const WS = [" ", "\t", "\n", "\v", "\f", "\r", " ", " ", " ", " ", " ", " ", " ", " ", " ", "　", "﻿"];
const NOT_WS = ["\u0085", "​", "᠎", "x", "Merhaba", "."];

describe("kesit öncesi cevap toplamları — SQL = JS `replyAuthor`", () => {
  let conversationId = "";
  let rows: { id: string; createdAt: Date; direction: string; senderName: string; authorType: string | null; systemEventType: string | null; body: string }[] = [];

  beforeAll(async () => {
    await resetDb();
    const { propertyId } = await makeOrgWithProperty();
    const c = await prisma.conversation.create({ data: { propertyId, guestIdentifier: "G", channel: "airbnb", status: "new" } });
    conversationId = c.id;
    const r = rng(20261012);
    const t0 = Date.now() - 10 * 86_400_000;
    rows = Array.from({ length: 600 }, (_, i) => {
      const blank = r() < 0.4;
      const body = blank
        ? Array.from({ length: Math.floor(r() * 4) }, () => pick(r, WS)).join("")
        : Array.from({ length: 1 + Math.floor(r() * 3) }, () => pick(r, [...WS, ...NOT_WS])).join("") + (r() < 0.5 ? pick(r, NOT_WS) : "");
      return {
        id: `p${String(i).padStart(4, "0")}${pick(r, ["a", "b"])}`,
        // Eşit damga ara sıra (kimlik kopma noktası).
        createdAt: new Date(t0 + Math.floor(i / (r() < 0.2 ? 2 : 1)) * 60_000),
        direction: pick(r, ["inbound", "outbound", "outbound"]),
        senderName: pick(r, ["GuestOps AI", "Lixus AI", "__lixus_ai_resumed__", "Ev sahibi", "Ayşe"]),
        authorType: pick(r, [null, null, "", "ai", "host", "guest", "automation", "system"]),
        systemEventType: pick(r, [null, null, null, "", "guest_chat_ai_resumed"]),
        body,
      };
    });
    await prisma.message.createMany({ data: rows.map((m) => ({ ...m, conversationId })) });
    rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  });

  it("🚨 her sınır ve süzülen kimlik kümesinde iki sayım eşit (anti-vakumluk: boş / dolu / ev sahibi / yapay zekâ hepsi var)", async () => {
    const r = rng(7);
    // Anti-vakumluk: üretilen kümede her sınıftan satır var.
    expect(rows.some((m) => replyAuthor(m) === "host")).toBe(true);
    expect(rows.some((m) => replyAuthor(m) === "ai")).toBe(true);
    expect(rows.some((m) => m.direction === "outbound" && m.body.trim() === "" && m.body.length > 0)).toBe(true);
    expect(rows.some((m) => m.direction === "outbound" && /^[\u0085​᠎]+$/.test(m.body))).toBe(true);
    // BÜTÜN sınırlar (sınır satırının kendisi sayılmamalı — `<` ↔ `<=` farkı her cevap satırında görünür).
    for (let cut = 0; cut < rows.length; cut++) {
      const boundary = rows[cut];
      const excluded = rows.slice(0, cut).filter(() => r() < 0.1).map((m) => m.id);
      const ex = new Set(excluded);
      const before = rows.slice(0, cut).filter((m) => !ex.has(m.id));
      const js = {
        outbound: before.filter((m) => replyAuthor(m) !== null).length,
        hostOutbound: before.filter((m) => replyAuthor(m) === "host").length,
      };
      const sql = await conversationStatePriorTotals({ conversationId, before: { id: boundary.id }, excludedIds: excluded });
      expect(sql, `sınır ${cut}`).toEqual(js);
    }
  });

  it("🚨 veritabanı oturum saat dilimi UTC DEĞİLKEN de aynı sayım (kesit sınırı ORM ile, sayım ham SQL ile — kaymamalı)", async () => {
    const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
    await prisma.$executeRawUnsafe(`ALTER DATABASE "${db}" SET timezone TO 'Pacific/Kiritimati'`);
    await prisma.$disconnect(); // yeni bağlantılar yeni saat dilimiyle açılır
    try {
      const [{ tz }] = await prisma.$queryRaw<{ tz: string }[]>`SELECT current_setting('TimeZone') AS tz`;
      expect(tz).toBe("Pacific/Kiritimati"); // anti-vakumluk: deneme gerçekten UTC dışında
      for (const cut of [37, 300, 451]) {
        const boundary = rows[cut];
        const before = rows.slice(0, cut);
        const js = {
          outbound: before.filter((m) => replyAuthor(m) !== null).length,
          hostOutbound: before.filter((m) => replyAuthor(m) === "host").length,
        };
        const sql = await conversationStatePriorTotals({ conversationId, before: { id: boundary.id }, excludedIds: [] });
        expect(sql, `sınır ${cut}`).toEqual(js);
      }
    } finally {
      await prisma.$executeRawUnsafe(`ALTER DATABASE "${db}" RESET timezone`);
      await prisma.$disconnect();
    }
  });

  it("başka konuşmanın satırları sayılmaz (kiracı / konuşma kapsamı)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const other = await prisma.conversation.create({ data: { propertyId, guestIdentifier: "H", channel: "airbnb", status: "new" } });
    await prisma.message.create({
      data: { conversationId: other.id, direction: "outbound", authorType: "host", senderName: "Ev sahibi", body: "Cevap", createdAt: new Date(0) },
    });
    const last = rows[rows.length - 1];
    const sql = await conversationStatePriorTotals({ conversationId: other.id, before: { id: last.id }, excludedIds: [] });
    expect(sql).toEqual({ outbound: 1, hostOutbound: 1 });
  });
});
