// ---------------------------------------------------------------------------
// KONUŞMA ÖĞELERİ — EV SAHİBİ GÖRÜNÜMÜ (saf; 09-26, kurucu kararı "Liste + konuşma + Dikkat"). Metinler sade (müşteriye giden
// metin kuralı): ne olduğu + ne yapması gerektiği. Tür adı tek kaynak `ITEM_KIND_LABELS_TR`.
// ---------------------------------------------------------------------------

import { ITEM_KIND_LABELS_TR, isOpenForHost, type EffectiveItemStatus, type ItemKind } from "./core";

export const ITEM_STATUS_LABELS_TR: Readonly<Record<EffectiveItemStatus, string>> = {
  open: "Açık",
  pending_host: "Size bırakıldı",
  host_replied: "Yanıtladınız",
  answered: "AI yanıtladı",
  withdrawn: "Misafir vazgeçti",
  superseded: "Yeni mesajla birleşti",
  done: "Tamamlandı",
};

export type ItemTone = "destructive" | "warning" | "secondary" | "success" | "muted";

/** Rozet tonu: acil hep kırmızı; ev sahibinde bekleyen sarı; açık güvenli istek ikincil; kapanmışlar sönük. */
export function itemTone(status: EffectiveItemStatus, sensitivity: string): ItemTone {
  if (!isOpenForHost(status)) return status === "answered" || status === "done" || status === "host_replied" ? "success" : "muted";
  if (sensitivity === "emergency") return "destructive";
  return status === "pending_host" ? "warning" : "secondary";
}

export function itemKindLabel(kind: ItemKind): string {
  return ITEM_KIND_LABELS_TR[kind];
}

/** Liste rozeti: "1 açık iş" / "3 açık iş" (Türkçede sayıdan sonra tekil). */
export function openItemsBadge(count: number): string | null {
  return count > 0 ? `${count} açık iş` : null;
}

/** "Açık işler" kartında gösterilen KAPANMIŞ öğe tavanı (kart dar bir rayda). Açık öğeler bu tavana takılmaz. */
export const ITEM_CARD_ROW_LIMIT = 20;

export interface ItemCardRows<V> {
  rows: V[];
  /** Ev sahibinde açık öğelerin TOPLAMI (rozet buradan). */
  openTotal: number;
  /** Tavan yüzünden gösterilmeyen kapanmış öğe sayısı. */
  hiddenClosed: number;
}

/**
 * Kart satırları (Codex 11-17 E4): kartı / sonuç satırı olan talebin öğesi (`excludeIds`) düşülür; açıklar üstte, sonra en yeni. AÇIK
 * öğelerin HEPSİ gösterilir (ev sahibinin işi — kesilirse en eski açık iş görünmez, rozet eksik sayardı); kapanmışlar yalnız `limit`e kadar
 * kalan yeri doldurur. Açık öğe sayısı konuşma başına sınırlıdır (misafirin istekleri), kart uzarsa sağ ray kendi içinde kayar.
 */
export function itemRowsForCard<V extends { id: string; effective: EffectiveItemStatus; messageAt: Date }>(
  views: readonly V[],
  excludeIds: ReadonlySet<string>,
  limit: number = ITEM_CARD_ROW_LIMIT,
): ItemCardRows<V> {
  const newestFirst = (a: V, b: V) => b.messageAt.getTime() - a.messageAt.getTime();
  const shown = views.filter((v) => !excludeIds.has(v.id));
  const open = shown.filter((v) => isOpenForHost(v.effective)).sort(newestFirst);
  const closed = shown.filter((v) => !isOpenForHost(v.effective)).sort(newestFirst);
  const closedRows = closed.slice(0, Math.max(0, limit - open.length));
  return { rows: [...open, ...closedRows], openTotal: open.length, hiddenClosed: closed.length - closedRows.length };
}
