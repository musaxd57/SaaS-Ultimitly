import { Building2 } from "lucide-react";
import { requireManagerSession } from "@/lib/auth/manager-page";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { LinkButton } from "@/components/ui/link-button";
import { EmptyState } from "@/components/empty-state";
import { KbManager, type KbItem } from "@/components/knowledge/kb-manager";
import { aiReadableForConflicts, kbTimeConflicts, type KbTimeConflictRow } from "@/lib/kb-time-conflicts";
import { AUTO_MESSAGE_LABEL, type AutoMessageKind } from "@/lib/auto-messages/render";
import { detectKbInstructionHijack } from "@/lib/ai/fallback";
import { parseKbPrefill } from "@/lib/kb-prefill";
import { paidPlanFeatureAllowed } from "@/lib/billing/subscription";
import { isImpersonating } from "@/lib/auth/impersonation";
import { buttonVariants } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireManagerSession();
  const [properties, items, autoMessages] = await Promise.all([
    prisma.property.findMany({
      where: { organizationId: session.organizationId },
      select: { id: true, name: true, checkInTime: true, checkOutTime: true },
      orderBy: { name: "asc" },
    }),
    prisma.knowledgeBaseItem.findMany({
      where: { property: { organizationId: session.organizationId } },
      include: { property: { select: { name: true } } },
      orderBy: [{ propertyId: "asc" }, { category: "asc" }],
    }),
    prisma.autoMessageTemplate.findMany({
      where: { organizationId: session.organizationId, kind: { in: ["checkin", "checkout"] } },
      select: { id: true, propertyId: true, kind: true, body: true },
    }),
  ]);

  const kbItems: KbItem[] = items.map((i) => ({
    id: i.id,
    propertyId: i.propertyId,
    propertyName: i.property.name,
    category: i.category,
    title: i.title,
    content: i.content,
    language: i.language,
    isActive: i.isActive,
  }));

  // "Uyuşmayan saatler" — yalnız AI'ın GERÇEKTEN okuduğu kalemler üzerinden (aktif + onay kapısı +
  // halefi olmayan); taslak ya da pasif bir kalem host'a sahte çelişki göstermesin.
  const timeConflicts: Record<string, KbTimeConflictRow[]> = {};
  for (const p of properties) {
    // Kurucu T4 (10-21): dairenin otomatik giriş / çıkış mesajı da kıyasa girer — misafire AYNEN gider, saat uyuşmazlığı burada görünür.
    const autoItems = autoMessages
      .filter((a) => a.propertyId === p.id && a.body.trim() !== "")
      .map((a) => ({ id: `auto-message:${a.id}`, title: AUTO_MESSAGE_LABEL[a.kind as AutoMessageKind] ?? a.kind, category: a.kind, content: a.body, sentAutomatically: true }));
    const rows = kbTimeConflicts(p, [...aiReadableForConflicts(items.filter((i) => i.propertyId === p.id)), ...autoItems]);
    if (rows.length > 0) timeConflicts[p.id] = rows;
  }
  // Yapay zekâya komut veren ifade taşıyan kalemler: `kb-fetch` onları isteme HİÇ koymaz (her
  // boyutta); host bunu kalemin yanında görür — güvenlik süzgeci sessiz bilgi kaybına dönüşmesin.
  const hijackIds = items.filter((i) => detectKbInstructionHijack(`${i.title}\n${i.content}`)).map((i) => i.id);
  // B1 (kurucu 10-11): gelen kutusundaki "Eksik bilgi" → form ön dolu (mülk / kategori / başlık). Yalnız oturumun kendi mülkü;
  // ev sahibi içeriği yazıp kendisi kaydeder.
  const prefill = parseKbPrefill(await searchParams, properties.map((p) => p.id));
  // Kurucu 10-28 §7-A (3): "Dışa aktar" ücretli paket özelliği — deneme sürümünde ve destek görünümünde düğme HİÇ görünmez (uç da aynı
  // kapıyla 403 der; düğme yalnız kullanılabilirken çıkar). Kalem yoksa indirilecek bir şey de yok.
  const canExport = items.some((i) => i.isActive) && !isImpersonating(session) && (await paidPlanFeatureAllowed(session.organizationId)).ok;

  return (
    <>
      <PageHeader
        title="Bilgi Tabanı"
        description="Buraya girdiğiniz mülke özel bilgiler (Wi-Fi, giriş yöntemi, ev kuralları, çevre önerileri…) yapay zekânın misafir sorularına verdiği cevapları besler. Karşılama, giriş ve çıkış mesajlarını her dairenin sayfasındaki “Otomatik mesajlar” bölümünden düzenleyin; elle kullandığınız hazır metinler için Şablonlar bölümünü kullanın."
      >
        {canExport ? (
          // Dosya indirmesi: düz bağlantı (istemci yönlendirmesi değil). Sunucu ek dosyası döner.
          <a href="/api/kb/export" download className={buttonVariants({ variant: "outline", size: "sm" })}>
            Dışa aktar
          </a>
        ) : null}
      </PageHeader>

      {properties.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Önce bir mülk ekleyin"
          description="Bilgi tabanı her mülke bağlıdır. En az bir mülk gerekli."
        >
          <LinkButton href="/properties/new" size="sm">
            Mülk ekle
          </LinkButton>
        </EmptyState>
      ) : (
        <KbManager
          properties={properties.map((p) => ({ id: p.id, name: p.name }))}
          items={kbItems}
          timeConflicts={timeConflicts}
          hijackIds={hijackIds}
          prefill={prefill}
        />
      )}
    </>
  );
}
