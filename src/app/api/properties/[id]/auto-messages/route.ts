import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { badRequest, jsonOk, notFound, readJsonCappedOrNull, tooManyRequests } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { writeAudit, auditActor } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { isUniqueViolation } from "@/lib/db-errors";
import { AUTO_MESSAGE_MAX_CHARS, isAutoMessageKind, previewAutoMessage } from "@/lib/auto-messages/render";
import { loadAutoMessagesView } from "@/lib/auto-messages/store";

// ---------------------------------------------------------------------------
// DAİRENİN OTOMATİK MESAJLARI (kurucu T4, 10-21): karşılama · giriş · çıkış metni bilgi tabanından AYRI, burada açıkça değişir.
//  GET  → üç metin + uyarılar (atlama sebebi, geçiş kontrolü, bilgi tabanı bu metinden sonra değişti mi) + her birinin önizlemesi.
//  POST → kaydetmeden ÖNİZLEME (misafire gidecek metnin aynısı, örnek adla) — hiçbir şey yazmaz.
//  PUT  → kaydet: `expectedRevision` ile (iki yönetici birbirinin üstüne yazmasın → 409); her kayıtta sürüm +1 (kuyruktaki eski metin
//         gönderimden önce yeniden kurulur). Boş metin = bu mesaj gönderilmez (satır silinmez). Denetim kaydı metinsiz.
// Giriş mesajı kapı kodu taşıyabilir → yalnız sahip / yönetici (`withManage`); personel görmez.
// ---------------------------------------------------------------------------

const KIND_ERROR = "Geçersiz mesaj türü.";
const TOO_LONG = `Mesaj en çok ${AUTO_MESSAGE_MAX_CHARS.toLocaleString("tr-TR")} karakter olabilir.`;
const STALE = "Bu mesaj siz düzenlerken değişti. Sayfayı yenileyip yeniden deneyin.";

async function propertyOf(organizationId: string, id: string) {
  return prisma.property.findFirst({
    where: { id, organizationId },
    select: { id: true, name: true, organization: { select: { aiSignature: true } } },
  });
}

export const GET = withManage<{ id: string }>(async (session, _req, { params }) => {
  const { id } = await params;
  const property = await propertyOf(session.organizationId, id);
  if (!property) return notFound();
  const messages = await loadAutoMessagesView(session.organizationId, property, property.organization.aiSignature?.trim() || undefined);
  return jsonOk({ messages });
});

export const POST = withManage<{ id: string }>(async (session, req, { params }) => {
  const { id } = await params;
  const limited = await rateLimit(`auto-message-preview:${session.userId}`, 60, 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);
  const data = await readJsonCappedOrNull<{ kind?: unknown; body?: unknown }>(req);
  if (!isAutoMessageKind(data?.kind)) return badRequest({ kind: KIND_ERROR });
  if (typeof data.body !== "string") return badRequest({ body: "Mesaj metni gerekli." });
  if (data.body.length > AUTO_MESSAGE_MAX_CHARS) return badRequest({ body: TOO_LONG });
  const property = await propertyOf(session.organizationId, id);
  if (!property) return notFound();
  return jsonOk({ preview: previewAutoMessage(data.body, property.name, property.organization.aiSignature?.trim() || undefined) });
});

export const PUT = withManage<{ id: string }>(async (session, req, { params }) => {
  const { id } = await params;
  const limited = await rateLimit(`auto-message-save:${session.userId}`, 30, 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);
  const data = await readJsonCappedOrNull<{ kind?: unknown; body?: unknown; expectedRevision?: unknown }>(req);
  if (!isAutoMessageKind(data?.kind)) return badRequest({ kind: KIND_ERROR });
  if (typeof data.body !== "string") return badRequest({ body: "Mesaj metni gerekli." });
  if (data.body.length > AUTO_MESSAGE_MAX_CHARS) return badRequest({ body: TOO_LONG });
  // NUL karakteri PostgreSQL metninde saklanamaz (500 yerine anlaşılır ret — Haiku T4 #7).
  if (data.body.includes("\u0000")) return badRequest({ body: "Mesajda geçersiz karakter var." });
  const expected = data.expectedRevision;
  if (typeof expected !== "number" || !Number.isInteger(expected) || expected < 0) return badRequest({ expectedRevision: STALE });
  const property = await propertyOf(session.organizationId, id);
  if (!property) return notFound();
  const kind = data.kind;
  const body = data.body;
  const actor = auditActor(session);
  const cleared = { needsReview: false, lastSkipReason: null, lastSkippedAt: null, updatedByUserId: actor };

  let revision: number;
  if (expected === 0) {
    // İlk kayıt: satır yoksa açılır; aynı anda iki ilk kayıt → benzersizlik ihlali → 409 (biri kazanır).
    try {
      const created = await prisma.autoMessageTemplate.create({
        data: { organizationId: session.organizationId, propertyId: property.id, kind, body, revision: 1, ...cleared },
        select: { revision: true },
      });
      revision = created.revision;
    } catch (err) {
      if (isUniqueViolation(err, ["propertyId", "kind"])) return NextResponse.json({ error: STALE }, { status: 409 });
      throw err;
    }
  } else {
    const updated = await prisma.autoMessageTemplate.updateMany({
      where: { propertyId: property.id, organizationId: session.organizationId, kind, revision: expected },
      data: { body, revision: { increment: 1 }, ...cleared },
    });
    if (updated.count !== 1) return NextResponse.json({ error: STALE }, { status: 409 });
    revision = expected + 1;
  }
  await writeAudit({
    organizationId: session.organizationId,
    actorUserId: auditActor(session),
    action: "property.auto_message_saved",
    // Metin YAZILMAZ (kapı kodu taşıyabilir) — yalnız tür, sürüm ve boş mu.
    metadata: { propertyId: property.id, kind, revision, empty: body.trim() === "" },
  });
  const signature = property.organization.aiSignature?.trim() || undefined;
  return jsonOk({ kind, body, revision, preview: previewAutoMessage(body, property.name, signature) });
});
