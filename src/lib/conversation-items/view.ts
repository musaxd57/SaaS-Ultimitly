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
