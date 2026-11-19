import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DEFAULT_TEMPLATES } from "@/lib/templates";

// ---------------------------------------------------------------------------
// MESAJ ŞABLONU LİSTESİ — TEK SINIRLI SORGU (kurucu 11-19 akşam madde 1; bulgu T2-B8: liste ucu ve yönetim sayfası bütün şablonları tam
// gövdeyle okuyordu — 3.000 şablonda tek istek 284 MB yığın). Yönetim sayfası (`/templates`) ve mesaj yazarken açılan seçici
// (`GET /api/templates`) AYNI fonksiyondan okur. Tasarım: `docs/TASARIM-2026-11-19-sablon-listesi-ve-sinir.md`.
//
//  · Veritabanından en çok `TEMPLATE_PAGE_SIZE` satır (sayfa numaralı). Sıra `createdAt desc, id desc`: kimlik eşitlik bozucu — aynı anda
//    yazılmış satırlar sayfa sınırında kaymaz, tekrarlanmaz, kaybolmaz.
//  · Kalemde başlık, kategori, dil, daire, sürüm + KISA ÖNİZLEME; tam gövde yalnız seçilince (`getTemplateDetail` → `GET /api/templates/[id]`).
//    Sunucu sayfadaki satırların gövdesini okuyup keser: bellek sayfa boyuyla sınırlı (gövdeyi veritabanında kesmek ham SQL isterdi).
//  · Arama işletmenin BÜTÜN şablonlarında, sunucuda: başlık VEYA gövde, büyük / küçük harf duyarsız (gelen kutusu aramasıyla aynı
//    `contains` + `insensitive`). Prisma `contains` `%` / `_` / `\` kaçışlamıyor (6.2.1'de ölçüldü: `%` araması her satırı buluyordu) →
//    elle kaçışlanır. Bilinen sınır (gelen kutusuyla aynı): veritabanı yereli C.UTF-8'de büyük "I" ile "ı" eşleşmez.
//  · Kapsam: `manage` (yönetim) pasifler dahil bütün şablonlar; `compose` (seçici) yalnız etkinler, daire verilmişse o dairenin + işletme
//    geneli (daire yoksa bugünkü uç gibi daire süzgeci yok). Hazır Lixus şablonları (koddaki sabitler) istenirse ÖZEL şablonların ARDINDAN aynı
//    sıraya ve sayfalamaya girer — yanıt yine en çok bir sayfa.
// ---------------------------------------------------------------------------

export const TEMPLATE_PAGE_SIZE = 30;
/** Önizleme uzunluğu (karakter). Yönetim kartı üç, seçici iki satır gösterir; bu ikisini de doldurur. */
export const TEMPLATE_PREVIEW_CHARS = 200;
/** Arama metni tavanı (karakter): şablon başlığı 300'e kadar olabilir ama aranan ifade kısa olur; tavan sorgu maliyetini sınırlar. */
export const TEMPLATE_QUERY_MAX_CHARS = 100;

export interface TemplateSummary {
  id: string;
  title: string;
  category: string;
  language: string;
  isActive: boolean;
  /** Koddaki hazır Lixus şablonu mu (düzenlenemez, yalnız uyarlanır). */
  isDefault: boolean;
  propertyId: string | null;
  propertyName: string | null;
  /** Satır sürümü (ISO); hazır şablonda null. */
  updatedAt: string | null;
  /** Gövdenin ilk `TEMPLATE_PREVIEW_CHARS` karakteri; kesildiyse sonunda "…". */
  preview: string;
}

export interface TemplateDetail {
  id: string;
  title: string;
  category: string;
  language: string;
  isActive: boolean;
  isDefault: boolean;
  propertyId: string | null;
  updatedAt: string | null;
  body: string;
}

export type TemplateListScope =
  | { kind: "manage" }
  | { kind: "compose"; propertyId: string | null; includeDefaults: boolean };

