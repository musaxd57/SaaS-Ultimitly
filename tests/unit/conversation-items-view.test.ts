import { describe, it, expect } from "vitest";
import { ITEM_STATUSES, type EffectiveItemStatus } from "@/lib/conversation-items/core";
import { ITEM_STATUS_LABELS_TR, itemTone, openItemsBadge } from "@/lib/conversation-items/view";

// ---------------------------------------------------------------------------
// KONUŞMA ÖĞELERİ — ev sahibi görünümünün saf parçaları (etiket / ton / rozet).
// ---------------------------------------------------------------------------

const ALL: EffectiveItemStatus[] = [...ITEM_STATUSES, "host_replied"];

describe("görünüm", () => {
  it("her görünen durumun sade Türkçe etiketi var (tek kaynak)", () => {
    for (const s of ALL) expect([s, typeof ITEM_STATUS_LABELS_TR[s]]).toEqual([s, "string"]);
    expect(ITEM_STATUS_LABELS_TR.pending_host).toBe("Size bırakıldı");
    expect(ITEM_STATUS_LABELS_TR.host_replied).toBe("Yanıtladınız");
  });

  it("ton: açık acil kırmızı, size bırakılan sarı, açık güvenli istek ikincil, kapanmışlar sönük/yeşil", () => {
    expect(itemTone("pending_host", "emergency")).toBe("destructive");
    expect(itemTone("pending_host", "sensitive")).toBe("warning");
    expect(itemTone("open", "none")).toBe("secondary");
    expect(itemTone("answered", "none")).toBe("success");
    expect(itemTone("done", "emergency")).toBe("success");
    expect(itemTone("host_replied", "sensitive")).toBe("success");
    expect(itemTone("withdrawn", "sensitive")).toBe("muted");
    expect(itemTone("superseded", "sensitive")).toBe("muted");
  });

  it("liste rozeti: sıfırda yok; sayıdan sonra tekil", () => {
    expect(openItemsBadge(0)).toBeNull();
    expect(openItemsBadge(1)).toBe("1 açık iş");
    expect(openItemsBadge(3)).toBe("3 açık iş");
  });
});
