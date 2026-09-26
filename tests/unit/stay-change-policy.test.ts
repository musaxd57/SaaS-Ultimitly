import { describe, it, expect, afterEach, vi } from "vitest";
import {
  STAY_CHANGE_KINDS,
  REPLY_STANCES,
  STAY_GUARD_JSON_SCHEMA,
  parseStayChangeDeclaration,
  parseStayGuardVerdict,
  hhmmToMinutes,
  normalizeHhmm,
  isEarlierThanCheckIn,
  isLaterThanCheckOut,
  slotTimesShifted,
  type StayGuardVerdict,
} from "@/lib/ai/semantic/stay-change";
import {
  detectAvailabilityClaim,
  detectAvailabilityRequest,
  evaluateAvailability,
  hasAvailabilityDeferral,
  stayEvidenceOf,
  vetoAvailability,
} from "@/lib/ai/availability-claims";
import { autoReplyGateFailure, availabilityPolicyFor, passesAutoReplySafetyGate } from "@/lib/automation";
import { qrAvailabilityPolicy } from "@/lib/guest-chat-gate";
import { buildKbEvidence } from "@/lib/ai/grounding";

// ---------------------------------------------------------------------------
// ANLAM KATMANI POLİTİKASI (09-24, kurucu düzeltmesi): kelime ağı genellemiyordu (kör batarya:
// izinlerin 19/60'ı) → karar dört katmanın birleşimi. Bu dosya ŞEMA sözleşmesini ve BİRLEŞİM
// kuralını pinler; modelin gerçek isabeti `evals/stay-change.json` ile (kredi) ölçülür.
// ---------------------------------------------------------------------------

const STAY = { checkIn: "15:00", checkOut: "11:00" };
const verdict = (over: Partial<StayGuardVerdict> = {}): StayGuardVerdict => ({
  guestRequestsChange: false,
  kind: "none",
  requestedCheckinTime: null,
  requestedCheckoutTime: null,
  replyStatesCalendar: false,
  replyGrantsChange: false,
  replyDefersToHost: false,
  replyRefuses: false,
  replyAmounts: [],
  replyPriceTerms: false,
  ...over,
});

afterEach(() => vi.unstubAllEnvs());

describe("şema sözleşmesi (strict)", () => {
  it("beyan: iki alan da yoksa null (sinyal yok); kapalı küme dışı değer `unknown` (coercion YOK)", () => {
    expect(parseStayChangeDeclaration(undefined, undefined)).toBeNull();
    expect(parseStayChangeDeclaration("early_checkin", "defers")).toEqual({ asked: "early_checkin", stance: "defers" });
    expect(parseStayChangeDeclaration("Early_Checkin", "DEFERS")).toEqual({ asked: "unknown", stance: "unknown" });
    expect(parseStayChangeDeclaration(true, 1)).toEqual({ asked: "unknown", stance: "unknown" });
    expect(parseStayChangeDeclaration("none", undefined)).toEqual({ asked: "none", stance: "unknown" });
  });

  it("bekçi: her boolean gerçekten boolean, `kind` kapalı kümede — değilse hüküm YOK (null)", () => {
    const ok = {
      guest_requests_change: true,
      kind: "early_checkin",
      requested_checkin_time: "11:00",
      requested_checkout_time: null,
      reply_states_calendar: false,
      reply_grants_change: false,
      reply_defers_to_host: true,
      reply_refuses: false,
      reply_amounts: [],
      reply_price_terms: false,
    };
    expect(parseStayGuardVerdict(ok)).toMatchObject({ guestRequestsChange: true, kind: "early_checkin", requestedCheckinTime: "11:00" });
    expect(parseStayGuardVerdict({ ...ok, reply_grants_change: "false" })).toBeNull();
    expect(parseStayGuardVerdict({ ...ok, kind: "early" })).toBeNull();
    expect(parseStayGuardVerdict({ ...ok, reply_refuses: undefined })).toBeNull();
    expect(parseStayGuardVerdict([ok])).toBeNull();
    // Saat yuvası yardımcıdır: biçim dışıysa yalnız o alan null olur.
    expect(parseStayGuardVerdict({ ...ok, requested_checkin_time: "11am" })?.requestedCheckinTime).toBeNull();
  });

  it("OpenAI strict şeması: her alan zorunlu, ek alan yok, `kind` enum'u kapalı kümeyle PARİTE", () => {
    const s = STAY_GUARD_JSON_SCHEMA.schema;
    expect(STAY_GUARD_JSON_SCHEMA.strict).toBe(true);
    expect(s.additionalProperties).toBe(false);
    expect([...s.required].sort()).toEqual(Object.keys(s.properties).sort());
    expect(s.properties.kind.enum).toEqual([...STAY_CHANGE_KINDS]);
  });

  it("kapalı kümeler bilinçli ve sabit", () => {
    expect([...STAY_CHANGE_KINDS]).toEqual(["none", "extend", "early_checkin", "late_checkout", "date_change", "availability"]);
    expect([...REPLY_STANCES]).toEqual(["none", "defers", "grants", "states_calendar", "refuses"]);
  });
});

describe("saat kıyası KODDA", () => {
  it("HH:MM / H:MM dışı her şey çözülmez; kıyas bilinmiyorsa null (tahmin YOK)", () => {
    expect(hhmmToMinutes("09:30")).toBe(570);
    expect(hhmmToMinutes("9:30")).toBe(570); // model bazen sıfırsız yazar — yuva düşmemeli (inceleme 09-24)
    expect(hhmmToMinutes("24:00")).toBeNull();
    expect(hhmmToMinutes("9.30")).toBeNull();
    expect(normalizeHhmm("9:05")).toBe("09:05");
    expect(isEarlierThanCheckIn("11:00", STAY)).toBe(true);
    expect(isEarlierThanCheckIn("15:00", STAY)).toBe(false);
    expect(isEarlierThanCheckIn("16:00", STAY)).toBe(false);
    expect(isLaterThanCheckOut("13:00", STAY)).toBe(true);
    expect(isLaterThanCheckOut("11:00", STAY)).toBe(false);
    expect(isEarlierThanCheckIn("11:00", { checkIn: null })).toBeNull();
  });

  it("🚨 gece yarısından sonraki varış (01:30) erken giriş DEĞİLDİR — ertesi günün geç varışı", () => {
    expect(isEarlierThanCheckIn("01:30", STAY)).toBe(false);
    expect(isEarlierThanCheckIn("04:59", STAY)).toBe(false);
    expect(isEarlierThanCheckIn("05:00", STAY)).toBe(true); // sabah erken varış = erken giriş isteği
    expect(slotTimesShifted({ checkinTime: "01:30" }, STAY)).toBe(false);
  });

  it("yuva kaydırması: yalnız standart dışı saat istek sayılır", () => {
    expect(slotTimesShifted({ checkinTime: "12:00" }, STAY)).toBe(true);
    expect(slotTimesShifted({ checkoutTime: "14:00" }, STAY)).toBe(true);
    expect(slotTimesShifted({ checkinTime: "15:00", checkoutTime: "11:00" }, STAY)).toBe(false);
    expect(slotTimesShifted({ checkinTime: "18:00", checkoutTime: "09:00" }, STAY)).toBe(false);
    expect(slotTimesShifted(null, STAY)).toBe(false);
  });
});

