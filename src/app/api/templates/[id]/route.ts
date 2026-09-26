import { prisma } from "@/lib/db";
import { z } from "zod";
import { badRequest, jsonOk, notFound, propertyInOrg, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { zodFieldErrors } from "@/lib/validators";

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
  // çıktıya KOYAR (ParseStatus yalnız `undefined` kalan anahtarları eler) —
  // yani `propertyId` HİÇ GÖNDERİLMEYEN bir istek (ör. yalnız `isActive`
  // güncelleyen bir düğme) şablonu sessizce "Tüm mülkler"e taşırdı. Alan ham
  // bırakılır, normalizasyon aşağıda AÇIKÇA yapılır.
  propertyId: z.string().max(50).nullable().optional(),
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

  const { propertyId, ...rest } = parsed.data;
  const patch: Record<string, unknown> = { ...rest };
  if (propertyId !== undefined) {
    // 🚨 KİRACI KAPISI: kimlik doğru biçimli ama BAŞKA org'un mülkü olabilir.
    const target = propertyId || null;
    if (target && !(await propertyInOrg(target, session.organizationId))) {
      return badRequest({ propertyId: "Geçersiz mülk" });
    }
    patch.propertyId = target;
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
