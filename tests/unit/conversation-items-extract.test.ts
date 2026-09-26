import { describe, it, expect } from "vitest";
import { extractTurnItems } from "@/lib/conversation-items/extract";
import { parseUnderstanding, type UnderstandingHistoryEntry } from "@/lib/ai/semantic/understanding-schema";

// ---------------------------------------------------------------------------
// KONUŞMA ÖĞELERİ — tur çıkarımı (saf). Cevapsız her mesaj → öğeler; emin olunmayan tur öğeye BÖLÜNMEZ (bugünkü kapı).
// ---------------------------------------------------------------------------

const STAY_NONE = { requested: false, kind: "none", checkin_time: null, checkout_time: null };
type Req = { intent: string; message?: number };
const understood = (requests: Req[], withdrawn: unknown[] = []) =>
  parseUnderstanding(
    { language: "tr", requests: requests.map((r) => ({ query_tr: "q", query_original: "q", ...r })), stay_change: STAY_NONE, withdrawn },
    { items: true },
  );

const H = (...rows: [string, "inbound" | "outbound", string][]): UnderstandingHistoryEntry[] =>
  rows.map(([id, direction, body]) => ({ id, direction, body }));

const ibanWifi = H(["m1", "outbound", "Hoş geldiniz"], ["m2", "inbound", "IBAN'ınızı atar mısınız?"], ["m3", "inbound", "Bir de Wi-Fi şifresi neydi?"]);

describe("öğeler — mesaj başına", () => {
  it("IBAN → Wi-Fi: ödeme öğesi hassas (kelime ağı kendi mesajında), Wi-Fi güvenli", () => {
    const t = extractTurnItems({
      history: ibanWifi,
      guestMessage: "Bir de Wi-Fi şifresi neydi?",
      understanding: understood([
        { intent: "payment_invoice", message: 1 },
        { intent: "wifi", message: 2 },
      ]),
    });
    expect(t.mode).toBe("items");
    if (t.mode !== "items") return;
    expect(t.messages.map((m) => [m.messageId, m.items.map((i) => [i.kind, i.sensitivity, i.riskType])])).toEqual([
      ["m2", [["payment_invoice", "sensitive", "platform_policy"]]],
      ["m3", [["wifi", "none", null]]],
    ]);
  });

  it("kelime ağı etiketi YALNIZ kendi mesajının öğelerine gider (başka mesajın güvenli öğesi hassas olmaz)", () => {
    const t = extractTurnItems({
      history: H(["o", "outbound", "x"], ["a", "inbound", "Daire çok kirli"], ["b", "inbound", "Otopark nerede?"]),
      guestMessage: "Otopark nerede?",
      understanding: understood([
        { intent: "complaint_issue", message: 1 },
        { intent: "parking", message: 2 },
      ]),
    });
    expect(t.mode === "items" && t.messages.map((m) => m.items.map((i) => [i.kind, i.sensitivity]))).toEqual([
      [["complaint_issue", "sensitive"]],
      [["parking", "none"]],
    ]);
  });

  it("anlama katmanı şikâyeti görmediyse aynı mesajın öğeleri hassas (birleşim: 'istek yok' kelime ağını silemez)", () => {
    const t = extractTurnItems({
      history: H(["o", "outbound", "x"], ["a", "inbound", "Wi-Fi çalışmıyor, daire çok kirli, rezalet"]),
      guestMessage: "Wi-Fi çalışmıyor, daire çok kirli, rezalet",
      understanding: understood([{ intent: "wifi", message: 1 }]),
    });
    expect(t.mode === "items" && t.messages[0].items.map((i) => [i.kind, i.sensitivity])).toEqual([["wifi", "sensitive"]]);
  });

  it("vazgeçmeler: 0 = önceki konuşma, n = bu turun mesajı, pencere dışı numara düşer", () => {
    const t = extractTurnItems({
      history: H(["o", "outbound", "x"], ["a", "inbound", "12'de gelebilir miyiz?"], ["b", "inbound", "Boşverin, 15'te geleceğiz"]),
      guestMessage: "Boşverin, 15'te geleceğiz",
      understanding: understood(
        [
          { intent: "early_checkin", message: 1 },
          { intent: "checkin_time", message: 2 },
        ],
        [
          { intent: "early_checkin", message: 1 },
          { intent: "late_checkout", message: 0 },
          { intent: "wifi", message: 7 },
        ],
      ),
    });
    expect(t.mode === "items" && t.withdrawals).toEqual([
      { kind: "early_checkin", messageId: "a" },
      { kind: "late_checkout", earlier: true },
    ]);
  });
});

