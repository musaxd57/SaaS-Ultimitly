import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { GET } from "@/app/api/kb/suggestions/route";

// ---------------------------------------------------------------------------
// KNOWLEDGE HUB BACAK B — OKUMA ROTASI (uçtan uca, GERÇEK DB).
//
// Saf çekirdek `tests/unit/kb-from-history.test.ts`'te pinli. Burada ölçülen şey
// ROTANIN kendisi: kiracı kapsamı, gerçek Prisma seçimi ve YAZMA YOKLUĞU.
//
// 🚨 KİRACI İZOLASYONU CLAUDE.md'de her yeni yol için ZORUNLU davranışsal test.
// ---------------------------------------------------------------------------

const req = (qs = "") => new NextRequest(`http://localhost/api/kb/suggestions${qs}`);
/** Rota ikinci argüman (route ctx) bekler; bu uçta dinamik parametre yok. */
const ctx = { params: Promise.resolve({}) } as never;

async function seedOrg(name: string) {
  const { orgId, propertyId } = await makeOrgWithProperty();
  await prisma.property.update({ where: { id: propertyId }, data: { name } });
  const user = await prisma.user.create({
    data: { organizationId: orgId, name: "O", email: `${name}-${Math.random()}@x.com`, passwordHash: "x", role: "owner" },
  });
  return { orgId, propertyId, userId: user.id };
}

let seq = 0;
/** Bir soru→cevap turu yazar; cevabı host mu AI mı yazdı seçilebilir. */
async function writeTurn(
  propertyId: string,
  question: string,
  answer: string,
  over: { senderName?: string; aiAssisted?: boolean; status?: string } = {},
) {
  seq += 1;
  const conv = await prisma.conversation.create({
    data: {
      propertyId,
      guestIdentifier: `g${seq}`,
      status: over.status ?? "answered",
      lastMessageAt: new Date(),
    },
  });
  const base = Date.now() - seq * 3_600_000;
  await prisma.message.create({
    data: {
      conversationId: conv.id,
      direction: "inbound",
      authorType: "guest",
      senderName: "Misafir",
      body: question,
      createdAt: new Date(base),
    },
  });
  await prisma.message.create({
    data: {
      conversationId: conv.id,
      direction: "outbound",
      authorType: over.senderName ? null : "host",
      senderName: over.senderName ?? "Musa",
      aiAssisted: over.aiAssisted ?? false,
      body: answer,
      createdAt: new Date(base + 60_000),
    },
  });
  return conv.id;
}

const body = async (r: Response) => (await r.json()) as {
  suggestions: { propertyId: string; propertyName: string | null; category: string; answer: string; occurrences: number }[];
  scanned: number;
  capped: boolean;
};

