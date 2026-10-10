import { describe, it, expect, beforeEach } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { findAttentionItems } from "@/modules/intelligence/incidents/attention";

// ---------------------------------------------------------------------------
// Dikkat Gerektirenler — KANAL BAĞLANTISI SAĞLIĞI (V0 §2f; sağlayıcıdan bağımsız, bağlantı satırının okuma kaydı). İşletme düzeyi satır
// (mülksüz); mülke daraltılmış çağrıda yok. Ölçüm yoksa (yazıcı anahtarı kapalı) satır yok — sakin gün boş kalır. Gerçek PostgreSQL.
// ---------------------------------------------------------------------------

const NOW = new Date("2026-10-10T12:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);

async function orgWithConnection(read: { lastReadOkAt?: Date | null; lastReadErrorAt?: Date | null; lastReadErrorKind?: string | null }, status = "active") {
  const { orgId, propertyId } = await makeOrgWithProperty();
  await prisma.channelConnection.create({ data: { organizationId: orgId, provider: "hospitable", status, ...read } });
  return { orgId, propertyId };
}
const rows = async (orgId: string, propertyId?: string) =>
  (await findAttentionItems(orgId, { now: NOW, ...(propertyId ? { propertyId } : {}) })).filter((i) => i.kind === "connection_unhealthy");

describe("Dikkat Gerektirenler — kanal bağlantısı sağlığı", () => {
  beforeEach(resetDb);

  it("KONTROL: ölçüm yok / taze başarılı okuma / taze okumadan sonra geçici kesinti → satır YOK", async () => {
    expect(await rows((await orgWithConnection({})).orgId)).toEqual([]);
    expect(await rows((await orgWithConnection({ lastReadOkAt: ago(3) })).orgId)).toEqual([]);
    expect(await rows((await orgWithConnection({ lastReadOkAt: ago(5), lastReadErrorAt: ago(1), lastReadErrorKind: "outage" })).orgId)).toEqual([]);
  });

  it("🚨 kalıcı hata (yetki düştü) HEMEN satır: işletme düzeyi, ayarlara bağlanır, tür + son başarılı okuma taşır, mülk adı YOK", async () => {
    const { orgId } = await orgWithConnection({ lastReadOkAt: ago(10), lastReadErrorAt: ago(2), lastReadErrorKind: "auth_revoked" });
    const [r] = await rows(orgId);
    expect(r).toMatchObject({
      kind: "connection_unhealthy",
      certainty: "observed",
      severity: 98,
      href: "/settings?tab=baglantilar",
      connectionErrorKind: "auth_revoked",
      minutesSinceOk: 10,
      propertyId: "",
      propertyName: "",
    });
  });

  it("bayat okuma (2 saattir başarılı senkron yok, hata da yok) → satır, türsüz", async () => {
    const [r] = await rows((await orgWithConnection({ lastReadOkAt: ago(120) })).orgId);
    expect(r).toMatchObject({ kind: "connection_unhealthy", minutesSinceOk: 120 });
    expect(r.connectionErrorKind).toBeUndefined();
  });

  it("🚨 sağlayıcının REDDETTİĞİ bağlantı (okuma kaydı olmasa da) → 'yetki düştü' satırı", async () => {
    const [r] = await rows((await orgWithConnection({}, "revoked")).orgId);
    expect(r).toMatchObject({ kind: "connection_unhealthy", connectionErrorKind: "auth_revoked" });
  });

  it("KONTROL: mülke daraltılmış çağrıda ve pasif (kesilmiş) bağlantıda satır YOK", async () => {
    const a = await orgWithConnection({ lastReadOkAt: ago(10), lastReadErrorAt: ago(2), lastReadErrorKind: "auth_revoked" });
    expect(await rows(a.orgId, a.propertyId)).toEqual([]);
    const b = await orgWithConnection({ lastReadOkAt: ago(10), lastReadErrorAt: ago(2), lastReadErrorKind: "auth_revoked" }, "disconnected");
    expect(await rows(b.orgId)).toEqual([]);
  });

  it("KONTROL: başka işletmenin bağlantısı görünmez", async () => {
    const a = await orgWithConnection({});
    await orgWithConnection({ lastReadOkAt: ago(10), lastReadErrorAt: ago(2), lastReadErrorKind: "auth_revoked" });
    expect(await rows(a.orgId)).toEqual([]);
  });
});
