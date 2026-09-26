import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { buildConversationState } from "@/lib/ai/conversation-state";
import { STAY_CHANGE_KINDS } from "@/lib/ai/semantic/stay-change";
import { stayTimeline } from "@/lib/ai/stay-timeline";
import { todayKey } from "@/modules/availability/core";
import { isGenericClarification, questionSentences } from "./reply-metrics";
import {
  CUS_CLASSES,
  CUS_LANGS,
  CUS_METRICS,
  CUS_TZ,
  armDiffs,
  decisionsOf,
  invalidRow,
  isFirstOperatorReply,
  localInstant,
  metricValue,
  pairedSummary,
  preModelSilence,
  rescoreRow,
  reservationOf,
  runScenario,
  scoreReply,
  threadOf,
  unansweredOf,
  writeReport,
  type Arm,
  type CusDataset,
  type CusRow,
  type CusScenario,
  type ReportMeta,
} from "./conversation-state-harness";

// ---------------------------------------------------------------------------
// KONUŞMA ANLAMA DURUMU — GERÇEK MODEL EVAL'İ (MÇ v2 §2.2 açma sırası + §5 ölçüleri; 09-26). Araç mantığı ve
// yapılandırma gerekçesi `conversation-state-harness.ts`te; ürüne bağlantısı `conversation-state-wiring.test.ts`te pinli.
//
// VERİ: `evals/conversation-state.json` — KÖR yazılır (ürünün dedektörlerine bakmadan; MÇ v2 §2.2: ajanla, harcama
// sınırı nedeniyle 30 Eylül sonrası). Biçim `CusDataset`. İlk ücretli koşudan sonra set "görüldü" sayılır: ürün ona
// göre ayarlanırsa doğrulama yeni bir kör setle yapılır. Dosya yoksa ücretli koşu atlanır.
// İKİ KAPI: `RUN_REAL_EVAL=1` + gerçek anahtar (`npm run eval`). Eksik koşu "GEÇTİ" diye okunamaz: satırların %2'sinden
// fazlası düşerse (cevap modeli yedeği ya da anlama katmanı) rapor GEÇERSİZ. `EVAL_CUS_LIMIT` ile örneklenir.
// Maliyet: senaryo başına iki kol × (cevap modeli + anlama katmanı) — kurucu onayıyla koşulur.
// ---------------------------------------------------------------------------

const DATASET = path.resolve(__dirname, "../../evals/conversation-state.json");
const datasetExists = existsSync(DATASET);
const key = process.env.OPENAI_API_KEY?.trim() ?? "";
const enabled = process.env.RUN_REAL_EVAL === "1" && key.length > 20 && !key.startsWith("test-");
const MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-5.1";
const LIMIT = Number(process.env.EVAL_CUS_LIMIT) > 0 ? Math.trunc(Number(process.env.EVAL_CUS_LIMIT)) : null;
const CONCURRENCY = 3;
/** Cevap modeli istek tavanı (model kıyasıyla aynı gerekçe: token/dk sınırı aşılırsa satır modelin suçu olmadan düşer). */
const RPM = Number(process.env.EVAL_CUS_RPM) > 0 ? Number(process.env.EVAL_CUS_RPM) : MODEL.includes("luna") ? 9 : 24;

const sentAt: number[] = [];
async function throttle(): Promise<void> {
  for (;;) {
    const cutoff = Date.now() - 60_000;
    while (sentAt.length && sentAt[0] < cutoff) sentAt.shift();
    if (sentAt.length < RPM) {
      sentAt.push(Date.now());
      return;
    }
    await new Promise((r) => setTimeout(r, 250 + sentAt[0] - cutoff));
  }
}

const FLAGS = ["AI_CONVERSATION_STATE_ENABLED", "AI_UNDERSTANDING_ENABLED", "AI_STAY_GUARD_ENABLED", "AI_ACTION_CLAIMS_ENABLED", "KB_SEMANTIC_RETRIEVAL"] as const;