describe("GET /api/kb/suggestions — Bacak B okuma rotası", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  it("host iki kez cevaplamışsa ÖNERİ döner, mülk adıyla", async () => {
    const a = await seedOrg("Nuve 1");
    session = { userId: a.userId, organizationId: a.orgId, role: "owner", email: "a@x.com", name: "O", sessionEpoch: 0 };
    await writeTurn(a.propertyId, "Wifi şifresi nedir?", "Ağ NuveApt, şifre 12345678.");
    await writeTurn(a.propertyId, "wifi parolası ne acaba", "Şifre 12345678.");

    const out = await body(await GET(req(), ctx));
    expect(out.suggestions).toHaveLength(1);
    expect(out.suggestions[0].category).toBe("wifi");
    expect(out.suggestions[0].occurrences).toBe(2);
    expect(out.suggestions[0].propertyName).toBe("Nuve 1");
    expect(out.suggestions[0].answer).toContain("12345678");
  });

  it("🚨 KİRACI İZOLASYONU: başka org'un cevapları HİÇ görünmez", async () => {
    const a = await seedOrg("A dairesi");
    const b = await seedOrg("B dairesi");
    // B org'unda bol bol cevap var…
    await writeTurn(b.propertyId, "Wifi şifresi nedir?", "B-ORG-SIFRESI-9999.");
    await writeTurn(b.propertyId, "wifi parolası ne acaba", "B-ORG-SIFRESI-9999.");
    await writeTurn(b.propertyId, "Otopark var mı?", "B org otoparkı bina altında.");
    await writeTurn(b.propertyId, "park yeri var mı", "B org otoparkı bina altında.");

    // …ama A org'unun oturumuyla bakıyoruz.
    session = { userId: a.userId, organizationId: a.orgId, role: "owner", email: "a@x.com", name: "O", sessionEpoch: 0 };
    const out = await body(await GET(req(), ctx));
    expect(out.suggestions).toEqual([]);
    expect(JSON.stringify(out), "başka kiracının metni sızdı").not.toContain("B-ORG-SIFRESI");
    expect(out.scanned).toBe(0);
  });

  it("🚨 KENDİ AI ÇIKTIMIZ öneri üretmez (gerçek DB satırlarıyla)", async () => {
    const a = await seedOrg("Nuve 2");
    session = { userId: a.userId, organizationId: a.orgId, role: "owner", email: "a@x.com", name: "O", sessionEpoch: 0 };
    await writeTurn(a.propertyId, "Wifi şifresi nedir?", "Şifre AAA.", { senderName: "Lixus AI" });
    await writeTurn(a.propertyId, "wifi parolası ne acaba", "Şifre AAA.", { senderName: "GuestOps AI" });
    await writeTurn(a.propertyId, "wifi şifresi?", "Şifre AAA.", { aiAssisted: true });

    const out = await body(await GET(req(), ctx));
    expect(out.suggestions).toEqual([]);
    expect(out.scanned, "mesajlar okundu ama hiçbiri host cevabı sayılmadı").toBeGreaterThan(0);
  });

  it("'sorunlu' konuşma öneriye girmez (gerçek DB durumu)", async () => {
    const a = await seedOrg("Nuve 3");
    session = { userId: a.userId, organizationId: a.orgId, role: "owner", email: "a@x.com", name: "O", sessionEpoch: 0 };
    await writeTurn(a.propertyId, "Wifi şifresi nedir?", "Şifre İYİ-CEVAP.");
    await writeTurn(a.propertyId, "wifi parolası ne acaba", "Modem arızalı, kusura bakmayın.", { status: "problem" });

    const out = await body(await GET(req(), ctx));
    expect(out.suggestions, "tek geçerli cevap eşiği geçmemeli").toEqual([]);
    expect(JSON.stringify(out)).not.toContain("arızalı");
  });

  it("propertyId filtresi çalışır ve KAPSAM DIŞINA çıkmaz", async () => {
    const a = await seedOrg("Nuve 4");
    const other = await prisma.property.create({
      data: { organizationId: a.orgId, name: "Nuve 5", checkInTime: "15:00", checkOutTime: "11:00" },
    });
    session = { userId: a.userId, organizationId: a.orgId, role: "owner", email: "a@x.com", name: "O", sessionEpoch: 0 };
    await writeTurn(a.propertyId, "Wifi şifresi nedir?", "P4 şifresi AAA.");
    await writeTurn(a.propertyId, "wifi parolası ne acaba", "P4 şifresi AAA.");
    await writeTurn(other.id, "Otopark var mı?", "P5 otoparkı altta.");
    await writeTurn(other.id, "park yeri var mı", "P5 otoparkı altta.");

    const only = await body(await GET(req(`?propertyId=${other.id}`), ctx));
    expect(only.suggestions.map((s) => s.category)).toEqual(["parking"]);
    expect(JSON.stringify(only)).not.toContain("P4 şifresi");

    const all = await body(await GET(req(), ctx));
    expect(all.suggestions).toHaveLength(2);
  });

  it("🚨 SALT OKUMA: rota hiçbir KB kalemi ya da mesaj YAZMAZ", async () => {
    const a = await seedOrg("Nuve 6");
    session = { userId: a.userId, organizationId: a.orgId, role: "owner", email: "a@x.com", name: "O", sessionEpoch: 0 };
    await writeTurn(a.propertyId, "Wifi şifresi nedir?", "Şifre AAA.");
    await writeTurn(a.propertyId, "wifi parolası ne acaba", "Şifre AAA.");

    const before = {
      kb: await prisma.knowledgeBaseItem.count(),
      msg: await prisma.message.count(),
      conv: await prisma.conversation.count(),
    };
    await GET(req(), ctx);
    expect({
      kb: await prisma.knowledgeBaseItem.count(),
      msg: await prisma.message.count(),
      conv: await prisma.conversation.count(),
    }).toEqual(before);
  });

  it("veri yoksa boş döner (çökmez)", async () => {
    const a = await seedOrg("Nuve 7");
    session = { userId: a.userId, organizationId: a.orgId, role: "owner", email: "a@x.com", name: "O", sessionEpoch: 0 };
    const out = await body(await GET(req(), ctx));
    expect(out.suggestions).toEqual([]);
    expect(out.scanned).toBe(0);
    expect(out.capped).toBe(false);
  });
});
