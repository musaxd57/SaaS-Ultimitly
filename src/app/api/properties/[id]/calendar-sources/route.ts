import { prisma } from "@/lib/db";
import { badRequest, jsonOk } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { isPrivateHost } from "@/lib/net/private-host";

export const POST = withManage<{ id: string }>(async (session, req, { params }) => {
  const { id: propertyId } = await params;

  const property = await prisma.property.findFirst({
    where: { id: propertyId, organizationId: session.organizationId },
    select: { id: true },
  });
  if (!property) return badRequest({ propertyId: "Geçersiz mülk" });

  const data = await req.json().catch(() => null);
  const label = String(data?.label ?? "").trim();
  const url = String(data?.url ?? "").trim();

  if (label.length < 2) return badRequest({ label: "Kaynak adı gerekli (örn. Airbnb)" });
  if (label.length > 120) return badRequest({ label: "Kaynak adı çok uzun (en fazla 120 karakter)" });
  // HTTPS only for NEW sources (Codex #22): feed URLs embed bearer-like secrets
  // (Airbnb/Booking export links), so plaintext http would leak them in transit.
  // All real PMS feeds are https. Legacy http rows (if any) keep syncing so no
  // live feed breaks — the requirement applies at creation.
  if (!/^https:\/\/.+/i.test(url)) {
    return badRequest({ url: "Yalnızca https iCal bağlantısı kabul edilir (http güvensizdir)." });
  }
  if (url.length > 2000) return badRequest({ url: "Bağlantı çok uzun (en fazla 2000 karakter)" });
  // SSRF guard: this URL is fetched server-side by the sync, so reject loopback /
  // link-local / private / cloud-metadata targets (e.g. 127.0.0.1, 169.254.169.254).
  try {
    if (isPrivateHost(new URL(url).hostname)) {
      return badRequest({ url: "İç ağ / özel adresler kabul edilmez." });
    }
  } catch {
    return badRequest({ url: "Geçerli bir http(s) iCal bağlantısı girin" });
  }

  const source = await prisma.calendarSource.create({
    data: { propertyId, label, url },
  });
  return jsonOk(source, 201);
});
