import { describe, it, expect } from "vitest";
import { MIN_START_TO_READY_MS, READY_SETTLE_MS, readinessDetailOf, readyAtOf, type ReadinessMark } from "@/lib/early-checkin/readiness";
import { markOfTask } from "@/lib/early-checkin/load";
import { explicitTimeMentions, mentionsAnotherDay, timeMismatchInTexts } from "@/lib/early-checkin/text-checks";
import { earlyCheckinAutoBlockers } from "@/lib/early-checkin/workflow";
import { validateEarlyCheckinRuleInput } from "@/lib/early-checkin/rules";
import { earlyCheckinPanelLines, type EarlyCheckinPanelData } from "@/lib/early-checkin/panel";
import { minutesOfDayInTimeZone } from "@/lib/timezone";
import { buildUnderstandingUserContent, UNDERSTANDING_WINDOW } from "@/lib/ai/semantic/understand";
import { buildStayGuardUserContent, GUARD_WINDOW } from "@/lib/ai/semantic/guard";

// ---------------------------------------------------------------------------
// ERKEN GİRİŞ KANIT MODELİ — dilim 1 (09-24; `docs/ERKEN-GIRIS-KANIT-MODELI-2026-09-24.md`). Kurucu: "Dün atılmış READY
// bugünkü kararda kullanılamasın"; "misafir 11 dedi, temizlikçi 08:45'te hazır dedi" senaryosu; "tahmin etme".
//  · Çıkıştan ÖNCE bitmiş temizlik yalnız host rızası + ayrılan konaklamaya bağlı görev + devir günü + AYNI kullanıcının
//    ≥15 dk önceki "başladım" kaydıyla sayılır (G4 → G5) — o zaman önceki misafirin gittiği de doğrulanmış olur.
//  · "Bitti" yalnız KİMLİKLİ kullanıcı kaydından; görevin EN SON durum kaydı "bitti" olmalı.
//  · Metin çapraz kontrolleri YALNIZ otomatik gönderimi engeller (taslak yine hazırlanır).
// ---------------------------------------------------------------------------

// İstanbul (UTC+3): önceki misafirin beklenen çıkışı 14 Ekim 11:00 (08:00Z); devir günü 00:00 = 13 Ekim 21:00Z.
const CHECKOUT = new Date("2026-10-14T08:00:00Z");
const DAY_START = new Date("2026-10-13T21:00:00Z");
const NOW = new Date("2026-10-14T08:40:00Z");
const at = (hhmmUtc: string, day = "2026-10-14") => new Date(`${day}T${hhmmUtc}:00Z`);
/** Kanıtlı erken işaret: 10:00'da (07:00Z) başladı, 10:45'te (07:45Z) hazır; ayrılan konaklamaya bağlı. */
const EARLY_DONE = at("07:45");
const EARLY: ReadinessMark = { status: "done", doneAt: EARLY_DONE, startedAt: at("07:00"), linked: true };
const OPTS = { dayStart: DAY_START, allowBeforeCheckout: true };

