import { prisma } from "@/lib/db";
import { propertySchema, zodFieldErrors } from "@/lib/validators";
import { badRequest, jsonOk, notFound, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { serializeSupplyProfile } from "@/lib/supply";
import { ERASABLE_STATUSES } from "@/lib/outbox/state";

// ⚠️ GİZLİ TOKEN'LAR YANITTAN ÇIKARILIR — GERİ EKLEME.
// `icalToken` takvim beslemesinin, `chatToken` QR concierge'in TEK kimlik
// bilgisi (ikisi de bearer). Bu rotalar `select`siz çalıştığı için ikisi de düz
// metin JSON'a giriyordu; arayüz hiçbirini okumuyor (kod-doğrulandı: components
// altında sıfır geçiş). Kritik nokta: sayfa `chatToken`'ı yalnız
// `canManage && GUEST_CHAT_ENABLED && chatEnabled` iken gösteriyor, API ise ÜÇ
// koşulun hiçbirine bakmıyordu — yani kill-switch kapalıyken bile iniyordu.
// Token ölü de değil: chat kapatılınca korunuyor ve yeniden açılınca aynı QR
// canlanıyor. KVKK ihracının Property allowlist'i (`data-export.ts`) ikisini de
// zaten BİLEREK dışarıda bırakıyor — bu rotalar o sözleşmenin dışında kalmıştı.
function stripPropertySecrets<T extends Record<string, unknown>>(p: T) {
  const rest = { ...p };
  delete rest.icalToken;
  delete rest.chatToken;
  return rest;
}

export const GET = withManage<{ id: string }>(async (session, _req, { params }) => {
  const { id } = await params;
  const property = await prisma.property.findFirst({
    where: { id, organizationId: session.organizationId },
  });
  if (!property) return notFound();
  return jsonOk(stripPropertySecrets(property));
});

export const PATCH = withManage<{ id: string }>(async (session, req, { params }) => {
  const { id } = await params;
  const existing = await prisma.property.findFirst({
    where: { id, organizationId: session.organizationId },
    select: { id: true, name: true },
  });
  if (!existing) return notFound();

  const data = await readJsonCappedOrNull(req);
  const parsed = propertySchema.partial().safeParse(data);
  if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));
  const d = parsed.data;

  // Block renaming onto another property's name in the same org — but ONLY when
  // the name actually changes, so editing other fields on a property that has a
  // pre-existing duplicate is never blocked.
  if (d.name !== undefined) {
    const newName = d.name.trim();
    if (newName.toLowerCase() !== existing.name.trim().toLowerCase()) {
      const dupe = await prisma.property.findFirst({
        where: {
          organizationId: session.organizationId,
          name: { equals: newName, mode: "insensitive" },
          id: { not: id },
        },
        select: { id: true },
      });
      if (dupe) return badRequest({ name: "Bu isimde bir mülk zaten var" });
    }
  }

  const property = await prisma.property.update({
    where: { id },
    data: {
      name: d.name?.trim(),
      address: d.address === "" ? null : d.address,
      city: d.city === "" ? null : d.city,
      country: d.country === "" ? null : d.country,
      checkInTime: d.checkInTime,
      checkOutTime: d.checkOutTime,
      cleaningBufferMinutes: d.cleaningBufferMinutes,
      notes: d.notes === "" ? null : d.notes,
      // Only touch the profile when the client actually sent one (partial PATCH).
      supplyProfileJson:
        d.supplyProfile === undefined ? undefined : serializeSupplyProfile(d.supplyProfile),
    },
  });
  return jsonOk(stripPropertySecrets(property));
});

export const DELETE = withManage<{ id: string }>(async (session, _req, { params }) => {
  const { id } = await params;
  // Org-scoped existence check FIRST so a foreign id is a clean 404 with zero writes.
  const owned = await prisma.property.findFirst({
    where: { id, organizationId: session.organizationId },
    select: { id: true },
  });
  if (!owned) return notFound();
  // 🚨 KUYRUK AYNI TX'TE İPTAL (Codex F03, P1). Mülk silme konuşma/mesaj/rezervasyonu
  // DB cascade ile götürür ama MessageOutbox'a FK YOK → bekleyen yanıt satırları
  // (conversationId) ve lifecycle satırları (reservationId / externalReservationId)
  // sahipsiz kalıp sağlayıcıya gidebilirdi. Kapsam ve `claimedBy: null` kuralı
  // konuşma silme rotasıyla AYNI (↑`conversations/[id]`); worker'ın varlık vetosu
  // (conversation_gone / reservation_gone) ikinci katman.
  const [convs, ress] = await Promise.all([
    prisma.conversation.findMany({ where: { propertyId: id }, select: { id: true } }),
    prisma.reservation.findMany({ where: { propertyId: id }, select: { id: true, sourceReference: true } }),
  ]);
  const convIds = convs.map((c) => c.id);
  const resIds = ress.map((r) => r.id);
  const srcRefs = ress.map((r) => r.sourceReference).filter((s): s is string => Boolean(s));
  const targets = [
    ...(convIds.length ? [{ conversationId: { in: convIds } }] : []),
    ...(resIds.length ? [{ reservationId: { in: resIds } }] : []),
    ...(srcRefs.length ? [{ externalReservationId: { in: srcRefs } }] : []),
  ];
  const [, result] = await prisma.$transaction([
    prisma.messageOutbox.updateMany({
      where: {
        organizationId: session.organizationId,
        ...(targets.length ? { OR: targets } : { id: "__none__" }),
        status: { in: [...ERASABLE_STATUSES] },
        claimedBy: null,
      },
      data: { status: "canceled", lastErrorKind: "canceled", lastErrorCode: "property_deleted" },
    }),
    prisma.property.deleteMany({ where: { id, organizationId: session.organizationId } }),
  ]);
  if (result.count === 0) return notFound();
  return jsonOk({ ok: true });
});
