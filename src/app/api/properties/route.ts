import { prisma } from "@/lib/db";
import { propertySchema, zodFieldErrors } from "@/lib/validators";
import { badRequest, jsonOk, forbidden, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { generateCalendarToken } from "@/lib/export/ics";
import { canAddProperty } from "@/lib/billing/subscription";

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

export const GET = withManage(async (session) => {
  const properties = await prisma.property.findMany({
    where: { organizationId: session.organizationId },
    orderBy: { createdAt: "desc" },
  });
  return jsonOk(properties.map(stripPropertySecrets));
});

export const POST = withManage(async (session, req) => {
  const data = await readJsonCappedOrNull(req);
  const parsed = propertySchema.safeParse(data);
  if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));
  const d = parsed.data;
  const name = d.name.trim();

  // One property per name within the org — prevents confusing duplicate-named
  // listings. App-level (no DB constraint) so existing rows are never touched —
  // adding a DB unique to a populated table is forbidden here (see schema
  // header). Sync (linkProperty) adopts same-named properties separately.
  const dupe = await prisma.property.findFirst({
    where: { organizationId: session.organizationId, name: { equals: name, mode: "insensitive" } },
    select: { id: true },
  });
  if (dupe) return badRequest({ name: "Bu isimde bir mülk zaten var" });

  // Plan limit (Faz 2). NON-BLOCKING while billing is dormant: canAddProperty
  // returns { allowed: true } unless BILLING_ENFORCED=true, so this changes
  // nothing today and only gates once the paywall is switched on.
  const gate = await canAddProperty(session.organizationId);
  if (!gate.allowed) {
    const message =
      gate.reason === "property_limit"
        ? `Planınız en fazla ${gate.limit} daireye izin veriyor. Daha fazla daire için planınızı yükseltin.`
        : "Aboneliğiniz aktif değil. Daire eklemek için bir plan seçin.";
    return forbidden(message);
  }

  const createData = {
    organizationId: session.organizationId,
    name,
    address: d.address || null,
    city: d.city || null,
    country: d.country || null,
    checkInTime: d.checkInTime,
    checkOutTime: d.checkOutTime,
    cleaningBufferMinutes: d.cleaningBufferMinutes,
    notes: d.notes || null,
    icalToken: generateCalendarToken(),
  };

  // Codex #17: the gate above is count-then-create — concurrent requests at limit-1 could ALL pass and overshoot the plan.
  // 10-10 (ölçüldü — tam koşu, 4 eşzamanlı istekte 2 oluşturma): eski düzeltme oluşturduktan SONRA satırları `createdAt`
  // sırasına dizip fazladaysa kendini siliyordu; ama `createdAt` ekleme anında atanır, satır commit anında görünür — erken
  // damgalı satırın commit'i diğer isteğin okumasından sonra görünürse ikisi de kendini sınır içinde sanıyordu. Artık plan
  // sınırı varken sayım + oluşturma TEK işlemde, kuruluş satırının `FOR UPDATE` kilidi altında (takvim kaynağı kotasının
  // kalıbı, U38): eşzamanlı oluşturmalar sıraya girer, sınırdaki istek hiç oluşturmaz (silme yok → "silme başarısız" ara
  // durumu da yok). Sınırsız plan / faturalandırma uyurken (`gate.limit` boş) yol DEĞİŞMEDİ.
  const limit = gate.limit;
  const property =
    limit != null
      ? await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${session.organizationId} FOR UPDATE`;
          if ((await tx.property.count({ where: { organizationId: session.organizationId } })) >= limit) return null;
          return tx.property.create({ data: createData });
        })
      : await prisma.property.create({ data: createData });
  if (!property) {
    return forbidden(`Planınız en fazla ${limit} daireye izin veriyor. Daha fazla daire için planınızı yükseltin.`);
  }
  return jsonOk(stripPropertySecrets(property), 201);
});
