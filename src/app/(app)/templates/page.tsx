import { redirect } from "next/navigation";
import { requireManagerSession } from "@/lib/auth/manager-page";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { DEFAULT_TEMPLATES } from "@/lib/templates";
import { TemplateManager } from "@/components/templates/template-manager";
import { listTemplatePage, normalizeTemplateQuery } from "@/lib/template-list";
import { messageTemplateCapForOrg, messageTemplateCapNotice } from "@/lib/template-cap";
import { clampPage, MAX_LIST_PAGE } from "@/lib/pagination";

export const dynamic = "force-dynamic";

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sayfa?: string }>;
}) {
  const session = await requireManagerSession();
  const sp = await searchParams;
  // Next 15 tekrarlanan parametreyi (?q=a&q=b) dizi olarak verebilir — ilki alınır (gelen kutusuyla aynı).
  const query = normalizeTemplateQuery(Array.isArray(sp.q) ? sp.q[0] : sp.q);
  const page = clampPage(Array.isArray(sp.sayfa) ? sp.sayfa[0] : sp.sayfa, MAX_LIST_PAGE);

  // Kurucu 11-19 akşam madde 1: sayfa BÜTÜN şablonları tam gövdeyle okuyordu (T2-B8). Artık seçiciyle AYNI sınırlı sorgu
  // (`lib/template-list.ts`): sayfa başına en çok 30, kısa önizleme; arama bütün şablonlarda; tam metin "Düzenle"de `GET /api/templates/[id]`.
  const [properties, list, allCount, cap] = await Promise.all([
    prisma.property.findMany({
      where: { organizationId: session.organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    listTemplatePage(session.organizationId, { scope: { kind: "manage" }, query, page }),
    // Başlıktaki sayı işletmenin TOPLAM özel şablonu (aramadan bağımsız); aramasızken liste toplamı zaten odur.
    query ? prisma.messageTemplate.count({ where: { organizationId: session.organizationId } }) : Promise.resolve(null),
    // Kurucu 11-20 sabah Ş-2: sınıra yaklaşınca uyarı satırı — eşik yürürlükteki sınırdan (plan tablosu / acil fren) türetilir.
    messageTemplateCapForOrg(session.organizationId),
  ]);
  // Sınırın saydığıyla aynı sayı: işletmenin bütün özel şablonları, pasifler dahil (aramadan bağımsız).
  const templateCount = allCount ?? list.total;

  const hrefFor = (p: number) => {
    const qs = new URLSearchParams();
    if (query) qs.set("q", query);
    if (p > 1) qs.set("sayfa", String(p));
    const s = qs.toString();
    return s ? `/templates?${s}` : "/templates";
  };
  // Aralık dışı sayfa → son geçerli sayfa (gelen kutusuyla aynı karar): son sayfadaki son şablon silinince boş ekran "hiç şablon yok" sanılmasın.
  const totalPages = Math.max(1, Math.ceil(list.total / list.pageSize));
  if (list.total > 0 && page > totalPages) redirect(hrefFor(totalPages));

  return (
    <>
      <PageHeader
        title="Şablonlar"
        description="Elle eklediğiniz hazır mesaj şablonları — bir konuşma ekranındaki “Şablonlar” düğmesiyle mesaja eklenir. (AI'ın misafir sorularını otomatik yanıtlarken kullandığı bilgiler için Bilgi Tabanı bölümünü kullanın.)"
      />

      <TemplateManager
        canManage={session.role === "owner" || session.role === "manager"}
        properties={properties}
        customTemplates={list.items.map((t) => ({
          id: t.id,
          title: t.title,
          preview: t.preview,
          category: t.category,
          language: t.language,
          isActive: t.isActive,
          propertyName: t.propertyName,
          propertyId: t.propertyId,
        }))}
        totalCount={templateCount}
        capNotice={messageTemplateCapNotice(templateCount, cap)}
        listing={{ query, page: list.page, pageSize: list.pageSize, matchCount: list.total }}
        defaultTemplates={DEFAULT_TEMPLATES}
      />
    </>
  );
}
