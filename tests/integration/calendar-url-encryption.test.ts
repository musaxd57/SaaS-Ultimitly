import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";
import { decryptSecretBound, encryptSecretBound, encryptionKeyFingerprint } from "@/lib/crypto";
import {
  backfillCalendarSourceUrlEnc,
  encryptCalendarSourceUrl,
  getCalendarSourceUrl,
} from "@/lib/calendar-source-url";

vi.mock("@/lib/net/pinned-fetch", () => ({ fetchFeedText: vi.fn() }));

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST as createSource } from "@/app/api/properties/[id]/calendar-sources/route";
import { syncCalendarSource } from "@/lib/import/sync";
import { fetchFeedText } from "@/lib/net/pinned-fetch";
import { buildOrganizationDataExport } from "@/lib/data-export";

// ---------------------------------------------------------------------------
// CalendarSource.url at-rest şifreleme — Faz 1-3 (expand-contract, tasarım:
// docs/CALENDAR-URL-ENCRYPTION-DESIGN.md). Feed URL'i query-string'de kimlik
// bilgisi taşır; bu testler üç şeyi pinler:
//
//   FAZ 1  create DUAL-WRITE: url + urlEnc + urlKeyFp birlikte yazılır; AAD
//          satıra ve org'a bağlıdır (ciphertext-swap kapalı).
//   FAZ 2  backfill: idempotent, batch'li, yalnız urlEnc IS NULL satırlara.
//   FAZ 3  dual-read FAIL-CLOSED: bozuk/uyumsuz urlEnc → sync O KAYNAĞI
//          ATLAR ve düz metne ASLA düşmez (düşerse şifreleme dekor olurdu);
//          legacy satır (urlEnc NULL) geçiş penceresinde düz metinle çalışır.
//          Export'a ne düz URL ne ciphertext sızar.
// ---------------------------------------------------------------------------

const FEED = "https://ical.example.com/feed.ics?s=cok-gizli-secret-abc123";

let orgId = "";
let propertyId = "";

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  const org = await prisma.organization.create({ data: { name: "Org" } });
  orgId = org.id;
  const user = await prisma.user.create({
    data: { organizationId: orgId, name: "Owner", email: "o@x.com", passwordHash: "x", role: "owner" },
  });
  const property = await prisma.property.create({ data: { organizationId: orgId, name: "Daire 1" } });
  propertyId = property.id;
  session = { userId: user.id, organizationId: orgId, role: "owner", email: "o@x.com", name: "Owner", sessionEpoch: 0 };
});

function createReq(url: string) {
  return new NextRequest(`http://localhost/api/properties/${propertyId}/calendar-sources`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label: "Airbnb", url }),
  });
}
const ctx = () => ({ params: Promise.resolve({ id: propertyId }) });

describe("FAZ 1 — create rotası dual-write", () => {
  it("url + urlEnc + urlKeyFp üçü birden yazılır ve urlEnc kendi AAD'siyle açılır", async () => {
    const res = await createSource(createReq(FEED), ctx());
    expect(res.status).toBe(201);
    const row = await prisma.calendarSource.findFirstOrThrow({ where: { propertyId } });
    expect(row.url).toBe(FEED); // düz kolon Faz 4'e kadar otorite
    expect(row.urlEnc).toBeTruthy();
    expect(row.urlKeyFp).toBe(encryptionKeyFingerprint());
    expect(decryptSecretBound(row.urlEnc!, `calendar-source-url:v1:${row.id}:${orgId}`)).toBe(FEED);
  });

  it("AAD satıra VE org'a bağlı: başka satırın/org'un bağlamıyla AÇILMAZ", async () => {
    await createSource(createReq(FEED), ctx());
    const row = await prisma.calendarSource.findFirstOrThrow({ where: { propertyId } });
    expect(() => decryptSecretBound(row.urlEnc!, `calendar-source-url:v1:BASKA-SATIR:${orgId}`)).toThrow();
    expect(() => decryptSecretBound(row.urlEnc!, `calendar-source-url:v1:${row.id}:BASKA-ORG`)).toThrow();
  });
});

