import { describe, it, expect, beforeEach } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { operatorLicenseQueue, OPERATOR_QUEUE_PAGE } from "@/lib/licenses/read";

// ---------------------------------------------------------------------------
// DİĞER X2 (Codex 11-10) — ESKİ ASKIDAKİ BELGELER YENİ BAŞVURUYU GÖRÜNMEZ BIRAKAMAZ. Gerçek PostgreSQL; kurgusal fikstür ("Lale").
//
// Operatör kuyruğu bütün durumları TEK sorguda, eskiden yeniye 200 satırla okuyordu: 200 eski askı kaydı birikince yeni başvuru listeye hiç
// girmiyordu (başvuru 14 günde kendiliğinden düşer — operatör görmeden). Artık başvurular, askıdakiler ve yeniden okunacaklar ayrı okunur,
// her birinin toplamı sayılır ve gösterilmeyen satır sayısı döner (sessiz kesme yok).
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
let orgId = "";
let holderId = "";
let seq = 0;

async function licenses(count: number, over: (i: number) => Record<string, unknown>) {
  await prisma.businessLicense.createMany({
    data: Array.from({ length: count }, (_, i) => {
      const n = String(++seq).padStart(6, "0");
      return { organizationId: orgId, holderId, type: "agency", number: n, numberNorm: n, attributes: { group: "A" }, status: "pending", ...over(i) };
    }),
  });
}
const daysAgo = (d: number, i = 0) => new Date(Date.now() - d * DAY + i * 1_000);

describe("operatör belge kuyruğu — ayrı listeler, ayrı sınırlar (X2)", () => {
  beforeEach(async () => {
    await resetDb();
    seq = 0;
    const org = await prisma.organization.create({ data: { name: "Lale" } });
    orgId = org.id;
    const holder = await prisma.licenseHolder.create({
      data: { organizationId: orgId, kind: "company", legalName: "Lale Turizm Ticaret Limited Şirketi", legalNameNorm: "lale turizm", taxIdHash: "h-lale", taxIdLast2: "90" },
    });
    holderId = holder.id;
  });

  it("🚨 205 ESKİ askı kaydı varken YENİ başvuru kuyrukta görünür (eskiden ilk 200 satır askıdakilerle doluyor, başvuru hiç gelmiyordu)", async () => {
    await licenses(205, (i) => ({ status: "suspended", suspendReason: "registry_mismatch", createdAt: daysAgo(400, i) }));
    await licenses(1, () => ({ status: "pending", number: "YENI-1", numberNorm: "yeni1", pendingUntil: new Date(Date.now() + 10 * DAY), createdAt: new Date() }));

    const q = await operatorLicenseQueue();
    const fresh = q.open.find((r) => r.number === "YENI-1");
    expect(fresh).toBeDefined(); // ⬅️ ESKİDE undefined
    expect(fresh!.status).toBe("pending");
    expect(q.open[0].number).toBe("YENI-1"); // başvurular askıdakilerden ÖNCE
    // Askıdakiler kendi sınırında; sığmayanlar sayılır.
    expect(q.open.filter((r) => r.status === "suspended")).toHaveLength(OPERATOR_QUEUE_PAGE);
    expect(q.hidden).toEqual({ applications: 0, suspended: 5, recheck: 0 });
  });

  it("🚨 yeniden okunacak doğrulanmış belgeler de başvuruları kuyruktan düşüremez; kendi listelerinde, kendi sınırlarıyla", async () => {
    await licenses(203, (i) => ({ status: "verified", verifiedAt: daysAgo(300), lastRegistryOkAt: daysAgo(200), createdAt: daysAgo(400, i) }));
    await licenses(2, (i) => ({ status: i === 0 ? "pending" : "under_review", pendingUntil: new Date(Date.now() + 5 * DAY), createdAt: new Date() }));
    const q = await operatorLicenseQueue();
    expect(q.open.map((r) => r.status).sort()).toEqual(["pending", "under_review"]);
    expect(q.recheck).toHaveLength(OPERATOR_QUEUE_PAGE);
    expect(q.hidden).toEqual({ applications: 0, suspended: 0, recheck: 3 });
  });

  it("başvurular en eskiden yeniye sıralanır; 200'den fazlaysa fazlası `hidden.applications` ile bildirilir ve gösterilenler en ESKİ 200'dür", async () => {
    await licenses(OPERATOR_QUEUE_PAGE + 4, (i) => ({ status: "pending", pendingUntil: new Date(Date.now() + 10 * DAY), createdAt: daysAgo(5, i) }));
    const q = await operatorLicenseQueue();
    expect(q.open).toHaveLength(OPERATOR_QUEUE_PAGE);
    expect(q.hidden.applications).toBe(4);
    expect(q.open[0].number).toBe("000001"); // en eski başvuru önce (bekleyen iş sırası)
    expect(q.open[OPERATOR_QUEUE_PAGE - 1].number).toBe(String(OPERATOR_QUEUE_PAGE).padStart(6, "0"));
  });

  it("KONTROL: süresi dolmuş başvuru ne listeye ne sayıya girer; yeni okunmuş doğrulanmış belge 'yeniden okunacak' sayılmaz", async () => {
    await licenses(1, () => ({ status: "pending", number: "DOLMUS", numberNorm: "dolmus", pendingUntil: daysAgo(1) }));
    await licenses(1, () => ({ status: "verified", number: "TAZE", numberNorm: "taze", verifiedAt: new Date(), lastRegistryOkAt: new Date() }));
    await licenses(1, () => ({ status: "pending", number: "ACIK", numberNorm: "acik", pendingUntil: null })); // son günü boş açık satır kuyruktan düşmez
    const q = await operatorLicenseQueue();
    expect(q.open.map((r) => r.number)).toEqual(["ACIK"]);
    expect(q.recheck).toEqual([]);
    expect(q.hidden).toEqual({ applications: 0, suspended: 0, recheck: 0 });
  });

  it("KONTROL: az kayıtta eski davranış aynen — başvuru + askıdaki 'açık' listede, süresi yaklaşan doğrulanmış belge 'yeniden okunacak'ta, gizli satır yok", async () => {
    await licenses(1, () => ({ status: "suspended", number: "ASKI", numberNorm: "aski", suspendReason: "registry_mismatch", createdAt: daysAgo(30) }));
    await licenses(1, () => ({ status: "under_review", number: "INCELEME", numberNorm: "inceleme", pendingUntil: new Date(Date.now() + 3 * DAY) }));
    await licenses(1, () => ({ status: "verified", number: "ESKI-OKUMA", numberNorm: "eskiokuma", verifiedAt: daysAgo(100), lastRegistryOkAt: daysAgo(100) }));
    const q = await operatorLicenseQueue();
    expect(q.open.map((r) => r.number)).toEqual(["INCELEME", "ASKI"]);
    expect(q.recheck.map((r) => r.number)).toEqual(["ESKI-OKUMA"]);
    expect(q.hidden).toEqual({ applications: 0, suspended: 0, recheck: 0 });
  });
});