describe("hazırlık — çıkıştan ÖNCE bitmiş temizlik yalnız host rızası + operasyonel kanıtla", () => {
  it("🚨 rıza + bağlı görev + devir günü + aynı kullanıcının ≥15 dk önceki 'başladım'ı → hazır VE çıkış doğrulandı", () => {
    expect(readinessDetailOf([EARLY], CHECKOUT, NOW, OPTS)).toEqual({ status: "ready", note: "none", departureConfirmed: true });
    expect(readyAtOf([EARLY], CHECKOUT, NOW, OPTS)).toEqual(EARLY_DONE);
  });

  it("🚨 rıza YOKSA (varsayılan) aynı işaret sayılmaz — bugünkü kural birebir", () => {
    for (const opts of [{}, { dayStart: DAY_START }, { dayStart: DAY_START, allowBeforeCheckout: false }]) {
      expect(readinessDetailOf([EARLY], CHECKOUT, NOW, opts), JSON.stringify(opts)).toEqual({
        status: "not_ready",
        note: "before_checkout",
        departureConfirmed: false,
      });
      expect(readyAtOf([EARLY], CHECKOUT, NOW, opts)).toBeNull();
    }
  });

  it("🚨 her kanıt parçası tek başına şart: bağsız görev · 'başladım' yok · 15 dk'dan kısa · dünkü başlama · dünkü bitiş · gün başı yok", () => {
    const cases: [string, ReadinessMark, typeof OPTS | { dayStart: null; allowBeforeCheckout: true }][] = [
      ["bağsız görev", { ...EARLY, linked: false }, OPTS],
      ["bağ bilgisi yok", { ...EARLY, linked: undefined }, OPTS],
      ["başladım kaydı yok", { ...EARLY, startedAt: null }, OPTS],
      ["14 dk 59 sn", { ...EARLY, startedAt: new Date(EARLY_DONE.getTime() - MIN_START_TO_READY_MS + 1000) }, OPTS],
      ["dün başlamış", { ...EARLY, startedAt: new Date(DAY_START.getTime() - 60_000) }, OPTS],
      ["dün bitmiş (dünkü READY)", { ...EARLY, doneAt: new Date(DAY_START.getTime() - 60_000), startedAt: new Date(DAY_START.getTime() - 3_600_000) }, OPTS],
      ["gün başı bilinmiyor", EARLY, { dayStart: null, allowBeforeCheckout: true }],
    ];
    for (const [name, mark, opts] of cases) {
      expect(readinessDetailOf([mark], CHECKOUT, NOW, opts), name).toMatchObject({ status: "not_ready", departureConfirmed: false });
    }
    // Sınır: tam 15 dk sayılır.
    const exact = { ...EARLY, startedAt: new Date(EARLY_DONE.getTime() - MIN_START_TO_READY_MS) };
    expect(readinessDetailOf([exact], CHECKOUT, NOW, OPTS).status).toBe("ready");
  });

  it("kanıtlı erken işaret de OTURMALI (≥5 dk) ve devrin başka görevi AÇIK olmamalı", () => {
    const fresh = { ...EARLY, doneAt: new Date(NOW.getTime() - READY_SETTLE_MS + 1000), startedAt: at("07:00") };
    expect(readinessDetailOf([fresh], new Date("2026-10-14T09:00:00Z"), NOW, OPTS)).toEqual({ status: "not_ready", note: "fresh", departureConfirmed: false });
    expect(readinessDetailOf([EARLY, { status: "todo", doneAt: null }], CHECKOUT, NOW, OPTS)).toEqual({
      status: "not_ready",
      note: "open",
      departureConfirmed: false,
    });
  });

  it("çıkıştan SONRAKİ işaret varken hazırlık ona dayanır (çıkış 'doğrulandı' iddiası üretilmez)", () => {
    const after: ReadinessMark = { status: "done", doneAt: at("08:20") };
    expect(readinessDetailOf([EARLY, after], CHECKOUT, NOW, OPTS)).toEqual({ status: "ready", note: "none", departureConfirmed: false });
    expect(readyAtOf([EARLY, after], CHECKOUT, NOW, OPTS)).toEqual(after.doneAt);
  });
});