describe("birleşim kuralı — İDDİA bacağı (her kipte, devirde de)", () => {
  it("🚨 beyan edilen izin/takvim duruşu kelime ağının göremediği cevabı da durdurur", () => {
    // Kelime ağının kaçırdığı gerçek izin cümleleri (kör batarya + ikinci inceleme).
    for (const reply of ["Olur, bekliyoruz.", "Absolutely, stay as long as you like!", "Your early check-in is all set."]) {
      expect(detectAvailabilityClaim(reply), reply).toBeNull(); // KONTROL: kelime ağı bu izni GÖRMÜYOR
      expect(vetoAvailability(reply, ["x"], { declared: { asked: "extend", stance: "grants" } }), reply).toBe("availability_claim");
    }
    expect(vetoAvailability("Mid-March is wide open.", [], { declared: { asked: "availability", stance: "states_calendar" } })).toBe(
      "availability_claim",
    );
  });

  it("'kaydedildi' tek başına erteleme DEĞİL; beyan edilen İZİN her zaman durdurur (devir cevabı muafiyeti 09-24'te kaldırıldı)", () => {
    const ask = ["Bir gece daha kalabilir miyiz?"];
    const declared = { asked: "extend", stance: "none" } as const;
    const ran = { status: "ok" as const, verdict: verdict({ guestRequestsChange: true, kind: "extend" }) };
    expect(vetoAvailability("Mesajınız kaydedildi.", ask, { declared, guard: ran })).toBe("availability_unconfirmed");
    expect(vetoAvailability("Mesajınız kaydedildi.", ask, { declared: { asked: "extend", stance: "grants" }, guard: ran })).toBe("availability_claim");
    expect(vetoAvailability("Mesajınız kaydedildi.", ask, { declared })).toBe("availability_unconfirmed");
  });

  it("bekçinin takvim/izin hükmü durdurur (ertelemeyle birlikte olsa bile)", () => {
    const reply = "It's technically your host's call, but I'm sure 1 pm will be fine.";
    expect(vetoAvailability(reply, ["Late checkout?"], { guard: { status: "ok", verdict: verdict({ replyGrantsChange: true, replyDefersToHost: false }) } })).toBe(
      "availability_claim",
    );
    expect(vetoAvailability("x", [], { guard: { status: "ok", verdict: verdict({ replyStatesCalendar: true }) } })).toBe("availability_claim");
  });
});

describe("birleşim kuralı — İSTEK bacağı", () => {
  const ASK = "Could we get into the flat at 11?"; // kelime ağı istek sanmıyor (kör batarya)
  const PLAIN = "Check-in is from 15:00.";

  it("KONTROL: kelime ağı bu isteği görmüyor (katmanların neden gerekli olduğu)", () => {
    expect(evaluateAvailability(PLAIN, [ASK], {}).signals.lx).toBe("-");
  });

  it("🚨 beyan edilen istek bekçi 'istek yok' dese de ertelemesiz cevabı durdurur (düşmanca inceleme 09-24, P1-1)", () => {
    const declared = { asked: "early_checkin" as const, stance: "none" as const };
    const guard = { status: "ok" as const, verdict: verdict() };
    expect(evaluateAvailability(PLAIN, [ASK], { declared, guard }).reason).toBe("availability_unconfirmed");
    expect(evaluateAvailability(PLAIN, [ASK], { declared }).reason).toBe("availability_unconfirmed"); // bekçisiz de
  });

  it("🚨 ERTELEME tek modelin sözüyle kabul edilmez: kelime ağının tanımadığı erteleme ancak beyan + bekçi ikisi 'erteliyor' derse", () => {
    // Kelime ağının TANIMADIĞI dilde erteleme (İtalyanca kalıp yok) — iki model birlikte tanımalı.
    const DE = "Se il check-out posticipato sia possibile lo stabilisce il suo host.";
    expect(evaluateAvailability(DE, [], {}).signals.lx).toBe("-"); // KONTROL: kelime ağı ertelemeyi görmüyor
    const declared = { asked: "late_checkout" as const, stance: "defers" as const };
    const req = verdict({ guestRequestsChange: true, kind: "late_checkout" });
    // Yalnız beyan: yetmez.
    expect(evaluateAvailability(DE, ["Possiamo fare il check-out più tardi? Late checkout?"], { declared }).reason).toBe("availability_unconfirmed");
    // Beyan + bağımsız bekçi hemfikir: erteleme kanıtı.
    expect(
      vetoAvailability(DE, ["Possiamo fare il check-out più tardi? Late checkout?"], {
        declared,
        guard: { status: "ok", verdict: { ...req, replyDefersToHost: true } },
      }),
    ).toBeNull();
    // Bekçi "erteliyor" dese de beyan etmiyorsa yetmez.
    expect(
      vetoAvailability(DE, ["Possiamo fare il check-out più tardi? Late checkout?"], {
        declared: { asked: "late_checkout", stance: "none" },
        guard: { status: "ok", verdict: { ...req, replyDefersToHost: true } },
      }),
    ).toBe("availability_unconfirmed");
  });

  it("🚨 (09-24 kurucu değişmezi, ESKİ KURALIN TERSİ) kelime ağının tanıdığı erteleme cümlesi + beyan 'defers' bekçi YOKKEN yetmez", () => {
    const reply = "Bu ev sahibinizin kararıdır; mesajınız kaydedildi, ev sahibiniz görebilir.";
    const declared = { asked: "early_checkin", stance: "defers" } as const;
    expect(hasAvailabilityDeferral(reply)).toBe(true); // anti-vakum: kelime ağı ertelemeyi tanıyor
    expect(vetoAvailability(reply, [ASK], { declared })).toBe("availability_unconfirmed");
    // İki bağımsız model hemfikirse gider.
    const guard = { status: "ok" as const, verdict: verdict({ guestRequestsChange: true, kind: "early_checkin", replyDefersToHost: true }) };
    expect(vetoAvailability(reply, [ASK], { declared, guard })).toBeNull();
  });

  it("bekçinin istek hükmü ve KODDA kaydırılmış saat (model 'istek yok' dese de) ertelemesiz cevabı durdurur", () => {
    const none = { asked: "none", stance: "none" } as const; // model "istek yok" diyor
    expect(
      vetoAvailability(PLAIN, [ASK], { declared: none, guard: { status: "ok", verdict: verdict({ guestRequestsChange: true, kind: "early_checkin" }) } }),
    ).toBe("availability_unconfirmed");
    expect(
      vetoAvailability(PLAIN, [ASK], { declared: none, stayTimes: STAY, guard: { status: "ok", verdict: verdict({ requestedCheckinTime: "11:00" }) } }),
    ).toBe("availability_unconfirmed");
    // Standart saat istek değildir.
    expect(
      vetoAvailability(PLAIN, ["Can we check in at 15:00?"], { stayTimes: STAY, guard: { status: "ok", verdict: verdict({ requestedCheckinTime: "15:00" }) } }),
    ).toBeNull();
  });

  it("bekçi reddi (takvimsiz 'mümkün değil') ertelemesizse durur — konaklama değişikliği konuşulan cevap ertelemeli", () => {
    expect(
      vetoAvailability("Early check-in isn't possible.", ["x"], {
        declared: { asked: "none", stance: "none" },
        guard: { status: "ok", verdict: verdict({ replyRefuses: true }) },
      }),
    ).toBe("availability_unconfirmed");
  });

  it("BEKÇİ BAŞARISIZ: modelin konaklama sinyali varsa tutulur; sinyal yoksa eski davranış", () => {
    expect(vetoAvailability(PLAIN, [ASK], { guard: { status: "failed" }, declared: { asked: "early_checkin", stance: "none" } })).toBe(
      "availability_unconfirmed",
    );
    expect(vetoAvailability(PLAIN, ["Wifi?"], { guard: { status: "failed" }, declared: { asked: "none", stance: "none" } })).toBeNull();
  });

  it("🚨 anlama katmanının isteği (ya da KODDA kaydırılmış yuva saati) bekçi 'istek yok' dese de durdurur", () => {
    const u = { requested: false, kind: "none" as const, checkinTime: "11:00", checkoutTime: null };
    const ran = { declared: { asked: "none", stance: "none" } as const, guard: { status: "ok" as const, verdict: verdict() } };
    const e = evaluateAvailability(PLAIN, [ASK], { ...ran, understanding: u, stayTimes: STAY });
    expect(e.signals.u).toBe("req");
    expect(e.reason).toBe("availability_unconfirmed");
    expect(e.enforceReason).toBe("availability_unconfirmed");
    // Bekçi yoksa anlama katmanının isteği de tutar (hassas istek + doğrulayıcı yok).
    expect(evaluateAvailability(PLAIN, [ASK], { declared: ran.declared, understanding: u, stayTimes: STAY }).reason).toBe(
      "availability_unconfirmed",
    );
  });

  it("geçersiz duruş (`unknown`) tanınmayan ≠ temiz: iddia sayılır (geçerli izin duruşundan gevşek olamaz)", () => {
    expect(vetoAvailability(PLAIN, ["Wifi?"], { declared: { asked: "none", stance: "unknown" } })).toBe("availability_claim");
  });
});