describe.skipIf(!enabled || !datasetExists)(`KONUŞMA ANLAMA DURUMU — eşleştirilmiş koşu (${MODEL})`, () => {
  const saved: Partial<Record<(typeof FLAGS)[number], string | undefined>> = {};
  const rows: CusRow[] = [];
  let data: CusDataset;
  let runDay = "";

  beforeAll(() => {
    for (const f of FLAGS) saved[f] = process.env[f];
    process.env.AI_UNDERSTANDING_ENABLED = "1";
    for (const f of ["AI_STAY_GUARD_ENABLED", "AI_ACTION_CLAIMS_ENABLED", "KB_SEMANTIC_RETRIEVAL"] as const) delete process.env[f];
    data = JSON.parse(readFileSync(DATASET, "utf8")) as CusDataset;
    runDay = todayKey(new Date(), CUS_TZ);
  });

  afterAll(() => {
    for (const f of FLAGS) {
      if (saved[f] === undefined) delete process.env[f];
      else process.env[f] = saved[f];
    }
    // Gerçek koşu yoksa rapor YAZILMAZ (ana suite `tests/**` topluyor — anahtarsız `npm test` ücretli raporu ezmesin).
    if (rows.length === 0) return;
    let commit = "?";
    try {
      commit = execSync("git rev-parse --short HEAD", { cwd: path.resolve(__dirname, "../..") }).toString().trim();
    } catch {
      /* git yoksa kanıtta "?" */
    }
    const dir = path.resolve(__dirname, "../../docs/olcum");
    mkdirSync(dir, { recursive: true });
    const name = `conversation-state-eval-${new Date().toISOString().slice(0, 10)}-${MODEL.replace(/[^a-z0-9.-]+/gi, "_")}.md`;
    writeReport(data, rows, { model: MODEL, commit, runDay, limit: LIMIT }, dir, name);
  });

  it(
    "iki kol (bayrak KAPALI → AÇIK), aynı senaryolar, ürünün yapı taşları",
    async () => {
      const list = data.scenarios.slice(0, LIMIT ?? undefined);
      // Kollar SIRAYLA: bayrak çağrı anında okunur (`conversationStateEnabled`) — bir kol bitmeden öteki başlamaz.
      for (const arm of ["off", "on"] as const) {
        if (arm === "on") process.env.AI_CONVERSATION_STATE_ENABLED = "1";
        else delete process.env.AI_CONVERSATION_STATE_ENABLED;
        let next = 0;
        await Promise.all(
          Array.from({ length: CONCURRENCY }, async () => {
            while (next < list.length) {
              const s = list[next++];
              rows.push(await runScenario(data, s, arm, runDay, { throttle }));
            }
          }),
        );
      }
      expect(rows.length).toBe(list.length * 2);
    },
    2 * 60 * 60 * 1000,
  );
});

// YENİDEN PUANLAMA (model çağrısı YOK): `EVAL_CUS_RESCORE=<koşu yan-dosyası .json>` — ham alanlar aynen kalır, türev
// alanlar (soru, genel netleştirme, söz, selam) ve beklentiler güncel veri setinden yeniden hesaplanır; rapor aynı adla,
// notla yeniden yazılır.
const RESCORE = process.env.EVAL_CUS_RESCORE?.trim();
describe.skipIf(!RESCORE)("Konuşma Anlama Durumu eval'i — yeniden puanlama (ücretsiz)", () => {
  it("yan-dosyadaki ham cevaplar güncel kurallarla puanlanır", () => {
    const file = path.resolve(RESCORE as string);
    const side = JSON.parse(readFileSync(file, "utf8")) as { version: number; meta: ReportMeta; rows: CusRow[] };
    const data: CusDataset = datasetExists
      ? (JSON.parse(readFileSync(DATASET, "utf8")) as CusDataset)
      : { version: side.version, property: { name: "?", checkInTime: "?", checkOutTime: "?" }, scenarios: [] };
    const byId = new Map(data.scenarios.map((s) => [s.id, s]));
    const rows = side.rows.map((r) => rescoreRow(r, byId.get(r.id)));
    expect(rows.length).toBeGreaterThan(0);
    writeReport(
      data,
      rows,
      side.meta,
      path.dirname(file),
      path.basename(file).replace(/\.json$/, ".md"),
      `Yeniden puanlandı (${new Date().toISOString().slice(0, 10)}, model çağrısı yok): ham cevaplar \`${side.meta.commit}\` koşusundan.`,
    );
  });
});