describe("görevin hazırlık işareti (`markOfTask`) — yalnız kimlikli ve EN SON durum kaydı", () => {
  const task = (updates: { status: string | null; userId: string | null; createdAt: Date }[], extra: Partial<{ status: string; reservationId: string | null }> = {}) => ({
    status: "done",
    reservationId: "dep",
    dueAt: null,
    updates,
    ...extra,
  });

  it("temizlikçinin 'başladım → bitti' sırası: iki an + bağ", () => {
    const m = markOfTask(
      task([
        { status: "in_progress", userId: "c1", createdAt: at("07:00") },
        { status: "done", userId: "c1", createdAt: at("07:45") },
      ]),
      "dep",
    );
    expect(m).toEqual({ status: "done", doneAt: at("07:45"), startedAt: at("07:00"), linked: true });
    expect(markOfTask(task([{ status: "done", userId: "c1", createdAt: at("07:45") }], { reservationId: "other" }), "dep").linked).toBe(false);
  });

  it("🚨 kullanıcısız (sistem) 'bitti' SAYILMAZ; sonradan geri alınan 'bitti'nin eskisi sayılmaz", () => {
    expect(markOfTask(task([{ status: "done", userId: null, createdAt: at("08:20") }]), "dep").doneAt).toBeNull();
    const reopened = task(
      [
        { status: "done", userId: "c1", createdAt: at("08:10") },
        { status: "todo", userId: "host", createdAt: at("08:15") },
      ],
      { status: "todo" },
    );
    expect(markOfTask(reopened, "dep")).toMatchObject({ status: "todo", doneAt: null, startedAt: null });
    // Yeniden bitirildi → EN SON "bitti" sayılır.
    const redone = task([...reopened.updates, { status: "done", userId: "c1", createdAt: at("08:30") }]);
    expect(markOfTask(redone, "dep").doneAt).toEqual(at("08:30"));
  });

  it("'başladım' AYNI kullanıcıdan ve 'bitti'den ÖNCE olmalı; birden çoksa bitişe en yakın olanı", () => {
    const other = markOfTask(
      task([
        { status: "in_progress", userId: "c2", createdAt: at("07:00") },
        { status: "done", userId: "c1", createdAt: at("07:45") },
      ]),
      "dep",
    );
    expect(other.startedAt).toBeNull();
    const two = markOfTask(
      task([
        { status: "in_progress", userId: "c1", createdAt: at("06:00") },
        { status: "in_progress", userId: "c1", createdAt: at("07:20") },
        { status: "done", userId: "c1", createdAt: at("07:45") },
      ]),
      "dep",
    );
    expect(two.startedAt).toEqual(at("07:20"));
    // Durum taşımayan kayıtlar (not / fotoğraf) sırayı bozmaz.
    const noted = markOfTask(
      task([
        { status: "in_progress", userId: "c1", createdAt: at("07:00") },
        { status: "done", userId: "c1", createdAt: at("07:45") },
        { status: null, userId: "c1", createdAt: at("07:50") },
      ]),
      "dep",
    );
    expect(noted.doneAt).toEqual(at("07:45"));
  });
});

