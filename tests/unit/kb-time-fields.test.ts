import { describe, it, expect } from "vitest";
import {
  extractFieldTimes,
  fieldTimeHits,
  timeSetsConflict,
  timesIn,
  propertyTimeMismatch,
  normalizePropertyTime,
} from "@/lib/ai/retrieval/time-fields";
import { preserveTimeConflicts } from "@/lib/ai/retrieval/rerank";
import { findTimeConflicts, buildReplyUserPrompt } from "@/lib/ai/prompts";
import type { KbChunk } from "@/lib/ai/retrieval/chunker";
import type { SuggestReplyInput } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// SAAT ALANLARI — TEK KAYNAK (09-23). Ölçülen canlı kusur: istemdeki KB↔mülk çelişki bloğu
// KATEGORİ bazlıydı ve mülkle UYUMLU bilgi tabanında SAHTE çelişki üretiyordu; blok "güveni
// 0.75 altında tut" dediği için ilgisiz sorular (Wi-Fi, otopark) insana düşüyordu. Aynı turda
// retrieval'ın alan atfının altı ölçülmüş kusuru düzeltildi. E7/R5'in GERÇEK çelişkileri hâlâ
// yakalanır (kontrol).
// ---------------------------------------------------------------------------

const PROP = { name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" };
const kb = (category: string, title: string, content: string) => ({ category, title, content });
const fields = (title: string, text: string) =>
  Object.fromEntries([...extractFieldTimes(title, text)].map(([f, s]) => [f, [...s].sort()]));

describe("findTimeConflicts — mülkle UYUMLU bilgi tabanı çelişki SAYILMAZ (canlı kusur)", () => {
  it("🚨 giriş kalemi iki saati birlikte yazıyor ('Giriş 15:00, çıkış 11:00.') → çelişki YOK", () => {
    expect(findTimeConflicts(PROP, [kb("checkin", "Giriş", "Giriş 15:00, çıkış 11:00.")])).toEqual([]);
    expect(findTimeConflicts(PROP, [kb("checkin", "Giriş ve çıkış", "Giriş 15:00. Çıkış 11:00.")])).toEqual([]);
    expect(findTimeConflicts(PROP, [kb("checkin", "Saatler", "Giriş 15:00 ve çıkış 11:00.")])).toEqual([]);
  });

  it("🚨 geç çıkış / erken giriş AYRI konudur, mülk saatiyle kıyaslanmaz", () => {
    expect(findTimeConflicts(PROP, [kb("checkout", "Çıkış", "Çıkış 11:00. Geç çıkış 13:00'e kadar ücretlidir.")])).toEqual([]);
    expect(findTimeConflicts(PROP, [kb("checkin", "Erken giriş", "Erken giriş 12:00'den itibaren mümkündür.")])).toEqual([]);
    expect(findTimeConflicts(PROP, [kb("checkout", "Late check-out", "Late check-out until 13:00 on request.")])).toEqual([]);
    // "en geç" = en son çıkış saati → ÇIKIŞ alanıdır (geç çıkış değil).
    expect(findTimeConflicts(PROP, [kb("checkout", "Çıkış", "En geç çıkış 12:00'dir.")])).toEqual([
      { field: "checkOutTime", propertyValue: "11:00", kbValues: ["12:00"] },
    ]);
  });

  it("🚨 bina/otopark girişi, acil çıkış, çıkış GÜNÜ konaklama saati değildir", () => {
    expect(findTimeConflicts(PROP, [kb("checkin", "Giriş", "Bina girişi 23:00'ten sonra kilitlenir.")])).toEqual([]);
    expect(findTimeConflicts(PROP, [kb("checkin", "Giriş", "Otopark girişi 08:00-20:00 arası açık.")])).toEqual([]);
    expect(findTimeConflicts(PROP, [kb("checkout", "Çıkış", "Çıkış günü bagajınızı 14:00'e kadar bırakabilirsiniz.")])).toEqual([]);
  });

  it("aralık: mülk saati kümenin içindeyse uyumlu ('15:00'ten itibaren, en geç 22:00')", () => {
    expect(findTimeConflicts(PROP, [kb("checkin", "Giriş", "Giriş 15:00'ten itibaren, en geç 22:00'ye kadar yapılabilir.")])).toEqual([]);
  });

  it("KONTROL — GERÇEK çelişkiler hâlâ yakalanır (E7 fikstürü birebir, R5 benzeri)", () => {
    expect(findTimeConflicts(PROP, [kb("checkout", "Çıkış", "Çıkış saati 12:00'dir.")])).toEqual([
      { field: "checkOutTime", propertyValue: "11:00", kbValues: ["12:00"] },
    ]);
    expect(findTimeConflicts(PROP, [kb("checkin", "Giriş", "Giriş 14:00'ten itibaren.")])).toEqual([
      { field: "checkInTime", propertyValue: "15:00", kbValues: ["14:00"] },
    ]);
  });

  it("🚨 KATEGORİDEN bağımsız: 'Ev kuralları' kalemindeki çıkış saati de karşılaştırılır (eskiden kaçıyordu)", () => {
    expect(findTimeConflicts(PROP, [kb("rules", "Ev kuralları", "Sigara içilmez. Çıkış saati 12:00'dir.")])).toEqual([
      { field: "checkOutTime", propertyValue: "11:00", kbValues: ["12:00"] },
    ]);
  });

  it("am/pm: 'Check-out by 11am' uyumlu, 'Check-in 3:00 PM' uyumlu, 'Check-out 12 pm' çelişki", () => {
    expect(findTimeConflicts(PROP, [kb("checkout", "Check-out", "Check-out by 11am.")])).toEqual([]);
    expect(findTimeConflicts(PROP, [kb("checkin", "Check-in", "Check-in from 3:00 PM.")])).toEqual([]);
    expect(findTimeConflicts(PROP, [kb("checkin", "Check-in", "Check-in from 3:00 p.m. onwards.")])).toEqual([]);
    expect(findTimeConflicts(PROP, [kb("checkout", "Check-out", "Check-out is at 12 pm.")])).toEqual([
      { field: "checkOutTime", propertyValue: "11:00", kbValues: ["12:00"] },
    ]);
  });

  it("🚨 istem: uyumlu bilgi tabanında Wi-Fi sorusuna ÇELİŞKİ BLOĞU BASILMAZ (devir zorlanmaz)", () => {
    const input: SuggestReplyInput = {
      guestMessage: "Wifi şifresi nedir?",
      property: PROP,
      reservation: null,
      knowledgeBase: [
        kb("checkin", "Giriş", "Giriş 15:00, çıkış 11:00."),
        kb("checkout", "Çıkış", "Çıkış 11:00. Geç çıkış 13:00'e kadar ücretlidir."),
        kb("wifi", "Wi-Fi", "Ağ: LaleNet. Şifre etikette yazıyor."),
      ],
      tone: "warm",
      language: "tr",
    };
    expect(buildReplyUserPrompt(input)).not.toContain("KAYNAK ÇELİŞKİSİ");
    // KONTROL: gerçek çelişkide blok basılır.
    const bad = { ...input, knowledgeBase: [kb("checkout", "Çıkış", "Çıkış saati 12:00'dir.")] };
    expect(buildReplyUserPrompt(bad)).toContain("KAYNAK ÇELİŞKİSİ");
  });
});

describe("alan atfı (retrieval + rapor ortak)", () => {
  it("rakamdan sonraki nokta cümlecik sınırıdır ('Giriş 15:00. Çıkış 11:00.'); '12.00' bölünmez", () => {
    expect(fields("Saatler", "Giriş 15:00. Çıkış 11:00.")).toEqual({ checkin: ["15:00"], checkout: ["11:00"] });
    expect(fields("Çıkış", "Çıkış 12.00'dir.")).toEqual({ checkout: ["12:00"] });
  });

  it("başlık ödüncü: cümlecik BAŞKA konudan söz ediyorsa alınmaz; alansız cümlecikte alınır", () => {
    expect(fields("Sessiz saatler", "Kahve makinesi 23:00'te kapanır.")).toEqual({});
    expect(fields("Çıkış", "Saat 11:00'e kadar daireyi boşaltın.")).toEqual({ checkout: ["11:00"] });
    expect(fieldTimeHits("Çıkış", "Saat 11:00'e kadar daireyi boşaltın.")[0].via).toBe("title");
    expect(fieldTimeHits("Notlar", "Çıkış 11:00'dir.")[0].via).toBe("clause");
  });

  it("erken giriş / geç çıkış ayrı alan; 'en geç' çıkış alanı", () => {
    expect(fields("Notlar", "Erken giriş 12:00'den itibaren.")).toEqual({ early_checkin: ["12:00"] });
    expect(fields("Notlar", "Geç çıkış 14:00'e kadar.")).toEqual({ late_checkout: ["14:00"] });
    expect(fields("Notlar", "En geç çıkış 12:00.")).toEqual({ checkout: ["12:00"] });
  });

  it("saat okuma: am/pm, dakikasız 'saat 11', belirsiz 'saat 3' OKUNMAZ, '10:10 am' tek saat", () => {
    expect([...timesIn("Check-in 3:00 PM")]).toEqual(["15:00"]);
    expect([...timesIn("by 11am")]).toEqual(["11:00"]);
    expect([...timesIn("12 am")]).toEqual(["00:00"]);
    expect([...timesIn("saat 11'e kadar")]).toEqual(["11:00"]);
    expect([...timesIn("saat 3'ten sonra")]).toEqual([]);
    expect([...timesIn("10:10 am")]).toEqual(["10:10"]);
  });

  it("aralık iki saati birden alana verir", () => {
    expect(fields("Sessiz saatler", "Sessiz saatler 22:00-08:00 arasıdır.")).toEqual({ quiet_hours: ["08:00", "22:00"] });
  });
});

describe("çelişki kuralı SİMETRİK", () => {
  it("biri ötekini kapsıyorsa çelişki DEĞİL (inceltme); ikisi de ötekinde olmayan saat taşıyorsa ÇELİŞKİ", () => {
    const s = (...t: string[]) => new Set(t);
    expect(timeSetsConflict(s("22:00"), s("22:00", "08:00"))).toBe(false);
    expect(timeSetsConflict(s("22:00", "08:00"), s("22:00"))).toBe(false);
    expect(timeSetsConflict(s("11:00"), s("12:00"))).toBe(true);
    expect(timeSetsConflict(s(), s("12:00"))).toBe(false);
  });

  it("🚨 retrieval çelişki koruması çapa SIRASINDAN bağımsız ('22:00-08:00' ↔ '22:00')", () => {
    const mk = (idx: number, title: string, text: string): KbChunk =>
      ({ id: `i${idx}`, title, content: text, category: "rules", updatedAt: new Date(0), text, chunkIndex: 0, chunkCount: 1 }) as KbChunk;
    const a = mk(0, "Sessiz saatler", "Sessiz saatler 22:00-08:00 arasıdır.");
    const b = mk(1, "Ev kuralları", "Sessiz saatler 22:00'de başlar.");
    const ft = [a, b].map((c) => extractFieldTimes(c.title, c.text));
    expect(preserveTimeConflicts([a, b], [0], ft).conflicts).toEqual([]);
    expect(preserveTimeConflicts([a, b], [1], ft).conflicts).toEqual([]);
  });

  it("mülk ayarı kuralı: küme doluysa ayar kümenin İÇİNDE olmalı; SS:DD olmayan ayar hüküm vermez", () => {
    expect(propertyTimeMismatch(new Set(["12:00"]), "11:00")).toEqual(["12:00"]);
    expect(propertyTimeMismatch(new Set(["15:00", "22:00"]), "15:00")).toEqual([]);
    expect(propertyTimeMismatch(undefined, "11:00")).toEqual([]);
    expect(normalizePropertyTime("9:00")).toBe("09:00");
    expect(normalizePropertyTime("öğlen")).toBeNull();
  });
});
