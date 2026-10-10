import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { badRequest, jsonOk, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { icalIdentityKey, recordTrialIdentities, TRIAL_IDENTITY_REUSED_MESSAGE } from "@/lib/billing/trial-identity";
import { isPrivateHost } from "@/lib/net/private-host";
import {
  CALENDAR_URL_SENTINEL,
  calendarUrlContractEnabled,
  encryptCalendarSourceUrl,
} from "@/lib/calendar-source-url";

const MAX_CALENDAR_SOURCES_PER_PROPERTY = 10;

export const POST = withManage<{ id: string }>(async (session, req, { params }) => {
  const { id: propertyId } = await params;

  const property = await prisma.property.findFirst({
    where: { id: propertyId, organizationId: session.organizationId },
    select: { id: true },
  });
  if (!property) return badRequest({ propertyId: "Geçersiz mülk" });

  const data = await readJsonCappedOrNull(req);
  const label = String(data?.label ?? "").trim();
  const url = String(data?.url ?? "").trim();

  if (label.length < 2) return badRequest({ label: "Kaynak adı gerekli (örn. Airbnb)" });
  if (label.length > 120) return badRequest({ label: "Kaynak adı çok uzun (en fazla 120 karakter)" });
  // HTTPS only for NEW sources (Codex #22): feed URLs embed bearer-like secrets
  // (Airbnb/Booking export links), so plaintext http would leak them in transit.
  // All real PMS feeds are https. Legacy http rows (if any) keep syncing so no
  // live feed breaks — the requirement applies at creation.
  if (!/^https:\/\/.+/i.test(url)) {
    return badRequest({ url: "Yalnızca https ile başlayan iCal bağlantısı kabul edilir (http bağlantı şifresiz taşınır)." });
  }
  if (url.length > 2000) return badRequest({ url: "Bağlantı çok uzun (en fazla 2000 karakter)" });
  // SSRF guard: this URL is fetched server-side by the sync, so reject loopback /
  // link-local / private / cloud-metadata targets (e.g. 127.0.0.1, 169.254.169.254).
  try {
    if (isPrivateHost(new URL(url).hostname)) {
      return badRequest({ url: "Bu bağlantı kabul edilmiyor. İç ağ / yerel adresler yerine genel erişime açık bir adres kullanın." });
    }
  } catch {
    return badRequest({ url: "Geçerli bir https iCal bağlantısı girin." });
  }

  // KAYNAK SAYISI TAVANI (↓ işlem içinde). Tavansızdı: bir hesap tek daireye yüzlerce besleme
  // ekleyip senkronu tetikleyebiliyordu — her biri ayrı bir dış HTTP isteği ve
  // 15 saniyeye kadar bir istek-işleyici tutuyor. Yani hem kendi sunucumuz hem
  // hedefteki üçüncü taraf için hacim üretme aracına dönüşüyordu.
  // 10 gerçek kullanım için fazlasıyla yeterli: bir dairenin Airbnb + Booking +
  // Etstur + kendi sitesi gibi en fazla 3-4 kanalı olur.
  // 🚨 U38 (Codex 10-07): sayım ile ekleme TEK işlemde, mülk satırı kilitli — eskiden iki paralel istek ikisi de 9 sayıp 11.
  // kaynağı yazabiliyordu. Kilit yalnız aynı mülke ekleme yapan istekleri sıralar.
  //
  // DUAL-WRITE (phase 1 of the url-encryption expand-contract): urlEnc carries
  // the real URL AAD-bound to this exact row+org; the AAD needs the row id, so
  // the id is generated up front (EmailOutbox m44 precedent). What the
  // plaintext column gets depends on the phase-4 flag: OFF (default) keeps
  // today's dual-write with the plaintext authoritative; ON stores only the
  // sentinel — validation above always ran on the REAL url either way.
  const id = randomUUID();
  const source = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Property" WHERE "id" = ${property.id} AND "organizationId" = ${session.organizationId} FOR UPDATE`;
    if (locked.length === 0) return "gone" as const;
    const sourceCount = await tx.calendarSource.count({ where: { propertyId: property.id } });
    if (sourceCount >= MAX_CALENDAR_SOURCES_PER_PROPERTY) return "full" as const;
    return tx.calendarSource.create({
      data: {
        id,
        propertyId,
        label,
        url: calendarUrlContractEnabled() ? CALENDAR_URL_SENTINEL : url,
        ...encryptCalendarSourceUrl(url, id, session.organizationId),
      },
      // The 201 body used to echo the full row — that shipped the ciphertext AND
      // the plaintext feed URL (a secret) back over the wire for a client that
      // only checks res.ok. Return the safe fields only.
      select: { id: true, propertyId: true, label: true, createdAt: true },
    });
  });
  if (source === "gone") return badRequest({ propertyId: "Geçersiz mülk" });
  if (source === "full") {
    return badRequest({
      url: "Bu daire için en fazla 10 takvim bağlantısı ekleyebilirsiniz. Kullanmadığınız bağlantıları silin.",
    });
  }
  // Deneme kimliği (kurucu onayı 10-10; anahtar KAPALIYKEN hiçbir şey yazılmaz): bu takvim daha önce başka bir hesapta görüldüyse deneme
  // biter. Takvim YİNE eklenir (akış bozulmaz); ekranda sade not.
  const identity = await recordTrialIdentities(session.organizationId, [icalIdentityKey(url)]);
  return jsonOk(identity.trialEnded ? { ...source, trialNotice: TRIAL_IDENTITY_REUSED_MESSAGE } : source, 201);
});