describe("metin çapraz kontrolleri — misafirin KENDİ yazdığı saat ve gün", () => {
  it("açık saat anmaları: saat biçimleri tanınır; sayı/tarih/kişi saat sayılmaz", () => {
    const cases: [string, number[][]][] = [
      ["Could we check in at 13:00 today?", [[780]]],
      ["Can we come at 1pm?", [[780]]],
      ["Saat 12'de gelebilir miyiz?", [[720]]],
      ["2'de gelebilir miyiz?", [[120, 840]]],
      ["13.30 gibi", [[810]]],
      ["Können wir um 14 Uhr einchecken?", [[840]]],
      ["On peut arriver à 13h30 ?", [[810]]],
      ["¿Podemos llegar a las 13?", [[780]]],
      ["Можно заехать в 13?", [[780]]],
      ["هل يمكننا الوصول الساعة ١٣", [[780]]],
      ["12 pm", [[720]]],
      ["2 kişiyiz, 3 gece kalacağız, 14 Ekim", []],
    ];
    for (const [text, expected] of cases) expect(explicitTimeMentions(text), text).toEqual(expected);
  });

  it("🚨 onaylanacak saat misafirin yazdığı saatle eşleşmeli: saat yoksa ya da BAŞKA bir saat de varsa engel", () => {
    expect(timeMismatchInTexts(["Could we check in at 13:00?"], "13:00")).toBe(false);
    expect(timeMismatchInTexts(["1'de gelebilir miyiz?"], "13:00")).toBe(false);
    // Model saati uydurmuş olabilir: mesajda açık saat yok.
    expect(timeMismatchInTexts(["Can we check in early?"], "12:00")).toBe(true);
    // Uçak iniş saati ≠ giriş saati.
    expect(timeMismatchInTexts(["We land at 10:00, could we check in at 12:00?"], "12:00")).toBe(true);
    // Başka mesajdaki farklı saat de sayılır.
    expect(timeMismatchInTexts(["Could we check in at 12:00?", "Actually 11:00 would be better"], "12:00")).toBe(true);
    expect(timeMismatchInTexts(["Could we check in at 12:00?"], null)).toBe(true);
    expect(timeMismatchInTexts(["Could we check in at 12:00?"], "bozuk")).toBe(true);
  });

  // 14 Ekim 2026 Çarşamba (İstanbul).
  const today = (texts: string[]) => mentionsAnotherDay(texts, NOW, "Europe/Istanbul");

  it("🚨 başka güne işaret: göreli sözcük, hafta günü, tarih — altı dilde", () => {
    for (const text of [
      "Yarın 12'de gelebilir miyiz?",
      "Could we check in tomorrow at 12?",
      "Können wir morgen um 12 Uhr einchecken?",
      "On peut arriver demain à 13h ?",
      "¿Podemos llegar mañana a las 12?",
      "Можно заехать завтра в 12?",
      "هل يمكننا الوصول غدا",
      "Cuma günü erken girebilir miyiz?",
      "Can we check in early on Fri?",
      "15 Ekim'de 12'de gelsek?",
      "October 15 at noon?",
      "the 16th",
      "15.10 günü",
      "haftaya salı değil, haftaya",
      "next week",
      "2 gün sonra geleceğiz",
    ]) {
      expect(today([text]), text).toBe(true);
    }
  });

  it("bugünü adlandıran gün / tarih ve saat biçimleri engel değildir (yanlış alarm yok)", () => {
    for (const text of [
      "Bugün 12'de gelebilir miyiz?",
      "Could we check in today at 12:30?",
      "Guten Morgen! Können wir um 12 Uhr einchecken?",
      "Wir kommen am Morgen an",
      "Llegamos esta mañana, ¿podemos entrar a las 12?",
      "Çarşamba günü, yani bugün",
      "on Wednesday",
      "14 Ekim",
      "Oct 14",
      "the 14th",
      "14.10",
      "14/10/2026",
      "13:30 olur mu?",
      "12.30 gibi",
      "Можно заехать 14 октября?",
      "¿Podemos llegar el 14 de octubre?",
    ]) {
      expect(today([text]), text).toBe(false);
    }
  });

  it("dil bilgisi: Rusça ay adı çekimli, İspanyolca 'de' ile; olumsuzlama ANLAŞILMAZ (temkinli yön: yalnız otomatik gönderim durur)", () => {
    expect(today(["Можно заехать 15 октября?"])).toBe(true);
    expect(today(["¿Podemos llegar el 15 de octubre?"])).toBe(true);
    expect(today(["Cumartesi değil, bugün geliyoruz"])).toBe(true);
  });

  it("saat dilimi: gün mülkün diliminde okunur (UTC'de 13 Ekim iken İstanbul'da 14 Ekim)", () => {
    const lateUtc = new Date("2026-10-13T22:30:00Z"); // İstanbul 14 Ekim 01:30
    expect(mentionsAnotherDay(["14 Ekim"], lateUtc, "Europe/Istanbul")).toBe(false);
    expect(mentionsAnotherDay(["14 Ekim"], lateUtc, "UTC")).toBe(true);
  });
});

