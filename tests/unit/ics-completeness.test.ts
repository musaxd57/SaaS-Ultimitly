import { describe, it, expect } from "vitest";
import { parseIcs, parseIcsDetailed, ICS_INCOMPLETE_REASONS } from "@/lib/import/ics";

// ---------------------------------------------------------------------------
// F16 (Codex denetimi 09-05, düzeltme 09-26): EKSİK OKUMA "TAKVİMİN TAMAMI" GİBİ DÖNMEZ.
//
// Ayrıştırıcı yalnız bir dizi döndürüyordu: 10.000 tavanında sessizce kesiliyor, RRULE'lu etkinliği tek
// örnek sanıyor, DTEND'siz / tarihi bozuk etkinliği iz bırakmadan atlıyordu. Senkron bu diziyi takvimin
// tamamı sayıp "kaybolan rezervasyonu iptal et" uzlaştırmasına ve müsaitlik motorunun "boş" hükmüne
// dayanak yapabiliyordu. Her neden için İKİ YÖN sınanır: neden varken işaretlenir, yokken (tavanın bir
// altı, VTIMEZONE'daki RRULE, VALARM, birebir aynı tekrar) işaretlenmez.
// ---------------------------------------------------------------------------

const cal = (...events: string[]) => `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Test//EN\n${events.join("\n")}\nEND:VCALENDAR`;
const ev = (uid: string, start = "20261010", end = "20261012", extra: string[] = []) =>
  ["BEGIN:VEVENT", `UID:${uid}`, `DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${end}`, "SUMMARY:Reserved", ...extra, "END:VEVENT"].join("\n");

describe("tam okuma: neden YOK", () => {
  it("sıradan Airbnb/Booking biçimi → incomplete boş, etkinlikler aynen", () => {
    const r = parseIcsDetailed(cal(ev("a@airbnb.com"), ev("b@airbnb.com", "20261015", "20261018")));
    expect(r.incomplete).toEqual([]);
    expect(r.events.map((e) => e.sourceReference)).toEqual(["a@airbnb.com", "b@airbnb.com"]);
  });

  it("boş ama geçerli takvim tam okumadır (boş besleme ≠ yarım dosya)", () => {
    expect(parseIcsDetailed("BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR")).toEqual({ events: [], incomplete: [] });
  });

  it("VTIMEZONE içindeki RRULE ve etkinlik içindeki VALARM işaretlenmez (etkinliğin tekrarı DEĞİL)", () => {
    const tz = [
      "BEGIN:VTIMEZONE",
      "TZID:Europe/Berlin",
      "BEGIN:DAYLIGHT",
      "DTSTART:19700329T020000",
      "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
      "END:DAYLIGHT",
      "END:VTIMEZONE",
    ].join("\n");
    const alarm = ["BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT15M", "DESCRIPTION:Hatırlatma", "END:VALARM"];
    const r = parseIcsDetailed(cal(tz, ev("a@x", "20261010", "20261012", alarm)));
    expect(r.incomplete).toEqual([]);
    expect(r.events).toHaveLength(1);
  });

  it("aynı UID birebir aynı tarih ve durumla iki kez: belirsizlik değil", () => {
    expect(parseIcsDetailed(cal(ev("a@x"), ev("a@x"))).incomplete).toEqual([]);
  });

  it("CRLF satır sonları ve dosya sonundaki boş satırlar tam okumayı bozmaz", () => {
    const text = `${cal(ev("a@x")).replace(/\n/g, "\r\n")}\r\n\r\n`;
    expect(parseIcsDetailed(text).incomplete).toEqual([]);
  });
});

describe("event_cap: 10.000 tavanının iki yanı", () => {
  const many = (n: number) => cal(...Array.from({ length: n }, (_, i) => ev(`u${i}@x`)));

  it("tam 10.000 etkinlik → eksik DEĞİL", () => {
    const r = parseIcsDetailed(many(10_000));
    expect(r.events).toHaveLength(10_000);
    expect(r.incomplete).toEqual([]);
  });

  it("10.001 etkinlik → 10.000 döner ve okuma EKSİK (eskiden sessizce kesiliyordu)", () => {
    const r = parseIcsDetailed(many(10_001));
    expect(r.events).toHaveLength(10_000);
    expect(r.incomplete).toEqual(["event_cap"]);
  });
});

describe("recurrence: tekrarlar açılmaz, okuma eksik sayılır", () => {
  for (const [name, line] of [
    ["RRULE", "RRULE:FREQ=WEEKLY;COUNT=4"],
    ["RDATE", "RDATE;VALUE=DATE:20261101"],
    ["EXDATE", "EXDATE;VALUE=DATE:20261017"],
    ["RECURRENCE-ID", "RECURRENCE-ID;VALUE=DATE:20261017"],
  ] as const) {
    it(`${name} → recurrence; ilk örnek yine döner`, () => {
      const r = parseIcsDetailed(cal(ev("r@x", "20261010", "20261012", [line])));
      expect(r.incomplete).toEqual(["recurrence"]);
      expect(r.events).toHaveLength(1);
    });
  }
});

