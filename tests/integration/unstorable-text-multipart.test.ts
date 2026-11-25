import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// G2 YENİDEN ÜRETME (11-19) — A-1 sınıfının (sızma testi 11-14) açık kalan komşusu: ÇOK PARÇALI (multipart) gövde.
// 11-14 düzeltmesi NUL'u adreste (`withAuth urlCarriesNul`) ve JSON gövdede (`parseJsonWithoutNul`) kapattı. Çok parçalı form alanı
// ve CSV dosyasının içeriği bu iki kapının hiçbirinden geçmiyor: NUL'lu değer doğrudan Prisma sorgusuna gidiyor → PostgreSQL hatası →
// 500 + `reportError("api")` (10 dakikalık ortak "api" e-posta kovası). Bu test ÜRÜN KODUNU DEĞİŞTİRMEZ; kırmızısı kanıttır.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
const reported: string[] = [];
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return {
    ...actual,
    reportError: vi.fn(async (context: string) => {
      reported.push(context);
      return { notified: false, throttled: false, configured: false };
    }),
  };
});
// Yükleme yolu yalnız depolama açıkken göreve bağlanır (üretimde STORAGE_ENABLED açık — RAILWAY-ACILIS §1).
vi.mock("@/lib/storage/config", async (orig) => {
  const actual = await orig<typeof import("@/lib/storage/config")>();
  return { ...actual, storageUploadsEnabled: () => true };
});
vi.mock("@/lib/storage/adapter", async (orig) => {
  const actual = await orig<typeof import("@/lib/storage/adapter")>();
  const { FakeStorageAdapter } = await import("../helpers/fake-storage");
  const fake = new FakeStorageAdapter();
  return { ...actual, getStorageAdapter: () => fake };
});

import { NextRequest } from "next/server";
import { POST as importPost } from "@/app/api/reservations/import/route";
import { POST as uploadPost } from "@/app/api/upload/route";
import { __resetRateLimit } from "@/lib/rate-limit";

const noParams = { params: Promise.resolve({}) };

function importReq(propertyId: string, csv: string) {
  const form = new FormData();
  form.set("file", new File([csv], "rez.csv", { type: "text/csv" }));
  form.set("propertyId", propertyId);
  return new NextRequest("http://localhost/api/reservations/import", { method: "POST", body: form });
}

// Gerçek küçük PNG (K27-K11: yükleme biçimin kabuğunu yürür; çıplak başlık artık kabul edilmez).
const PNG = readFileSync(join(process.cwd(), "tests/fixtures/images/rgba.png"));
function uploadReq(taskId: string) {
  const form = new FormData();
  form.set("file", new File([PNG], "p.png", { type: "image/png" }));
  form.set("taskId", taskId);
  return new NextRequest("http://localhost/api/upload", { method: "POST", body: form });
}

describe("(G2 11-19) çok parçalı gövdede NUL — 500 / uyarı kovası YOK", () => {
  let orgId: string;
  let propertyId: string;

  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    reported.length = 0;
    const made = await makeOrgWithProperty();
    orgId = made.orgId;
    propertyId = made.propertyId;
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("KONTROL: geçersiz (NUL'suz) daire kimliği → 400, alarm yok", async () => {
    const res = await importPost(importReq("yok-boyle-daire", "guest_name,arrival,departure\nAda,2026-07-10,2026-07-14"), noParams);
    expect(res.status).toBe(400);
    expect(reported).not.toContain("api");
  });

  it("🚨 içe aktarma: propertyId alanında NUL → 400 (hız sınırından ÖNCE)", async () => {
    const res = await importPost(importReq("abc\u0000def", "guest_name,arrival,departure\nAda,2026-07-10,2026-07-14"), noParams);
    expect({ status: res.status, reported }).toEqual({ status: 400, reported: [] });
  });

  it("🚨 içe aktarma: CSV referans sütununda NUL → 500 olmamalı, alarm kovasına yazmamalı", async () => {
    const csv = "guest_name,arrival,departure,reference\nAda,2026-07-10,2026-07-14,HM\u0000X1";
    const res = await importPost(importReq(propertyId, csv), noParams);
    expect(res.status).not.toBe(500);
    expect(reported).not.toContain("api");
  });

  it("🚨 yükleme (personel de çağırabilir): taskId alanında NUL → 404", async () => {
    session = { ...session, role: "staff" };
    const res = await uploadPost(uploadReq("t\u0000x"), noParams);
    expect({ status: res.status, reported }).toEqual({ status: 404, reported: [] });
  });

  it("KONTROL: yükleme, olmayan görev (NUL'suz) → 404, alarm yok", async () => {
    session = { ...session, role: "staff" };
    const res = await uploadPost(uploadReq("yok-boyle-gorev"), noParams);
    expect(res.status).toBe(404);
    expect(reported).not.toContain("api");
  });
});
