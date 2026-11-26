import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { defaultCleanerWhere } from "@/lib/tasks/default-cleaner";
import { isStorableDate, propertyPatchSchema, zodFieldErrors } from "@/lib/validators";
import { KB_STALE_EDIT_MESSAGE } from "@/lib/kb/stale-edit";
import { badRequest, jsonOk, notFound, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { writeAudit, auditActor } from "@/lib/audit";
import { serializeSupplyProfile } from "@/lib/supply";
import { ERASABLE_STATUSES, SETTLED_OUTBOX_STATUSES } from "@/lib/outbox/state";
import { cancelRequestWrite } from "@/lib/outbox/dispatch";
import { REVIVABLE_LIFECYCLE_CANCEL_CODES } from "@/lib/outbox/enqueue";
import { ANON_BODY } from "@/lib/data-retention";
import { earlyCheckinRuleWhere } from "@/lib/early-checkin/rules";
import { houseRulesWhere } from "@/lib/house-rules/store";
import { STORAGE_PHOTO_URL_PREFIX } from "@/lib/storage/keys";
import { enqueueUnreferencedPhotoDeletions } from "@/lib/storage/deletion-queue";
import { normalizeGuestDisplayName } from "@/lib/guest-display-name";

/** Silinen dairenin, referansı başka dairede yaşayan otomatik mesaj satırının iptal kodu — tip gereği DİRİLTİLEBİLİR kümeden (↓DELETE). */
const SHARED_BOOKING_CANCEL_CODE: (typeof REVIVABLE_LIFECYCLE_CANCEL_CODES)[number] = "reservation_gone";

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
  const parsed = propertyPatchSchema.safeParse(data);
  if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));
  const { expectedUpdatedAt, ...d } = parsed.data;
  // Codex 11-17 H2: form TAM gövde gönderir (saatler, adres, notlar…); arada başka sekme / kişi kaydettiyse eski form onun değerini (ör.
  // yeni çıkış saati) sessizce GERİ YAZMASIN → 409, form açık kalır. Gönderilmezse (tek alan gönderen kartlar, eski istemci) bugünkü
  // davranış. Sözleşme bilgi tabanı düzenleyicisiyle aynı (`api/kb/[id]`).
  const expected = expectedUpdatedAt ? new Date(expectedUpdatedAt) : null;
  if (expectedUpdatedAt && (!expected || !isStorableDate(expected))) return badRequest({ _: "Geçersiz istek." });

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
      if (dupe) return badRequest({ name: "Bu isimde bir daire zaten var" });
    }
  }

  const changes = {
    name: d.name?.trim(),
    address: d.address === "" ? null : d.address,
    city: d.city === "" ? null : d.city,
    country: d.country === "" ? null : d.country,
    checkInTime: d.checkInTime,
    checkOutTime: d.checkOutTime,
    cleaningBufferMinutes: d.cleaningBufferMinutes,
    notes: d.notes === "" ? null : d.notes,
    // U4: misafire görünen ad — gönderilmediyse dokunulmaz, boş → temizlenir (başlık yalnız marka).
    guestDisplayName: d.guestDisplayName === undefined ? undefined : normalizeGuestDisplayName(d.guestDisplayName),
    // Only touch the profile when the client actually sent one (partial PATCH).
    supplyProfileJson:
      d.supplyProfile === undefined ? undefined : serializeSupplyProfile(d.supplyProfile),
  };
  // Koşullu yazım (sürüm hâlâ formun açıldığı sürümse; kapsam koşulu aynı sorguda) — iki eski form aynı anda gelse de yalnız biri yazar.
  // Okuma aynı işlemde: yazılan satır kilitli, araya giren silme okumayı boşa düşürüp 500 üretemez. Çatışmada denetim kaydı da yazılmaz.
  const property = expected
    ? await prisma.$transaction(async (tx) => {
        const res = await tx.property.updateMany({ where: { id, organizationId: session.organizationId, updatedAt: expected }, data: changes });
        return res.count === 1 ? tx.property.findUniqueOrThrow({ where: { id } }) : null;
      })
    : await prisma.property.update({ where: { id }, data: changes });
  if (!property) return NextResponse.json({ error: KB_STALE_EDIT_MESSAGE, fields: { _: KB_STALE_EDIT_MESSAGE } }, { status: 409 });
  // Gece-4 S6-14: kardeş ayar rotaları (gecelik fiyat, ev kuralları…) gibi denetimli — alan ADLARI, değerler değil.
  const fields = Object.keys(d).filter((k) => d[k as keyof typeof d] !== undefined);
  if (fields.length > 0) {
    await writeAudit({
      organizationId: session.organizationId,
      actorUserId: auditActor(session),
      action: "property.updated",
      metadata: { propertyId: id, fields },
    });
  }
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
  const [convs, ress, sharedRows] = await Promise.all([
    prisma.conversation.findMany({ where: { propertyId: id }, select: { id: true } }),
    prisma.reservation.findMany({ where: { propertyId: id }, select: { id: true, sourceReference: true } }),
    // Bu dairenin rezervasyon referanslarından, işletmenin BAŞKA bir dairesinde de kaydı olanlar (↓`sharedRefs`). Aynı turda okunur.
    prisma.$queryRaw<{ ref: string }[]>`
      SELECT DISTINCT o."sourceReference" AS ref
      FROM "Reservation" r
      JOIN "Reservation" o ON o."sourceReference" = r."sourceReference" AND o."propertyId" <> r."propertyId"
      JOIN "Property" p ON p."id" = o."propertyId"
      WHERE r."propertyId" = ${id} AND r."sourceReference" IS NOT NULL AND p."organizationId" = ${session.organizationId}`,
  ]);
  const convIds = convs.map((c) => c.id);
  const resIds = ress.map((r) => r.id);
  const srcRefs = ress.map((r) => r.sourceReference).filter((s): s is string => Boolean(s));
  const targets = [
    ...(convIds.length ? [{ conversationId: { in: convIds } }] : []),
    ...(resIds.length ? [{ reservationId: { in: resIds } }] : []),
    ...(srcRefs.length ? [{ externalReservationId: { in: srcRefs } }] : []),
  ];
  // 🚨 REFERANSI BAŞKA DAİREDE YAŞAYAN OTOMATİK MESAJ SATIRI (hata ayıklama ajanı G4, 11-26): aynı sağlayıcı rezervasyonu iki dairede
  // kayıtlıyken işçi mesajı TUTAR ("ev sahibi yanlış kaydı kaldırınca gider", `booking-property-conflict.ts`). Yanlış kayıt yanlış DAİRE
  // silinerek kaldırılınca referans hedefi doğru dairenin bekleyen satırını da "property_deleted" ile iptal ediyordu; bu kod diriltilebilir
  // değil → misafire giriş bilgisi / karşılama hiç gitmiyordu, sessizce. Kural:
  //  - satır başka dairenin rezervasyonuna aitse DOKUNULMAZ (işçi gönderim anında bütün kuralları yeniden uygular);
  //  - satır silinen dairenin rezervasyonuna aitse (gövdesi BU dairenin metninden kuruldu → o gövde gitmemeli) diriltilebilir
  //    "reservation_gone" koduyla iptal edilir; gönderici doğru dairenin metniyle aynı satırı yeniden bekleyen yapar (`enqueueProactive`).
  // Yanıt satırları (konuşmalı) ve referansı başka dairede yaşamayan satırlar eskisi gibi. Koşul OLUMLU yazılır: nullable kolonda `NOT`
  // boş referanslı satırı da dışarıda bırakırdı (yanıt satırı iptalden kaçardı).
  const sharedRefs = sharedRows.map((r) => r.ref);
  const scope: Prisma.MessageOutboxWhereInput = {
    organizationId: session.organizationId,
    ...(targets.length ? { OR: targets } : { id: "__none__" }),
    ...(sharedRefs.length
      ? { AND: [{ OR: [{ conversationId: { not: null } }, { externalReservationId: null }, { externalReservationId: { notIn: sharedRefs } }] }] }
      : {}),
  };
  const sharedOwnScope: Prisma.MessageOutboxWhereInput | null =
    sharedRefs.length && resIds.length
      ? { organizationId: session.organizationId, conversationId: null, externalReservationId: { in: sharedRefs }, reservationId: { in: resIds } }
      : null;
  // Sonuç ADIYLA okunur: dizi biçimli işlemde konumsal okuma (`[, result]`) araya adım eklenince yanlış satırın
  // sayısını okuyordu — kural silme eklenince kuralı OLMAYAN her mülk silinip 404 dönüyordu (09-24, yayın öncesi yakalandı).
  const deleted = await prisma.$transaction(async (tx) => {
    // Kilit sırası kural kaydıyla AYNI: önce mülk satırı (`saveEarlyCheckinRule` de önce onu kilitler) — ters sıra
    // eşzamanlı kural kaydı + silmede kilitlenme (deadlock) ya da silinmiş mülke sahipsiz kural bırakabilirdi.
    await tx.$queryRaw`SELECT 1 FROM "Property" WHERE "id" = ${id} AND "organizationId" = ${session.organizationId} FOR UPDATE`;
    // İşçinin elindeki, isteği henüz atılmamış satır aşağıdaki iptalden kaçar (talebi ezilmez) → ona iptal İSTEĞİ yazılır; işçi isteği
    // atmadan hemen önce bunu görür ve göndermez (`outbox/dispatch.ts`, konuşma silmeyle aynı kural).
    await tx.messageOutbox.updateMany(cancelRequestWrite(scope, "property_deleted", new Date()));
    await tx.messageOutbox.updateMany({
      where: { AND: [scope, { status: { in: [...ERASABLE_STATUSES] }, claimedBy: null }] },
      data: { status: "canceled", lastErrorKind: "canceled", lastErrorCode: "property_deleted" },
    });
    if (sharedOwnScope) {
      await tx.messageOutbox.updateMany(cancelRequestWrite(sharedOwnScope, SHARED_BOOKING_CANCEL_CODE, new Date()));
      await tx.messageOutbox.updateMany({
        where: { AND: [sharedOwnScope, { status: { in: [...ERASABLE_STATUSES] }, claimedBy: null }] },
        data: { status: "canceled", lastErrorKind: "canceled", lastErrorCode: SHARED_BOOKING_CANCEL_CODE },
      });
    }
    // 🚨 GÖVDE DE BOŞALIR (G2 tur 8 T8-B15; konuşma silmeyle aynı kural): kaskad konuşma / rezervasyonu götürünce saklama süpürgesi bu satırlara
    // bir daha ulaşamaz → misafire yazılmış metin (yanıt + yaşam döngüsü) SONUÇLANMIŞ satırlarda burada `ANON_BODY` olur (uçuştaki / belirsiz satır
    // kanal uzlaştırması için gövdesini korur — konuşma silmeyle aynı sınır).
    if (targets.length) {
      await tx.messageOutbox.updateMany({
        where: {
          AND: [
            sharedOwnScope ? { OR: [scope, sharedOwnScope] } : scope,
            { status: { in: [...SETTLED_OUTBOX_STATUSES] }, body: { not: ANON_BODY } },
          ],
        },
        data: { body: ANON_BODY },
      });
    }
    // Mülkün erken giriş kuralı ve ev kuralları da gider (FK yok; aynı kimlikle yeniden kullanılmasın, sahipsiz satır kalmasın).
    await tx.automationRule.deleteMany({ where: earlyCheckinRuleWhere(session.organizationId, id) });
    await tx.automationRule.deleteMany({ where: houseRulesWhere(session.organizationId, id) });
    await tx.automationRule.deleteMany({ where: defaultCleanerWhere(session.organizationId, id) });
    // 🚨 F11 (Codex 09-05): görev fotoğraflarının SİLME NİYETİ aynı işlemde (görev silme rotasıyla aynı sözleşme).
    // Kaskad görevleri ve güncellemelerini götürür; nesneleri gösteren satırlar gidince kovadaki fotoğraf sahipsiz
    // kalıyordu. Anahtarlar kilitten SONRA, silmeden hemen önce okunur; kiracı süzgeci kuyruğun tek boğazında.
    const photoRows = await tx.taskUpdate.findMany({
      where: { task: { propertyId: id }, photoUrl: { startsWith: STORAGE_PHOTO_URL_PREFIX } },
      select: { photoUrl: true },
    });
    const del = await tx.property.deleteMany({ where: { id, organizationId: session.organizationId } });
    // Yalnız artık hiçbir görevin göstermediği nesne (başka mülkün eski satırı aynı nesneyi gösterebilir — inceleme b1, 09-30).
    if (del.count > 0 && photoRows.length > 0) {
      await enqueueUnreferencedPhotoDeletions(tx, session.organizationId, photoRows.map((r) => r.photoUrl));
    }
    return del;
    // Etkileşimli işlemin varsayılan 5 sn / 2 sn sınırı dizi biçiminde YOKTU: kaskad silme (indekssiz SetNull
    // kolonları) veri büyüdükçe uzar; kardeş yazma yollarının sınırları (inceleme 09-24).
  }, { timeout: 60_000, maxWait: 15_000 });
  if (deleted.count === 0) return notFound();
  // Gece-4 S6-14: kalıcı kararlardaki "properties/[id] DELETE audit'siz (açık)" kapandı — mülk kimliği (ad yazılmaz).
  await writeAudit({
    organizationId: session.organizationId,
    actorUserId: auditActor(session),
    action: "property.deleted",
    metadata: { propertyId: id },
  });
  return jsonOk({ ok: true });
});
