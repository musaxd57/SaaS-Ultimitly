import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// ---------------------------------------------------------------------------
// Kanal sınırının mülk ↔ ilan okuyucuları (değişmez 1/20 taşıması, 10-11): mülkler sayfası "kanal bağlı mı" ve rezervasyon temizliğinin
// köprü ilan kimlikleri artık buradan okunur. Haiku 10-11: kiracı kapsamı testsizdi — süzgeç kalkarsa temizlik BAŞKA kiracının ilan
// kimliğini bu kiracının kimlik bilgisiyle sağlayıcıya sorardı.
// ---------------------------------------------------------------------------
vi.mock("server-only", () => ({}));

import { listBridgeListingIds, listPropertyChannelLinks } from "@/lib/channels/property-links";

describe("kanal sınırı — mülk ↔ ilan okuyucuları kiracı kapsamlı", () => {
  beforeEach(resetDb);

  it("listBridgeListingIds: yalnız BU kiracının köprüye bağlı mülkleri; bağsız mülk ve başka kiracı yok", async () => {
    const a = await makeOrgWithProperty();
    await prisma.property.update({ where: { id: a.propertyId }, data: { hospitableId: "hosp-A" } });
    await prisma.property.create({ data: { organizationId: a.orgId, name: "Bağsız", hospitableId: null } });
    const b = await makeOrgWithProperty();
    await prisma.property.update({ where: { id: b.propertyId }, data: { hospitableId: "hosp-B" } });

    expect(await listBridgeListingIds(a.orgId)).toEqual([{ propertyId: a.propertyId, externalId: "hosp-A" }]);
    expect(await listBridgeListingIds(b.orgId)).toEqual([{ propertyId: b.propertyId, externalId: "hosp-B" }]);
  });

  it("listPropertyChannelLinks: istenen kimlikler arasından yalnız bu kiracının bağlı mülkleri; başka kiracının kimliği verilse de dönmez", async () => {
    const a = await makeOrgWithProperty();
    await prisma.property.update({ where: { id: a.propertyId }, data: { hospitableId: "hosp-A" } });
    const unlinked = await prisma.property.create({ data: { organizationId: a.orgId, name: "Bağsız", hospitableId: null } });
    const b = await makeOrgWithProperty();
    await prisma.property.update({ where: { id: b.propertyId }, data: { hospitableId: "hosp-B" } });

    const links = await listPropertyChannelLinks(a.orgId, [a.propertyId, unlinked.id, b.propertyId]);
    expect(links.map((l) => l.propertyId)).toEqual([a.propertyId]);
    expect(JSON.stringify(links)).not.toContain("hosp-"); // sağlayıcı kimliği sınırdan dışarı TAŞINMAZ
    expect(await listPropertyChannelLinks(a.orgId, [])).toEqual([]);
  });
});