describe("otomatik gönderim engelleri — yalnız ENGELLER", () => {
  const base = { requestedTime: "12:00", now: NOW, timeZone: "Europe/Istanbul" };

  it("temiz mesaj → engel yok; her engel kendi koşuluyla", () => {
    expect(earlyCheckinAutoBlockers({ ...base, guestTexts: ["Saat 12'de gelebilir miyiz?"] })).toEqual([]);
    expect(earlyCheckinAutoBlockers({ ...base, guestTexts: ["Yarın saat 12'de gelebilir miyiz?"] })).toEqual(["day_unverified"]);
    expect(earlyCheckinAutoBlockers({ ...base, guestTexts: ["Erken girebilir miyiz?"] })).toEqual(["time_mismatch_text"]);
  });

  it("pencere sabitleri modellerin GERÇEKTEN gördüğüyle aynıdır (davranışsal; sabitten türetilen totoloji değil)", () => {
    const fruits = ["elma", "armut", "kiraz", "erik", "incir", "ayva", "nar", "dut"];
    for (const [name, window, build] of [
      [
        "anlama",
        UNDERSTANDING_WINDOW,
        (msgs: string[]) => buildUnderstandingUserContent({ guestMessage: msgs[msgs.length - 1], history: msgs.map((body) => ({ direction: "inbound" as const, body })) }),
      ],
      ["bekçi", GUARD_WINDOW, (msgs: string[]) => buildStayGuardUserContent({ guestMessages: msgs, reply: "tamam", stayTimes: null })],
    ] as const) {
      const msgs = fruits.slice(0, window.maxMessages + 1);
      const content = build([...msgs]);
      expect(content, name).not.toContain(`<<<${msgs[0]}>>>`);
      for (const m of msgs.slice(1)) expect(content, `${name}: ${m}`).toContain(`<<<${m}>>>`);
      const long = `${"a".repeat(window.messageCap)}Z`;
      const cut = build([long]);
      expect(cut, name).toContain(`<<<${"a".repeat(window.messageCap)}>>>`);
      expect(cut, name).not.toContain("aZ");
    }
  });

  it("🚨 modellerin penceresine sığmayan cevapsız mesaj → 'tamamı okunmadı' (iki modelin ORTAK penceresi)", () => {
    const maxMessages = Math.min(UNDERSTANDING_WINDOW.maxMessages, GUARD_WINDOW.maxMessages);
    const messageCap = Math.min(UNDERSTANDING_WINDOW.messageCap, GUARD_WINDOW.messageCap);
    const fits = Array.from({ length: maxMessages }, () => "Saat 12'de gelebilir miyiz?");
    expect(earlyCheckinAutoBlockers({ ...base, guestTexts: fits })).toEqual([]);
    expect(earlyCheckinAutoBlockers({ ...base, guestTexts: [...fits, "Saat 12'de gelebilir miyiz?"] })).toEqual(["not_fully_read"]);
    const long = `Saat 12'de gelebilir miyiz? ${"a".repeat(messageCap)}`;
    expect(earlyCheckinAutoBlockers({ ...base, guestTexts: [long] })).toEqual(["not_fully_read"]);
    const exact = `Saat 12'de ${"a".repeat(messageCap - "Saat 12'de ".length)}`;
    expect(exact.length).toBe(messageCap);
    expect(earlyCheckinAutoBlockers({ ...base, guestTexts: [exact] })).toEqual([]);
  });
});

describe("kural: host rızası `readyBeforeCheckout`", () => {
  const base = { mode: "auto", earliest: "12:00", fee: null, note: null };
  it("yalnız açık `true` rıza; yok / false → alan yok; başka tip → kural bozuk (kapalı)", () => {
    expect(validateEarlyCheckinRuleInput({ ...base, readyBeforeCheckout: true })).toEqual({ ...base, readyBeforeCheckout: true });
    expect(validateEarlyCheckinRuleInput({ ...base, readyBeforeCheckout: false })).toEqual(base);
    expect(validateEarlyCheckinRuleInput({ ...base, readyBeforeCheckout: null })).toEqual(base);
    expect(validateEarlyCheckinRuleInput(base)).toEqual(base);
    for (const bad of ["true", 1, {}, []]) expect(validateEarlyCheckinRuleInput({ ...base, readyBeforeCheckout: bad }), JSON.stringify(bad)).toBeNull();
  });
});