describe("kanıt: PII'siz kapalı-küme özet", () => {
  it("sinyal kodları ve `sc` kanıt alanı", () => {
    const e = evaluateAvailability("O gece boş; Bu ev sahibinizin kararıdır.", ["Bir gece daha kalabilir miyiz?"], {
      declared: { asked: "extend", stance: "states_calendar" },
      guard: { status: "ok", verdict: verdict({ guestRequestsChange: true, kind: "extend", replyStatesCalendar: true, requestedCheckoutTime: "13:00" }) },
      stayTimes: STAY,
    });
    expect(e.reason).toBe("availability_claim");
    expect(e.signals).toEqual({ lx: "crd", d: "extend/states_calendar", g: "ok", gv: "qst", u: "off" });
    const json = buildKbEvidence({ retrieved: [], usedLabels: [], stay: stayEvidenceOf(e) });
    expect(JSON.parse(String(json)).sc).toEqual({ v: "availability_claim", ev: "availability_claim", lx: "crd", d: "extend/states_calendar", g: "ok", gv: "qst", u: "off" });
  });

  it("tanınmayan kanıt değeri düşer (serbest metin sızamaz)", () => {
    const bad = { v: "availability_claim", ev: "-", lx: "-", d: "misafir Ayşe/grants", g: "ok", u: "off" };
    expect(buildKbEvidence({ retrieved: [], usedLabels: [], stay: bad })).toBeNull();
    const bad2 = { v: "Ayşe", ev: "-", lx: "-", d: "absent", g: "ok", u: "off" };
    expect(buildKbEvidence({ retrieved: [], usedLabels: [], stay: bad2 })).toBeNull();
  });

  it("her alan AYRI kapalı kümeden: bozuk g/u/lx/ev/d → blok düşer; bozuk gv yalnız kendisi düşer", () => {
    const good = { v: "-", ev: "availability_unconfirmed", lx: "r", d: "extend/defers", g: "ok", gv: "qd", u: "req" };
    const sc = (stay: Record<string, string>) => {
      const json = buildKbEvidence({ retrieved: [], usedLabels: [], stay: stay as never });
      return json === null ? null : JSON.parse(json).sc;
    };
    expect(sc(good)).toEqual(good); // anti-vakum
    for (const [k, v] of [
      ["g", "maybe"],
      ["u", "yes"],
      ["lx", ""],
      ["lx", "cc"],
      ["lx", "x"],
      ["ev", "blocked"],
      ["d", "extend/defers/x"],
      ["d", "extend/maybe"],
    ] as const) {
      expect(sc({ ...good, [k]: v }), `${k}=${v}`).toBeNull();
    }
    for (const gv of ["", "qsz", "Ayşe", "dq"]) {
      expect(sc({ ...good, gv }), gv).toEqual({ v: "-", ev: "availability_unconfirmed", lx: "r", d: "extend/defers", g: "ok", u: "req" });
    }
    // Sıra harfleri koddakiyle AYNI (q s a d x t): tam küme geçer.
    expect(sc({ ...good, gv: "qsadxt" })?.gv).toBe("qsadxt");
  });

  it("bekçi bayrak harfleri: istek(q) · takvim(s) · izin(a) · erteleme(d) · ret(x) · KODDA kaymış saat(t)", () => {
    const flags = (over: Partial<StayGuardVerdict>) =>
      evaluateAvailability("Ok.", ["hi"], { guard: { status: "ok", verdict: verdict(over) }, stayTimes: STAY }).signals.gv;
    expect(flags({})).toBe("-");
    expect(flags({ replyDefersToHost: true })).toBe("d");
    expect(flags({ replyRefuses: true })).toBe("x");
    expect(flags({ requestedCheckinTime: "11:00" })).toBe("t");
    expect(flags({ requestedCheckinTime: "15:00" })).toBe("-"); // standart saat kaymış sayılmaz
    expect(flags({ guestRequestsChange: true, replyStatesCalendar: true, replyGrantsChange: true })).toBe("qsa");
  });
});

describe("kanal kapısı — bağlantı DAVRANIŞSAL", () => {
  const OK = { intent: "general", riskLevel: "none", confidence: 0.92, source: "openai" };

  it("🚨 beyan edilen izin kapıyı kapatır (kelime ağı görmese de)", () => {
    expect(passesAutoReplySafetyGate({ ...OK, reply: "Olur, bekliyoruz." }, "Bir gece daha kalabilir miyiz?")).toBe(false); // kelime ağı: istek + ertelemesiz
    expect(passesAutoReplySafetyGate({ ...OK, reply: "Your early check-in is all set." }, "Could we get into the flat at 11?")).toBe(true); // KONTROL
    expect(
      passesAutoReplySafetyGate(
        { ...OK, reply: "Your early check-in is all set.", stayChange: { asked: "early_checkin", stance: "grants" } },
        "Could we get into the flat at 11?",
      ),
    ).toBe(false);
  });

  it("bekçi bağlamı kapıya ulaşır; standart saat bilgisi kapıyı kapatmaz", () => {
    const reply = "Check-in is from 15:00.";
    expect(passesAutoReplySafetyGate({ ...OK, reply }, "What time is check-in?", { stayTimes: STAY })).toBe(true);
    expect(
      passesAutoReplySafetyGate({ ...OK, reply }, "Could we get into the flat at 11?", {
        stayTimes: STAY,
        stayGuard: { status: "ok", verdict: verdict({ requestedCheckinTime: "11:00" }) },
      }),
    ).toBe(false);
  });
});

