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
  stayPolicyMode,
  type StayGuardVerdict,
} from "@/lib/ai/semantic/stay-change";
import { evaluateAvailability, stayEvidenceOf, vetoAvailability } from "@/lib/ai/availability-claims";
import { passesAutoReplySafetyGate } from "@/lib/automation";
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

describe("politika kipi", () => {
  it("varsayılan gölge; YALNIZ 'enforce' (büyük/küçük harf esnek) açar — sıkılaştıran anahtar yazım farkıyla gevşemez", () => {
    expect(stayPolicyMode()).toBe("shadow");
    for (const [v, want] of [["1", "shadow"], ["true", "shadow"], [" yes", "shadow"], ["Enforce", "enforce"], ["ENFORCE ", "enforce"], ["enforce", "enforce"]] as const) {
      vi.stubEnv("AI_STAY_POLICY", v);
      expect(stayPolicyMode(), v).toBe(want);
    }
  });
});

describe("birleşim kuralı — İDDİA bacağı (her kipte, devirde de)", () => {
  it("🚨 beyan edilen izin/takvim duruşu kelime ağının göremediği cevabı da durdurur", () => {
    // Kör bataryadan: kelime ağının kaçırdığı gerçek izin cümleleri.
    for (const reply of ["Olur, bekliyoruz.", "Sure, you're welcome to stay until Tuesday.", "Your early check-in is all set."]) {
      expect(vetoAvailability(reply, ["Bir gece daha kalabilir miyiz?"])).not.toBe("availability_claim");
      expect(vetoAvailability(reply, ["x"], { declared: { asked: "extend", stance: "grants" } }), reply).toBe("availability_claim");
    }
    expect(vetoAvailability("Mid-March is wide open.", [], { declared: { asked: "availability", stance: "states_calendar" } })).toBe(
      "availability_claim",
    );
  });

  it("devir cevabı İSTEK bacağından muaf, beyan edilen İZİNDEN değil", () => {
    // KONTROL (inceleme 09-24): "kaydedildi" tek başına erteleme DEĞİL → devir olmasa durur.
    expect(vetoAvailability("Mesajınız kaydedildi.", ["Bir gece daha kalabilir miyiz?"])).toBe("availability_unconfirmed");
    expect(vetoAvailability("Mesajınız kaydedildi.", ["Bir gece daha kalabilir miyiz?"], { handoff: true })).toBeNull();
    expect(
      vetoAvailability("Mesajınız kaydedildi.", ["Bir gece daha kalabilir miyiz?"], { handoff: true, declared: { asked: "extend", stance: "grants" } }),
    ).toBe("availability_claim");
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
    expect(evaluateAvailability(PLAIN, [ASK], { mode: "enforce" }).signals.lx).toBe("-");
  });

  it("beyan edilen istek GÖLGEDE karar vermez ama `enforceReason` ölçülür; `enforce` kipinde durdurur", () => {
    const declared = { asked: "early_checkin" as const, stance: "none" as const };
    const shadow = evaluateAvailability(PLAIN, [ASK], { declared, mode: "shadow" });
    expect(shadow.reason).toBeNull();
    expect(shadow.enforceReason).toBe("availability_unconfirmed");
    expect(evaluateAvailability(PLAIN, [ASK], { declared, mode: "enforce" }).reason).toBe("availability_unconfirmed");
  });

  it("varsayılan kip `AI_STAY_POLICY` ortam değişkeninden (verilmezse gölge)", () => {
    const declared = { asked: "early_checkin" as const, stance: "none" as const };
    expect(vetoAvailability(PLAIN, [ASK], { declared })).toBeNull();
    vi.stubEnv("AI_STAY_POLICY", "enforce");
    expect(vetoAvailability(PLAIN, [ASK], { declared })).toBe("availability_unconfirmed");
  });

  it("🚨 ERTELEME tek modelin sözüyle kabul edilmez: kelime ağının tanımadığı erteleme ancak beyan + bekçi ikisi 'erteliyor' derse", () => {
    // Kelime ağının TANIMADIĞI dilde erteleme (İtalyanca kalıp yok) — iki model birlikte tanımalı.
    const DE = "Se il check-out posticipato sia possibile lo stabilisce il suo host.";
    expect(evaluateAvailability(DE, [], {}).signals.lx).toBe("-"); // KONTROL: kelime ağı ertelemeyi görmüyor
    const declared = { asked: "late_checkout" as const, stance: "defers" as const };
    const req = verdict({ guestRequestsChange: true, kind: "late_checkout" });
    // Yalnız beyan: yetmez.
    expect(evaluateAvailability(DE, ["Possiamo fare il check-out più tardi? Late checkout?"], { declared, mode: "enforce" }).reason).toBe("availability_unconfirmed");
    // Beyan + bağımsız bekçi hemfikir: erteleme kanıtı.
    expect(
      vetoAvailability(DE, ["Possiamo fare il check-out più tardi? Late checkout?"], {
        declared,
        mode: "enforce",
        guard: { status: "ok", verdict: { ...req, replyDefersToHost: true } },
      }),
    ).toBeNull();
    // Bekçi "erteliyor" dese de beyan etmiyorsa yetmez.
    expect(
      vetoAvailability(DE, ["Possiamo fare il check-out più tardi? Late checkout?"], {
        declared: { asked: "late_checkout", stance: "none" },
        mode: "enforce",
        guard: { status: "ok", verdict: { ...req, replyDefersToHost: true } },
      }),
    ).toBe("availability_unconfirmed");
  });

  it("kelime ağının tanıdığı erteleme cümlesi tek başına yeter (kodda doğrulanmış metin)", () => {
    expect(
      vetoAvailability("Bu ev sahibinizin kararıdır; mesajınız kaydedildi, ev sahibiniz görebilir.", [ASK], {
        declared: { asked: "early_checkin", stance: "defers" },
        mode: "enforce",
      }),
    ).toBeNull();
  });

  it("bekçinin istek hükmü ve KODDA kaydırılmış saat (model 'istek yok' dese de) ertelemesiz cevabı durdurur", () => {
    expect(vetoAvailability(PLAIN, [ASK], { guard: { status: "ok", verdict: verdict({ guestRequestsChange: true, kind: "early_checkin" }) } })).toBe(
      "availability_unconfirmed",
    );
    expect(
      vetoAvailability(PLAIN, [ASK], { stayTimes: STAY, guard: { status: "ok", verdict: verdict({ requestedCheckinTime: "11:00" }) } }),
    ).toBe("availability_unconfirmed");
    // Standart saat istek değildir.
    expect(
      vetoAvailability(PLAIN, ["Can we check in at 15:00?"], { stayTimes: STAY, guard: { status: "ok", verdict: verdict({ requestedCheckinTime: "15:00" }) } }),
    ).toBeNull();
  });

  it("bekçi reddi (takvimsiz 'mümkün değil') ertelemesizse durur — konaklama değişikliği konuşulan cevap ertelemeli", () => {
    expect(vetoAvailability("Early check-in isn't possible.", ["x"], { guard: { status: "ok", verdict: verdict({ replyRefuses: true }) } })).toBe(
      "availability_unconfirmed",
    );
  });

  it("BEKÇİ BAŞARISIZ: modelin konaklama sinyali varsa gölgede bile tutulur; sinyal yoksa eski davranış", () => {
    expect(
      vetoAvailability(PLAIN, [ASK], { guard: { status: "failed" }, declared: { asked: "early_checkin", stance: "none" }, mode: "shadow" }),
    ).toBe("availability_unconfirmed");
    expect(vetoAvailability(PLAIN, ["Wifi?"], { guard: { status: "failed" }, declared: { asked: "none", stance: "none" }, mode: "shadow" })).toBeNull();
  });

  it("anlama katmanının isteği (ya da KODDA kaydırılmış yuva saati) yalnız `enforce` kipinde karar verir", () => {
    const u = { requested: false, kind: "none" as const, checkinTime: "11:00", checkoutTime: null };
    const e = evaluateAvailability(PLAIN, [ASK], { understanding: u, stayTimes: STAY, mode: "shadow" });
    expect(e.signals.u).toBe("req");
    expect(e.reason).toBeNull();
    expect(e.enforceReason).toBe("availability_unconfirmed");
  });

  it("geçersiz beyan (`unknown`) tanınmayan ≠ temiz: enforce kipinde istek sayılır", () => {
    expect(vetoAvailability(PLAIN, ["Wifi?"], { declared: { asked: "none", stance: "unknown" }, mode: "enforce" })).toBe("availability_unconfirmed");
  });
});