describe("panel — kanıt modelinin yeni satırları (sade dil)", () => {
  const facts: EarlyCheckinPanelData["facts"] = {
    arrivalToday: true,
    requestedTime: "12:00",
    previousCheckout: "11:00",
    readiness: "ready",
    otherOverlaps: 0,
    previousNightVerifiedVacant: false,
  };
  const lines = (d: Partial<EarlyCheckinPanelData>, over: Partial<EarlyCheckinPanelData["facts"]> = {}) =>
    earlyCheckinPanelLines({ status: "needs_host", mode: "auto", fee: null, failed: [], ...d, facts: { ...facts, ...over } });

  it("her yeni kod kendi satırını yazar", () => {
    const texts = (code: string) => lines({ failed: [code] }).filter((l) => !l.ok).map((l) => l.text);
    expect(texts("open_issue")).toContain('Bu devirde açık bir sorun ya da bakım görevi var; kapanmadan "daire hazır" denemez.');
    expect(texts("arrival_passed")).toContain("Misafirin varış günü geçmiş.");
    expect(texts("time_passed")).toContain("İstenen saat geçti; misafire uygun saati siz yazın.");
    expect(texts("before_window")).toContain("İstenen saat, otomatik onay için belirlediğiniz en erken saatten önce; karar sizin.");
    expect(texts("luggage")).toContain("Misafir bavul bırakmayı ya da almayı soruyor; erken giriş onayı bunu yanıtlamaz.");
    expect(texts("day_unverified")).toContain('Mesajda başka bir güne işaret var (ör. "yarın"); günü kontrol edin.');
    expect(texts("not_fully_read")).toContain("Cevapsız mesajlar çok uzun ya da çok fazla; hepsini okuyup siz karar verin.");
    expect(texts("time_mismatch_text")).toContain("Mesajdaki saat(ler) istenen saatle birebir eşleşmiyor; saati kontrol edin.");
  });

  it("önceki çıkış BEKLENTİDİR: 'dolu' denmez; kanıtlı erken hazırlıkta çıkış doğrulandı satırı", () => {
    expect(lines({ failed: ["previous_still_in"] }).find((l) => l.text.startsWith("Önceki misafir"))).toEqual({
      ok: false,
      text: "Önceki misafirin beklenen çıkışı: 11:00 — istenen saatten sonra; temizlik bitmeden onay verilmez.",
    });
    const confirmed = lines({ status: "approvable" }, { departureConfirmed: true });
    expect(confirmed.find((l) => l.text.startsWith("Temizlik önceki"))).toEqual({
      ok: true,
      text: "Temizlik önceki misafirin beklenen çıkışından önce bitti; çıkış temizlikçinin kaydıyla doğrulandı.",
    });
    expect(confirmed.some((l) => l.text.startsWith("Önceki misafirin beklenen çıkışı"))).toBe(false);
  });

  it("önceki misafirin beklenenden ERKEN beyanı bilgi satırıdır; temizlikçi başladıysa temizlik satırı bunu söyler", () => {
    const DECLARED = "Önceki misafirin yazdığı çıkış: 10:00 (misafir beyanı; temizlik kaydı olmadan esas alınmaz).";
    expect(lines({ failed: ["previous_still_in"] }, { previousDeclaredCheckout: "10:00" }).map((l) => l.text)).toContain(DECLARED);
    expect(lines({ failed: ["previous_still_in"] }).map((l) => l.text)).not.toContain(DECLARED);
    // Kanıtlı erken hazırlıkta çıkış zaten doğrulandı: beyan satırı gösterilmez.
    expect(lines({ status: "approvable" }, { departureConfirmed: true, previousDeclaredCheckout: "10:00" }).map((l) => l.text)).not.toContain(DECLARED);
    const STARTED = 'Temizlikçi temizliğe başladı; henüz "Daire hazır" demedi.';
    expect(lines({ failed: ["not_ready"] }, { readiness: "not_ready", readinessNote: "open", cleaningStarted: true }).map((l) => l.text)).toContain(STARTED);
    expect(lines({ failed: ["not_ready"] }, { readiness: "not_ready", readinessNote: "open" }).map((l) => l.text)).toContain(
      "Temizlik henüz bitti olarak işaretlenmedi.",
    );
  });

  it("bekleyen istek: yalnız otomatik kurallı + varış günü 'yeniden kontrol edilir' der (başka durumda söz verilmez)", () => {
    const RECHECK = 'Temizlikçi "Daire hazır" dediğinde istek yeniden kontrol edilir.';
    const has = (d: Partial<EarlyCheckinPanelData>, over: Partial<EarlyCheckinPanelData["facts"]> = {}) => lines(d, over).some((l) => l.text === RECHECK);
    expect(has({ status: "pending", failed: ["not_ready"] }, { readiness: "not_ready" })).toBe(true);
    expect(has({ status: "pending", failed: ["not_ready"], mode: "draft" }, { readiness: "not_ready" })).toBe(false);
    expect(has({ status: "pending", failed: ["not_arrival_day"] }, { arrivalToday: false })).toBe(false);
    expect(has({ status: "needs_host", failed: ["not_ready", "overlap"] }, { readiness: "not_ready", otherOverlaps: 1 })).toBe(false);
  });
});

describe("gün içi dakika (mülk dilimi)", () => {
  it("İstanbul UTC+3; geçersiz dilim → null (tahmin yok)", () => {
    expect(minutesOfDayInTimeZone("Europe/Istanbul", NOW)).toBe(11 * 60 + 40);
    expect(minutesOfDayInTimeZone("UTC", NOW)).toBe(8 * 60 + 40);
    expect(minutesOfDayInTimeZone("Europe/Istanbul", new Date("2026-10-13T21:00:00Z"))).toBe(0);
    expect(minutesOfDayInTimeZone("Not/AZone", NOW)).toBeNull();
  });
});