// ─── Çevrimdışı pinler (model çağrısı YOK) ────────────────────────────────────────────────────────────────────────

describe("Konuşma Anlama Durumu eval'i — çevrimdışı pinler", () => {
  const scenario = (over: Partial<CusScenario>): CusScenario => ({
    id: "x",
    class: "resolvable",
    lang: "tr",
    reservation: { arrivalInDays: -1, nights: 3 },
    message: "Havlular nerede?",
    expect: {},
    ...over,
  });

  it("yerel saat sabit ofsetle kurulur ve ürünün gün kuralıyla aynı güne düşer (+03:00 varsayımı pinli)", () => {
    const at = localInstant("2026-09-26", "01:30");
    expect(todayKey(at, CUS_TZ)).toBe("2026-09-26");
    expect(new Intl.DateTimeFormat("en-GB", { timeZone: CUS_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at)).toBe("01:30");
  });

  it("rezervasyon yalnız-tarih çapasıdır: 'yarın giriş' senaryosu ürünün zaman çizelgesinde de yarın", () => {
    const s = scenario({ reservation: { arrivalInDays: 1, nights: 2 } });
    const now = localInstant("2026-09-26", "14:00");
    const t = stayTimeline({ now, timeZone: CUS_TZ, reservation: reservationOf(s, "2026-09-26") });
    expect(t.stage).toBe("arrival_tomorrow");
    expect([t.arrival, t.departure]).toEqual(["2026-09-27", "2026-09-29"]);
  });

  it("karar kayıtları ürünün kurucusundan geçer: ev sahibine bırakılmış erken giriş 'pending_host', sonra ev sahibi yazınca 'host_replied'", () => {
    const pendingS = scenario({
      class: "pending_followup",
      history: [
        { direction: "inbound", body: "Saat 11'de girebilir miyiz?", decision: { finalDecision: "human_review", stay: "early_checkin/defers" } },
      ],
      message: "Bir gelişme var mı?",
    });
    const t1 = threadOf(pendingS);
    expect(buildConversationState({ messages: t1, decisions: decisionsOf(pendingS, t1) }).items).toEqual([{ topic: "early_checkin", status: "pending_host" }]);

    const replied = scenario({
      ...pendingS,
      history: [...(pendingS.history ?? []), { direction: "outbound", author: "host", body: "Bakıp size yazacağım." }],
    });
    const t2 = threadOf(replied);
    const st = buildConversationState({ messages: t2, decisions: decisionsOf(replied, t2) });
    expect(st.items).toEqual([{ topic: "early_checkin", status: "host_replied" }]);
    expect([st.outbound, st.hostOutbound, st.unansweredGuest]).toEqual([1, 1, 1]);
  });

  it("model öncesi kanal kararları: önceki cevaptan sonra teşekkür = sözcük yolu; ilk mesajdaki teşekkür modele; bitmiş konaklama sessiz", () => {
    const now = localInstant("2026-09-26", "14:00");
    const closing = scenario({
      class: "closing",
      history: [
        { direction: "inbound", body: "Wi-Fi şifresi nedir?" },
        { direction: "outbound", body: "Şifre Lale2025." },
      ],
      message: "Teşekkürler 🙏",
    });
    expect(preModelSilence(closing, threadOf(closing), now)).toBe("lexical");
    const first = scenario({ class: "closing", message: "Teşekkürler 🙏" });
    expect(preModelSilence(first, threadOf(first), now)).toBeNull();
    // Kapanışa benzeyen gerçek istek sözcük yolundan geçmez.
    const trap = scenario({ ...closing, class: "closing_trap", message: "Teşekkürler, yarın havlu getirebilir misiniz?" });
    expect(preModelSilence(trap, threadOf(trap), now)).toBeNull();
    const ended = scenario({ reservation: { arrivalInDays: -5, nights: 3 } });
    expect(preModelSilence(ended, threadOf(ended), now)).toBe("reservation_ended");
    // Çıkış günü konaklama bitmiş SAYILMAZ (tek tarih kuralı).
    const checkoutDay = scenario({ reservation: { arrivalInDays: -3, nights: 3 } });
    expect(preModelSilence(checkoutDay, threadOf(checkoutDay), now)).toBeNull();
  });

  it("selam kuralı ve cevapsız mesaj dilimi kanal yoluyla aynı", () => {
    const s = scenario({
      history: [
        { direction: "inbound", body: "Merhaba" },
        { direction: "outbound", author: "host", body: "Hoş geldiniz!" },
        { direction: "inbound", body: "Otopark var mı?" },
      ],
      message: "Bir de havlular?",
    });
    const t = threadOf(s);
    expect(isFirstOperatorReply(t)).toBe(false);
    expect(unansweredOf(t)).toEqual(["Otopark var mı?", "Bir de havlular?"]);
    expect(isFirstOperatorReply(threadOf(scenario({})))).toBe(true);
  });

  it("soru ve genel netleştirme ölçüsü: hedefli soru GENEL değil, açıklama isteği GENEL (yedi dil örneği)", () => {
    expect(questionSentences("Standart giriş 15:00. Yarınki girişinizi mi kastediyorsunuz?")).toEqual(["Yarınki girişinizi mi kastediyorsunuz?"]);
    expect(questionSentences("¿Se refiere a mañana? Gracias.")).toEqual(["Se refiere a mañana?"]);
    expect(questionSentences("Şifre Lale2025.")).toEqual([]);
    for (const q of [
      "Biraz daha açıklar mısınız?",
      "Ne demek istediğinizi açıklar mısınız?",
      "Could you please clarify what you mean?",
      "What do you mean?",
      "Können Sie das genauer erklären?",
      "Pourriez-vous préciser ?",
      "¿Podría aclarar su pregunta?",
      "Уточните, пожалуйста?",
    ]) {
      expect(isGenericClarification(q), q).toBe(true);
    }
    for (const q of ["Yarınki girişinizi mi kastediyorsunuz?", "Do you mean your check-in tomorrow?", "Meinen Sie den Check-in morgen?"]) {
      expect(isGenericClarification(q), q).toBe(false);
    }
  });

  it("ölçüler: yanlış susturma sözcük+anlam yolunu sayar ama bitmiş konaklamayı saymaz; giden söz ayrı; yedeğe düşen paydadan çıkar", () => {
    const row = (over: Partial<CusRow>): CusRow => ({ id: "r", cls: "resolvable", lang: "tr", arm: "off", expect: {}, ok: true, silent: null, modelRan: true, ...over });
    const rows = [
      row({ id: "a", silent: "lexical", modelRan: false, expect: { silent: false } }),
      row({ id: "b", silent: "semantic", expect: {} }),
      row({ id: "c", silent: "reservation_ended", modelRan: false, expect: {} }),
      row({ id: "d", auto: true, promise: true }),
      row({ id: "e", ok: false, silent: "semantic" }),
    ];
    const byLabel = (l: string) => CUS_METRICS.find((m) => m.label.includes(l))!;
    expect(metricValue(byLabel("YANLIŞ SUSTURMA"), rows)).toBe("2/4 (50%)");
    expect(metricValue(byLabel("BEKLEME SÖZÜ misafire giden"), rows)).toBe("1/1 (100%)");
    const scored = scoreReply(row({ id: "f" }), "Ev sahibinize soracağım. Merhaba!", true);
    expect([scored.promise, scored.greet, scored.questions]).toEqual([true, false, []]);
    // Selam yalnız ÖNCEKİ cevaptan sonra ölçülür (ilk cevapta selam doğrudur).
    expect(scoreReply(row({ id: "g" }), "Merhaba! Havlular dolapta.", false).greet).toBeNull();
    expect(scoreReply(row({ id: "h" }), "Merhaba! Havlular dolapta.", true).greet).toBe(true);
  });

  it("yeniden puanlama: ham alanlar aynen, türevler cevaptan, beklenti güncel senaryodan; model koşmayan satıra cevap uydurulmaz", () => {
    const s = scenario({
      history: [
        { direction: "inbound", body: "Otopark var mı?" },
        { direction: "outbound", body: "Evet, bina önünde." },
      ],
      message: "Peki havlular?",
      expect: { clarify: "none" },
    });
    const raw: CusRow = { id: "x", cls: "resolvable", lang: "tr", arm: "on", expect: {}, ok: true, silent: null, modelRan: true, auto: true, gate: null, reply: "Merhaba! Havlular dolapta. Başka bir şey?", asked: "none" };
    const out = rescoreRow(raw, s);
    expect(out.expect).toEqual({ clarify: "none" });
    expect([out.auto, out.gate, out.asked, out.reply]).toEqual([true, null, "none", raw.reply]);
    expect([out.greet, out.questions, out.promise]).toEqual([true, ["Başka bir şey?"], false]);
    const lexical: CusRow = { ...raw, modelRan: false, reply: undefined, silent: "lexical", auto: undefined };
    const out2 = rescoreRow(lexical, s);
    expect([out2.reply, out2.questions, out2.greet]).toEqual([undefined, undefined, undefined]);
    // Anlama katmanı düşen satır ölçüme geçersiz.
    expect(invalidRow({ ...raw, uStatus: "failed" })).toBe(true);
    expect(invalidRow({ ...raw, uStatus: "ok" })).toBe(false);
  });

  it("eşleştirilmiş özet iki kolu ayrı sayar; değişen senaryo listesi yalnız farkı basar", () => {
    const row = (arm: Arm, id: string, auto: boolean): CusRow => ({ id, cls: "resolvable", lang: "tr", arm, expect: { autoSend: "no" }, ok: true, silent: null, modelRan: true, auto });
    const rows = [row("off", "s1", true), row("on", "s1", false), row("off", "s2", false), row("on", "s2", false)];
    const text = pairedSummary(rows).join("\n");
    expect(text).toContain("| 🚨 SIZINTI (beklenti 'gitmez' iken otomatik gitti) | 0 | 1/2 (50%) | 0/2 (0%) |");
    const diffs = armDiffs(rows);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toContain("`s1`");
  });

  it.skipIf(!datasetExists)("veri seti biçimi: kimlik eşsiz, sınıf/dil kapalı küme, beklenti sınıfla tutarlı, konaklama bitmemiş", () => {
    const ds = JSON.parse(readFileSync(DATASET, "utf8")) as CusDataset;
    const ids = ds.scenarios.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of ds.scenarios) {
      expect(CUS_CLASSES as readonly string[], s.id).toContain(s.class);
      expect(CUS_LANGS as readonly string[], s.id).toContain(s.lang);
      expect(s.message.trim().length, s.id).toBeGreaterThan(0);
      for (const m of s.history ?? []) expect(m.body.trim().length, s.id).toBeGreaterThan(0);
      if (s.localTime !== undefined) expect(s.localTime, s.id).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
      if (s.reservation) expect(s.reservation.arrivalInDays + s.reservation.nights, `${s.id}: bitmiş konaklama ölçülmez`).toBeGreaterThanOrEqual(0);
      if (s.expect.stayKind !== undefined) expect(STAY_CHANGE_KINDS as readonly string[], s.id).toContain(s.expect.stayKind);
      if (s.class === "closing") expect(s.expect.silent, s.id).toBe(true);
      if (s.class === "closing_trap") expect(s.expect.silent, s.id).toBe(false);
      if (s.class === "travel_not_checkout") expect(s.expect.statedCheckoutTime, s.id).toBeNull();
      if (s.class === "checkout_time") expect(s.expect.statedCheckoutTime, s.id).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
      if (s.class === "tomorrow_early") expect(s.expect.stayKind, s.id).toBeDefined();
      if (s.class === "resolvable") expect(s.expect.clarify, s.id).toBe("none");
      if (s.class === "ambiguous") expect(s.expect.clarify, s.id).toBe("one");
      if (s.class === "pending_followup") expect((s.history ?? []).some((m) => m.decision), s.id).toBe(true);
    }
  });
});
