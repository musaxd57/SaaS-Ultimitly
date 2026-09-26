import { prisma } from "@/lib/db";
import { propertySchema, zodFieldErrors } from "@/lib/validators";
import { badRequest, jsonOk, notFound, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { serializeSupplyProfile } from "@/lib/supply";
import { ERASABLE_STATUSES } from "@/lib/outbox/state";
import { earlyCheckinRuleWhere } from "@/lib/early-checkin/rules";
import { houseRulesWhere } from "@/lib/house-rules/store";
import { STORAGE_PHOTO_URL_PREFIX, keyFromPhotoUrl } from "@/lib/storage/keys";
import { enqueueStorageDeletions } from "@/lib/storage/deletion-queue";

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
  // Sonuç ADIYLA okunur: dizi biçimli işlemde konumsal okuma (`[, result]`) araya adım eklenince yanlış satırın
  // sayısını okuyordu — kural silme eklenince kuralı OLMAYAN her mülk silinip 404 dönüyordu (09-24, yayın öncesi yakalandı).
  const deleted = await prisma.$transaction(async (tx) => {
    // Kilit sırası kural kaydıyla AYNI: önce mülk satırı (`saveEarlyCheckinRule` de önce onu kilitler) — ters sıra
    // eşzamanlı kural kaydı + silmede kilitlenme (deadlock) ya da silinmiş mülke sahipsiz kural bırakabilirdi.
    await tx.$queryRaw`SELECT 1 FROM "Property" WHERE "id" = ${id} AND "organizationId" = ${session.organizationId} FOR UPDATE`;
    await tx.messageOutbox.updateMany({
      where: {
        organizationId: session.organizationId,
        ...(targets.length ? { OR: targets } : { id: "__none__" }),
        status: { in: [...ERASABLE_STATUSES] },
        claimedBy: null,
      },
      data: { status: "canceled", lastErrorKind: "canceled", lastErrorCode: "property_deleted" },
    });
    // Mülkün erken giriş kuralı ve ev kuralları da gider (FK yok; aynı kimlikle yeniden kullanılmasın, sahipsiz satır kalmasın).
    await tx.automationRule.deleteMany({ where: earlyCheckinRuleWhere(session.organizationId, id) });
    await tx.automationRule.deleteMany({ where: houseRulesWhere(session.organizationId, id) });
    // 🚨 F11 (Codex 09-05): görev fotoğraflarının SİLME NİYETİ aynı işlemde (görev silme rotasıyla aynı sözleşme).
    // Kaskad görevleri ve güncellemelerini götürür; nesneleri gösteren satırlar gidince kovadaki fotoğraf sahipsiz
    // kalıyordu. Anahtarlar kilitten SONRA, silmeden hemen önce okunur; kiracı süzgeci kuyruğun tek boğazında.
    const photoRows = await tx.taskUpdate.findMany({
      where: { task: { propertyId: id }, photoUrl: { startsWith: STORAGE_PHOTO_URL_PREFIX } },
      select: { photoUrl: true },
    });
    const del = await tx.property.deleteMany({ where: { id, organizationId: session.organizationId } });
    const keys = photoRows.map((r) => keyFromPhotoUrl(r.photoUrl)).filter((k): k is string => k !== null);
    if (del.count > 0 && keys.length > 0) await enqueueStorageDeletions(tx, session.organizationId, keys);
    return del;
    // Etkileşimli işlemin varsayılan 5 sn / 2 sn sınırı dizi biçiminde YOKTU: kaskad silme (indekssiz SetNull
    // kolonları) veri büyüdükçe uzar; kardeş yazma yollarının sınırları (inceleme 09-24).
  }, { timeout: 60_000, maxWait: 15_000 });
  if (deleted.count === 0) return notFound();
  return jsonOk({ ok: true });
});
