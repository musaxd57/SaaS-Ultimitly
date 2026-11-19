import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { badRequest, jsonOk, notFound, propertyInOrg, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { isStorableDate, zodFieldErrors } from "@/lib/validators";
import { KB_STALE_EDIT_MESSAGE } from "@/lib/kb/stale-edit";
import { getTemplateDetail } from "@/lib/template-list";

// Bounds mirror templateCreateSchema (templates/route.ts) so an update can't
// store an unbounded payload the create path would have rejected.
const templateUpdateSchema = z.object({
  title: z.string().min(2).max(300).optional(),
  body: z.string().min(2).max(20000).optional(),
  // `min(1)` create şemasıyla PARİTE (inceleme ajanı 09-11): eksikti ve
  // `PATCH {"category": ""}` boş kategori yazıyordu — liste rozeti boşalıyor ve
  // o şablon bir daha KB önerisi olamıyordu (allowlist "" anahtarını tanımaz).
  category: z.string().min(1, "Kategori gerekli").max(80).optional(),
  language: z.string().max(10).optional(),
  isActive: z.boolean().optional(),
  // 🚨 "Tüm mülkler" ↔ tek mülk taşıması. Alan YOKKEN düzenleme ekranı mülk
  // seçimini gönderiyor ama rota onu SESSİZCE YUTUYORDU: host "bu şablonu
  // yalnız Lale 3'e bağla" dedikten sonra şablon org genelinde kalıyordu.
  //
  // 🚨 Create şemasındaki `.nullish().transform(v => v || null)` BURAYA
  // YAZILAMAZ: zod, dönüşüm `undefined`'ı `null`'a çevirdiğinde anahtarı
  // çıktıya KOYAR (zod yalnız `undefined` kalan anahtarı eler; zod 4'te aynı, 10-28 ölçüldü) —
  // yani `propertyId` HİÇ GÖNDERİLMEYEN bir istek (ör. yalnız `isActive`
  // güncelleyen bir düğme) şablonu sessizce "Tüm mülkler"e taşırdı. Alan ham
  // bırakılır, normalizasyon aşağıda AÇIKÇA yapılır.
  propertyId: z.string().max(50).nullable().optional(),
  // Codex 11-17 H1: düzenleme formunun açıldığı sürüm (`updatedAt`, ISO). Form TAM gövde gönderir; arada başka sekme / kişi kaydettiyse
  // eski form onun metnini sessizce GERİ YAZMASIN → 409, form açık kalır. İsteğe bağlı: göndermeyen çağıran (eski istemci) bugünkü gibi
  // koşulsuz yazar. Yazılmaz, yalnız koşul (bilgi tabanı düzenleyicisiyle aynı sözleşme, `api/kb/[id]`).
  expectedUpdatedAt: z.string().max(40).optional(),
});

// Seçilen şablonun TAM metni (kurucu 11-19 akşam madde 1): liste yalnız kısa önizleme taşır; mesaj yazarken seçicide seçim ve yönetim
// sayfasında "Düzenle" gövdeyi buradan alır. İşletme kapsamında (başka işletmenin kimliği 404); `default-…` kimliği koddaki hazır şablon.
// Pasif şablon da okunur (yönetim sayfası düzenler; seçici listesi zaten yalnız etkinleri gösterir).
export const GET = withManage<{ id: string }>(async (session, _req, { params }) => {
  const { id } = await params;
  const template = await getTemplateDetail(session.organizationId, id);
  if (!template) return notFound();
  return jsonOk(template);
});

export const PATCH = withManage<{ id: string }>(async (session, req, { params }) => {
  const { id } = await params;
  const existing = await prisma.messageTemplate.findFirst({
    where: { id, organizationId: session.organizationId },
    select: { id: true },
  });
  if (!existing) return notFound();

  const data = await readJsonCappedOrNull(req);
  const parsed = templateUpdateSchema.safeParse(data);
  if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));

  const { propertyId, expectedUpdatedAt, ...rest } = parsed.data;
  const expected = expectedUpdatedAt ? new Date(expectedUpdatedAt) : null;
  if (expectedUpdatedAt && (!expected || !isStorableDate(expected))) return badRequest({ _: "Geçersiz istek." });
  const patch: Record<string, unknown> = { ...rest };
  if (propertyId !== undefined) {
    // 🚨 KİRACI KAPISI: kimlik doğru biçimli ama BAŞKA org'un mülkü olabilir.
    const target = propertyId || null;
    if (target && !(await propertyInOrg(target, session.organizationId))) {
      return badRequest({ propertyId: "Geçersiz daire" });
    }
    patch.propertyId = target;
  }

  if (expected) {
    // Koşullu yazım: sürüm hâlâ formun açıldığı sürümse yazılır (kapsam koşulu da aynı sorguda) — iki eski form aynı anda gelse de
    // yalnız biri yazar. Okuma aynı işlemde: yazılan satır kilitli, araya giren silme okumayı boşa düşürüp 500 üretemez.
    const written = await prisma.$transaction(async (tx) => {
      const res = await tx.messageTemplate.updateMany({ where: { id, organizationId: session.organizationId, updatedAt: expected }, data: patch });
      return res.count === 1 ? tx.messageTemplate.findUniqueOrThrow({ where: { id } }) : null;
    });
    if (!written) return NextResponse.json({ error: KB_STALE_EDIT_MESSAGE, fields: { _: KB_STALE_EDIT_MESSAGE } }, { status: 409 });
    return jsonOk(written);
  }
  const template = await prisma.messageTemplate.update({
    where: { id },
    data: patch,
  });
  return jsonOk(template);
});

export const DELETE = withManage<{ id: string }>(async (session, _req, { params }) => {
  const { id } = await params;
  const result = await prisma.messageTemplate.deleteMany({
    where: { id, organizationId: session.organizationId },
  });
  if (result.count === 0) return notFound();
  return jsonOk({ ok: true });
});
