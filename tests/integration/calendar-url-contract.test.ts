import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";
import { decryptSecretBound, encryptSecretBound, encryptionKeyFingerprint } from "@/lib/crypto";
import {
  CALENDAR_URL_SENTINEL,
  calendarUrlContractEnabled,
  contractCalendarSourceUrlSentinel,
  encryptCalendarSourceUrl,
  getCalendarSourceUrl,
  restoreCalendarSourceUrlPlaintext,
  verifyCalendarSourceUrlContract,
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
// FAZ 4 (contract) — KOD HAZIRLIĞI. Sentinel yazımı CALENDAR_URL_CONTRACT_ENABLED
// bayrağının arkasında (DEFAULT KAPALI); bu dosya dört şeyi pinler:
//
//   PARITE   bayrak kapalıyken create BUGÜNKÜ dual-write'ın birebir aynısı
//            (default ON'a çevrilirse bu testler kırmızı = mutasyon kanıtı).
//   SENTINEL bayrak açıkken düz kolon yalnız "enc:" taşır; doğrulama yine
//            GERÇEK URL üstünde koşar; okuma/sync çözülmüş değerle çalışır
//            (eski okuma yolu ÖLDÜ pini — tasarım §6/6).
//   CONTRACT executor satır başına SON-AN çöz+=== kanıtı olmadan sentinel
//            YAZMAZ; idempotent; legacy satırı fatal raporlar. Restore aracı
//            anahtar sağlamken gerçek geri dönüş yoludur.
//   SIZINTI  201 gövdesi ve export ne düz URL ne ciphertext taşır; mülk
//            sayfası maskeyi SUNUCUDA üretir (RSC payload'ında sır yok).
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

// email-verify dersi: env stub'ı assertion başarısız olsa da SIZMAMALI.
afterEach(() => {
  vi.unstubAllEnvs();
});

function createReq(url: string, label = "Airbnb") {
  return new NextRequest(`http://localhost/api/properties/${propertyId}/calendar-sources`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label, url }),
  });
}
const ctx = () => ({ params: Promise.resolve({ id: propertyId }) });

describe("bayrak varsayılanı ve parite (mutasyon kanıtı)", () => {
  it("bayrak DEFAULT KAPALI; tanınmayan değer de KAPALI", () => {
    expect(calendarUrlContractEnabled()).toBe(false);
    vi.stubEnv("CALENDAR_URL_CONTRACT_ENABLED", "true"); // "1" DEĞİL → kapalı
    expect(calendarUrlContractEnabled()).toBe(false);
    vi.stubEnv("CALENDAR_URL_CONTRACT_ENABLED", "1");
    expect(calendarUrlContractEnabled()).toBe(true);
  });

  it("bayrak kapalıyken create düz kolona GERÇEK URL yazar (bugünkü davranış birebir)", async () => {
    const res = await createSource(createReq(FEED), ctx());
    expect(res.status).toBe(201);
    const row = await prisma.calendarSource.findFirstOrThrow({ where: { propertyId } });
    expect(row.url).toBe(FEED); // default ON'a çevrilirse burası kırmızı
    expect(decryptSecretBound(row.urlEnc!, `calendar-source-url:v1:${row.id}:${orgId}`)).toBe(FEED);
  });

  it("201 gövdesi sır taşımaz: ne düz URL ne ciphertext ne parmak izi", async () => {
    const res = await createSource(createReq(FEED), ctx());
    expect(res.status).toBe(201);
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain("cok-gizli-secret-abc123");
    expect(body).not.toContain("urlEnc");
    expect(body).not.toContain("urlKeyFp");
  });
});

describe("bayrak AÇIK — sentinel yazımı", () => {
  it("düz kolon yalnız sentinel taşır; urlEnc gerçek URL'e çözülür; doğrulama gerçek URL'de", async () => {
    vi.stubEnv("CALENDAR_URL_CONTRACT_ENABLED", "1");
    // Doğrulama hâlâ GERÇEK girdi üstünde: http ve özel adres yine reddedilir.
    expect((await createSource(createReq("http://ical.example.com/f.ics"), ctx())).status).toBe(400);
    expect((await createSource(createReq("https://127.0.0.1/f.ics"), ctx())).status).toBe(400);

    const res = await createSource(createReq(FEED), ctx());
    expect(res.status).toBe(201);
    const row = await prisma.calendarSource.findFirstOrThrow({ where: { propertyId } });
    expect(row.url).toBe(CALENDAR_URL_SENTINEL);
    expect(decryptSecretBound(row.urlEnc!, `calendar-source-url:v1:${row.id}:${orgId}`)).toBe(FEED);
    expect(row.urlKeyFp).toBe(encryptionKeyFingerprint());
  });

  it("ESKİ OKUMA YOLU ÖLDÜ pini: sentinel satırda sync ÇÖZÜLMÜŞ URL ile fetch eder, sentinel'le asla", async () => {
    vi.stubEnv("CALENDAR_URL_CONTRACT_ENABLED", "1");
    vi.mocked(fetchFeedText).mockResolvedValue("BEGIN:VCALENDAR\nEND:VCALENDAR");
    await createSource(createReq(FEED), ctx());
    const row = await prisma.calendarSource.findFirstOrThrow({ where: { propertyId } });
    await syncCalendarSource(row.id);
    expect(vi.mocked(fetchFeedText)).toHaveBeenCalledWith(FEED, expect.anything());
    for (const call of vi.mocked(fetchFeedText).mock.calls) {
      expect(call[0]).not.toBe(CALENDAR_URL_SENTINEL);
    }
  });

  it("export sentinel satırda da sır sızdırmaz; maske çözülen değerden gelir", async () => {
    vi.stubEnv("CALENDAR_URL_CONTRACT_ENABLED", "1");
    await createSource(createReq(FEED), ctx());
    const dump = JSON.stringify(await buildOrganizationDataExport(orgId));
    expect(dump).not.toContain("cok-gizli-secret-abc123");
    expect(dump).toContain("ical.example.com"); // host görünür (mevcut maske politikası)
  });
});