describe("FAZ 2 — backfill: idempotent, batch'li, yalnız NULL satırlar", () => {
  it("legacy satırları şifreler; ikinci koşu no-op; dolu satıra dokunmaz", async () => {
    // Legacy satırlar: rota DEĞİL doğrudan DB (dual-write öncesi dünya).
    const legacy1 = await prisma.calendarSource.create({ data: { propertyId, label: "L1", url: FEED } });
    const legacy2 = await prisma.calendarSource.create({ data: { propertyId, label: "L2", url: `${FEED}&x=2` } });
    const legacy3 = await prisma.calendarSource.create({ data: { propertyId, label: "L3", url: `${FEED}&x=3` } });
    // Zaten şifreli bir satır — backfill'in DOKUNMAMASI gereken değer.
    const pre = encryptCalendarSourceUrl(FEED, "sabit-id", orgId);
    const done = await prisma.calendarSource.create({
      data: { propertyId, label: "Done", url: FEED, urlEnc: pre.urlEnc, urlKeyFp: pre.urlKeyFp },
    });

    const n = await backfillCalendarSourceUrlEnc(prisma, 2); // batch=2 → döngü kanıtı
    expect(n).toBe(3);
    for (const id of [legacy1.id, legacy2.id, legacy3.id]) {
      const row = await prisma.calendarSource.findUniqueOrThrow({ where: { id } });
      expect(decryptSecretBound(row.urlEnc!, `calendar-source-url:v1:${id}:${orgId}`)).toBe(row.url);
      expect(row.urlKeyFp).toBe(encryptionKeyFingerprint());
    }
    const untouched = await prisma.calendarSource.findUniqueOrThrow({ where: { id: done.id } });
    expect(untouched.urlEnc).toBe(pre.urlEnc);

    expect(await backfillCalendarSourceUrlEnc(prisma, 2)).toBe(0); // idempotent
  });
});

