import { describe, it, expect } from "vitest";
import {
  MAX_OLDER_PAGES,
  MESSAGE_WINDOW_PAGE,
  messageWindowSize,
  olderMessagesHref,
  parseOlderPages,
  windowCoversTail,
  windowFromNewestFirst,
} from "@/lib/inbox-message-window";

// ---------------------------------------------------------------------------
// Sohbet ekranı mesaj penceresinin saf kuralları (K2-S, kurucu 11-26 sabah). Sayfa bağlantısı
// `tests/integration/inbox-message-window-page.test.ts`te.
// ---------------------------------------------------------------------------

describe("parseOlderPages — ?eski= doğrulaması", () => {
  it("1 … tavan arası tam sayı kabul edilir", () => {
    expect(parseOlderPages("1")).toBe(1);
    expect(parseOlderPages("7")).toBe(7);
    expect(parseOlderPages(String(MAX_OLDER_PAGES))).toBe(MAX_OLDER_PAGES);
    expect(parseOlderPages("01")).toBe(1);
  });
  it("yok / boş / negatif / ondalık / çöp / tavandan büyük → 0 (varsayılan)", () => {
    for (const bad of [undefined, "", "0", "-1", "1.5", "abc", " 1", "1 ", "1e1", "0x2", "+1", String(MAX_OLDER_PAGES + 1), "999", "1000", "99999999999"]) {
      expect(parseOlderPages(bad), JSON.stringify(bad)).toBe(0);
    }
  });
  it("dizi → ilki", () => {
    expect(parseOlderPages(["2", "9"])).toBe(2);
    expect(parseOlderPages(["x", "2"])).toBe(0);
    expect(parseOlderPages([])).toBe(0);
  });
});

describe("messageWindowSize", () => {
  it("sayfa başına 60; tavanda bütün geçmiş (null)", () => {
    expect(MESSAGE_WINDOW_PAGE).toBe(60);
    expect(messageWindowSize(0)).toBe(60);
    expect(messageWindowSize(1)).toBe(120);
    expect(messageWindowSize(MAX_OLDER_PAGES - 1)).toBe(60 * MAX_OLDER_PAGES);
    expect(messageWindowSize(MAX_OLDER_PAGES)).toBeNull();
  });
});

describe("windowFromNewestFirst", () => {
  const desc = (n: number) => Array.from({ length: n }, (_, i) => n - 1 - i); // [n-1 … 0]
  it("size+1 satır → en yeni size satır kronolojik, daha eski var", () => {
    expect(windowFromNewestFirst(desc(4), 3)).toEqual({ messages: [1, 2, 3], hasOlder: true });
  });
  it("size ya da daha az satır → hepsi, daha eski yok", () => {
    expect(windowFromNewestFirst(desc(3), 3)).toEqual({ messages: [0, 1, 2], hasOlder: false });
    expect(windowFromNewestFirst(desc(0), 3)).toEqual({ messages: [], hasOlder: false });
  });
  it("size null → bütün satırlar", () => {
    expect(windowFromNewestFirst(desc(5), null)).toEqual({ messages: [0, 1, 2, 3, 4], hasOlder: false });
  });
  it("girdiyi değiştirmez", () => {
    const rows = desc(4);
    windowFromNewestFirst(rows, 3);
    expect(rows).toEqual([3, 2, 1, 0]);
  });
});

describe("windowCoversTail — pencere geriye tarayan hesapların sonlandırıcılarını içeriyor mu", () => {
  const g = (id: string) => ({ id, direction: "inbound", authorType: "guest" });
  const h = (id: string) => ({ id, direction: "outbound", authorType: "host" });
  it("misafir mesajı + iptalsiz cevap → yeterli", () => {
    expect(windowCoversTail([g("a"), h("b")], new Set())).toBe(true);
    expect(windowCoversTail([h("b"), g("a")], new Set())).toBe(true);
    // Yazarı boş eski giden satır cevaptır (`isAnsweringOutbound`).
    expect(windowCoversTail([g("a"), { id: "b", direction: "outbound", authorType: null }], new Set())).toBe(true);
  });
  it("misafir mesajı yok → yetmez", () => {
    expect(windowCoversTail([h("a"), h("b")], new Set())).toBe(false);
  });
  it("cevap yok / yalnız otomatik şablon mesajı / yalnız İPTAL edilmiş cevap → yetmez", () => {
    expect(windowCoversTail([g("a"), g("b")], new Set())).toBe(false);
    expect(windowCoversTail([g("a"), { id: "b", direction: "outbound", authorType: "automation" }], new Set())).toBe(false);
    expect(windowCoversTail([g("a"), h("b")], new Set(["b"]))).toBe(false);
    expect(windowCoversTail([g("a"), h("b"), h("c")], new Set(["b"]))).toBe(true);
  });
  it("boş pencere → yetmez", () => {
    expect(windowCoversTail([], new Set())).toBe(false);
  });
});

describe("olderMessagesHref", () => {
  it("bir sayfa artırır; geri hedefi varsa korunur", () => {
    expect(olderMessagesHref("c1", 0, null)).toBe("/inbox/c1?eski=1");
    expect(olderMessagesHref("c1", 3, null)).toBe("/inbox/c1?eski=4");
    expect(olderMessagesHref("c1", 0, "/inbox?status=problem&sayfa=2")).toBe(
      `/inbox/c1?from=${encodeURIComponent("/inbox?status=problem&sayfa=2")}&eski=1`,
    );
  });
  it("tavanı aşmaz (tavan = bütün geçmiş)", () => {
    expect(olderMessagesHref("c1", MAX_OLDER_PAGES - 1, null)).toBe(`/inbox/c1?eski=${MAX_OLDER_PAGES}`);
    expect(olderMessagesHref("c1", MAX_OLDER_PAGES, null)).toBe(`/inbox/c1?eski=${MAX_OLDER_PAGES}`);
  });
});