describe("erişimci — sentinel bozuk-durum dalı", () => {
  it("url=sentinel ama urlEnc YOK → fail-closed (sentinel bir URL gibi ASLA dönmez)", () => {
    expect(
      getCalendarSourceUrl({ id: "a", url: CALENDAR_URL_SENTINEL, urlEnc: null, urlKeyFp: null }, orgId),
    ).toEqual({ ok: false, reason: "sentinel-without-ciphertext" });
  });

  it("sync böyle bir satırı FETCH ETMEDEN adlandırılmış hatayla durdurur", async () => {
    const source = await prisma.calendarSource.create({
      data: { propertyId, label: "Bozuk", url: CALENDAR_URL_SENTINEL },
    });
    const result = await syncCalendarSource(source.id);
    expect(vi.mocked(fetchFeedText)).not.toHaveBeenCalled();
    expect(result.errors.length).toBeGreaterThan(0);
    const row = await prisma.calendarSource.findUniqueOrThrow({ where: { id: source.id } });
    expect(row.lastStatus).toBe("error");
    expect(row.lastResult).toContain("şifreli değer eksik");
  });
});

describe("contract executor — son-an kanıt olmadan sentinel YAZMAZ", () => {
  it("sağlam satırları çevirir, kurcalanmış/sürüklenmiş satırı REDDEDER, idempotent", async () => {
    // 3 sağlam satır (rota, bayrak KAPALI → düz metin + urlEnc).
    await createSource(createReq(FEED, "A1"), ctx());
    await createSource(createReq(`${FEED}&x=2`, "A2"), ctx());
    await createSource(createReq(`${FEED}&x=3`, "A3"), ctx());
    // Kurcalanmış: yabancı AAD'li ciphertext — çözülemez.
    const tampered = await prisma.calendarSource.create({
      data: {
        propertyId, label: "T", url: FEED,
        urlEnc: encryptSecretBound(FEED, "calendar-source-url:v1:baska:org"),
        urlKeyFp: encryptionKeyFingerprint(),
      },
    });
    // Sürüklenmiş: çözülüyor ama düz kolon SONRADAN değişmiş — === tutmaz.
    const driftSeed = await prisma.calendarSource.findFirstOrThrow({ where: { label: "A3" } });
    await prisma.calendarSource.update({ where: { id: driftSeed.id }, data: { url: `${FEED}&degisti=1` } });

    const r = await contractCalendarSourceUrlSentinel(prisma);
    expect(r).toMatchObject({ converted: 2, sentineled: 2, refused: 2, nullEnc: 0 });
    expect(r.badIds).toContain(tampered.id);
    expect(r.badIds).toContain(driftSeed.id);

    // Reddedilenlerin düz kolonu OLDUĞU GİBİ durur — asla sentinel'lenmez.
    expect((await prisma.calendarSource.findUniqueOrThrow({ where: { id: tampered.id } })).url).toBe(FEED);
    expect((await prisma.calendarSource.findUniqueOrThrow({ where: { id: driftSeed.id } })).url).toBe(`${FEED}&degisti=1`);
    // Çevrilenler sentinel + hâlâ çözülür.
    for (const label of ["A1", "A2"]) {
      const row = await prisma.calendarSource.findFirstOrThrow({ where: { label } });
      expect(row.url).toBe(CALENDAR_URL_SENTINEL);
      const resolved = getCalendarSourceUrl(row, orgId);
      expect(resolved.ok).toBe(true);
    }

    // İkinci koşu: yeni dönüşüm yok, sentinel'liler sayılır, redler aynı kalır.
    const r2 = await contractCalendarSourceUrlSentinel(prisma);
    expect(r2).toMatchObject({ converted: 0, sentineled: 2, refused: 2 });
  });

  it("legacy satır (urlEnc NULL) fatal raporlanır ve DOKUNULMAZ", async () => {
    const legacy = await prisma.calendarSource.create({ data: { propertyId, label: "L", url: FEED } });
    const r = await contractCalendarSourceUrlSentinel(prisma);
    expect(r.nullEnc).toBe(1);
    expect(r.badIds).toContain(legacy.id);
    expect((await prisma.calendarSource.findUniqueOrThrow({ where: { id: legacy.id } })).url).toBe(FEED);
  });
});