describe("FAZ 3 — dual-read FAIL-CLOSED", () => {
  it("erişimci: legacy=düz metin, sağlam=çözülmüş, bozuk=ok:false (düz metne düşmez)", () => {
    expect(getCalendarSourceUrl({ id: "a", url: FEED, urlEnc: null, urlKeyFp: null }, orgId)).toEqual({
      ok: true,
      url: FEED,
      legacyPlaintext: true,
    });
    const good = encryptCalendarSourceUrl(FEED, "a", orgId);
    expect(getCalendarSourceUrl({ id: "a", url: "DUZ-METIN-KULLANILMAMALI", ...good }, orgId)).toEqual({
      ok: true,
      url: FEED,
      legacyPlaintext: false,
    });
    // Yanlış satıra kopyalanmış ciphertext → fail-closed.
    expect(getCalendarSourceUrl({ id: "b", url: FEED, ...good }, orgId)).toEqual({
      ok: false,
      reason: "decrypt-failed",
    });
    // Yanlış anahtar parmak izi → adlandırılmış teşhis.
    expect(
      getCalendarSourceUrl({ id: "a", url: FEED, urlEnc: good.urlEnc, urlKeyFp: "deadbeefdeadbeef" }, orgId),
    ).toEqual({ ok: false, reason: "key-fingerprint-mismatch" });
  });

  it("sync: BOZUK urlEnc'li kaynak FETCH ETMEDEN hata durumuna düşer (düz URL'e asla)", async () => {
    // Başka satırın AAD'siyle şifrelenmiş değer = kurcalanmış/yanlış satır.
    const tampered = encryptSecretBound(FEED, "calendar-source-url:v1:baska:org");
    const source = await prisma.calendarSource.create({
      data: { propertyId, label: "Tampered", url: FEED, urlEnc: tampered, urlKeyFp: encryptionKeyFingerprint() },
    });
    const result = await syncCalendarSource(source.id);
    expect(vi.mocked(fetchFeedText)).not.toHaveBeenCalled(); // düz metin fetch = sızıntı
    expect(result.errors.length).toBeGreaterThan(0);
    const row = await prisma.calendarSource.findUniqueOrThrow({ where: { id: source.id } });
    expect(row.lastStatus).toBe("error");
    expect(row.lastResult).toContain("çözülemedi");
  });

  it("sync: legacy satır (urlEnc NULL) geçiş penceresinde DÜZ url ile fetch eder", async () => {
    vi.mocked(fetchFeedText).mockResolvedValue("BEGIN:VCALENDAR\nEND:VCALENDAR");
    const source = await prisma.calendarSource.create({ data: { propertyId, label: "Legacy", url: FEED } });
    await syncCalendarSource(source.id);
    expect(vi.mocked(fetchFeedText)).toHaveBeenCalledWith(FEED, expect.anything());
  });

  it("sync: SAĞLAM urlEnc varken fetch ÇÖZÜLMÜŞ değerle yapılır (düz kolon okunmaz)", async () => {
    vi.mocked(fetchFeedText).mockResolvedValue("BEGIN:VCALENDAR\nEND:VCALENDAR");
    const res = await createSource(createReq(FEED), ctx());
    expect(res.status).toBe(201);
    const row = await prisma.calendarSource.findFirstOrThrow({ where: { propertyId } });
    // Düz kolonu KASTEN farklı bir değere çekiyoruz: fetch yine FEED'i almalı —
    // yani okuma yolu gerçekten urlEnc'ten geçiyor.
    await prisma.calendarSource.update({ where: { id: row.id }, data: { url: "https://tuzak.example.com/yanlis.ics" } });
    await syncCalendarSource(row.id);
    expect(vi.mocked(fetchFeedText)).toHaveBeenCalledWith(FEED, expect.anything());
  });

  it("export: ne düz URL ne CIPHERTEXT sızar; maske çözülen değerden üretilir", async () => {
    await createSource(createReq(FEED), ctx());
    const dump = JSON.stringify(await buildOrganizationDataExport(orgId));
    expect(dump).not.toContain("cok-gizli-secret-abc123");
    const row = await prisma.calendarSource.findFirstOrThrow({ where: { propertyId } });
    expect(dump).not.toContain(row.urlEnc!.slice(0, 24)); // ciphertext de sır sayılır
    expect(dump).toContain("ical.example.com"); // host görünür kalır (mevcut maske politikası)
  });

  it("YAPISAL PİN: okuyucular erişimciyi ATLAYAMAZ (source.url doğrudan okunmaz)", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["src/lib/import/sync.ts", "src/lib/data-export.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src.includes("getCalendarSourceUrl"), `${f}: erişimci import edilmeli`).toBe(true);
      expect(/\bsource\.url\b/.test(src), `${f}: source.url doğrudan okunuyor`).toBe(false);
    }
  });
});

describe("TAM DOĞRULAYICI — sayım değil, her satırı AÇAR", () => {
  it("temiz/legacy/kurcalanmış/sürüklenmiş satırları doğru sınıflar", async () => {
    const { verifyCalendarSourceUrlEnc } = await import("@/lib/calendar-source-url");
    // 1) sağlam (rota ile) — ok saymalı
    await createSource(createReq(FEED), ctx());
    // 2) legacy — nullEnc
    await prisma.calendarSource.create({ data: { propertyId, label: "L", url: FEED } });
    // 3) kurcalanmış — decryptFailed
    await prisma.calendarSource.create({
      data: {
        propertyId, label: "T", url: FEED,
        urlEnc: encryptSecretBound(FEED, "calendar-source-url:v1:baska:org"),
        urlKeyFp: encryptionKeyFingerprint(),
      },
    });
    // 4) SÜRÜKLENMİŞ: şifre çözülüyor ama düz kolon sonradan değişmiş —
    //    Faz 4 öncesi yakalanması ŞART olan sınıf (Codex: sayım yetmez).
    const drifted = await prisma.calendarSource.findFirstOrThrow({ where: { label: "Airbnb" } });
    await prisma.calendarSource.update({ where: { id: drifted.id }, data: { url: `${FEED}&degisti=1` } });

    const r = await verifyCalendarSourceUrlEnc(prisma);
    expect(r).toMatchObject({ total: 3, nullEnc: 1, ok: 0, fpMismatch: 0, decryptFailed: 1, plaintextMismatch: 1 });
    expect(r.badIds).toContain(drifted.id);
  });
});
