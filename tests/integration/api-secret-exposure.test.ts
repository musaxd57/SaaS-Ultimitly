import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { GET as listProperties, POST as createProperty } from "@/app/api/properties/route";
import { GET as getProperty, PATCH as patchProperty } from "@/app/api/properties/[id]/route";

// ---------------------------------------------------------------------------
// MÜLK API'LERİ BEARER SIRLARINI YANITA KOYMAZ — DAVRANIŞSAL PİN (08-07).
//
// ⚠️ Bu dosya bilinçli olarak DAVRANIŞSALDIR. Eskiden bu değişmez yalnız kaynak
// taramasıyla pinliydi (`expect(src).toContain("stripPropertySecrets")`) ve
// ÖLÇÜLDÜ: o tarama iki gerçekçi gerilemeyi birden KAÇIRIYOR —
//  (1) `toContain` fonksiyonun AYNI DOSYADAKİ TANIMIYLA da tatmin oluyor, yani
//      her çağrı yeri silinse bile tarama YEŞİL kalıyor;
//  (2) olumsuz regex yalnız bildiği DEĞİŞKEN ADLARINI tanıyor, `return
//      jsonOk(rows)` gibi yeniden adlandırılmış bir dönüş sızdırıyor ve yine
//      YEŞİL kalıyor.
// Sızan iki alan da BEARER KİMLİK BİLGİSİ: `icalToken` herkese açık takvim
// akışını, `chatToken` misafir sohbeti yüzeyini açıyor. Tek doğru soru
// "yanıtın İÇİNDE var mı" ve buna ancak rotayı çağırarak cevap verilir.
// ---------------------------------------------------------------------------

const SECRETS = ["icalToken", "chatToken"] as const;

/** Gövdenin HERHANGİ bir derinliğinde yasak anahtar var mı? */
function findSecretKeys(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => findSecretKeys(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      (SECRETS as readonly string[]).includes(k)
        ? [`${path}.${k}`]
        : findSecretKeys(v, `${path}.${k}`),
    );
  }
  return [];
}

const noCtx = { params: Promise.resolve({} as Record<string, never>) };

describe("mülk API'leri bearer sırlarını sızdırmaz", () => {
  let orgId: string;
  let propertyId: string;

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const org = await prisma.organization.create({ data: { name: "Lale" } });
    orgId = org.id;
    // ⚠️ Sırlar ŞEMA VARSAYILANI DEĞİL, rota tarafından üretiliyor — düz bir
    // `prisma.create` ikisini de NULL bırakır ve aşağıdaki testlerin hepsi
    // sessizce vacuous olurdu ("boş alan zaten sızmaz"). Bu yüzden hem açıkça
    // dolduruluyor hem de ayrı bir ön koşul testi bunu asserte ediyor.
    const p = await prisma.property.create({
      data: {
        organizationId: orgId,
        name: "Daire 1",
        icalToken: "ical-" + "a".repeat(59),
        chatToken: "chat-" + "b".repeat(59),
      },
      select: { id: true },
    });
    propertyId = p.id;
    session = {
      userId: "u",
      organizationId: orgId,
      role: "owner",
      email: "o@x.com",
      name: "O",
      sessionEpoch: 0,
    };
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Sırların DB'de GERÇEKTEN dolu olduğunu doğrula — yoksa test hiçbir şey
   *  ölçmez: boş bir alan zaten "sızmaz" ve pin sessizce anlamsızlaşırdı. */
  it("ön koşul: satırda sırlar dolu (yoksa aşağıdaki testler vacuous olurdu)", async () => {
    const row = await prisma.property.findUniqueOrThrow({
      where: { id: propertyId },
      select: { icalToken: true, chatToken: true },
    });
    expect(row.icalToken, "icalToken boş — pin ölçüm yapamaz").toBeTruthy();
    expect(row.chatToken, "chatToken boş — pin ölçüm yapamaz").toBeTruthy();
  });

  it("GET /api/properties (liste) sır taşımaz", async () => {
    const res = await listProperties(
      new NextRequest("http://localhost/api/properties"),
      noCtx as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(findSecretKeys(body), "listede sır").toEqual([]);
  });

  it("POST /api/properties (oluşturma yanıtı) sır taşımaz", async () => {
    const res = await createProperty(
      new NextRequest("http://localhost/api/properties", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Daire 2" }),
      }),
      noCtx as never,
    );
    expect([200, 201]).toContain(res.status);
    expect(findSecretKeys(await res.json()), "oluşturma yanıtında sır").toEqual([]);
  });

  it("GET /api/properties/[id] sır taşımaz", async () => {
    const res = await getProperty(
      new NextRequest(`http://localhost/api/properties/${propertyId}`),
      { params: Promise.resolve({ id: propertyId }) } as never,
    );
    expect(res.status).toBe(200);
    expect(findSecretKeys(await res.json()), "tekil GET'te sır").toEqual([]);
  });

  it("PATCH /api/properties/[id] sır taşımaz", async () => {
    const res = await patchProperty(
      new NextRequest(`http://localhost/api/properties/${propertyId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Yeni ad" }),
      }),
      { params: Promise.resolve({ id: propertyId }) } as never,
    );
    expect(res.status).toBe(200);
    expect(findSecretKeys(await res.json()), "PATCH yanıtında sır").toEqual([]);
  });

  it("ham gövde metninde de token DEĞERİ geçmiyor (anahtar adı değişse bile)", async () => {
    // Anahtar adına bakan kontrol, alanı `feedToken` diye yeniden adlandıran
    // bir gerilemeyi kaçırır. Bu yüzden DEĞERİN kendisini arıyoruz.
    const row = await prisma.property.findUniqueOrThrow({
      where: { id: propertyId },
      select: { icalToken: true, chatToken: true },
    });
    const res = await getProperty(
      new NextRequest(`http://localhost/api/properties/${propertyId}`),
      { params: Promise.resolve({ id: propertyId }) } as never,
    );
    const text = await res.text();
    expect(text).not.toContain(row.icalToken);
    expect(text).not.toContain(row.chatToken);
  });
});
