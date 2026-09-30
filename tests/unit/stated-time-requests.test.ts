import { describe, it, expect } from "vitest";
import { timeCorrectedInMessage, timeStatedInMessage } from "@/lib/ai/stated-time";
import { REPLY_SYSTEM_PROMPT } from "@/lib/ai/prompts";

// ---------------------------------------------------------------------------
// K11 (kurucu kararı 09-30): "bağlamdan, sorudan anlamalı — 'Hi can we check out at 1pm' çıkış saati beyanı DEĞİL; '10'da
// çıkabiliyoruz' beyandır; uçak kalkış saati çıkış saatiyle karışmasın". Yazılan çıkış saati (`guestCheckoutTime`) yalnız
// misafirin kendi PLANINI bildirdiği cümleden okunur. İstek / soru / izin isteme biçimi — cümlenin neresinde olursa olsun
// (selamdan sonra da) — beyan değildir; düz sıra ("we can leave at 10") beyandır. Sözcük yasağı DEĞİL: aynı sözcük ("can")
// soru sırasında istek, düz sırada beyan.
// ---------------------------------------------------------------------------

const REQUESTS: [msg: string, hhmm: string][] = [
  ["Hi can we check out at 1pm", "13:00"],
  ["Hey guys can we do checkout at 12", "12:00"],
  ["Hello could we leave at 2pm instead", "14:00"],
  ["Hi is it possible to check out at 12", "12:00"],
  ["We would like to check out at 1pm if possible", "13:00"],
  ["I wonder if we could check out at 1pm", "13:00"],
  ["Please let us check out at 1pm", "13:00"],
  ["We'd love a late checkout at 1pm", "13:00"],
  ["Geç çıkış 13:00 rica ediyoruz", "13:00"],
  ["Mümkünse 13'te çıkmak istiyoruz", "13:00"],
  ["İzin verirseniz 13'te çıkalım", "13:00"],
  ["Müsaade ederseniz 13'te çıkalım", "13:00"],
  ["Hey do you mind if we leave at 1pm", "13:00"],
  ["Late checkout at 1pm possible", "13:00"],
  ["Hi guys if we could check out at 1pm that would be great", "13:00"],
  ["Wondering if check out at 1pm works for you", "13:00"],
  ["We would like to check out at 1pm", "13:00"],
  ["Requesting checkout at 1pm", "13:00"],
  ["Wäre es möglich um 13 Uhr auszuchecken", "13:00"],
  ["Si es posible saldremos a las 13", "13:00"],
  // Bugün de istek sayılanlar (değişmedi): soru eki, -sAk, cümle başında soru.
  ["Merhaba 13'te çıkabilir miyiz", "13:00"],
  ["13'te çıksak olur mu", "13:00"],
  ["Is it possible to check out at 12", "12:00"],
];

const STATEMENTS: [msg: string, hhmm: string][] = [
  ["10'da çıkabiliyoruz", "10:00"], // kurucu örneği: yeterlilik bildirimi = plan
  ["We can leave at 10", "10:00"],
  ["We'll leave at 10", "10:00"],
  ["Yarın 11'de çıkacağız", "11:00"],
  ["Hi, we will check out at 9am tomorrow", "09:00"],
  ["Merhaba, yarın sabah 9'da çıkıyoruz", "09:00"],
  ["Hi we will leave at 10, is it ok?", "10:00"], // soru ayrı cümlecikte: beyan etkilenmez
  ["We leave for the airport at 10", "10:00"],
  ["Flight at 14:00, we'll leave the apartment at 11", "11:00"],
  ["Uçak kalkış saatimiz 16:00, 12'de çıkarız", "12:00"],
];

const VEHICLES: [msg: string, hhmm: string][] = [
  ["Our flight is at 15:30", "15:30"],
  ["Uçağımız 15:30'da kalkıyor", "15:30"],
  ["Our flight departs at 13:20", "13:20"],
  ["Our plane leaves at 3pm", "15:00"],
  ["Flight at 14:00, we'll leave the apartment at 11", "14:00"],
  ["Uçak kalkış saatimiz 16:00, 12'de çıkarız", "16:00"],
];

describe("K11 — yazılan çıkış saati bağlamdan: istek / soru beyan değildir", () => {
  it.each(REQUESTS)("🚨 istek → kayıt YOK: %s (%s)", (msg, t) => {
    expect(timeStatedInMessage(t, msg)).toBe(false);
  });
  it.each(STATEMENTS)("beyan → kayıt: %s (%s)", (msg, t) => {
    expect(timeStatedInMessage(t, msg)).toBe(true);
  });
  it.each(VEHICLES)("başka aracın kalkışı → kayıt YOK: %s (%s)", (msg, t) => {
    expect(timeStatedInMessage(t, msg)).toBe(false);
  });
});

describe("K11 — düzeltme yolu: istek cümleciğindeki yeni saat düzeltme değildir", () => {
  it("🚨 'Hi can we make it 13:00 instead of 11' kayıtlı 11:00'i 13:00'e TAŞIMAZ", () => {
    expect(timeCorrectedInMessage("11:00", "13:00", "Hi can we make it 13:00 instead of 11")).toBe(false);
  });
  it("KONTROL — beyan düzeltmesi taşır ('Checkout 11 değil, 13'te çıkarız')", () => {
    expect(timeCorrectedInMessage("11:00", "13:00", "Checkout 11 değil, 13'te çıkarız.")).toBe(true);
  });
});

describe("K11 — istem: model istek / soruyu çıkış saati diye DOLDURMAZ", () => {
  it("ÇIKIŞ SAATİ ÇIKARIMI kuralı isteği, beyanı ve araç kalkışını ayırır", () => {
    const i = REPLY_SYSTEM_PROMPT.indexOf("ÇIKIŞ SAATİ ÇIKARIMI");
    expect(i).toBeGreaterThan(-1);
    const block = REPLY_SYSTEM_PROMPT.slice(i, i + 2_000);
    expect(block).toContain("Hi can we check out at 1pm");
    expect(block).toContain("10'da çıkabiliyoruz");
    expect(block).toMatch(/uçağın|uçuşun|flight/i);
  });
});