describe("restore aracı — anahtar sağlamken gerçek geri dönüş yolu", () => {
  it("sentinel satırları çözülmüş düz metne GERİ yazar; çözülemeyeni raporlar; idempotent", async () => {
    await createSource(createReq(FEED, "A1"), ctx());
    await createSource(createReq(`${FEED}&x=2`, "A2"), ctx());
    await contractCalendarSourceUrlSentinel(prisma);

    // Çözülemeyen sentinel satır: contract SONRASI urlEnc'i bozulmuş senaryo.
    const broken = await prisma.calendarSource.create({
      data: {
        propertyId, label: "B", url: CALENDAR_URL_SENTINEL,
        urlEnc: encryptSecretBound(FEED, "calendar-source-url:v1:baska:org"),
        urlKeyFp: encryptionKeyFingerprint(),
      },
    });

    const r = await restoreCalendarSourceUrlPlaintext(prisma);
    expect(r.restored).toBe(2);
    expect(r.unreadable).toBe(1);
    expect(r.badIds).toContain(broken.id);
    expect((await prisma.calendarSource.findFirstOrThrow({ where: { label: "A1" } })).url).toBe(FEED);
    expect((await prisma.calendarSource.findFirstOrThrow({ where: { label: "A2" } })).url).toBe(`${FEED}&x=2`);
    // Çözülemeyen satır sentinel kalır — sessiz veri uydurma yok.
    expect((await prisma.calendarSource.findUniqueOrThrow({ where: { id: broken.id } })).url).toBe(CALENDAR_URL_SENTINEL);

    const r2 = await restoreCalendarSourceUrlPlaintext(prisma);
    expect(r2.restored).toBe(0); // idempotent — gerçek URL'ler bir daha ellenmez
  });
});

describe("post-contract doğrulayıcı — her satırı AÇAR", () => {
  it("sağlıklı/düz-metin-kalan/legacy/bozuk satırları doğru sınıflar", async () => {
    // Sağlıklı: contract'tan geçmiş satır.
    await createSource(createReq(FEED, "A1"), ctx());
    await contractCalendarSourceUrlSentinel(prisma);
    // Düz metin KALAN: contract'ı kaçırmış şifreli satır.
    const pre = encryptCalendarSourceUrl(FEED, "sabit-id", orgId);
    await prisma.calendarSource.create({
      data: { propertyId, label: "P", url: FEED, urlEnc: pre.urlEnc, urlKeyFp: pre.urlKeyFp },
    });
    // Legacy: urlEnc NULL.
    const legacy = await prisma.calendarSource.create({ data: { propertyId, label: "L", url: FEED } });
    // Bozuk: sentinel ama çözülemeyen.
    const broken = await prisma.calendarSource.create({
      data: {
        propertyId, label: "B", url: CALENDAR_URL_SENTINEL,
        urlEnc: encryptSecretBound(FEED, "calendar-source-url:v1:baska:org"),
        urlKeyFp: encryptionKeyFingerprint(),
      },
    });

    const r = await verifyCalendarSourceUrlContract(prisma);
    expect(r).toMatchObject({ total: 4, ok: 1, plaintextRemaining: 1, nullEnc: 1, decryptFailed: 1, fpMismatch: 0 });
    expect(r.badIds).toContain(legacy.id);
    expect(r.badIds).toContain(broken.id);
  });
});

describe("YAPISAL PİN — maske sunucuda, sayfa ham URL'i client'a geçirmez", () => {
  it("mülk sayfası erişimci+maskeyi kullanır; 'url: s.url' kalıbı yasak", async () => {
    const { readFileSync } = await import("node:fs");
    const page = readFileSync("src/app/(app)/properties/[id]/page.tsx", "utf8");
    expect(page.includes("getCalendarSourceUrl")).toBe(true);
    expect(page.includes("maskFeedUrl")).toBe(true);
    expect(/url:\s*s\.url\b/.test(page)).toBe(false);
    // Client component ham URL prop'u tanımaz — sunucu maskesi tek yol.
    const component = readFileSync("src/components/properties/calendar-sources.tsx", "utf8");
    expect(component.includes("urlMasked")).toBe(true);
    expect(/\burl:\s*string/.test(component)).toBe(false);
  });
});