describe("inceleme turu 09-24 — politika sıkılaştırmaları", () => {
  const ASK = "Could we get into the flat at 11?";
  const PLAIN = "Check-in is from 15:00.";

  it("🚨 'kaydedildi / recorded' ERTELEME DEĞİLDİR: örtük izin + kayıt cümlesi gitmez", () => {
    for (const [reply, ask] of [
      ["Olur, bekliyoruz. Mesajınız kaydedildi.", "Bir gece daha kalabilir miyiz?"],
      ["Of course, we'd love to have you another night. Your request has been recorded.", "Can we stay one more night?"],
    ] as const) {
      expect(hasAvailabilityDeferral(reply), reply).toBe(false);
      // "Kaydedildi" erteleme değil; beyan da yok → duruş bilinmiyor → durur.
      expect(vetoAvailability(reply, [ask]), reply).not.toBeNull();
    }
  });

  it("🚨 onay TAHMİNİ erteleme değildir; onaya BAĞLILIK ve 'ev sahibiniz karar verir/kontrol eder' ertelemedir", () => {
    // Erteleme tanıma artık KANIT (lx `d`) ve deterministik yedeğin ölçüsüdür; izin iki modelden gelir.
    expect(hasAvailabilityDeferral("Ev sahibiniz uzatma talebinizi onaylayacaktır, merak etmeyin.")).toBe(false);
    expect(hasAvailabilityDeferral("Uzatma ev sahibinizin onayına bağlıdır; mesajınız kaydedildi.")).toBe(true);
    expect(hasAvailabilityDeferral("Bu tarihlerin uygunluğunu ev sahibiniz kontrol edecek.")).toBe(true);
    expect(hasAvailabilityDeferral("Karar ev sahibinizindir, isteğiniz kaydedildi.")).toBe(true);
    expect(hasAvailabilityDeferral("Your extension has been approved by your host.")).toBe(false);
    expect(hasAvailabilityDeferral("Your extension needs to be approved by your host.")).toBe(true);
    // Uçtan uca: gerçek erteleme iki modelle gider; onay TAHMİNİNİ bekçi izin olarak okursa durur (kelime ağı bu
    // tahmini izin sanmıyor — o bacak artık modellerin işi); "onaylandı" cümlesi kelime ağında da izindir.
    const ask = ["Bir gece daha kalabilir miyiz?"];
    const twoModels = {
      declared: { asked: "extend", stance: "defers" } as const,
      guard: { status: "ok" as const, verdict: verdict({ guestRequestsChange: true, kind: "extend", replyDefersToHost: true }) },
    };
    expect(vetoAvailability("Uzatma ev sahibinizin onayına bağlıdır; mesajınız kaydedildi.", ask, twoModels)).toBeNull();
    expect(
      vetoAvailability("Ev sahibiniz uzatma talebinizi onaylayacaktır, merak etmeyin.", ask, {
        ...twoModels,
        guard: { status: "ok", verdict: verdict({ guestRequestsChange: true, kind: "extend", replyGrantsChange: true }) },
      }),
    ).toBe("availability_claim");
    expect(vetoAvailability("Your extension has been approved by your host.", ["Can we extend?"], twoModels)).toBe("availability_claim");
  });

  it("🚨 kelime ağının ertelemesi hiçbir durumda tek başına izin değildir; beyan başka duruş söylüyorsa bekçi 'erteliyor' dese de sayılmaz", () => {
    const reply = "Olur, bekliyoruz. Bu ev sahibinizin kararıdır.";
    const ask = ["Bir gece daha kalabilir miyiz?"];
    const guardDefers = { status: "ok" as const, verdict: verdict({ guestRequestsChange: true, kind: "extend", replyDefersToHost: true }) };
    expect(hasAvailabilityDeferral(reply)).toBe(true); // anti-vakum
    // (09-24'e kadar "beyan yok → yedek sayar" idi — kurucu değişmeziyle KALDIRILDI.)
    expect(vetoAvailability(reply, ask)).toBe("availability_claim");
    expect(vetoAvailability(reply, ask, { declared: { asked: "extend", stance: "none" }, guard: guardDefers })).toBe("availability_unconfirmed");
    expect(vetoAvailability(reply, ask, { declared: { asked: "extend", stance: "defers" } })).toBe("availability_unconfirmed");
    expect(vetoAvailability(reply, ask, { declared: { asked: "extend", stance: "defers" }, guard: guardDefers })).toBeNull();
  });

  it("🚨 tanınmayan duruş (biçim bozuk 'Grants') izin SAYILIR — konaklama bağlamı olsa da olmasa da (09-24: bağlamsız muafiyet kaldırıldı, P2-3)", () => {
    expect(vetoAvailability(PLAIN, [ASK], { declared: { asked: "early_checkin", stance: "unknown" } })).toBe("availability_claim");
    expect(vetoAvailability("Wi-Fi şifresi Lale2024.", ["Wifi?"], { declared: { asked: "none", stance: "unknown" } })).toBe("availability_claim");
  });

  it("bekçi / anlama `kind` bir değişiklik adlandırıyorsa `requested:false` olsa da istek sayılır", () => {
    const none = { asked: "none", stance: "none" } as const;
    expect(vetoAvailability(PLAIN, [ASK], { declared: none, guard: { status: "ok", verdict: verdict({ kind: "early_checkin" }) } })).toBe(
      "availability_unconfirmed",
    );
    const e = evaluateAvailability(PLAIN, [ASK], {
      declared: none,
      understanding: { requested: false, kind: "extend", checkinTime: null, checkoutTime: null },
    });
    expect(e.signals.u).toBe("req");
    expect(e.reason).toBe("availability_unconfirmed");
  });

  it("🚨 ev sahibinin KENDİ teklif metni iddia sayılmaz; değiştirilmiş/kendi izni sayılır; istekte erteleme şartı sürer", () => {
    const offer = "Müsaitlik varsa çıkışınızı 13:00'e kadar uzatabiliriz.";
    const ask = ["Geç çıkış mümkün mü?"];
    const relay = `${offer} Uygunluğu ev sahibinizin kararıdır; mesajınız kaydedildi.`;
    const twoModels = {
      declared: { asked: "late_checkout", stance: "defers" } as const,
      guard: { status: "ok" as const, verdict: verdict({ guestRequestsChange: true, kind: "late_checkout", replyDefersToHost: true }) },
    };
    expect(vetoAvailability(relay, ask, twoModels)).toBe("availability_claim"); // KONTROL: teklif bilinmezse izin gibi okunur
    expect(vetoAvailability(relay, ask, { ...twoModels, hostOfferText: offer })).toBeNull();
    // 🚨 Bekçi yokken teklif aktarımı da taslakta kalır (erteleme iki modelle kanıtlanamadı).
    expect(vetoAvailability(relay, ask, { declared: twoModels.declared, hostOfferText: offer })).not.toBeNull();
    // 🚨 ERTELEMESİZ AKTARIMDA MUAFİYET YOK (ikinci inceleme 09-24, P1): teklifin kendi izin cümlesi iddiadır —
    // model "defers" dese de, istek kelime ağından kaçsa da.
    expect(vetoAvailability(offer, ask, { hostOfferText: offer })).toBe("availability_claim");
    const tomorrow = ["Yarın öğlen 1'de çıksak sorun olur mu?"];
    for (const stance of ["defers", "none"] as const) {
      expect(vetoAvailability(offer, tomorrow, { hostOfferText: offer, declared: { asked: "late_checkout", stance } }), stance).toBe(
        "availability_claim",
      );
    }
    const en = "Late checkout until 13:00 is possible for 20 EUR.";
    expect(
      vetoAvailability(en, ["Could we leave at 1pm tomorrow instead of 11?"], {
        hostOfferText: en,
        declared: { asked: "late_checkout", stance: "defers" },
        stayTimes: STAY,
      }),
    ).toBe("availability_claim");
    // Teklifin KENDİ erteleme cümlesi kendini onaylamaz: erteleme teklif metninin DIŞINDA aranır. Teklif metni
    // kendi içinde "subject to availability" taşıyor (mutasyon turu 09-24: teklif metni erteleme İÇERMEYEN eski
    // örnek bu kuralı sınamıyordu — kural silinse de geçiyordu).
    const selfDeferring = "Late checkout until 13:00 is possible for 20 EUR, subject to availability.";
    expect(hasAvailabilityDeferral(selfDeferring)).toBe(true); // anti-vakum: teklif GERÇEKTEN erteleme cümlesi taşıyor
    const relayOnly = evaluateAvailability(selfDeferring, ["Could we leave at 1pm tomorrow instead of 11?"], {
      hostOfferText: selfDeferring,
      stayTimes: STAY,
    });
    expect(relayOnly.reason).toBe("availability_claim");
    expect(relayOnly.signals.lx).not.toContain("d");
    // KONTROL: teklifin DIŞINDA gerçek erteleme varsa muafiyet işler.
    expect(
      vetoAvailability(`${selfDeferring} Whether it works for your dates is your host's call; your message has been recorded.`, ["x"], {
        hostOfferText: selfDeferring,
        stayTimes: STAY,
        declared: { asked: "late_checkout", stance: "defers" },
        guard: { status: "ok", verdict: verdict({ guestRequestsChange: true, kind: "late_checkout", replyDefersToHost: true }) },
      }),
    ).toBeNull();
    expect(vetoAvailability("Çıkışınızı 13:00'e uzattık, iyi tatiller.", ask, { hostOfferText: offer })).toBe("availability_claim");
  });

  it("🚨 teklif muafiyetinin anahtarı (mutasyon turu 09-24, P20/P21 hayatta kalmıştı): beyan YOKSA muafiyet yok; bekçi koştuysa ONUN erteleme hükmü", () => {
    const offer = "Müsaitlik varsa çıkışınızı 13:00'e kadar uzatabiliriz.";
    const relay = `${offer} Uygunluğu ev sahibinizin kararıdır; mesajınız kaydedildi.`;
    expect(hasAvailabilityDeferral(relay)).toBe(true); // anti-vakum: erteleme cümlesi var
    // P20: istek YOK (teşekkür) + beyan HİÇ YOK → erteleme cümlesi tek başına teklifi iddia taramasından çıkaramaz.
    for (const declared of [undefined, null]) {
      expect(vetoAvailability(relay, ["Teşekkürler, her şey için."], { hostOfferText: offer, declared }), String(declared)).toBe("availability_claim");
    }
    // KONTROL: güvenilir `defers` beyanı + erteleme cümlesi (bekçi yok) → muafiyet işler; istek yok → gider.
    expect(vetoAvailability(relay, ["Teşekkürler, her şey için."], { hostOfferText: offer, declared: { asked: "none", stance: "defers" } })).toBeNull();

    // P21 — bekçi KOŞTUYSA muafiyet onun hükmüdür, kelime ağının cümlesi DEĞİL:
    const ask = ["Geç çıkış mümkün mü?"];
    const defers = { asked: "late_checkout", stance: "defers" } as const;
    // (a) bekçi "erteliyor" der, kelime ağı cümleyi TANIMAZ → muafiyet + iki model ertelemesi → gider.
    const quiet = `${offer} Bunu şimdilik kesinleştiremiyoruz.`;
    expect(hasAvailabilityDeferral(quiet)).toBe(false); // anti-vakum: kelime ağı bu ertelemeyi görmüyor
    const guardDefers = { status: "ok" as const, verdict: verdict({ guestRequestsChange: true, kind: "late_checkout", replyDefersToHost: true }) };
    expect(vetoAvailability(quiet, ask, { hostOfferText: offer, declared: defers, guard: guardDefers })).toBeNull();
    // (b) bekçi "ertelemiyor" der, kelime ağı erteleme cümlesi görür → muafiyet YOK → teklif iddia olarak okunur.
    const guardNot = { status: "ok" as const, verdict: verdict({ guestRequestsChange: true, kind: "late_checkout", replyDefersToHost: false }) };
    expect(vetoAvailability(relay, ask, { hostOfferText: offer, declared: defers, guard: guardNot })).toBe("availability_claim");
  });

  it("🚨 İngilizce kısaltmalar izin olarak yakalanır; virgülle biten koşul cümleciği ana cümlecikteki izni gizlemez", () => {
    const ask = ["Can we stay one more night?"];
    for (const reply of [
      "You're welcome to stay another night",
      "You’re welcome to stay another night",
      "We'll extend your stay by one night — subject to availability.",
      "I'll add another night to your booking.",
      "You'll be able to check in early.",
      "If you want, you can stay another night.",
      "Once you confirm, early check-in is possible.",
      "Sure, you're welcome to stay until Tuesday.",
    ]) {
      expect(vetoAvailability(reply, ask), reply).toBe("availability_claim");
      // Model erteleme beyan etse de (tek model gevşetemez).
      expect(vetoAvailability(reply, ask, { declared: { asked: "extend", stance: "defers" } }), reply).toBe("availability_claim");
    }
    // Aşırı-uygulama kontrolü: gömülü soru, koşulun İÇİNDEKİ durum ve nezaket kalıpları iddia DEĞİL.
    for (const reply of [
      "Please ask your host if you can stay another night.",
      "Whether you can stay another night is your host's call.",
      "If an extra night is possible, your host will let you know.",
      "You're welcome! Enjoy your stay.",
      "We'll be happy to help with anything else.",
      "You'll find the keys in the lockbox.",
    ]) {
      expect(detectAvailabilityClaim(reply), reply).toBeNull();
    }
  });

  it("🚨 standart çıkış saatini söyleyen 'kadar kalabilirsiniz' izin DEĞİL; saat KODDA mülkün çıkışıyla BİREBİR kıyaslanır", () => {
    const ask = ["What time is check-out?"];
    for (const reply of [
      "Check-out is at 11:00, so you can stay until 11:00.",
      "You can stay until 11:00 on your departure day.",
      "You can stay until 11am.",
      "Çıkış günü 11:00'e kadar kalabilirsiniz.",
      "Çıkış saatimiz 11:00; saat 11'e kadar dairede kalabilirsiniz.",
      "11.00'a kadar kalabilirsiniz.",
    ]) {
      expect(vetoAvailability(reply, ask, { stayTimes: STAY }), reply).toBeNull();
    }
    // Öğleden sonra çıkışlı mülk: dakikalı "1:00" da öğleden sonradır (13:00 = standart).
    expect(vetoAvailability("You can stay until 1:00 on your departure day.", ask, { stayTimes: { ...STAY, checkOut: "13:00" } })).toBeNull();
    // Standart DIŞI saat izindir; "until 1" öğleden sonradır (kimse gece 1'de çıkmaz).
    for (const reply of ["You can stay until 13:00 on Sunday.", "You can stay until 1 on Sunday.", "You can stay until 12pm.", "Pazar günü 13:00'e kadar kalabilirsiniz."]) {
      expect(vetoAvailability(reply, ask, { stayTimes: STAY }), reply).toBe("availability_claim");
    }
    // Mülkün çıkış saati bilinmiyorsa eski davranış (temkin): izin sayılır.
    expect(vetoAvailability("You can stay until 11:00.", ask, {})).toBe("availability_claim");
  });

  it("🚨 son denetim: ayıklama GERÇEK izni gizlemez (dakikalı öğleden sonra, akşam, gece yarısı, tarih, başka gün, onay, erteleme yanında izin)", () => {
    // Misafir mesajı BOŞ: istek bacağı devre dışı — yalnız iddia bacağı sınanır (model beyanı yok/yanlış olduğunda son savunma).
    for (const reply of [
      "you can stay until 1:00",
      "You can stay until 2:30.",
      "You can keep the apartment until 1:30",
      "Akşam 7'ye kadar kalabilirsiniz",
      "You can stay until 8 in the evening",
      "You can stay until 9 tonight",
      "You can stay until 7 p.m",
      "You can stay until 11 in the evening",
      "Akşam 11'e kadar kalabilirsiniz",
      "You can stay until 12am",
      "You can stay until 00:00",
      "Gece 00:00'a kadar kalabilirsiniz",
      "You can stay until 10.10",
      "5.11'e kadar kalabilirsiniz",
      "10.12'ye kadar kalabilirsiniz",
      "You can stay until 11 October",
      "Ayın 11'ine kadar kalabilirsiniz",
      "You can stay until 11:00 on Sunday.",
      "Pazar günü 11:00'e kadar kalabilirsiniz",
      "Yarın 11:00'e kadar kalabilirsiniz",
      "You can stay until 11 the next day.",
      "Bir gün daha, 11'e kadar kalabilirsiniz.",
      "Of course! You can stay until 11:00.",
      "Tabii, 11:00'e kadar kalabilirsiniz.",
      "Late checkout is up to your host, but you can stay until 2:30.",
      "8 gün kadar kalabilirsiniz",
      "11 gün kadar kalabilirsiniz",
    ]) {
      expect(vetoAvailability(reply, [], { stayTimes: STAY }), reply).toBe("availability_claim");
    }
  });

  it("ayıklama yalnız İZİN kalıplarına: takvim kalıbının saat bastırması (CLOCK_AHEAD) standart bilgi cümlesini tutmaz", () => {
    for (const reply of ["On departure day the apartment is available until 11:00.", "The flat is free until 11am on your last day."]) {
      expect(vetoAvailability(reply, [], { stayTimes: STAY }), reply).toBeNull();
      expect(vetoAvailability(reply, [], {}), reply).toBeNull(); // saatsiz de aynı (eski davranış)
    }
  });

  it("🚨 genel müsaitlik kalıbı üçüncü taraf YAPILARINDA istek DEĞİL (fiil/yüklem + nesne bitişik); kalan metinde isabet varsa yine istek", () => {
    const reply = "The supermarket on the corner is open 9–21 every day.";
    for (const msg of [
      "Can I book a taxi for tomorrow morning?",
      "Is the supermarket open on Sunday?",
      "Is it possible to rent bikes for tomorrow?",
      "Yarın için taksi ayırtabilir miyiz?",
      "Yarın araba kiralamak istiyoruz.",
      "Otopark müsait mi? 14-16 Ekim arası arabayla geleceğiz.",
      "Are there any restaurants open on Sunday?",
      "Can we reserve a table for Saturday night?",
      "Is parking free on the weekend?",
      "Yarın akşam restoranda yer var mı?",
      "Ist der Parkplatz am Samstag frei?",
      "La piscine est-elle libre samedi?",
    ]) {
      expect(detectAvailabilityRequest(msg), msg).toBeNull();
      expect(vetoAvailability(reply, [msg]), msg).toBeNull();
    }
    // KONTROL: nesne olsa da konaklamanın kendisi soruluyorsa istek; öznesiz tarih sorusu da istek.
    expect(detectAvailabilityRequest("Is the apartment available on the 14th? We'd also need parking.")).toBe("availability");
    expect(detectAvailabilityRequest("15 ekim musait mi")).toBe("availability");
    expect(detectAvailabilityRequest("Can we stay one more night? Also can I book a taxi?")).toBe("extend");
  });

  it("🚨 son denetim: nesne sözcüğü mesajın BAŞKA yerinde geçiyor diye gerçek istek düşmez (bitişiklik şartı, kök değil tam sözcük)", () => {
    for (const msg of [
      "Do you have availability on Oct 14? We love the beach.",
      "We will come by car, is it free on 14-16 Oct?",
      "Is it available next weekend? We would need parking for our car.",
      "Hafta sonu müsait mi? Otopark var mı?",
      "20-25 Ekim için müsait misiniz? Taksit imkanı var mı?",
      "Airbnb aracılığıyla 20-22 Ekim için rezervasyon yapabilir miyiz?",
      "Masal gibi bir yer! Cuma gecesi müsait mi?",
      "Taksitle rezervasyon yapabilir miyiz 14 Ekim için?",
      "Can I book a taxi and is the flat free on the 14th?",
    ]) {
      expect(detectAvailabilityRequest(msg), msg).toBe("availability");
    }
    // Uçtan uca: istek düşmediği için ertelemesiz "misafir ederiz" cevabı gönderilmez.
    expect(
      vetoAvailability("Great news, we would love to host you on October 14!", ["Do you have availability on Oct 14? We love the beach."], {
        declared: { asked: "none", stance: "none" }, // model isteği kaçırdı; kelime ağı ENGELLER
      }),
    ).toBe("availability_unconfirmed");
  });

  it("kısaltmalar (DOĞRULUK — açık biçim zaten kapsanıyordu): 's / 're / 've ve U+02BC kesmesi", () => {
    for (const reply of [
      "Nobody's checking in after you.",
      "No one’s booked after you.",
      "We've no other bookings after yours.",
      "There’re no other guests after you.",
    ]) {
      expect(detectAvailabilityClaim(reply), reply).toBe("calendar");
    }
    for (const reply of ["youʼre welcome to stay another night", "weʼll extend your stay"]) {
      expect(detectAvailabilityClaim(reply), reply).toBe("grant");
    }
    // Aşırı-uygulama kontrolü: sıradan nezaket cümleleri iddia değil.
    for (const reply of ["You're welcome! Enjoy your stay.", "We've added the towels you asked for.", "There's a bakery next door."]) {
      expect(detectAvailabilityClaim(reply), reply).toBeNull();
    }
  });

  it("Türkçe ünsüz yumuşaması: 'teyit' ünlüyle başlayan ekte 'teyid-' olur — erteleme yine tanınır", () => {
    expect(hasAvailabilityDeferral("Bu, ev sahibinizin teyidine bağlıdır.")).toBe(true);
    expect(hasAvailabilityDeferral("Geç çıkış ev sahibinizin teyidine tabidir.")).toBe(true);
    expect(hasAvailabilityDeferral("Ev sahibinizin onayına bağlıdır.")).toBe(true); // KONTROL: eski biçim
  });

  it("anlama katmanı açıktı ama BAŞARISIZ: kanıtta 'failed' ('off'tan ayrı), karar değişmez", () => {
    const off = evaluateAvailability("Check-in is from 15:00.", ["Could we get into the flat at 11?"], {});
    const failed = evaluateAvailability("Check-in is from 15:00.", ["Could we get into the flat at 11?"], { understandingFailed: true });
    expect(off.signals.u).toBe("off");
    expect(failed.signals.u).toBe("failed");
    expect(failed.reason).toBe(off.reason);
    expect(failed.enforceReason).toBe(off.enforceReason);
    const json = buildKbEvidence({ retrieved: [], usedLabels: [], stay: stayEvidenceOf(failed) });
    expect(JSON.parse(String(json)).sc.u).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// 🚨 BELİRSİZLİK GÜVENLİ DEĞİLDİR (kurucu değişmezi 09-24). Ölçülen açık (kurucunun ve dış incelemenin tarifi):
// "bekçi çöktü → kelime ağı bir şey bulamadı → cevap otomatik gitti". Değişmez: HASSAS İSTEK (herhangi bir katman)
// + herhangi bir güvenlik sinyali YOK / düştü / tanınmıyor / çelişiyor → OTOMATİK GÖNDERİM YOK. Kelime ağı yalnız
// engeller: sessizliği de, erteleme cümlesi de izin DEĞİLDİR. Hassas olmayan bilgi sorusu her durumda cevaplanır.
// ---------------------------------------------------------------------------
describe("🚨 BELİRSİZLİK GÜVENLİ DEĞİLDİR — hassas istek + eksik/düşmüş/çelişen sinyal = insana", () => {
  const ASK = "Could we get into the flat at 11?"; // kelime ağı istek sanmıyor (↑KONTROL)
  const IMPLICIT_GRANT = "See you at 11!"; // kelime ağı izin sanmıyor
  const MODEL = { riskLevel: "low", confidence: 0.92, source: "openai", riskType: null };
  const FAILED = { status: "failed" } as const;
  const DEFERS = "Whether an earlier arrival is possible is the host's call; your request has been recorded and is visible to your host.";

  it("KONTROL (anti-vakum): kelime ağı ne isteği ne örtük izni görüyor", () => {
    expect(detectAvailabilityRequest(ASK)).toBeNull();
    expect(detectAvailabilityClaim(IMPLICIT_GRANT)).toBeNull();
    expect(hasAvailabilityDeferral(DEFERS)).toBe(true); // erteleme cümlesini TANIYOR — ama artık izin sayılmıyor
  });

  it("🚨 bekçi DÜŞTÜ + beyan YOK + niyet erken giriş → gönderilmez (ölçülen açık)", () => {
    const r = { ...MODEL, intent: "early_checkin", reply: IMPLICIT_GRANT };
    expect(autoReplyGateFailure(r, ASK, { stayTimes: STAY, stayGuard: FAILED })).not.toBeNull();
  });

  it("🚨 bekçi KAPALI (bayrak) + beyan YOK + niyet erken giriş → gönderilmez", () => {
    const r = { ...MODEL, intent: "early_checkin", reply: IMPLICIT_GRANT };
    expect(autoReplyGateFailure(r, ASK, { stayTimes: STAY })).not.toBeNull();
  });

  it("🚨 beyan 'istek yok' ama aynı modelin niyet etiketi erken giriş/geç çıkış → bekçi yok, düştü ya da koşup 'istek yok' dedi: GÖNDERİLMEZ", () => {
    for (const intent of ["early_checkin", "late_checkout"]) {
      const r = { ...MODEL, intent, reply: IMPLICIT_GRANT, stayChange: { asked: "none", stance: "none" } as const };
      expect(autoReplyGateFailure(r, ASK, { stayTimes: STAY, stayGuard: FAILED }), intent).toBe("availability_unconfirmed");
      expect(autoReplyGateFailure(r, ASK, { stayTimes: STAY }), intent).toBe("availability_unconfirmed");
      // 🚨 Birleşim değişmezi (09-24 üçüncü tur): beyan + bekçinin "istek yok"u etiketin isteğini SİLEMEZ (eskiden
      // gölge kipte giderdi).
      expect(autoReplyGateFailure(r, ASK, { stayTimes: STAY, stayGuard: { status: "ok", verdict: verdict() } }), intent).toBe(
        "availability_unconfirmed",
      );
    }
  });

  it("🚨 bekçi yokken kelime ağının erteleme cümlesi İZİN DEĞİLDİR — beyan 'defers' olsa da", () => {
    const declared = { asked: "early_checkin" as const, stance: "defers" as const };
    expect(vetoAvailability(DEFERS, ["Erken giriş yapabilir miyiz?"], { declared }), "off").toBe("availability_unconfirmed");
    expect(vetoAvailability(DEFERS, ["Erken giriş yapabilir miyiz?"], { declared, guard: FAILED }), "failed").toBe("availability_unconfirmed");
  });

  it("🚨 bekçi DÜŞTÜ: devir cevabı da hassas istekte gönderilmez (hakem yok)", () => {
    const handoff = { intent: "human_request", riskLevel: "low", confidence: 0.9, source: "openai", riskType: "human_request" };
    const msg = "Ev sahibiyle konuşmak istiyorum, bir gece daha kalabilir miyiz?";
    const declared = { asked: "extend", stance: "defers" } as const;
    expect(autoReplyGateFailure({ ...handoff, reply: "Mesajınız kaydedildi; ev sahibiniz görebilir.", stayChange: declared }, msg, { stayGuard: FAILED })).toBe(
      "availability_unconfirmed",
    );
  });

  it("İKİ BAĞIMSIZ MODEL erteleme diyorsa gider (bekçi koştu) — güvenli yolun kendisi kapanmadı", () => {
    const declared = { asked: "early_checkin" as const, stance: "defers" as const };
    const ok = { status: "ok" as const, verdict: verdict({ guestRequestsChange: true, kind: "early_checkin", replyDefersToHost: true }) };
    expect(vetoAvailability(DEFERS, ["Erken giriş yapabilir miyiz?"], { declared, guard: ok })).toBeNull();
    // Devir cevabı da iki model "erteliyor" derse gider.
    expect(vetoAvailability("Mesajınız kaydedildi.", ["Bir gece daha kalabilir miyiz?"], { declared: { asked: "extend", stance: "defers" }, guard: ok })).toBeNull();
  });

  it("🚨 kelime ağı bekçinin 'ertelemiyor' hükmünü EZEMEZ (erteleme cümlesi + beyan 'defers' yetmez)", () => {
    const declared = { asked: "early_checkin" as const, stance: "defers" as const };
    const notDefers = { status: "ok" as const, verdict: verdict({ guestRequestsChange: true, kind: "early_checkin", replyDefersToHost: false }) };
    expect(evaluateAvailability(DEFERS, ["Erken giriş yapabilir miyiz?"], { declared, guard: notDefers }).signals.lx).toContain("d"); // anti-vakum
    expect(vetoAvailability(DEFERS, ["Erken giriş yapabilir miyiz?"], { declared, guard: notDefers })).toBe("availability_unconfirmed");
  });

  it("🚨 beyan YOK + hassas istek → bekçi 'temiz' dese de duruş bilinmiyor (F01); hassas istek yoksa etkisiz", () => {
    const clean = { status: "ok" as const, verdict: verdict({ guestRequestsChange: true, kind: "extend" }) };
    expect(vetoAvailability("Mesajınız kaydedildi.", ["Bir gece daha kalabilir miyiz?"], { guard: clean })).toBe("availability_claim");
    expect(vetoAvailability("Wi-Fi şifresi Lale2024.", ["Wifi şifresi ne?"], { guard: FAILED })).toBeNull();
    expect(vetoAvailability("Wi-Fi şifresi Lale2024.", ["Wifi şifresi ne?"])).toBeNull();
  });

  it("aşırı-uygulama kontrolü: BİLGİ sorusu ('Check-in saati kaç?') bekçi yokken ya da düşmüşken de cevaplanır", () => {
    const info = { ...MODEL, intent: "checkin", reply: "Giriş saatimiz 15:00.", stayChange: { asked: "none", stance: "none" } as const };
    for (const msg of ["Check-in saati kaç?", "What time is check-in?", "Çıkış saat kaçta?"]) {
      expect(autoReplyGateFailure(info, msg, { stayTimes: STAY }), `off: ${msg}`).toBeNull();
      expect(autoReplyGateFailure(info, msg, { stayTimes: STAY, stayGuard: FAILED }), `failed: ${msg}`).toBeNull();
    }
    const wifi = { ...MODEL, intent: "wifi", reply: "Wi-Fi şifresi Lale2024.", stayChange: { asked: "none", stance: "none" } as const };
    expect(autoReplyGateFailure(wifi, "Wifi şifresi ne?", { stayGuard: FAILED })).toBeNull();
  });

  it("🚨 aynı konuya benzeyen İZİN talebi ('Saat 12'de gelebilir miyiz?') belirsizlikte ASLA gitmez", () => {
    const permission = { ...MODEL, intent: "early_checkin", reply: "Standart giriş saatimiz 15:00; erken giriş ev sahibinizin kararıdır, mesajınız kaydedildi." };
    const msg = "Saat 12'de gelebilir miyiz?";
    expect(autoReplyGateFailure({ ...permission, stayChange: { asked: "early_checkin", stance: "defers" } }, msg, { stayTimes: STAY })).toBe(
      "availability_unconfirmed",
    );
    expect(autoReplyGateFailure(permission, msg, { stayTimes: STAY })).toBe("availability_claim"); // beyan yok
    expect(autoReplyGateFailure({ ...permission, stayChange: { asked: "early_checkin", stance: "unknown" } }, msg, { stayTimes: STAY })).toBe(
      "availability_claim",
    );
  });

  it("ev sahibi teklifi: bekçi koşmadan aktarım 'iddia' değil 'onaylanmadı' sayılır (bekçi çağrılabilsin); bilgi sorusuna eklenen teklif gider", () => {
    const offer = "Müsaitlik varsa çıkışınızı 13:00'e kadar uzatabiliriz.";
    const relay = `${offer} Uygunluğu ev sahibinizin kararıdır; mesajınız kaydedildi.`;
    const defers = { asked: "late_checkout", stance: "defers" } as const;
    // Hassas istek, bekçi henüz koşmadı/kapalı: TUTULUR ama gerekçe "onaylanmadı" → kanal/QR bekçiyi çağırır.
    expect(vetoAvailability(relay, ["Geç çıkış mümkün mü?"], { declared: defers, hostOfferText: offer })).toBe("availability_unconfirmed");
    expect(vetoAvailability(relay, ["Geç çıkış mümkün mü?"], { declared: defers, hostOfferText: offer, guard: FAILED })).toBe(
      "availability_unconfirmed",
    );
    // Bilgi sorusu (hiçbir katmanda istek yok): teklif + erteleme eskisi gibi gider.
    const info = `Çıkış saatimiz 11:00. ${relay}`;
    expect(detectAvailabilityRequest("Çıkış saat kaçta?")).toBeNull(); // anti-vakum
    expect(vetoAvailability(info, ["Çıkış saat kaçta?"], { declared: { asked: "none", stance: "defers" }, hostOfferText: offer, stayTimes: STAY })).toBeNull();
    // Beyan "erteliyor" demiyorsa teklif metni yine iddiadır (muafiyet yok).
    expect(vetoAvailability(info, ["Çıkış saat kaçta?"], { declared: { asked: "none", stance: "none" }, hostOfferText: offer, stayTimes: STAY })).toBe(
      "availability_claim",
    );
  });

  it("yedek (şablon) cevapta model duruşu yoktur: istek varsa 'onaylanmadı' der, 'takvim iddiası' DEMEZ (host uyarısı doğru cümle)", () => {
    const tpl = "Our check-in time is 15:00. An early check-in may be possible depending on availability that day.";
    expect(vetoAvailability(tpl, [ASK], { replyIntent: "early_checkin", deterministicReply: true })).toBe("availability_unconfirmed");
    expect(vetoAvailability(tpl, [ASK], { replyIntent: "early_checkin" })).toBe("availability_claim"); // KONTROL: model metni sayılsaydı
  });

  it("kanal ve QR kurucuları niyet etiketini ve şablon ayrımını AYNI biçimde taşır (parite; yalnız BİLİNEN şablon kaynağı)", () => {
    const r = { intent: "late_checkout", stayChange: null, source: "fallback" };
    expect(availabilityPolicyFor(r)).toMatchObject({ replyIntent: "late_checkout", deterministicReply: true });
    expect(qrAvailabilityPolicy(r)).toMatchObject({ replyIntent: "late_checkout", deterministicReply: true });
    for (const source of ["openai", undefined, "Fallback"]) {
      expect(availabilityPolicyFor({ ...r, source }).deterministicReply, String(source)).toBe(false);
      expect(qrAvailabilityPolicy({ ...r, source }).deterministicReply, String(source)).toBe(false);
    }
  });

  it("kanıt: niyet etiketi `ri` olarak yazılır (kapalı küme); tanınmayan değer yalnız kendisi düşer", () => {
    const e = evaluateAvailability(IMPLICIT_GRANT, [ASK], { replyIntent: "late_checkout", declared: { asked: "none", stance: "none" }, guard: FAILED });
    expect(e.signals).toMatchObject({ d: "none/none", g: "failed", ri: "late_checkout" });
    expect(evaluateAvailability("Ok.", ["hi"], { replyIntent: "wifi" }).signals.ri).toBeUndefined();
    const sc = (stay: Record<string, string>) => JSON.parse(String(buildKbEvidence({ retrieved: [], usedLabels: [], stay: stay as never }))).sc;
    const base = { v: "availability_claim", ev: "availability_claim", lx: "-", d: "none/none", g: "failed", u: "off" };
    expect(sc({ ...base, ri: "early_checkin" }).ri).toBe("early_checkin");
    expect(sc({ ...base, ri: "Ayşe" })).toEqual(base);
  });
});

// ---------------------------------------------------------------------------
// DÜŞMANCA İNCELEME 09-24 (ikinci tur, değişmez sonrası) — kodda doğrulanmış bulgular.
// ---------------------------------------------------------------------------
describe("düşmanca inceleme 09-24 — bekçi AÇIKKEN değişmez", () => {
  const LATE = "Is it ok if we leave at 1pm on Sunday?";
  const GUARD_BLIND = { status: "ok" as const, verdict: verdict() }; // bekçi koştu ama hiçbir şey görmedi

  it("🚨 P1-1: bekçi 'istek yok' dese de cevap modelinin beyanı / anlama katmanı istek görüyorsa İKİ MODEL ertelemesi şart", () => {
    const reply = "Sure, no rush on Sunday — take your time!"; // örtük izin; kelime ağı görmüyor
    expect(detectAvailabilityClaim(reply)).toBeNull(); // anti-vakum
    const base = { guard: GUARD_BLIND, stayTimes: STAY, replyIntent: "late_checkout" };
    // Beyan istek görüyor (duruşu yanlış 'defers'), bekçi ertelemeyi doğrulamıyor → tutulur.
    expect(vetoAvailability(reply, [LATE], { ...base, declared: { asked: "late_checkout", stance: "defers" } })).toBe("availability_unconfirmed");
    // Yalnız anlama katmanı istek görüyor → yine tutulur.
    const u = { requested: true, kind: "late_checkout" as const, checkinTime: null, checkoutTime: "13:00" };
    expect(vetoAvailability(reply, [LATE], { ...base, replyIntent: "general", declared: { asked: "none", stance: "none" }, understanding: u })).toBe(
      "availability_unconfirmed",
    );
  });

  it("🚨 P1-2: devir cevabı ('Tabii. Mesajınız kaydedildi…') konaklama isteğinde muaf DEĞİL — iki model ertelemesi şart", () => {
    const handoff = { intent: "human_request", riskLevel: "low", confidence: 0.9, source: "openai", riskType: "human_request" };
    // Türkçe devir cümlesi Türkçe yazan misafire (dil kapısı 09-25 ayrı ölçülür: `reply-language-gate.test.ts`).
    const msg = "Pazar günü 13:00'te çıksak olur mu? Ev sahibiyle konuşmak istiyorum.";
    const reply = "Tabii. Mesajınız kaydedildi; ev sahibiniz görebilir.";
    const guardReq = { status: "ok" as const, verdict: verdict({ guestRequestsChange: true, kind: "late_checkout", requestedCheckoutTime: "13:00" }) };
    expect(
      autoReplyGateFailure({ ...handoff, reply, stayChange: { asked: "late_checkout", stance: "none" } }, msg, { stayTimes: STAY, stayGuard: guardReq }),
    ).toBe("availability_unconfirmed");
    // KONTROL: iki model de "erteliyor" derse devir cevabı gider.
    const guardDefers = { status: "ok" as const, verdict: verdict({ guestRequestsChange: true, kind: "late_checkout", replyDefersToHost: true }) };
    expect(
      autoReplyGateFailure({ ...handoff, reply, stayChange: { asked: "late_checkout", stance: "defers" } }, msg, { stayTimes: STAY, stayGuard: guardDefers }),
    ).toBeNull();
    // KONTROL: konaklama konusu olmayan saf devir her zamanki gibi gider.
    expect(
      autoReplyGateFailure({ ...handoff, reply, stayChange: { asked: "none", stance: "none" } }, "Ev sahibiyle konuşmak istiyorum.", { stayTimes: STAY }),
    ).toBeNull();
  });

  it("P2-2 → birleşim (09-24 üçüncü tur): konu etiketi `early_checkin` olan bilgi sorusu da insana gider — 'iddia' değil 'onaylanmadı' (bekçi çağrılabilsin)", () => {
    const info = { riskLevel: "low", confidence: 0.92, source: "openai", riskType: null, intent: "early_checkin" };
    const r = { ...info, reply: "Check-in is from 15:00.", stayChange: { asked: "none", stance: "none" } as const };
    // Bilinçli bedel: istem etiketi konu SORULARINA da verir; birleşimde etiketin isteği silinemez.
    expect(autoReplyGateFailure(r, "What time is check-in?", { stayTimes: STAY, stayGuard: GUARD_BLIND })).toBe("availability_unconfirmed");
    expect(autoReplyGateFailure(r, "What time is check-in?", { stayTimes: STAY })).toBe("availability_unconfirmed");
    // `enforceReason` artık ayrı karar değil: `reason`a eşit (kanıtta `ev` = `v`).
    const e = evaluateAvailability(r.reply, ["What time is check-in?"], availabilityPolicyFor(r, { stayTimes: STAY, stayGuard: GUARD_BLIND }));
    expect(e.reason).toBe("availability_unconfirmed");
    expect(e.enforceReason).toBe(e.reason);
    // KONTROL: aynı soru bilgi etiketiyle (`checkin`) bekçi yokken de gider — bedel yalnız etiketli konuya.
    expect(autoReplyGateFailure({ ...r, intent: "checkin" }, "What time is check-in?", { stayTimes: STAY })).toBeNull();
  });

  it("P2-3: tanınmayan duruş, geçerli bir izin duruşundan GEVŞEK olamaz — konaklama bağlamı olmasa da iddia sayılır (F01)", () => {
    const reply = "Thank you! Feel free to take your time tomorrow, 2pm works.";
    expect(detectAvailabilityClaim(reply)).toBeNull(); // anti-vakum: kelime ağı görmüyor
    expect(vetoAvailability(reply, ["Thanks for everything!"], { declared: { asked: "none", stance: "grants" } })).toBe("availability_claim");
    expect(vetoAvailability(reply, ["Thanks for everything!"], { declared: { asked: "none", stance: "unknown" } })).toBe("availability_claim");
  });
});

// ---------------------------------------------------------------------------
// BİRLEŞİM DEĞİŞMEZİ (kurucu + dış inceleme, 09-24 üçüncü tur): hassas istek = TÜM katmanların birleşimi. Hiçbir
// katmanın "istek yok"u başka bir katmanın isteğini SİLEMEZ — cevap modelinin niyet etiketi dahil, her kipte.
// ("Yanlış otomatik izin çok kötü; gereksiz insan incelemesi can sıkıcı ama kabul edilebilir.")
// ---------------------------------------------------------------------------
describe("🚨 birleşim değişmezi — hiçbir katman başka bir katmanın isteğini silemez", () => {
  const ASK = "Could we get into the flat at 11?";
  const PLAIN = "Check-in is from 15:00.";
  const GUARD_BLIND = { status: "ok" as const, verdict: verdict() };

  it("niyet etiketi tek başına da tutar: bekçi + beyan 'istek yok' dese bile (her ortam değeri)", () => {
    const opts = { declared: { asked: "none", stance: "none" } as const, replyIntent: "early_checkin", guard: GUARD_BLIND, stayTimes: STAY };
    expect(evaluateAvailability(PLAIN, [ASK], opts).reason).toBe("availability_unconfirmed");
    for (const v of ["", "shadow", "enforce", "whatever"]) {
      vi.stubEnv("AI_STAY_POLICY", v);
      expect(vetoAvailability(PLAIN, [ASK], opts), v).toBe("availability_unconfirmed");
    }
  });

  it("her katman tek başına yeter (kelime ağı · beyan · ret · anlama · niyet etiketi · bekçi); hiçbiri yoksa bilgi cevabı gider", () => {
    const none = { asked: "none", stance: "none" } as const;
    const base = { declared: none, guard: GUARD_BLIND, stayTimes: STAY };
    const cases: [string, Parameters<typeof evaluateAvailability>[2], string][] = [
      ["kelime ağı", base, "Erken giriş yapabilir miyiz?"],
      ["beyan", { ...base, declared: { asked: "early_checkin", stance: "none" } }, ASK],
      ["ret duruşu", { ...base, declared: { asked: "none", stance: "refuses" } }, ASK],
      ["anlama", { ...base, understanding: { requested: true, kind: "early_checkin", checkinTime: "11:00", checkoutTime: null } }, ASK],
      ["niyet etiketi", { ...base, replyIntent: "late_checkout" }, ASK],
      ["bekçi", { ...base, guard: { status: "ok", verdict: verdict({ guestRequestsChange: true, kind: "early_checkin" }) } }, ASK],
    ];
    for (const [name, opts, msg] of cases) expect(evaluateAvailability(PLAIN, [msg], opts).reason, name).toBe("availability_unconfirmed");
    expect(evaluateAvailability(PLAIN, ["What time is check-in?"], { ...base, replyIntent: "checkin" }).reason).toBeNull(); // KONTROL
  });
});
