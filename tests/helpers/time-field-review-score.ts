import { fieldTimeHits, kbPropertyMismatch } from "@/lib/ai/retrieval/time-fields";
import type { ReviewCase, ReviewClass } from "./time-field-review-battery";

// İnceleme bataryasının TEK puanlayıcısı (kalıcı test + eski/yeni raporu aynı mantıkla). Okuma = `fieldTimeHits` (ürünün kendisi);
// çelişki = `kbPropertyMismatch` (istem çelişki bloğu + `kb_time_conflict` kapısı + ev sahibi raporu aynı kuralı kullanır).

export interface ReviewScore {
  id: string;
  cls: ReviewClass;
  got: string[];
  readOk: boolean | null;
  gotConflict: { checkin?: string[]; checkout?: string[] };
  conflictOk: boolean | null;
  ok: boolean;
}

export function scoreReviewCase(c: ReviewCase): ReviewScore {
  const hits = fieldTimeHits(c.title, c.text, c.category);
  const got = [...new Set(hits.map((h) => `${h.field}:${h.time}`))].sort();
  const readOk = c.expect ? JSON.stringify(got) === JSON.stringify([...c.expect].sort()) : null;
  const gotConflict: ReviewScore["gotConflict"] = {};
  let conflictOk: boolean | null = null;
  if (c.conflict) {
    conflictOk = true;
    if (c.conflict.checkin) {
      gotConflict.checkin = kbPropertyMismatch(hits, "checkin", c.conflict.checkIn ?? null);
      conflictOk &&= JSON.stringify(gotConflict.checkin) === JSON.stringify([...c.conflict.checkin].sort());
    }
    if (c.conflict.checkout) {
      gotConflict.checkout = kbPropertyMismatch(hits, "checkout", c.conflict.checkOut ?? null);
      conflictOk &&= JSON.stringify(gotConflict.checkout) === JSON.stringify([...c.conflict.checkout].sort());
    }
  }
  return { id: c.id, cls: c.cls, got, readOk, gotConflict, conflictOk, ok: readOk !== false && conflictOk !== false };
}
