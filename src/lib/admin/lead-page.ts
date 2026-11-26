import type { Prisma } from "@prisma/client";

// Operatör paneli — demo talepleri listesi: durum süzgeci + "daha eski" imleçli sayfa (K27-K16a, Codex 11-25 akşam). YAPRAK, saf modül.
// Eskiden yalnız en yeni 50 talep görünüyordu (süzgeç / sayfa yok): bildirim bütçesi aşılınca eski AÇIK talepler panelde bulunamıyordu.
// İmleç = son satırın (createdAt, id) çifti; sıra (createdAt desc, id desc) → eşit damgalı satırlar sayfa sınırında kaybolmaz / yinelenmez.
// Bozuk / bilinmeyen parametre sessizce yok sayılır (ilk sayfa, tüm durumlar) — operatör ekranı, hata sayfası gerekmez.

export const LEAD_PAGE_SIZE = 50;

/** PATCH rotasının kabul ettiği kapalı küme ile AYNI sıra (`api/admin/leads/[id]` LEAD_STATUSES). */
export const LEAD_STATUS_OPTIONS = [
  { value: "new", label: "Yeni" },
  { value: "contacted", label: "Arandı" },
  { value: "demo", label: "Demo verildi" },
  { value: "won", label: "Kazanıldı" },
  { value: "lost", label: "Kaybedildi" },
] as const;

export type LeadStatus = (typeof LEAD_STATUS_OPTIONS)[number]["value"];

export interface LeadCursor {
  createdAt: Date;
  id: string;
}

export interface LeadPageParams {
  status: LeadStatus | null;
  before: LeadCursor | null;
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function encodeLeadCursor(row: LeadCursor): string {
  return `${row.createdAt.getTime()}_${row.id}`;
}

export function decodeLeadCursor(raw: string | undefined): LeadCursor | null {
  if (!raw || raw.length > 100) return null;
  const m = /^(\d{1,15})_([A-Za-z0-9_-]{1,64})$/.exec(raw);
  if (!m) return null;
  const createdAt = new Date(Number(m[1]));
  if (Number.isNaN(createdAt.getTime())) return null;
  return { createdAt, id: m[2]! };
}

export function parseLeadPageParams(sp: Record<string, string | string[] | undefined>): LeadPageParams {
  const s = first(sp.talepDurum);
  const status = LEAD_STATUS_OPTIONS.some((o) => o.value === s) ? (s as LeadStatus) : null;
  return { status, before: decodeLeadCursor(first(sp.talepOnce)) };
}

/** Sorgu: süzgeç SORGUDA; bir fazlası okunur (`take: size + 1`) → "daha eski var mı" ek sayım sorgusu olmadan bilinir. */
export function leadPageQuery(p: LeadPageParams, size: number = LEAD_PAGE_SIZE): Prisma.LeadFindManyArgs {
  const where: Prisma.LeadWhereInput = {
    ...(p.status ? { status: p.status } : {}),
    ...(p.before
      ? { OR: [{ createdAt: { lt: p.before.createdAt } }, { createdAt: p.before.createdAt, id: { lt: p.before.id } }] }
      : {}),
  };
  return { where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: size + 1 };
}

/** Okunan satırlardan görünen sayfa + sonraki imleç. */
export function splitLeadPage<T extends LeadCursor>(rows: T[], size: number = LEAD_PAGE_SIZE): { rows: T[]; nextCursor: string | null } {
  if (rows.length <= size) return { rows, nextCursor: null };
  const shown = rows.slice(0, size);
  return { rows: shown, nextCursor: encodeLeadCursor(shown[shown.length - 1]!) };
}

/** Panel bağlantısı: süzgeç korunur; imleç yalnız verilirse. `#talepler` kartına iner. */
export function leadPageHref(status: LeadStatus | null, before: string | null): string {
  const q = new URLSearchParams();
  if (status) q.set("talepDurum", status);
  if (before) q.set("talepOnce", before);
  const s = q.toString();
  return `/admin${s ? `?${s}` : ""}#talepler`;
}
