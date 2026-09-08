import { prisma } from "@/lib/db";
import { badRequest, jsonOk, notFound, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { limitsForOrg } from "@/lib/billing/plan-limits";
import { refreshPropertyMemoryBestEffort } from "@/modules/intelligence";

// Copy a knowledge-base entry to one or more OTHER apartments. Lets the host
// fill one apartment fully, then clone its info across the rest and only tweak
// the apartment-specific bits (door code, wifi, address line).
export const POST = withManage<{ id: string }>(async (session, req, { params }) => {
  const { id } = await params;

  // The source entry must belong to the caller's organization.
  const source = await prisma.knowledgeBaseItem.findFirst({
    where: { id, property: { organizationId: session.organizationId } },
    select: {
      propertyId: true,
      category: true,
      title: true,
      content: true,
      language: true,
      isActive: true,
    },
  });
  if (!source) return notFound();

  const body = await readJsonCappedOrNull(req);
  const requested: unknown = body?.targetPropertyIds;
  const ids = Array.isArray(requested)
    ? requested.filter((x): x is string => typeof x === "string")
    : [];
  if (ids.length === 0) {
    return badRequest({ targetPropertyIds: "En az bir hedef daire seçin." });
  }

  // Keep only valid targets in this org, and never copy onto the source itself.
  const targets = await prisma.property.findMany({
    where: {
      organizationId: session.organizationId,
      id: { in: ids },
      NOT: { id: source.propertyId },
    },
    select: { id: true },
  });

  // PLAN SINIRI KOPYALAMA YOLUNDA DA GEÇERLİ (denetim, 07-31). Bu rota eskiden
  // hiç saymıyordu: aynı kaydı 20 kez kopyalayan host hedef dairede 20 aktif
  // kayıt üretebiliyor, yani "daire başına N kayıt" sözü tek düğmeyle
  // delinebiliyordu. Sayım HEDEF DAİRE BAŞINA yapılır (sınır daire başına).
  //
  // Kısmi başarı bilinçli: sınırı dolmuş daire ATLANIR, diğerlerine kopyalanır
  // ve kaç tanesinin atlandığı çağırana DÖNER. Hepsini birden reddetmek, 10
  // daireden biri dolu diye 9 başarılı kopyayı iptal etmek olurdu.
  const limits = await limitsForOrg(session.organizationId);

  // KARAKTER KAPISI BURADA DA (denetim, 07-31). CLAUDE.md "POST ve PATCH ve
  // COPY" diyordu ama COPY'de yalnız ADET kontrolü vardı: tavan ÜSTÜNDEKİ eski
  // bir kayıt (20.000 karakter) tek düğmeyle 24 daireye çoğaltılabiliyordu —
  // yani "her şeyi tek kayda doldur" kaçışı fan-out ile geri açılıyordu.
  // Kaynak kaydı KİLİTLEMİYORUZ (o kendi dairesinde düzenlenebilir kalır),
  // yalnız ÇOĞALTILMASINI reddediyoruz.
  if (source.content.length > limits.kbCharsPerItem) {
    return badRequest({
      _: `Bu kayıt ${source.content.length.toLocaleString("tr-TR")} karakter ve kopyalama sınırı olan ${limits.kbCharsPerItem.toLocaleString("tr-TR")} karakteri aşıyor. Önce kaydı kısaltın, sonra kopyalayın.`,
    });
  }

  let created = 0;
  let skippedAtLimit = 0;
  for (const t of targets) {
    if (source.isActive) {
      const activeCount = await prisma.knowledgeBaseItem.count({
        where: { propertyId: t.id, isActive: true },
      });
      if (activeCount >= limits.kbItemsPerProperty) {
        skippedAtLimit++;
        continue;
      }
    }
    await prisma.knowledgeBaseItem.create({
      data: {
        propertyId: t.id,
        category: source.category,
        title: source.title,
        content: source.content,
        language: source.language,
        isActive: source.isActive,
      },
    });
    created++;
  }
  // V1: hedef mülklerin hafızası anında eşitlenir (org kapsamı; fırlatmaz).
  if (created > 0) await refreshPropertyMemoryBestEffort(session.organizationId);

  return jsonOk({
    ok: true,
    created,
    skippedAtLimit,
    ...(skippedAtLimit > 0
      ? {
          notice: `${skippedAtLimit} daire, planınızın bilgi tabanı sınırına (daire başına ${limits.kbItemsPerProperty} kayıt) ulaştığı için atlandı.`,
        }
      : {}),
  });
});
