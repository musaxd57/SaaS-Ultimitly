import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST } from "@/app/api/reservations/import/route";
import { RESERVATION_TASKS_TX } from "@/lib/automation";

// ---------------------------------------------------------------------------
// KİMLİKSİZ CSV — EŞ ZAMANLI İKİ YÜKLEME (idempotency denetimi 10-15, P2).
// Ölçülen boşluk: sınıflandırma "bu misafir + tarih var mı?" sorusunu kilitsiz soruyordu → aynı dosya iki sekmeden / çift tıkla aynı anda
// yüklenince ikisi de "yok" görüp ÇİFT rezervasyon (+ çift görev, + sahte takvim çakışması) açıyordu. Düzeltme: kontrol yazma işleminin
// işletme kilidi altında tekrarlanır; ikinci yükleme satırı "zaten var" sayar (yeniden yüklemeyle aynı sonuç, yeni hata metni yok).
// ---------------------------------------------------------------------------

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const CSV = [
  "guest_name,arrival,departure",
  `Ada Guest,${ymd(daysFromNow(10))},${ymd(daysFromNow(13))}`,
  `Bora Guest,${ymd(daysFromNow(20))},${ymd(daysFromNow(22))}`,
].join("\n");

function importReq(propertyId: string, csv: string) {
  const form = new FormData();
  form.set("file", new File([csv], "rez.csv", { type: "text/csv" }));
  form.set("propertyId", propertyId);
  return new NextRequest("http://localhost/api/reservations/import", { method: "POST", body: form });
}

describe("POST /api/reservations/import — eş zamanlı kimliksiz yükleme", () => {
  let propertyId: string;

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const made = await makeOrgWithProperty();
    propertyId = made.propertyId;
    session = { userId: "u", organizationId: made.orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("🚨 aynı dosya aynı anda iki kez → her misafir TEK rezervasyon, TEK temizlik görevi; toplam içe aktarılan 2", async () => {
    const ctx = { params: Promise.resolve({}) };
    const [r1, r2] = await Promise.all([POST(importReq(propertyId, CSV), ctx), POST(importReq(propertyId, CSV), ctx)]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    const [j1, j2] = (await Promise.all([r1.json(), r2.json()])) as Array<{ imported: number; skipped: number }>;
    expect(j1.imported + j2.imported).toBe(2);
    expect(j1.skipped + j2.skipped).toBe(2);
    expect(await prisma.reservation.count({ where: { propertyId } })).toBe(2);
    for (const name of ["Ada Guest", "Bora Guest"]) {
      const r = await prisma.reservation.findFirstOrThrow({ where: { propertyId, guestName: name } });
      expect(await prisma.task.count({ where: { reservationId: r.id, type: "cleaning" } })).toBe(1);
    }
  });

  it("aşırı uygulama yok: aynı misafirin FARKLI tarihli satırı ayrı rezervasyondur", async () => {
    const other = ["guest_name,arrival,departure", `Ada Guest,${ymd(daysFromNow(30))},${ymd(daysFromNow(32))}`].join("\n");
    const ctx = { params: Promise.resolve({}) };
    await Promise.all([POST(importReq(propertyId, CSV), ctx), POST(importReq(propertyId, other), ctx)]);
    expect(await prisma.reservation.count({ where: { propertyId, guestName: "Ada Guest" } })).toBe(2);
  });

  it("görev açma hatası satırı 'Kaydedilemedi' yapmaz: rezervasyonlar kaydedildi ve öyle sayılır (Opus 10-15 B4)", async () => {
    const realTx = prisma.$transaction.bind(prisma);
    vi.spyOn(prisma, "$transaction").mockImplementation(((arg: unknown, opts?: unknown) => {
      if (opts === RESERVATION_TASKS_TX) return Promise.reject(new Error("pool timeout"));
      return (realTx as (a: unknown, o?: unknown) => Promise<unknown>)(arg, opts);
    }) as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(importReq(propertyId, CSV), { params: Promise.resolve({}) });
    const j = (await res.json()) as { imported: number; errors: string[] };
    expect(j.imported).toBe(2);
    expect(j.errors).toEqual([]);
    expect(await prisma.reservation.count({ where: { propertyId } })).toBe(2);
  });
});
