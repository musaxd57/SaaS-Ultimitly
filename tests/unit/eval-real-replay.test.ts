import { describe, it, expect } from "vitest";
import { replayStats, type ReplayInput } from "@/lib/eval-real/replay-stats";

// ---------------------------------------------------------------------------
// GEÇMİŞ MESAJ TARAMASI — SAF SAYIM (09-24). Pinlenen: yalnız SAYI döner (metin/kimlik yok); tür sayımı bir mesajdaki
// tüm türleri görür; "yalnız erken giriş" varış gününe, aynı gün devre, o devrin temizlik görevine ve ürünle AYNI
// hazırlık kuralına göre ayrışır (sorulduğunda hazır / girişe kadar hazır oldu / hiç).
// ---------------------------------------------------------------------------

const TZ = "Europe/Istanbul";
const d = (iso: string) => new Date(iso);
const midnight = (k: string) => new Date(`${k}T00:00:00.000Z`);

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
      { body: "Erken giriş yapabilir miyiz?", createdAt: d("2026-10-10T10:00:00Z"), propertyId: "p1", reservationId: null },
      { body: "What is the wifi password?", createdAt: d("2026-10-10T10:00:00Z"), propertyId: "p1", reservationId: null },
    ];
    const s = replayStats(input);
    expect(s.messages).toBe(3);
    expect(s.stayRequests).toMatchObject({ any: 2, multiKind: 1, early: 2, late: 1 });
    expect(s.earlyOnly.total).toBe(1);
    expect(s.earlyOnly.withReservation).toBe(0);
  });

  it("yalnız erken giriş: varış gününden önce / varış günü / sonra; aynı gün devir ve temizlik görevi", () => {
    const input = base();
    const ask = (iso: string) => ({ body: "Erken giriş yapabilir miyiz?", createdAt: d(iso), propertyId: "p1", reservationId: "own" });
    input.messages = [ask("2026-10-13T12:00:00Z"), ask("2026-10-14T06:00:00Z"), ask("2026-10-15T09:00:00Z")];
    let s = replayStats(input);
    expect(s.earlyOnly).toMatchObject({ total: 3, withReservation: 3, askedBeforeArrivalDay: 1, askedOnArrivalDay: 1, askedAfterArrivalDay: 1, sameDayTurnover: 1, cleaningTaskFound: 0 });
    // Saat dağılımı yerel saatle (06:00Z = 09:00 İstanbul).
    expect(s.askHourLocal[9]).toBe(1);

    // Devrin temizlik görevi: sabah 09:00'da (06:00Z) sorulduğunda henüz bitmemiş, 11:30'da (08:30Z) bitmiş → "girişe kadar hazır oldu".
    input.cleanings = [{ propertyId: "p1", reservationId: "prev", dueAt: midnight("2026-10-14"), status: "done", doneAt: d("2026-10-14T08:30:00Z") }];
    s = replayStats(input);
    expect(s.earlyOnly).toMatchObject({ cleaningTaskFound: 1, readyWhenAsked: 0, readyLaterSameDay: 1, neverReadyByCheckIn: 0 });

    // Öğlen 12:00'de (09:00Z) sorulsaydı hazırdı.
    input.messages = [ask("2026-10-14T09:00:00Z")];
    expect(replayStats(input).earlyOnly).toMatchObject({ readyWhenAsked: 1, readyLaterSameDay: 0 });

    // Temizlik hiç bitmediyse (görev açık) → girişe kadar da hazır değil.
    input.cleanings = [{ propertyId: "p1", reservationId: "prev", dueAt: midnight("2026-10-14"), status: "todo", doneAt: null }];
    expect(replayStats(input).earlyOnly).toMatchObject({ readyWhenAsked: 0, readyLaterSameDay: 0, neverReadyByCheckIn: 1 });
  });

  it("görev kümesi ürünle aynı: bağsız görev sayılır, başka günün görevi sayılmaz; çıkış = bildirilen ile varsayılanın GEÇ olanı", () => {
    const askAt = (iso: string) => [{ body: "Erken giriş yapabilir miyiz?", createdAt: d(iso), propertyId: "p1", reservationId: "own" }];
    // Rezervasyona bağlanmamış (reservationId null) çıkış günü görevi o devrin görevidir.
    const unlinked = base();
    unlinked.messages = askAt("2026-10-14T09:00:00Z");
    unlinked.cleanings = [{ propertyId: "p1", reservationId: null, dueAt: midnight("2026-10-14"), status: "done", doneAt: d("2026-10-14T08:30:00Z") }];
    expect(replayStats(unlinked).earlyOnly).toMatchObject({ cleaningTaskFound: 1, readyWhenAsked: 1 });

    // Önceki rezervasyonun BAŞKA gündeki (konaklama ortası) temizliği bu devrin görevi değildir.
    const otherDay = base();
    otherDay.messages = askAt("2026-10-14T09:00:00Z");
    otherDay.cleanings = [{ propertyId: "p1", reservationId: "prev", dueAt: midnight("2026-10-13"), status: "done", doneAt: d("2026-10-13T08:30:00Z") }];
    expect(replayStats(otherDay).earlyOnly).toMatchObject({ sameDayTurnover: 1, cleaningTaskFound: 0 });

    // Önceki misafir 13:00'te çıkacağını bildirmiş: 12:30'da "bitti" denen temizlik çıkıştan ÖNCEdir → hazır sayılmaz.
    const stated = base();
    stated.reservations[0].guestCheckoutTime = "13:00";
    stated.messages = askAt("2026-10-14T11:00:00Z");
    stated.cleanings = [{ propertyId: "p1", reservationId: "prev", dueAt: midnight("2026-10-14"), status: "done", doneAt: d("2026-10-14T09:30:00Z") }];
    expect(replayStats(stated).earlyOnly).toMatchObject({ cleaningTaskFound: 1, readyWhenAsked: 0, readyLaterSameDay: 0, neverReadyByCheckIn: 1 });

    // Aynı gün girip çıkan (sıfır gece, bozuk) satır önceki misafir sayılmaz.
    const zero = base();
    zero.reservations = [zero.reservations[1], { id: "zero", propertyId: "p1", status: "confirmed", arrivalDate: midnight("2026-10-14"), departureDate: midnight("2026-10-14"), guestCheckoutTime: null }];
    zero.messages = askAt("2026-10-14T06:00:00Z");
    expect(replayStats(zero).earlyOnly).toMatchObject({ askedOnArrivalDay: 1, sameDayTurnover: 0 });
  });

  it("iptal edilmiş önceki rezervasyon devir sayılmaz; başka mülkün görevi sayılmaz", () => {
    const input = base();
    input.reservations[0].status = "cancelled";
    input.messages = [{ body: "Erken giriş yapabilir miyiz?", createdAt: d("2026-10-14T06:00:00Z"), propertyId: "p1", reservationId: "own" }];
    expect(replayStats(input).earlyOnly).toMatchObject({ askedOnArrivalDay: 1, sameDayTurnover: 0 });
    const other = base();
    other.messages = input.messages;
    other.cleanings = [{ propertyId: "p2", reservationId: null, dueAt: midnight("2026-10-14"), status: "done", doneAt: d("2026-10-14T08:30:00Z") }];
    expect(replayStats(other).earlyOnly).toMatchObject({ sameDayTurnover: 1, cleaningTaskFound: 0 });
  });
});
