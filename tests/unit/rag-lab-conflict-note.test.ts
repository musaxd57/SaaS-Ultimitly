import { describe, it, expect } from "vitest";
import { conflictNoteForQuery, rowInBlock, type LabQuery } from "../eval/rag-lab/core";

// ---------------------------------------------------------------------------
// A9 #1 (09-27, doğrulandı): ölçerin çelişki grubunda notlarda HERHANGİ bir "farklı değerler" geçmesi başarı sayılıyordu — sorunun
// kendi çelişkisi yerine başka alanın notu ("çıkış saati (11:00 / 12:00)", "temizlik saati") da kredi alıyordu (276 kalemde 8 satırın
// 2'si). Not yolu artık iki tarafın saatlerinden en az birer tanesini birlikte taşımalı. Yalnız puanlama; girdiler aynı.
// ---------------------------------------------------------------------------

const q = (a: string, b: string, conflictOk = true): LabQuery => ({
  id: "c",
  group: "conflict",
  cls: "conflict_tr",
  lang: "tr",
  text: "Giriş saat kaçta?",
  answers: [
    { needles: [a], goldIds: ["x"] },
    { needles: [b], goldIds: ["x_conf"] },
  ],
  conflictOk,
});
const note = (label: string, values: string) =>
  `Kaynaklarda ${label} saati için farklı değerler var (${values}); tamamı bu yanıta sığmadı. Kesin saat SÖYLEME — konuyu insana devret.`;

describe("çelişki notu yalnız sorunun KENDİ çelişkisi için kredi alır", () => {
  it("kendi alanının notu (iki tarafın saati) → başarı; nokta ayraçlı ve tek haneli saat normalleştirilir", () => {
    expect(conflictNoteForQuery([note("giriş", "15:00 / 16:00")], q("Giriş 15:00'ten itibaren.", "Giriş 16:00'ten itibaren."))).toBe(true);
    expect(conflictNoteForQuery([note("giriş", "15:00 / 16:00")], q("Giriş 15.00'ten itibaren.", "Giriş 16.00'ten itibaren."))).toBe(true);
    expect(conflictNoteForQuery([note("giriş", "09:30 / 10:30")], q("Giriş 9:30.", "Giriş 10:30."))).toBe(true);
    // Dolgu şart: "9:30" başka bir notun "19:30"unda alt dize olarak geçer — sorunun 09:30'u o notta YOK.
    expect(conflictNoteForQuery([note("çıkış", "19:30 / 20:30")], q("Giriş 9:30.", "Giriş 20:30."))).toBe(false);
    // Saatsiz taraf → kredi yok.
    expect(conflictNoteForQuery([note("giriş", "15:00 / 16:00")], q("Giriş 15:00.", "Giriş saati değişti."))).toBe(false);
  });

  it("🚨 başka alanın notu (çıkış 11:00 / 12:00) → başarı DEĞİL (eski ölçer sayıyordu)", () => {
    expect(conflictNoteForQuery([note("çıkış", "11:00 / 12:00")], q("Giriş 15:00'ten itibaren.", "Giriş 16:00'ten itibaren."))).toBe(false);
  });

  it("yalnız bir tarafın saatini taşıyan not → başarı değil", () => {
    expect(conflictNoteForQuery([note("giriş", "15:00 / 17:00")], q("Giriş 15:00.", "Giriş 16:00."))).toBe(false);
  });

  it("KONTROL — çelişki sorusu değilse (conflictOk yok) ya da not yoksa → başarı değil", () => {
    expect(conflictNoteForQuery([note("giriş", "15:00 / 16:00")], q("Giriş 15:00.", "Giriş 16:00.", false))).toBe(false);
    expect(conflictNoteForQuery([], q("Giriş 15:00.", "Giriş 16:00."))).toBe(false);
  });
});

describe("satır hükmü (labRow'un tek kuralı)", () => {
  const conflictQ = q("Giriş 15:00'ten itibaren.", "Giriş 16:00'ten itibaren.");
  const missed = [{ stage: "budget" }, { stage: "ok" }];
  it("tüm cevaplar blokta → blokta; biri kaçtıysa yalnız KENDİ çelişki notuyla", () => {
    expect(rowInBlock([], conflictQ, [{ stage: "ok" }, { stage: "ok" }], false)).toBe(true);
    expect(rowInBlock([note("giriş", "15:00 / 16:00")], conflictQ, missed, false)).toBe(true);
    expect(rowInBlock([note("çıkış", "11:00 / 12:00")], conflictQ, missed, false)).toBe(false);
  });
  it("sızıntı her şeyi kırmızı yapar; cevapsız (negatif) satır blokta sayılmaz", () => {
    expect(rowInBlock([note("giriş", "15:00 / 16:00")], conflictQ, [{ stage: "ok" }, { stage: "ok" }], true)).toBe(false);
    expect(rowInBlock([], { ...conflictQ, answers: [], conflictOk: false }, [], false)).toBe(false);
  });
});
