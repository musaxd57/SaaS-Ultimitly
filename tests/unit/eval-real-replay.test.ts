import { describe, it, expect } from "vitest";
import { replayStats, type ReplayCleaning, type ReplayInput } from "@/lib/eval-real/replay-stats";

// ---------------------------------------------------------------------------
// GEÇMİŞ MESAJ TARAMASI — SAF SAYIM (09-24). Pinlenen: yalnız SAYI döner (metin/kimlik yok); tür sayımı bir mesajdaki
// tüm türleri görür; "yalnız erken giriş" rezervasyon başına İLK soruyla varış gününe, aynı gün devre, o devrin
// temizlik görevine ve ürünle AYNI hazırlık kuralına göre ayrışır (sorulduğunda hazır / girişe kadar hazır oldu / hiç).
// 🚨 İnceleme 09-24 (P2): görevlerin BUGÜNKÜ durumu değil, SORU ANINDAKİ durumu kullanılır.
// ---------------------------------------------------------------------------

const TZ = "Europe/Istanbul";
const d = (iso: string) => new Date(iso);
const midnight = (k: string) => new Date(`${k}T00:00:00.000Z`);
const EARLY = "Erken giriş yapabilir miyiz?";
const OLD = d("2026-10-01T00:00:00Z"); // görevler sorudan çok önce oluşturulmuş

function base(): ReplayInput {
  return {
    timeZone: TZ,
    properties: [{ id: "p1", checkInTime: "15:00", checkOutTime: "11:00" }],
    reservations: [
      { id: "prev", propertyId: "p1", status: "confirmed", arrivalDate: midnight("2026-10-12"), departureDate: midnight("2026-10-14"), guestCheckoutTime: null },
      { id: "own", propertyId: "p1", status: "confirmed", arrivalDate: midnight("2026-10-14"), departureDate: midnight("2026-10-16"), guestCheckoutTime: null },
    ],
    cleanings: [],
    messages: [],
  };
}
const ask = (iso: string, reservationId: string | null = "own", propertyId = "p1") => ({ body: EARLY, createdAt: d(iso), propertyId, reservationId });
const task = (over: Partial<ReplayCleaning>): ReplayCleaning => ({
  propertyId: "p1",
  reservationId: "prev",
  dueAt: midnight("2026-10-14"),
  status: "done",
  doneAt: d("2026-10-14T08:30:00Z"),
  createdAt: OLD,
  ...over,
});

function leaves(v: unknown, out: unknown[] = []): unknown[] {
  if (v !== null && typeof v === "object") for (const x of Object.values(v)) leaves(x, out);
  else out.push(v);
  return out;
}