describe("emin olunmayan tur öğeye bölünmez (bugünkü kapı)", () => {
  const one = H(["o", "outbound", "x"], ["a", "inbound", "Wi-Fi?"]);

  it("öğe kipinde olmayan / olmayan anlama sonucu", () => {
    expect(extractTurnItems({ history: one, guestMessage: "Wi-Fi?", understanding: undefined })).toEqual({
      mode: "degraded",
      reason: "understanding_unavailable",
    });
    const offMode = parseUnderstanding({ language: "tr", requests: [{ intent: "wifi", query_tr: "q", query_original: "q" }], stay_change: STAY_NONE });
    expect(extractTurnItems({ history: one, guestMessage: "Wi-Fi?", understanding: offMode })).toEqual({
      mode: "degraded",
      reason: "understanding_unavailable",
    });
  });

  it("katmanın görmediği cevapsız mesaj (pencere taşması)", () => {
    const many = H(["o", "outbound", "x"], ...Array.from({ length: 6 }, (_, i) => [`g${i}`, "inbound", `soru ${i}`] as [string, "inbound", string]));
    const u = understood([1, 2, 3, 4].map((m) => ({ intent: "other", message: m })));
    expect(extractTurnItems({ history: many, guestMessage: "soru 5", understanding: u })).toEqual({ mode: "degraded", reason: "window_overflow" });
  });

  it("tamamı okunmamış uzun mesaj (maske payı dahil)", () => {
    const long = "a ".repeat(451); // 902 > 1000 - 100
    const h = H(["o", "outbound", "x"], ["a", "inbound", long]);
    expect(extractTurnItems({ history: h, guestMessage: long, understanding: understood([{ intent: "other", message: 1 }]) })).toEqual({
      mode: "degraded",
      reason: "message_not_fully_read",
    });
    const ok = "a ".repeat(450); // 900 — sınır
    expect(
      extractTurnItems({ history: H(["o", "outbound", "x"], ["a", "inbound", ok]), guestMessage: ok, understanding: understood([{ intent: "other", message: 1 }]) })
        .mode,
    ).toBe("items");
  });

  it("kimliksiz cevapsız mesaj (güncel mesaj geçmişte yok)", () => {
    expect(extractTurnItems({ history: [], guestMessage: "Wi-Fi?", understanding: understood([{ intent: "wifi", message: 1 }]) })).toEqual({
      mode: "degraded",
      reason: "message_unidentified",
    });
  });

  it("istek tavanı (5): görülmemiş istek olabilir", () => {
    const h = H(["o", "outbound", "x"], ["a", "inbound", "beş soru"]);
    const u = understood(["wifi", "parking", "pets", "trash", "amenities"].map((intent) => ({ intent, message: 1 })));
    expect(extractTurnItems({ history: h, guestMessage: "beş soru", understanding: u })).toEqual({ mode: "degraded", reason: "request_cap" });
    const four = understood(["wifi", "parking", "pets", "trash"].map((intent) => ({ intent, message: 1 })));
    expect(extractTurnItems({ history: h, guestMessage: "beş soru", understanding: four }).mode).toBe("items");
  });

  it("mesaja eşlenemeyen istek (numarasız / pencere dışı)", () => {
    expect(extractTurnItems({ history: one, guestMessage: "Wi-Fi?", understanding: understood([{ intent: "wifi" }]) })).toEqual({
      mode: "degraded",
      reason: "request_unattributed",
    });
    expect(extractTurnItems({ history: one, guestMessage: "Wi-Fi?", understanding: understood([{ intent: "wifi", message: 2 }]) })).toEqual({
      mode: "degraded",
      reason: "request_unattributed",
    });
  });

  it("hiç istek atfedilmemiş cevapsız mesaj", () => {
    const two = H(["o", "outbound", "x"], ["a", "inbound", "IBAN?"], ["b", "inbound", "Wi-Fi?"]);
    expect(extractTurnItems({ history: two, guestMessage: "Wi-Fi?", understanding: understood([{ intent: "wifi", message: 2 }]) })).toEqual({
      mode: "degraded",
      reason: "message_without_request",
    });
  });
});