describe("kanıt: PII'siz kapalı-küme özet", () => {
  it("sinyal kodları ve `sc` kanıt alanı", () => {
    const e = evaluateAvailability("O gece boş; Bu ev sahibinizin kararıdır.", ["Bir gece daha kalabilir miyiz?"], {
      declared: { asked: "extend", stance: "states_calendar" },
      guard: { status: "ok", verdict: verdict({ guestRequestsChange: true, kind: "extend", replyStatesCalendar: true, requestedCheckoutTime: "13:00" }) },
      stayTimes: STAY,
      mode: "shadow",
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
    expect(vetoAvailability("Olur, bekliyoruz. Mesajınız kaydedildi.", ["Bir gece daha kalabilir miyiz?"])).toBe("availability_unconfirmed");
    expect(vetoAvailability("Of course, we'd love to have you another night. Your request has been recorded.", ["Can we stay one more night?"])).toBe(
      "availability_unconfirmed",
    );
  });

  it("🚨 onay TAHMİNİ erteleme değildir; onaya BAĞLILIK ve 'ev sahibiniz karar verir/kontrol eder' ertelemedir", () => {
    const ask = ["Bir gece daha kalabilir miyiz?"];
    expect(vetoAvailability("Ev sahibiniz uzatma talebinizi onaylayacaktır, merak etmeyin.", ask)).not.toBeNull();
    expect(vetoAvailability("Uzatma ev sahibinizin onayına bağlıdır; mesajınız kaydedildi.", ask)).toBeNull();
    expect(vetoAvailability("Bu tarihlerin uygunluğunu ev sahibiniz kontrol edecek.", ask)).toBeNull();
    expect(vetoAvailability("Karar ev sahibinizindir, isteğiniz kaydedildi.", ask)).toBeNull();
    expect(vetoAvailability("Your extension has been approved by your host.", ["Can we extend?"])).not.toBeNull();
    expect(vetoAvailability("Your extension needs to be approved by your host.", ["Can we extend?"])).toBeNull();
  });

  it("kelime ağının ertelemesi, model BAŞKA duruş beyan ettiyse sayılmaz (çelişkili cevap)", () => {
    const reply = "Olur, bekliyoruz. Bu ev sahibinizin kararıdır.";
    expect(vetoAvailability(reply, ["Bir gece daha kalabilir miyiz?"])).toBeNull(); // beyan yok → yedek sayar
    expect(vetoAvailability(reply, ["Bir gece daha kalabilir miyiz?"], { declared: { asked: "extend", stance: "none" } })).toBe(
      "availability_unconfirmed",
    );
    expect(vetoAvailability(reply, ["Bir gece daha kalabilir miyiz?"], { declared: { asked: "extend", stance: "defers" } })).toBeNull();
  });

  it("🚨 tanınmayan duruş (biçim bozuk 'Grants') konaklama bağlamında izin SAYILIR; bağlam yoksa etkisiz", () => {
    expect(vetoAvailability(PLAIN, [ASK], { declared: { asked: "early_checkin", stance: "unknown" } })).toBe("availability_claim");
    expect(vetoAvailability("Wi-Fi şifresi Lale2024.", ["Wifi?"], { declared: { asked: "none", stance: "unknown" }, mode: "shadow" })).toBeNull();
  });

  it("bekçi / anlama `kind` bir değişiklik adlandırıyorsa `requested:false` olsa da istek sayılır", () => {
    expect(vetoAvailability(PLAIN, [ASK], { guard: { status: "ok", verdict: verdict({ kind: "early_checkin" }) } })).toBe("availability_unconfirmed");
    const e = evaluateAvailability(PLAIN, [ASK], { understanding: { requested: false, kind: "extend", checkinTime: null, checkoutTime: null }, mode: "enforce" });
    expect(e.signals.u).toBe("req");
    expect(e.reason).toBe("availability_unconfirmed");
  });

  it("🚨 ev sahibinin KENDİ teklif metni iddia sayılmaz; değiştirilmiş/kendi izni sayılır; istekte erteleme şartı sürer", () => {
    const offer = "Müsaitlik varsa çıkışınızı 13:00'e kadar uzatabiliriz.";
    const ask = ["Geç çıkış mümkün mü?"];
    const relay = `${offer} Uygunluğu ev sahibinizin kararıdır; mesajınız kaydedildi.`;
    expect(vetoAvailability(relay, ask)).toBe("availability_claim"); // KONTROL: teklif bilinmezse izin gibi okunur
    expect(vetoAvailability(relay, ask, { hostOfferText: offer })).toBeNull();
    expect(vetoAvailability(offer, ask, { hostOfferText: offer })).toBe("availability_unconfirmed"); // ertelemesiz aktarım
    expect(vetoAvailability("Çıkışınızı 13:00'e uzattık, iyi tatiller.", ask, { hostOfferText: offer })).toBe("availability_claim");
  });
});
