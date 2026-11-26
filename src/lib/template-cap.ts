import "server-only";
import { Prisma, type MessageTemplate } from "@prisma/client";
import { prisma } from "@/lib/db";
import { limitsForOrg } from "@/lib/billing/plan-limits";

// ---------------------------------------------------------------------------
// ÖZEL MESAJ ŞABLONU SINIRI — tek kapı (kurucu 11-19 akşam madde 1; bulgu T2-B8). Tasarım: `docs/TASARIM-2026-11-19-sablon-listesi-ve-sinir.md`.
//
//  · Değer plan tablosundan (`PlanLimits.messageTemplatesPerOrg`, başlangıç 500) — koda gömülü kalıcı kural DEĞİL. `MESSAGE_TEMPLATE_CAP`
//    yalnız acil fren: yazılırsa plandan bağımsız herkese uygulanır (`AI_DAILY_CALL_CAP` emsali; geçersiz değer yok sayılır).
//  · Sayılan: işletmenin `MessageTemplate` satırları — PASİFLER DAHİL (pasife alma sınırsız biriktirme yolu olmasın). İşletme geneli
//    şablon (`propertyId` null) tek satırdır → bir kez sayılır. Koddaki hazır Lixus şablonları (`DEFAULT_TEMPLATES`) tabloda olmadığı için
//    sayılmaz; "Kendime uyarla" ile kaydedilen kopya ev sahibinin kendi satırıdır, sayılır.
//  · Yalnız BÜYÜME reddedilir: sınırı aşmış işletmenin hiçbir şablonu silinmez / gizlenmez; düzenleme, pasife alma / etkinleştirme,
//    silme ve kullanım sürer (bunlar satır sayısını artırmaz, buradan geçmez).
//  · Sayım + yazma TEK işlemde, işletme başına danışma kilidi altında (ekip kişisi / bilgi tabanı sınırlarının kalıbı): eşzamanlı iki
//    ekleme sınırı aşamaz. Kilit işlem sonunda (commit'ten sonra) bırakılır → sıradaki istek öncekinin satırını sayar.
//  · Tabloya şablon ekleyen her yol buradan geçer (kaynak pini `tests/unit/message-template-access.test.ts`; tek istisna demo sıfırlaması).
// ---------------------------------------------------------------------------

/** Şablon sınırı danışma kilidi ad alanı (diğerleri: 23 · 40–51). İşletme başına. */
const TEMPLATE_CAP_LOCK_NS = 52;

/**
 * Yalnız testler: kilitli bölgede sayımdan SONRA, yazmadan ÖNCE araya girme noktası (eşzamanlılık testi şansa kalmasın). Yazma işlem
 * istemcisinden yapıldığı için genel Prisma temsilcisine kurulan casus onu görmez — yarış testleri buradan kurulur (`__kbCapHooks` emsali).
 */
export const __templateCapHooks: { afterCount: null | ((organizationId: string) => Promise<void>) } = { afterCount: null };

/** `MESSAGE_TEMPLATE_CAP` — yalnız rakam (en çok 6 hane) ve ≥ 1 ise geçerli; aksi hâlde yok sayılır (sınır plandan gelir). */
export function messageTemplateCapOverride(): number | null {
  const raw = process.env.MESSAGE_TEMPLATE_CAP?.trim();
  if (!raw || !/^\d{1,6}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 ? n : null;
}

/** İşletmenin yürürlükteki şablon sınırı. Plan okuması `limitsForOrg` içinde fail-open (kullanım kapısı). */
export async function messageTemplateCapForOrg(organizationId: string): Promise<number> {
  return messageTemplateCapOverride() ?? (await limitsForOrg(organizationId)).messageTemplatesPerOrg;
}

/** Sınıra ulaşan ev sahibine gösterilen TEK metin (kapı ve ileti aynı sayıyı okur). */
export function messageTemplateCapMessage(cap: number): string {
  return `Özel şablon sınırına ulaştınız (${cap.toLocaleString("tr-TR")} şablon). Yeni şablon eklemek için kullanmadığınız bir şablonu silin.`;
}

/**
 * Şablonlar sayfasındaki sınır satırı (kurucu 11-20 sabah Ş-2: "Evet, 450'de uyarı"). Eşik sınırın %90'ı, SINIRDAN türetilir (450 koda
 * yazılmaz; sınır plan tablosundan / acil frenden gelir) ve yukarı yuvarlanır — uyarı hiçbir zaman %90'ın altında başlamaz. Sınıra ulaşan ya
 * da aşan işletmede uyarı yerine bugünkü sınır metni: TEK satır (iki satır aynı şeyi iki kez söylerdi). `count` sınırın saydığıyla aynı —
 * işletmenin bütün özel şablonları, pasifler dahil. Satır yoksa null.
 */
export function messageTemplateCapNotice(count: number, cap: number): string | null {
  if (count >= cap) return messageTemplateCapMessage(cap);
  if (count >= Math.ceil((cap * 9) / 10)) {
    return `Özel şablon sınırına yaklaşıyorsunuz (${count.toLocaleString("tr-TR")} / ${cap.toLocaleString("tr-TR")}).`;
  }
  return null;
}

export type TemplateCreateFields = {
  propertyId: string | null;
  category: string;
  title: string;
  body: string;
  language: string;
};

export type CreateTemplateResult = { kind: "created"; template: MessageTemplate } | { kind: "limit"; cap: number };

/**
 * Yeni özel şablonu sınır içinde yazar. Çağıran alanları doğrulamış ve daireyi işletmeye bağlamış olmalı (rota). Sınırdaysa HİÇ yazmaz
 * (silme / geri alma ara durumu yok).
 */
export async function createTemplateWithinCap(organizationId: string, fields: TemplateCreateFields): Promise<CreateTemplateResult> {
  const cap = await messageTemplateCapForOrg(organizationId);
  return prisma.$transaction(async (tx): Promise<CreateTemplateResult> => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${TEMPLATE_CAP_LOCK_NS}::int4, hashtext(${organizationId}))`);
    const count = await tx.messageTemplate.count({ where: { organizationId } });
    if (__templateCapHooks.afterCount) await __templateCapHooks.afterCount(organizationId);
    if (count >= cap) return { kind: "limit", cap };
    const template = await tx.messageTemplate.create({ data: { ...fields, organizationId, isActive: true } });
    return { kind: "created", template };
  });
}