describe("replayStats", () => {
  it("yalnız sayı döner; metin ya da kimlik sızmaz", () => {
    const input = base();
    input.messages = [{ body: "Erken giriş yapabilir miyiz? Adım GizliAd.", createdAt: d("2026-10-14T06:00:00Z"), propertyId: "p1", reservationId: "own" }];
    const stats = replayStats(input);
    const all = leaves(stats);
    expect(all.length).toBeGreaterThan(30); // anti-vakum: 24 saat kovası + sayaçlar
    for (const x of all) expect(typeof x, String(x)).toBe("number");
    expect(JSON.stringify(stats)).not.toMatch(/GizliAd|own|prev|p1|2026/);
  });

  it("tür sayımı: bir mesajdaki TÜM türler; çok türlü mesaj ayrı sayılır; bilgi sorusu sayılmaz", () => {
    const input = base();
    input.messages = [
      { body: "Could we check in early and also check out late?", createdAt: d("2026-10-10T10:00:00Z"), propertyId: "p1", reservationId: null },
      { body: EARLY, createdAt: d("2026-10-10T10:00:00Z"), propertyId: "p1", reservationId: null },
      { body: "What is the wifi password?", createdAt: d("2026-10-10T10:00:00Z"), propertyId: "p1", reservationId: null },
    ];
    const s = replayStats(input);
    expect(s.messages).toBe(3);
    expect(s.stayRequests).toMatchObject({ any: 2, multiKind: 1, early: 2, late: 1 });
    expect(s.earlyOnly.messages).toBe(1);
    expect(s.earlyOnly.requests).toBe(0); // rezervasyona bağlı değil
  });

  it("istek = rezervasyon başına İLK soru (takip mesajı yeniden sayılmaz); başka mülkün rezervasyonu sayılmaz", () => {
    const input = base();
    input.messages = [ask("2026-10-14T07:00:00Z"), ask("2026-10-14T06:00:00Z"), ask("2026-10-14T06:30:00Z", "own", "p2")];
    const s = replayStats(input);
    expect(s.earlyOnly).toMatchObject({ messages: 3, requests: 1, askedOnArrivalDay: 1 });
    expect(s.askHourLocal[9]).toBe(1); // ilk soru 06:00Z = 09:00 İstanbul
    expect(s.askHourLocal[10]).toBe(0);
  });

  it("varış gününden önce / varış günü / sonra (ayrı rezervasyonlar)", () => {
    const input = base();
    input.reservations.push(
      { id: "r2", propertyId: "p1", status: "confirmed", arrivalDate: midnight("2026-10-20"), departureDate: midnight("2026-10-22"), guestCheckoutTime: null },
      { id: "r3", propertyId: "p1", status: "confirmed", arrivalDate: midnight("2026-10-05"), departureDate: midnight("2026-10-07"), guestCheckoutTime: null },
    );
    input.messages = [ask("2026-10-14T06:00:00Z"), ask("2026-10-18T09:00:00Z", "r2"), ask("2026-10-06T09:00:00Z", "r3")];
    expect(replayStats(input).earlyOnly).toMatchObject({ requests: 3, askedBeforeArrivalDay: 1, askedOnArrivalDay: 1, askedAfterArrivalDay: 1, sameDayTurnover: 1 });
  });

  it("hazırlık: sabah sorulduğunda bitmemiş, öğlen bitmiş → 'girişe kadar hazır oldu'; öğlen sorulsaydı hazır; hiç bitmediyse hiç", () => {
    const input = base();
    input.cleanings = [task({})]; // bitti 08:30Z = 11:30 İstanbul
    input.messages = [ask("2026-10-14T06:00:00Z")];
    expect(replayStats(input).earlyOnly).toMatchObject({ cleaningTaskFound: 1, readyWhenAsked: 0, readyLaterSameDay: 1, neverReadyByCheckIn: 0 });
    input.messages = [ask("2026-10-14T09:00:00Z")];
    expect(replayStats(input).earlyOnly).toMatchObject({ readyWhenAsked: 1, readyLaterSameDay: 0 });
    input.cleanings = [task({ status: "todo", doneAt: null })];
    expect(replayStats(input).earlyOnly).toMatchObject({ readyWhenAsked: 0, readyLaterSameDay: 0, neverReadyByCheckIn: 1 });
  });

  it("🚨 P2 (inceleme 09-24): SORU ANINDAKİ durum — o an açık olan ikinci görev hazır saydırmaz; soru anında olmayan görev sayılmaz", () => {
    const input = base();
    // A: devre bağlı, 11:30'da bitti. B: bağsız, 14:00'te (11:00Z) bitti. Soru 12:00'de (09:00Z): B O ANDA AÇIKTI → hazır değil.
    input.cleanings = [task({}), task({ reservationId: null, doneAt: d("2026-10-14T11:00:00Z") })];
    input.messages = [ask("2026-10-14T09:00:00Z")];
    expect(replayStats(input).earlyOnly).toMatchObject({ cleaningTaskFound: 1, readyWhenAsked: 0, readyLaterSameDay: 1 });
    // Soru anında görev YOKTU (sonradan oluşturuldu) → görev bulunamadı sayılır.
    input.cleanings = [task({ createdAt: d("2026-10-14T10:00:00Z") })];
    expect(replayStats(input).earlyOnly).toMatchObject({ sameDayTurnover: 1, cleaningTaskFound: 0 });
  });

  it("görev kümesi ürünle aynı: bağsız görev sayılır, başka günün görevi sayılmaz; çıkış = bildirilen ile varsayılanın GEÇ olanı", () => {
    const unlinked = base();
    unlinked.messages = [ask("2026-10-14T09:00:00Z")];
    unlinked.cleanings = [task({ reservationId: null })];
    expect(replayStats(unlinked).earlyOnly).toMatchObject({ cleaningTaskFound: 1, readyWhenAsked: 1 });

    const otherDay = base();
    otherDay.messages = [ask("2026-10-14T09:00:00Z")];
    otherDay.cleanings = [task({ dueAt: midnight("2026-10-13"), doneAt: d("2026-10-13T08:30:00Z") })];
    expect(replayStats(otherDay).earlyOnly).toMatchObject({ sameDayTurnover: 1, cleaningTaskFound: 0 });

    // Önceki misafir 13:00'te çıkacağını bildirmiş: 12:30'da "bitti" denen temizlik çıkıştan ÖNCEdir → hazır sayılmaz.
    const stated = base();
    stated.reservations[0].guestCheckoutTime = "13:00";
    stated.messages = [ask("2026-10-14T11:00:00Z")];
    stated.cleanings = [task({ doneAt: d("2026-10-14T09:30:00Z") })];
    expect(replayStats(stated).earlyOnly).toMatchObject({ cleaningTaskFound: 1, readyWhenAsked: 0, readyLaterSameDay: 0, neverReadyByCheckIn: 1 });

    // Aynı gün girip çıkan (sıfır gece, bozuk) satır önceki misafir sayılmaz.
    const zero = base();
    zero.reservations = [zero.reservations[1], { id: "zero", propertyId: "p1", status: "confirmed", arrivalDate: midnight("2026-10-14"), departureDate: midnight("2026-10-14"), guestCheckoutTime: null }];
    zero.messages = [ask("2026-10-14T06:00:00Z")];
    expect(replayStats(zero).earlyOnly).toMatchObject({ askedOnArrivalDay: 1, sameDayTurnover: 0 });
  });

  it("önceki misafir ürünle aynı seçilir: iptal (ve diğer 'yok sayılan' durumlar) devir sayılmaz; iki ayrılandan en GEÇ çıkan", () => {
    const cancelled = base();
    cancelled.reservations[0].status = "cancelled";
    cancelled.messages = [ask("2026-10-14T06:00:00Z")];
    expect(replayStats(cancelled).earlyOnly).toMatchObject({ askedOnArrivalDay: 1, sameDayTurnover: 0 });

    // İki ayrılan: biri 10:00, biri 13:00 bildirmiş → 13:00 esas; 12:30'daki "bitti" hazır saydırmaz.
    const two = base();
    two.reservations.push({ id: "prev2", propertyId: "p1", status: "confirmed", arrivalDate: midnight("2026-10-13"), departureDate: midnight("2026-10-14"), guestCheckoutTime: "13:00" });
    two.reservations[0].guestCheckoutTime = "10:00";
    two.cleanings = [task({ reservationId: null, doneAt: d("2026-10-14T09:30:00Z") })];
    two.messages = [ask("2026-10-14T11:00:00Z")];
    expect(replayStats(two).earlyOnly).toMatchObject({ sameDayTurnover: 1, readyWhenAsked: 0 });

    const other = base();
    other.messages = [ask("2026-10-14T06:00:00Z")];
    other.cleanings = [task({ propertyId: "p2", reservationId: null })];
    expect(replayStats(other).earlyOnly).toMatchObject({ sameDayTurnover: 1, cleaningTaskFound: 0 });
  });
});
