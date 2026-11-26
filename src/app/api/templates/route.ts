import { z } from "zod";
import { badRequest, jsonOk, propertyInOrg, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { zodFieldErrors } from "@/lib/validators";
import { clampPage, MAX_LIST_PAGE } from "@/lib/pagination";
import { createTemplateWithinCap, messageTemplateCapMessage } from "@/lib/template-cap";
import { listTemplatePage } from "@/lib/template-list";

const templateCreateSchema = z.object({
  // "Tüm mülkler" (org-wide template) arrives as null from the form — nullish
  // accepts null/undefined/string; ""/null both normalize to null. The old
  // string-only shape REJECTED null, so creating an org-wide template 400'd
  // with a bare "Doğrulama hatası" (user-reported bug).
  propertyId: z.string().max(50).nullish().transform((v) => v || null),
  category: z.string().min(1, "Kategori gerekli").max(80),
  title: z.string().min(2, "Başlık gerekli").max(300),
  body: z.string().min(2, "İçerik gerekli").max(20000),
  language: z.string().max(10).default("tr"),
});

// Mesaj yazarken açılan şablon seçicisinin listesi (kurucu 11-19 akşam madde 1). Eskiden işletmenin BÜTÜN etkin şablonlarını tam gövdeyle
// tek yanıtta döküyordu (T2-B8: 3.000 şablonda 284 MB yığın). Artık yönetim sayfasıyla AYNI sınırlı sorgu (`lib/template-list.ts`): sayfa
// başına en çok 30 kalem, kısa önizleme; tam metin seçilince `GET /api/templates/[id]`. `q` işletmenin bütün şablonlarında arar; `page` 1'den.
// Yanıt `{ items, total, page, pageSize, hasMore }` (eskiden dizi; tek çağıran seçici).
export const GET = withManage(async (session, req) => {
  const { searchParams } = new URL(req.url);
  const page = await listTemplatePage(session.organizationId, {
    scope: {
      kind: "compose",
      propertyId: searchParams.get("propertyId") || null,
      includeDefaults: searchParams.get("includeDefaults") !== "false",
    },
    query: searchParams.get("q") ?? "",
    page: clampPage(searchParams.get("page") ?? undefined, MAX_LIST_PAGE),
  });
  return jsonOk(page);
});

export const POST = withManage(async (session, req) => {
  const data = await readJsonCappedOrNull(req);
  const parsed = templateCreateSchema.safeParse(data);
  if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));
  const d = parsed.data;

  if (d.propertyId) {
    if (!(await propertyInOrg(d.propertyId, session.organizationId))) {
      return badRequest({ propertyId: "Geçersiz daire" });
    }
  }

  // İşletme başına özel şablon sınırı (kurucu 11-19 akşam madde 1): sayım + yazma tek işlemde, işletme kilidi altında (`lib/template-cap.ts`)
  // — eşzamanlı iki ekleme sınırı aşamaz. Yalnız büyüme reddedilir: sınırı aşmış işletmede düzenleme / silme / kullanım bu yoldan geçmez.
  const outcome = await createTemplateWithinCap(session.organizationId, {
    propertyId: d.propertyId ?? null,
    category: d.category,
    title: d.title,
    body: d.body,
    language: d.language,
  });
  if (outcome.kind === "limit") return badRequest({ _: messageTemplateCapMessage(outcome.cap) });

  return jsonOk(outcome.template, 201);
});
