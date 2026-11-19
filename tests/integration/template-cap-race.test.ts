import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// ÖZEL MESAJ ŞABLONU SINIRI EŞZAMANLI EKLEMEDE DE TUTAR (kurucu 11-19 akşam madde 1: "Limiti sunucuda eşzamanlı iki eklemenin de
// aşamayacağı şekilde"). Sayım + yazma tek işlemde, işletme başına danışma kilidi altında (`lib/template-cap.ts`); kilitsiz "say → yaz"da
// N−1'deki eşzamanlı istekler hepsi N−1 sayıp geçerdi.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST } from "@/app/api/templates/route";
import { __templateCapHooks, messageTemplateCapForOrg } from "@/lib/template-cap";

const post = (title: string) =>
  POST(
    new NextRequest("http://localhost/api/templates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, body: `${title} metni.`, category: "general", language: "tr", propertyId: null }),
    }),
    { params: Promise.resolve({}) },
  );

/**
 * Kilit sınaması (`tests/helpers/lock-probe.ts` kalıbının on istek için hızlı biçimi): kilitli bölgeye İLK giren istek `waitMs` boyunca eş
 * bekler. Kilit yoksa öteki istekler bu pencerede aynı sayımı okuyup bölgeye girer (`maxInside() ≥ 2`, birden çok kabul) — testin sonucu
 * `Promise.all` zamanlamasına değil kilidin kendisine bağlıdır. Kilit varsa kimse buluşmaz; sonraki istekler beklemeden geçer (≈ 1 sn).
 */
function firstEntryProbe(waitMs = 1_000) {
  let inside = 0;
  let maxInside = 0;
  let entries = 0;
  let wake: () => void = () => {};
  const partner = new Promise<void>((r) => (wake = r));
  return {
    entries: () => entries,
    maxInside: () => maxInside,
    async hook(): Promise<void> {
      entries += 1;
      inside += 1;
      maxInside = Math.max(maxInside, inside);
      if (inside >= 2) wake();
      if (entries === 1) await Promise.race([partner, new Promise<void>((r) => setTimeout(r, waitMs).unref?.())]);
      inside -= 1;
    },
  };
}

describe("şablon sınırı — eşzamanlı eklemeler", () => {
  let orgId = "";
  let cap = 0;
  const count = () => prisma.messageTemplate.count({ where: { organizationId: orgId } });

  beforeEach(async () => {
    await resetDb();
    orgId = (await makeOrgWithProperty()).orgId;
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
    cap = await messageTemplateCapForOrg(orgId);
    expect(cap).toBe(500); // başlangıç değeri (plan tablosu)
    for (let i = 0; i < cap - 1; i += 250) {
      await prisma.messageTemplate.createMany({
        data: Array.from({ length: Math.min(250, cap - 1 - i) }, (_, k) => ({
          organizationId: orgId,
          category: "general",
          title: `Şablon ${i + k}`,
          body: `Metin ${i + k}.`,
          language: "tr",
        })),
      });
    }
  });
  afterEach(() => {
    __templateCapHooks.afterCount = null;
  });

  it("🚨 499 şablon varken aynı anda 10 ekleme → tam 1 kabul, 9 sınır iletisiyle 400; toplam 500; kilitli bölgede aynı anda tek istek", async () => {
    const probe = firstEntryProbe();
    __templateCapHooks.afterCount = probe.hook;
    const res = await Promise.all(Array.from({ length: 10 }, (_, i) => post(`Eşzamanlı ${i}`)));
    expect(probe.entries()).toBe(10);
    expect(probe.maxInside()).toBe(1);
    expect(res.filter((r) => r.status === 201)).toHaveLength(1);
    const rejected = res.filter((r) => r.status === 400);
    expect(rejected).toHaveLength(9);
    for (const r of rejected) expect(JSON.stringify(await r.json())).toContain("Özel şablon sınırına ulaştınız");
    expect(await count()).toBe(cap);
  }, 30_000);

  it("KONTROL: sınırın altındaki eşzamanlı eklemelerin hepsi yazılır (kilit sıraya koyar, reddetmez)", async () => {
    const extra = await prisma.messageTemplate.findMany({ where: { organizationId: orgId }, select: { id: true }, take: 4 });
    await prisma.messageTemplate.deleteMany({ where: { id: { in: extra.map((e) => e.id) } } }); // cap − 5
    const res = await Promise.all(Array.from({ length: 3 }, (_, i) => post(`Alt ${i}`)));
    expect(res.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(await count()).toBe(cap - 2);
  });
});