describe("unreadable_event: okunamayan etkinlik iz bırakır", () => {
  it("DTEND yok (DURATION'lı) → işaretlenir, etkinlik dönmez", () => {
    const noEnd = ["BEGIN:VEVENT", "UID:d@x", "DTSTART;VALUE=DATE:20261010", "DURATION:P2D", "END:VEVENT"].join("\n");
    const r = parseIcsDetailed(cal(ev("a@x"), noEnd));
    expect(r.incomplete).toEqual(["unreadable_event"]);
    expect(r.events.map((e) => e.sourceReference)).toEqual(["a@x"]);
  });

  it("geçersiz takvim günü (31 Şubat) → işaretlenir, etkinlik dönmez", () => {
    const r = parseIcsDetailed(cal(ev("bad@x", "20260231", "20260305")));
    expect(r.incomplete).toEqual(["unreadable_event"]);
    expect(r.events).toEqual([]);
  });

  it("ters etkinlik → işaretlenir; liste davranışı değişmez (satır döner, senkron atlar)", () => {
    const r = parseIcsDetailed(cal(ev("inv@x", "20261012", "20261010")));
    expect(r.incomplete).toEqual(["unreadable_event"]);
    expect(r.events).toHaveLength(1);
  });

  it("sıfır süreli etkinlik (giriş = çıkış) → işaretlenir: hangi geceyi kastettiği bilinemez", () => {
    const r = parseIcsDetailed(cal(ev("zero@x", "20261010", "20261010")));
    expect(r.incomplete).toEqual(["unreadable_event"]);
    expect(r.events).toHaveLength(1);
  });

  it("END:VEVENT görmeden yeni BEGIN:VEVENT → önceki etkinlik kayboldu", () => {
    const lost = ["BEGIN:VEVENT", "UID:lost@x", "DTSTART;VALUE=DATE:20261001", "DTEND;VALUE=DATE:20261003"].join("\n");
    const r = parseIcsDetailed(cal(lost, ev("a@x")));
    expect(r.incomplete).toEqual(["unreadable_event"]);
    expect(r.events.map((e) => e.sourceReference)).toEqual(["a@x"]);
  });

  it("BEGIN'i kayıp etkinlik (başıboş END:VEVENT) → işaretlenir ve önceki etkinlik İKİ KEZ işlenmez", () => {
    const orphan = ["UID:orphan@x", "DTSTART;VALUE=DATE:20261020", "DTEND;VALUE=DATE:20261022", "END:VEVENT"].join("\n");
    const r = parseIcsDetailed(cal(ev("a@x"), orphan));
    expect(r.incomplete).toEqual(["unreadable_event"]);
    expect(r.events.map((e) => e.sourceReference)).toEqual(["a@x"]);
  });
});

describe("duplicate_uid: aynı kayıt çelişen iki hâlle", () => {
  it("aynı UID farklı tarihle → işaretlenir (hangisi geçerli bilinemez)", () => {
    expect(parseIcsDetailed(cal(ev("a@x"), ev("a@x", "20261020", "20261022"))).incomplete).toEqual(["duplicate_uid"]);
  });

  it("aynı UID aynı tarih ama biri iptal → işaretlenir", () => {
    expect(parseIcsDetailed(cal(ev("a@x"), ev("a@x", "20261010", "20261012", ["STATUS:CANCELLED"]))).incomplete).toEqual([
      "duplicate_uid",
    ]);
  });
});

describe("truncated: yarım dosya", () => {
  it("END:VCALENDAR yok → işaretlenir; okunan etkinlik yine döner", () => {
    const r = parseIcsDetailed(`BEGIN:VCALENDAR\nVERSION:2.0\n${ev("a@x")}`);
    expect(r.incomplete).toEqual(["truncated"]);
    expect(r.events).toHaveLength(1);
  });

  it("dosya bir etkinliğin ortasında bitiyor → işaretlenir", () => {
    const r = parseIcsDetailed(`BEGIN:VCALENDAR\n${ev("a@x")}\nBEGIN:VEVENT\nUID:cut@x\nDTSTART;VALUE=DATE:2026`);
    expect(r.incomplete).toEqual(["truncated"]);
    expect(r.events.map((e) => e.sourceReference)).toEqual(["a@x"]);
  });

  it("takvim çerçevesi olmayan girdi bir etkinliğin ortasında bitiyor → yine yarım", () => {
    expect(parseIcsDetailed("BEGIN:VEVENT\nUID:cut@x\nDTSTART;VALUE=DATE:20261010").incomplete).toEqual(["truncated"]);
  });

  it("kapanmamış etkinlikle kapanan takvim → etkinlik kayboldu", () => {
    const r = parseIcsDetailed(`BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:cut@x\nDTSTART;VALUE=DATE:20261010\nEND:VCALENDAR`);
    expect(r.incomplete).toEqual(["unreadable_event"]);
  });
});

describe("sözleşme", () => {
  it("birden çok neden tekrarsız ve ağırlık sırasında döner", () => {
    const r = parseIcsDetailed(`BEGIN:VCALENDAR\n${ev("a@x")}\n${ev("a@x", "20261020", "20261022", ["RRULE:FREQ=DAILY"])}`);
    expect(r.incomplete).toEqual(["truncated", "recurrence", "duplicate_uid"]);
    expect(ICS_INCOMPLETE_REASONS).toEqual(["truncated", "event_cap", "recurrence", "duplicate_uid", "unreadable_event"]);
  });

  it("`parseIcs` aynı etkinlik listesini döndürür (eski çağıranlar değişmez)", () => {
    const text = cal(ev("a@x"), ev("b@x", "20261020", "20261022", ["RRULE:FREQ=DAILY"]));
    expect(parseIcs(text)).toEqual(parseIcsDetailed(text).events);
  });
});
