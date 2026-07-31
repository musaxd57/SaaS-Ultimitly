import { prisma } from "@/lib/db";
import { kbUpdateSchema, zodFieldErrors } from "@/lib/validators";
import { badRequest, jsonOk, notFound, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { limitsForOrg } from "@/lib/billing/plan-limits";
import { KB_ITEM_CAP } from "@/lib/ai/limits";

// ---------------------------------------------------------------------------
// PLAN SINIRLARI DÜZENLEME YOLUNDA DA GEÇERLİ (denetim, 07-31).
//
// Bu rota uzun süre HİÇBİR sınır uygulamıyordu; sınırlar yalnız POST'taydı. İki
// ayrı kaçış açıktı ve ikisi de tek istekle sömürülebiliyordu:
//  1. ADET — sınır YALNIZ aktif kayıtları sayar. 15 ekle → PATCH ile hepsini
//     pasife al (aktif=0) → 15 daha ekle → PATCH ile eskileri geri aktifleştir.
//     Sonuç: Başlangıç planında sınırsız aktif kayıt.
//  2. KARAKTER — POST 3.000'de kesiyordu ama `kbUpdateSchema` 20.000'e izin
//     veriyordu; tek bir PATCH tavanı 6,6 katına çıkarıyordu. Karakter tavanının
//     VARLIK SEBEBİ adet sınırının delinmesini engellemekti, yani bu kaçış
//     doğrudan ilkini de geçersiz kılıyordu.
//
// ⚠️ ESKİ KAYITLAR KİLİTLENMEZ: tavan bugün yürürlüğe girdiği için 3.000'den
// uzun kayıtlar mevcut olabilir. Sadece BÜYÜME reddedilir — host böyle bir kaydı
// kısaltarak veya aynı uzunlukta bırakarak her zaman kaydedebilir. Aksi hâlde
// kendi kaydını düzenleyemeyen bir müşteri yaratırdık.
// ---------------------------------------------------------------------------
export const PATCH = withManage<{ id: string }>(async (session, req, { params }) => {
  const { id } = await params;
  const existing = await prisma.knowledgeBaseItem.findFirst({
    where: { id, property: { organizationId: session.organizationId } },
    select: { id: true, propertyId: true, isActive: true, content: true },
  });
  if (!existing) return notFound();

  const data = await readJsonCappedOrNull(req);
  const parsed = kbUpdateSchema.safeParse(data);
  if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));
  const d = parsed.data;

  const limits = await limitsForOrg(session.organizationId);

  // Eşik: tavan VEYA (tavanın üstündeyse) MEVCUT uzunluk — hangisi büyükse.
  // İlk sürüm sadece "yeni > eski" diyordu, yani 20.000 karakterlik eski bir
  // kayıt BAŞKA bir 20.000 karakterlik içerikle sınırsızca yeniden yazılabiliyor
  // ve "her şeyi tek kayda doldur" kaçışı elde bir tane eski uzun kayıt varken
  // açık kalıyordu (denetim, 07-31). Artık o kayıt yalnız KISALABİLİR.
  const allowedChars = Math.max(limits.kbCharsPerItem, existing.content.length);
  if (typeof d.content === "string" && d.content.length > allowedChars) {
    return badRequest({
      content: `Tek bir bilgi kaydı en fazla ${limits.kbCharsPerItem.toLocaleString("tr-TR")} karakter olabilir. Uzun bilgileri birkaç kayda bölün — AI bir yanıtta en güncel ${KB_ITEM_CAP} kaydı okur.`,
    });
  }

  // Pasiften aktife geçiş = yeni bir aktif kayıt yaratmakla aynı şey; aynı kapıdan
  // geçmeli. Zaten aktif olan bir kaydı düzenlemek sayımı değiştirmez → serbest.
  if (d.isActive === true && !existing.isActive) {
    const activeCount = await prisma.knowledgeBaseItem.count({
      where: { propertyId: existing.propertyId, isActive: true },
    });
    if (activeCount >= limits.kbItemsPerProperty) {
      return badRequest({
        _: `Planınızın izin verdiği bilgi tabanı sınırına ulaştınız (daire başına ${limits.kbItemsPerProperty} kayıt). Bu kaydı aktifleştirmek için önce başka bir kaydı pasife alın veya planınızı yükseltin.`,
      });
    }
  }

  const item = await prisma.knowledgeBaseItem.update({
    where: { id },
    data: d,
  });
  return jsonOk(item);
});

export const DELETE = withManage<{ id: string }>(async (session, _req, { params }) => {
  const { id } = await params;
  const result = await prisma.knowledgeBaseItem.deleteMany({
    where: { id, property: { organizationId: session.organizationId } },
  });
  if (result.count === 0) return notFound();
  return jsonOk({ ok: true });
});