export interface TemplateListPage {
  items: TemplateSummary[];
  /** Süzgece (kapsam + arama) uyan toplam kalem — seçicide hazır şablonlar dahil. */
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/** Arama metni: dize değilse boş; denetim karakterleri (NUL dahil — veritabanı metni taşıyamaz) boşluğa döner, tavanda kesilir. */
export function normalizeTemplateQuery(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const cleaned = raw.slice(0, TEMPLATE_QUERY_MAX_CHARS * 2).replace(/\p{Cc}/gu, " ").trim();
  return Array.from(cleaned).slice(0, TEMPLATE_QUERY_MAX_CHARS).join("").trim();
}

/** Gövdenin kısa önizlemesi. Vekil çift bölünmez (kesim kod noktasıyla). */
export function templatePreview(body: string): string {
  const head = Array.from(body.slice(0, TEMPLATE_PREVIEW_CHARS * 2)).slice(0, TEMPLATE_PREVIEW_CHARS).join("");
  return head.length < body.length ? `${head.trimEnd()}…` : head;
}

/** LIKE desenindeki özel karakterler düz karakter olarak aransın (PostgreSQL'in varsayılan kaçış karakteri ters bölü). */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function templateWhere(organizationId: string, scope: TemplateListScope, query: string): Prisma.MessageTemplateWhereInput {
  const and: Prisma.MessageTemplateWhereInput[] = [];
  if (scope.kind === "compose") {
    and.push({ isActive: true });
    if (scope.propertyId) and.push({ OR: [{ propertyId: scope.propertyId }, { propertyId: null }] });
  }
  if (query) {
    const needle = escapeLike(query);
    and.push({ OR: [{ title: { contains: needle, mode: "insensitive" } }, { body: { contains: needle, mode: "insensitive" } }] });
  }
  return { organizationId, ...(and.length > 0 ? { AND: and } : {}) };
}

/** Hazır şablonlar koddaki 16 sabit — süzme bellekte (Türkçe küçük harfle; veritabanı aramasından farkı yalnız I / ı). */
function matchingDefaults(query: string) {
  if (!query) return DEFAULT_TEMPLATES;
  const needle = query.toLocaleLowerCase("tr-TR");
  return DEFAULT_TEMPLATES.filter(
    (t) => t.title.toLocaleLowerCase("tr-TR").includes(needle) || t.body.toLocaleLowerCase("tr-TR").includes(needle),
  );
}

const SUMMARY_SELECT = {
  id: true,
  title: true,
  category: true,
  language: true,
  isActive: true,
  propertyId: true,
  updatedAt: true,
  body: true,
  property: { select: { name: true } },
} satisfies Prisma.MessageTemplateSelect;

export async function listTemplatePage(
  organizationId: string,
  opts: { scope: TemplateListScope; query?: unknown; page?: number },
): Promise<TemplateListPage> {
  const query = normalizeTemplateQuery(opts.query);
  const page = Number.isInteger(opts.page) && (opts.page as number) >= 1 ? (opts.page as number) : 1;
  const start = (page - 1) * TEMPLATE_PAGE_SIZE;
  const where = templateWhere(organizationId, opts.scope, query);
  const [customTotal, rows] = await Promise.all([
    prisma.messageTemplate.count({ where }),
    prisma.messageTemplate.findMany({
      where,
      select: SUMMARY_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: start,
      take: TEMPLATE_PAGE_SIZE,
    }),
  ]);
  const items: TemplateSummary[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    category: r.category,
    language: r.language,
    isActive: r.isActive,
    isDefault: false,
    propertyId: r.propertyId,
    propertyName: r.property?.name ?? null,
    updatedAt: r.updatedAt.toISOString(),
    preview: templatePreview(r.body),
  }));

  const defaults = opts.scope.kind === "compose" && opts.scope.includeDefaults ? matchingDefaults(query) : [];
  const room = TEMPLATE_PAGE_SIZE - items.length;
  if (room > 0 && defaults.length > 0) {
    // Özel şablonlar bittikten sonraki konum: bu sayfadan önce gösterilmiş hazır şablon sayısı.
    const from = Math.max(0, start - customTotal);
    for (const t of defaults.slice(from, from + room)) {
      items.push({
        id: t.id,
        title: t.title,
        category: t.category,
        language: t.language,
        isActive: true,
        isDefault: true,
        propertyId: null,
        propertyName: null,
        updatedAt: null,
        preview: templatePreview(t.body),
      });
    }
  }

  const total = customTotal + defaults.length;
  return { items, total, page, pageSize: TEMPLATE_PAGE_SIZE, hasMore: start + items.length < total };
}

/** Seçilen şablonun TAM metni (işletme kapsamında; hazır şablon kimliği koddaki sabitten). Yoksa null. */
export async function getTemplateDetail(organizationId: string, id: string): Promise<TemplateDetail | null> {
  const builtIn = DEFAULT_TEMPLATES.find((t) => t.id === id);
  if (builtIn) {
    return {
      id: builtIn.id,
      title: builtIn.title,
      category: builtIn.category,
      language: builtIn.language,
      isActive: true,
      isDefault: true,
      propertyId: null,
      updatedAt: null,
      body: builtIn.body,
    };
  }
  const row = await prisma.messageTemplate.findFirst({
    where: { id, organizationId },
    select: { id: true, title: true, category: true, language: true, isActive: true, propertyId: true, updatedAt: true, body: true },
  });
  if (!row) return null;
  return { ...row, isDefault: false, updatedAt: row.updatedAt.toISOString() };
}
