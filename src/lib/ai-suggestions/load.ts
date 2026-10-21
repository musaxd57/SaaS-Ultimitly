import "server-only";

import { prisma } from "@/lib/db";
import { detectRiskType } from "@/lib/ai/fallback";
import { buildOperationalTaskData, detectOperationalTask } from "@/lib/tasks/detect";
import { TASK_TYPE } from "@/lib/constants";
import { isChannelAutomation, resolveMessageAuthor } from "@/lib/message-author";
import { addZonedDays, dateKeyInTimeZone, orgTimezone, zonedWallClockToUtc } from "@/lib/timezone";
import {
  COMMITMENT_TOPIC_LABELS,
  commitmentWhenText,
  commitmentLabel,
  storedCommitmentWhen,
  commitmentSlotAbsorbs,
  commitmentSlotSame,
  commitmentTopicsCompatible,
  hostCommitmentAutoEnabled,
  isCommitmentTopic,
  type CommitmentKind,
  type CommitmentTopic,
  type DayPartCode,
  type DuePrecision,
} from "@/lib/guest-commitments-core";
import {
  applyWifiValue,
  contextHalfHint,
  contextSaysNow,
  detectHostPromises,
  hasPromiseTime,
  extractWifiValues,
  kbContainsValue,
  maskSecret,
  promiseWindow,
  wifiTargetAmbiguous,
  withHalf,
  SUGGESTION_WINDOW_DAYS,
  suggestionKey,
  type HostPromise,
  type PromiseWindow,
  type SuggestionDecision,
  type SuggestionKind,
} from "./core";

// ---------------------------------------------------------------------------
// YAPAY ZEKÂ EYLEM ÖNERİLERİ — OKUMA (⑤ ilk dilim, kurucu 10-12). Kiracı + kaynak kapsamlı; salt-okuma. Karar (onay / yok say) kaydı
// `AuditLog`ta (`ai_suggestion.approved` / `ai_suggestion.dismissed`, metadata yalnız anahtar + tür — metin YOK) → migration yok.
// Anahtar `AI_ACTION_SUGGESTIONS_ENABLED` (yalnız "1"; varsayılan KAPALI).
// ---------------------------------------------------------------------------

export function aiActionSuggestionsEnabled(): boolean {
  return process.env.AI_ACTION_SUGGESTIONS_ENABLED === "1";
}

export const SUGGESTION_APPROVED = "ai_suggestion.approved";
export const SUGGESTION_DISMISSED = "ai_suggestion.dismissed";
/** Öneri listesi tavanı (konuşma / mülk başına). */
const MAX_SUGGESTIONS = 5;

export type SuggestionView =
  | {
      key: string;
      kind: "task";
      title: string;
      detail: string;
      evidenceAt: string;
      proposal: { messageId: string; taskTitle: string; priority: "urgent" | "standard" };
    }
  | {
      key: string;
      kind: "commitment";
      title: string;
      detail: string;
      evidenceAt: string;
      /**
       * `topic`: sözün konusu (I1; ev sahibinin mesajından kodla) — onay aynı konuyu yazar. `attachTopics` (Q1-b): konusuz öneri aynı saatte
       * birden çok farklı konulu açık söze uyuyor — onayda biri (ya da "yeni söz") seçilir.
       */
      proposal: {
        messageId: string;
        commitmentKind: CommitmentKind;
        topic: CommitmentTopic | null;
        day: "today" | "tomorrow";
        /** Açık saat ("SS:DD"); gün dilimi / gün sözünde "" (kurucu 10-17: saat uydurulmaz). */
        time: string;
        precision: DuePrecision;
        dayPart?: DayPartCode;
        /** Sunucunun hesapladığı son an (pencere sonu) — onay bunu YENİDEN üretir, istemciden okunmaz. */
        dueAt: string;
        /** Sözün günü (YYYY-MM-DD, işletme dilimi) — dilim / gün sözünde görevin yalnız-tarih vadesi. */
        dayKey: string;
        attachTopics?: CommitmentTopic[];
        /** Bağlamla KESİN eşleşen önceki açık söz — onay (ya da otomatik kip) onun saatini taşır, yeni söz açmaz. */
        reschedule?: { commitmentId: string };
        /**
         * Bağlam BELİRSİZ: yeni saat hangi sözün? Seçim "move:<kimlik>" ya da "new". Her seçenek TAŞINACAĞI anı taşır (sert itirazcı 10-17
         * gece-4, F11: gün sözcüğü olmayan "Klima için teknisyen 15:00'te gelecek" yarınki 10:00 sözünü YARIN 15:00'e taşır, bugüne değil);
         * etiket sonucu yazar ("… — yarın 10:00 → yarın 15:00"). Taşımada gün seçimi kullanılmaz.
         */
        moveOptions?: Array<{
          commitmentId: string;
          label: string;
          day: "today" | "tomorrow";
          time: string;
          precision: DuePrecision;
          dayPart?: DayPartCode;
          dueAt: string;
          dayKey: string;
        }>;
        /** Mesajda birden çok saat — kendiliğinden kaydedilmez, ev sahibi saati seçer (Opus O9). */
        timeAmbiguous?: true;
        /** Kurucu T5: saat öğleden önce mi sonra mı belli değil ("yarın 7'de") — iki seçenek; seçilmeden onay yok (`time` boş). */
        timeChoices?: string[];
        /** Kurucu T5: kesin söz değil ("belki", "müsait olursa", "yarın gelir") — kendiliğinden kaydedilmez, ev sahibi onaylarsa söz olur. */
        tentative?: true;
        /** Kurucu T5: açık "bugün" + mesaj yazıldığında GEÇMİŞ saat ("Bugün 11'de" 13:00'te) — gösterilir, kendiliğinden kaydedilmez; saat düzeltilir ya da yok sayılır. */
        pastDue?: true;
        /**
         * Sözün günü mesajdan okunamadı (kendi gün sözcüğü yok, mesajın başka yerinde yarın / tanınmayan gün geçiyor — sert itirazcı 10-17
         * gece-4, D3): kendiliğinden kaydedilmez, onay günü SEÇMEDEN geçmez (`decideSuggestion`; varsayılan "bugün" yok).
         */
        dayUnclear?: true;
        /** Kesin taşıma sözün kesinliğini DÜŞÜRÜYOR (kayıtlı saat → yalnız gün / dilim) — kendiliğinden uygulanmaz, kart kalır (R1). */
        lowersPrecision?: true;
        /**
         * Sözü YAPAN (visit · delivery · null) — onay söze yazar (migration 76); yazma katmanı aynı andaki BAŞKA yapanın sözüne kilit içinde
         * birleşmez (Haiku 10-17 gece 2. tur + Opus gece-3 F4: birleşip kayboluyordu).
         */
        actor: "visit" | "delivery" | null;
      };
    }
  | {
      key: string;
      kind: "kb_wifi";
      title: string;
      detail: string;
      evidenceAt: string;
      proposal: { kbItemId: string; messageId: string; field: "password" | "network"; masked: string };
    };

/** Bu kiracının karar verilmiş öneri anahtarları (pencere içinde). */
export async function decidedSuggestionKeys(organizationId: string, since: Date): Promise<Set<string>> {
  const rows = await prisma.auditLog.findMany({
    where: { organizationId, action: { in: [SUGGESTION_APPROVED, SUGGESTION_DISMISSED] }, createdAt: { gte: since } },
    select: { metadataJson: true },
  });
  const keys = new Set<string>();
  for (const r of rows) {
    try {
      const k = (JSON.parse(r.metadataJson ?? "{}") as { key?: unknown }).key;
      if (typeof k === "string") keys.add(k);
    } catch {
      /* bozuk satır karar sayılmaz */
    }
  }
  return keys;
}

/** Otomatiğe geçiş ölçütü için kararlar (pencere içinde; metin yok). */
export async function suggestionDecisions(organizationId: string, since: Date): Promise<SuggestionDecision[]> {
  const rows = await prisma.auditLog.findMany({
    where: { organizationId, action: { in: [SUGGESTION_APPROVED, SUGGESTION_DISMISSED] }, createdAt: { gte: since } },
    select: { action: true, metadataJson: true, createdAt: true },
  });
  const out: SuggestionDecision[] = [];
  for (const r of rows) {
    try {
      const m = JSON.parse(r.metadataJson ?? "{}") as { kind?: unknown; edited?: unknown; auto?: unknown };
      if (m.kind !== "task" && m.kind !== "kb_wifi" && m.kind !== "commitment") continue;
      // Sistemin onaysız uyguladığı söz (kurucu 10-17 gece) ev sahibinin kararı DEĞİL — "otomatiğe geçiş" ölçütünü şişirmez.
      if (m.auto === true) continue;
      out.push({ kind: m.kind as SuggestionKind, decision: r.action === SUGGESTION_APPROVED ? "approved" : "dismissed", edited: m.edited === true, at: r.createdAt });
    } catch {
      /* atla */
    }
  }
  return out;
}

const fmtAt = (d: Date) => d.toISOString();

/** Gece yarısından sonra "yarın"ın belirsiz olduğu son dakika (05:00 hariç; `ai/date-resolution.ts` after_midnight_relative ile aynı aralık). */
const AFTER_MIDNIGHT_END_MIN = 5 * 60;

/**
 * Yalnız test: gece yarısı kuralını kapatır. Mesajlarını gerçek saatle yazan söz testleri (günlük sınır sayımı veritabanı saatine bakar)
 * İstanbul 00:00–04:59'da koşunca bu kurala çarpıp kırmızı oluyordu (gece-4: ölçüldü, 45 test). Kuralın kendi testi saati sabitler ve
 * kuralı AÇIK tutar; üretimde kimse değiştirmez.
 */
export const __afterMidnightRule: { enabled: boolean } = { enabled: true };

/** İşletme diliminde günün dakikası (QR'daki `nowMinutesInTz` ile aynı hesap). */
function nowMinutesInTz(now: Date, tz: string): number {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false })
    .format(now)
    .split(":")
    .map(Number);
  return ((h % 24) * 60 + m) % (24 * 60);
}

/** Kurucu T5: saati / günü / dilimi olmayan söz bu saatten sonra yazıldıysa ("Havlu getireceğim" 23:30) bugün 23:59 son an yüklenmez. */
const LATE_NIGHT_MIN = 22 * 60;
/** Bağlam penceresi: önceki en çok 3 mesaj, 12 saat içinde (gün yarısı ipucu); "şimdi" ipucu yalnız misafirin son 2 saatteki mesajından. */
const CONTEXT_MESSAGES = 3;
const CONTEXT_HALF_MS = 12 * 3_600_000;
const CONTEXT_NOW_MS = 2 * 3_600_000;

/**
 * KURUCU T5 (10-21, tablo AYNEN uygulanır): gün ve saat MESAJIN YAZILDIĞI ana ve işletmenin saat dilimine göre, konuşma bağlamıyla okunur —
 * senkronun çalıştığı ana göre değil. "Saat geçtiyse yarın" otomatik kuralı YOK (yanlış günü kesinleştirir):
 *  · Gün sözcüğü yok + saat / sabah-öğle dilimi mesaj yazıldığında geçmiş ("Teknisyen 10'da gelecek" 10:30'da) → yarına taşınmaz, kart günü sorar.
 *  · Saat öğleden önce mi sonra mı belli değil ("yarın 7'de" → 07:00 / 19:00): önceki mesajlar sabahı / akşamı söylüyorsa o; söylemiyorsa iki
 *    seçenek sorulur. Bugün için tek okuma ileride kalmışsa o ("7'de" 15:00'te → 19:00).
 *  · Saatsiz, günsüz söz gece 22:00'den sonra ("Havlu getireceğim" 23:30): misafir "şimdi / hemen" dediyse şimdiye bağlı; demediyse gün sorulur.
 */
function readInContext(
  p: HostPromise,
  messageAt: Date,
  tz: string,
  prior: { all: string[]; guestRecent: string[] },
): { promise: HostPromise; timeChoices: string[] | null } {
  const msgMin = nowMinutesInTz(messageAt, tz);
  const fmt = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  let q = p;
  let timeChoices: string[] | null = null;
  if (q.halfAmbiguous) {
    const hint = contextHalfHint(prior.all);
    if (hint) q = withHalf(q, hint);
    const oneUpcomingToday = q.day === "today" && q.timeCandidates.filter((m) => m > msgMin).length === 1;
    if (q.halfAmbiguous && !oneUpcomingToday) timeChoices = [...q.timeCandidates].sort((a, b) => a - b).map(fmt);
  }
  if (!hasPromiseTime(q) && msgMin >= LATE_NIGHT_MIN) q = contextSaysNow(prior.guestRecent) ? { ...q, soon: true } : { ...q, dayUnclear: true };
  if (!q.dayExplicit && q.day === "today" && q.inMinutes === null && !q.soon && timeChoices === null) {
    const w = promiseWindow(q, msgMin);
    const passed = w.day === "tomorrow" && (q.timeCandidates.length > 0 ? q.timeCandidates.every((m) => m <= msgMin) : q.cue !== null);
    if (passed) q = { ...q, dayUnclear: true };
  }
  return { promise: q, timeChoices };
}

/**
 * Sözün MUTLAK penceresi — mesajın YAZILDIĞI ana göre ("30 dakika içinde" = mesaj + 30 dk; "yarın" = mesajın ertesi günü). Onayda yeniden
 * üretilen öneri aynı ânı verir (Haiku 10-12). `dueAt`: açık saatte o an; gün dilimi / gün sözünde pencerenin SONU (kurucu 10-17: saat
 * uydurulmaz — yalnız gecikme hesabı). `dayKey`: sözün GÜNÜ (gösterim; gece yarısı / gece penceresi ertesi güne taşsa da gün aynı).
 */
function absolutePromiseWindow(p: HostPromise, messageAt: Date, tz: string): { dayKey: string; dueAt: Date; window: PromiseWindow } {
  const window = promiseWindow(p, nowMinutesInTz(messageAt, tz));
  const base = window.day === "tomorrow" ? addZonedDays(messageAt, 1, tz) : messageAt;
  const dayKey = dateKeyInTimeZone(base, tz);
  let [y, mo, d] = dayKey.split("-").map(Number);
  if (window.end >= 24 * 60) {
    const next = addZonedDays(zonedWallClockToUtc(y, mo, d, 12, 0, 0, tz), Math.floor(window.end / (24 * 60)), tz);
    [y, mo, d] = dateKeyInTimeZone(next, tz).split("-").map(Number);
  }
  const m = window.end % (24 * 60);
  return { dayKey, dueAt: zonedWallClockToUtc(y, mo, d, Math.floor(m / 60), m % 60, 0, tz), window };
}

/** Kayıtlı sözün GÜNÜ (işletme dilimi) — gece / gece yarısı dilimi ertesi güne taşan pencere sonundan bir gün geri. */
function commitmentDayKey(c: { dueAt: Date; duePrecision?: string | null; dayPart?: string | null }, tz: string): string {
  const spill = c.duePrecision === "part" && (c.dayPart === "night" || c.dayPart === "midnight");
  return dateKeyInTimeZone(spill ? addZonedDays(c.dueAt, -1, tz) : c.dueAt, tz);
}

/** Sözün penceresi VERİLEN günde (gün sözcüğü olmayan saat değişikliği — eski sözün günü, O4). Gün kaydırması yok. */
function windowOnDay(p: HostPromise, dayKey: string, tz: string): { dayKey: string; dueAt: Date; window: PromiseWindow } | null {
  const window = promiseWindow({ ...p, day: "today" }, -1);
  if (window.day !== "today") return null;
  let [y, mo, d] = dayKey.split("-").map(Number);
  if (window.end >= 24 * 60) {
    const next = addZonedDays(zonedWallClockToUtc(y, mo, d, 12, 0, 0, tz), Math.floor(window.end / (24 * 60)), tz);
    [y, mo, d] = dateKeyInTimeZone(next, tz).split("-").map(Number);
  }
  const m = window.end % (24 * 60);
  return { dayKey, dueAt: zonedWallClockToUtc(y, mo, d, Math.floor(m / 60), m % 60, 0, tz), window };
}

/** Sözün günü → ev sahibine gösterilen "bugün / yarın" (şimdiye göre); son an geçmişse ya da yarından sonraysa null (öneri yok). */
function relativeDayOf(dayKey: string, dueAt: Date, now: Date, tz: string): "today" | "tomorrow" | null {
  if (dueAt.getTime() < now.getTime() - 5 * 60_000) return null;
  return dayKey === dateKeyInTimeZone(now, tz) ? "today" : dayKey === dateKeyInTimeZone(addZonedDays(now, 1, tz), tz) ? "tomorrow" : null;
}

/** Kesinlik sırası (R1): saat > gün dilimi > yalnız gün. */
const PRECISION_RANK: Record<string, number> = { time: 3, part: 2, day: 1 };
/** Gün dilimlerinin BAŞI (dakika; sonları sözün pencere sonu) — yalnız "yeni pencere kayıtlı sözü kapsıyor mu" (R1) için. "Kısa süre" yok. */
const PART_START: Partial<Record<DayPartCode, number>> = {
  morning: 6 * 60,
  noon: 11 * 60,
  afternoon: 12 * 60,
  late_afternoon: 15 * 60,
  evening: 17 * 60,
  night: 20 * 60,
  midnight: 23 * 60,
};

/** Bir sözün mutlak penceresi [baş, son] (ms): saat → tek an; dilim → dilim başı..pencere sonu; gün → gece yarısı..pencere sonu. */
function windowSpan(dayKey: string, dueAt: Date, precision: string | null | undefined, dayPart: string | null | undefined, tz: string): [number, number] | null {
  if (precision === "time" || precision == null) return [dueAt.getTime(), dueAt.getTime()];
  const [y, mo, d] = dayKey.split("-").map(Number);
  if (precision === "part") {
    const start = PART_START[dayPart as DayPartCode];
    if (start === undefined) return null;
    return [zonedWallClockToUtc(y, mo, d, Math.floor(start / 60), start % 60, 0, tz).getTime(), dueAt.getTime()];
  }
  return [zonedWallClockToUtc(y, mo, d, 0, 0, 0, tz).getTime(), dueAt.getTime()];
}

/**
 * Bir konuşmanın A (görev) + C (söz) önerileri. A yalnız işletmenin otomatik görev anahtarı KAPALIYKEN (açıksa görev zaten kendiliğinden
 * açılıyor — öneri gereksiz); kaynak mesaja bağlı görev ya da aynı konuda (aynı gün anahtarı) AÇIK görev varsa öneri yok. C: aynı türde,
 * mesajdan sonra işaretlenmiş söz varsa; son an geçmişse ya da yarından sonraysa öneri yok. Sorgular toplu (mesaj başına sorgu yok).
 */
export async function getConversationSuggestions(
  organizationId: string,
  conversationId: string,
  now: Date = new Date(),
  /**
   * `only`: yalnız bu tür (Opus 10-17 gece O7): görünmeyen görev önerileri söz kartlarının 5 yerlik tavanını doldurmasın (otomatik kip, onay).
   * `limit`: öneri tavanı (varsayılan ekrandaki 5). Otomatik kip ve onaydaki yeniden üretim TAVANSIZ okur (Opus dilim sonu 3 A16: 5'ten çok
   * bekleyen söz varken en eskisi görünmüyor, yenisi önce kaydedilip eskisini gizliyordu). Öneri mesajlar arası bağımsızdır (yalnız kayıtlı
   * sözlere bakar) → tavan yalnız listeyi keser, tek önerinin içeriğini değiştirmez. Okunan mesaj yine en çok 50.
   */
  opts: { only?: "task" | "commitment"; limit?: number } = {},
): Promise<SuggestionView[]> {
  const cap = opts.limit ?? MAX_SUGGESTIONS;
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, property: { organizationId } },
    select: {
      id: true,
      propertyId: true,
      property: { select: { organization: { select: { timezone: true, autoTaskFromMessageEnabled: true, autoCommitmentsEnabled: true } } } },
    },
  });
  if (!conversation) return [];
  const since = new Date(now.getTime() - SUGGESTION_WINDOW_DAYS * 86_400_000);
  const [messages, decided, commitments] = await Promise.all([
    prisma.message.findMany({
      where: { conversationId: conversation.id, createdAt: { gte: since, lte: now } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
      select: { id: true, body: true, direction: true, authorType: true, senderName: true, systemEventType: true, createdAt: true, channelSenderRole: true },
    }),
    decidedSuggestionKeys(organizationId, since),
    prisma.guestCommitment.findMany({
      where: { conversationId: conversation.id, organizationId },
      select: {
        id: true,
        kind: true,
        topic: true,
        createdAt: true,
        dueAt: true,
        status: true,
        taskId: true,
        clientRequestId: true,
        duePrecision: true,
        dayPart: true,
        sourceMessageId: true,
        actor: true,
      },
    }),
  ]);
  const tz = orgTimezone(conversation.property.organization.timezone);
  const autoTask = conversation.property.organization.autoTaskFromMessageEnabled;
  // Ev sahibi "mesajlarımdan söz görevi oluşturulmasın" dediyse (Ayarlar, kurucu 10-17: "isterlerse kapatabilsinler") söz önerisi de çıkmaz —
  // YALNIZ otomatik söz anahtarı açıkken (kapalıyken ayar yüzeyde yok, bugünkü öneri akışı aynen).
  const commitmentsOff = hostCommitmentAutoEnabled() && !conversation.property.organization.autoCommitmentsEnabled;
  // Sözün KAYNAĞI (Opus 10-17 gece O19 / O1): kaynak mesajın zamanı ("bu mesajdan önce açılmış" kıyası kaydın değil sözün ânıyla — gecikmeli
  // gelen / kuyrukta bekleyen mesajda saat değişikliği gizlenmesin) ve sözü yapan (teknisyen gelecek ↔ ben getireceğim). Kaynak mesaj
  // pencerede değilse (eski / elle kayıt) kaydın zamanı ve "bilinmiyor".
  const msgById = new Map(messages.map((x) => [x.id, x]));
  const sourceAt = (c: (typeof commitments)[number]): number =>
    ((c.sourceMessageId ? msgById.get(c.sourceMessageId)?.createdAt : undefined) ?? c.createdAt).getTime();
  // Algılama mesaj başına BİR kez (Opus 10-17 gece-3 F15: her söz × her açık söz için yeniden koşuyordu — uzun mesajda yüzlerce ms).
  const promisesCache = new Map<string, HostPromise[]>();
  const promisesOf = (id: string, body: string): HostPromise[] => {
    let hit = promisesCache.get(id);
    if (!hit) {
      hit = detectHostPromises(body);
      promisesCache.set(id, hit);
    }
    return hit;
  };
  // Sözü YAPAN kayıttan okunur (migration 76) — kaynak mesaj yeniden algılanmaz (Opus gece-3 F5: algılayıcının çıktı SIRASINA bağlıydı, her
  // kural değişikliğinde kayıyordu). Yazma katmanı da yalnız bu kolona bakar → iki katman aynı karar.
  const actorOf = (c: (typeof commitments)[number]): HostPromise["actor"] => (c.actor === "visit" || c.actor === "delivery" ? c.actor : null);

  // A adayları + toplu görev denetimi (kaynağa bağlı görev · aynı gün anahtarlı açık görev).
  const taskCandidates = autoTask || opts.only === "commitment"
    ? []
    : messages
        .filter((m) => resolveMessageAuthor(m).authorType === "guest" && !decided.has(suggestionKey("task", m.id)))
        .flatMap((m) => {
          const detected = detectOperationalTask(m.body ?? "", { riskType: detectRiskType(m.body ?? "") });
          if (!detected) return [];
          const data = buildOperationalTaskData(detected, { propertyId: conversation.propertyId, message: m.body ?? "", now, timezone: tz });
          return [{ m, detected, dedupeKey: data.dedupeKey }];
        });
  const [linked, openSame] = taskCandidates.length
    ? await Promise.all([
        prisma.task.findMany({ where: { sourceMessageId: { in: taskCandidates.map((c) => c.m.id) }, property: { organizationId } }, select: { sourceMessageId: true } }),
        prisma.task.findMany({
          where: { dedupeKey: { in: taskCandidates.map((c) => c.dedupeKey) }, status: { not: "done" }, property: { organizationId } },
          select: { dedupeKey: true },
        }),
      ])
    : [[], []];
  const linkedIds = new Set(linked.map((t) => t.sourceMessageId));
  const openKeys = new Set(openSame.map((t) => t.dedupeKey));
  const taskByMessage = new Map(taskCandidates.filter((c) => !linkedIds.has(c.m.id) && !openKeys.has(c.dedupeKey)).map((c) => [c.m.id, c]));

  const out: SuggestionView[] = [];
  const seenTaskKeys = new Set<string>();
  // Kurucu T5 bağlamı: sözden ÖNCEKİ mesajlar (liste yeniden eskiye sıralı → sonraki indeksler daha eski).
  const indexOf = new Map(messages.map((x, i) => [x.id, i]));
  const priorOf = (m: (typeof messages)[number]) => {
    const i = indexOf.get(m.id) ?? messages.length;
    const older = messages.slice(i + 1, i + 1 + CONTEXT_MESSAGES).filter((x) => m.createdAt.getTime() - x.createdAt.getTime() <= CONTEXT_HALF_MS);
    return {
      all: older.map((x) => x.body ?? ""),
      guestRecent: older
        .filter((x) => resolveMessageAuthor(x).authorType === "guest" && m.createdAt.getTime() - x.createdAt.getTime() <= CONTEXT_NOW_MS)
        .map((x) => x.body ?? ""),
    };
  };
  for (const m of messages) {
    if (out.length >= cap) break;
    const author = resolveMessageAuthor(m).authorType;
    const cand = taskByMessage.get(m.id);
    if (cand) {
      if (seenTaskKeys.has(cand.dedupeKey)) continue; // aynı konuda iki mesaj → tek öneri (en yenisi)
      seenTaskKeys.add(cand.dedupeKey);
      const taskTitle = `${TASK_TYPE.label(cand.detected.type)}: ${cand.detected.topic}`.slice(0, 200);
      out.push({
        key: suggestionKey("task", m.id),
        kind: "task",
        title: `Görev aç: ${taskTitle}`,
        detail: cand.detected.priority === "urgent" ? "Misafirin mesajından — ACİL öncelik" : "Misafirin mesajından",
        evidenceAt: fmtAt(m.createdAt),
        proposal: { messageId: m.id, taskTitle, priority: cand.detected.priority },
      });
    } else if (author === "host" && !isChannelAutomation(m) && !commitmentsOff && opts.only !== "task") {
      // L5 (10-17): kanalın KENDİ otomatik mesajı ("Housekeeping will come tomorrow at 10" şablonu) ev sahibinin sözü DEĞİL.
      // Q1-b (kurucu 10-17, "ikisini de öner"): mesajdaki HER söz ayrı öneri. Anahtar `<mesaj>:<konum>` — konum sözün METİNDEKİ yeri
      // ("<cümlecik>-<parça>"; sert itirazcı gece-4 K1 / Opus gece-3 F5): süzgeç kuralları değişse de aynı söz aynı anahtar (çıktı SIRASI
      // kayınca "yok sayılan" söz başka söze geçiyordu) → listede ve onayda aynı anahtar.
      for (const detected of promisesOf(m.id, m.body ?? "")) {
        if (out.length >= cap) break;
        // 00:00–04:59 arasında yazılan "yarın" çoğu zaman aynı sabahtır (uyumamış birinin dili — `ai/date-resolution.ts` after_midnight
        // kuralı): gün tahmin edilmez, kendiliğinden kaydedilmez, kart günü sorar (gece-4 S1-02: görev bir gün geç açılıyordu).
        const afterMidnightTomorrow =
          __afterMidnightRule.enabled && detected.dayExplicit && detected.day === "tomorrow" && nowMinutesInTz(m.createdAt, tz) < AFTER_MIDNIGHT_END_MIN;
        const read = readInContext(afterMidnightTomorrow ? { ...detected, dayUnclear: true } : detected, m.createdAt, tz, priorOf(m));
        const promise = read.promise;
        const key = suggestionKey("commitment", `${m.id}:${promise.anchor}`);
        if (decided.has(key)) continue;
        // Mesajdan SONRA aynı türde ve UYUMLU konuda söz kaydedilmiş → öneri yok (I1: klima sözü musluk önerisini gizlemez). Saate BAKILMAZ
        // (bilinçli, Haiku 10-17 tartışıldı): ev sahibi mesajdan sonra sözü elle FARKLI saatle kaydettiyse (ya da saati sonraki öneriyle
        // değiştirdiyse) öneri onayı İKİNCİ söz + görev açardı. Bedeli: mesajdan sonra elle kaydedilen KONUSUZ söze konu yazılmaz (Q1 "a"
        // yalnız mesajdan ÖNCE kaydedilmiş söz için — kurucunun örneğindeki sıra).
        // AYNI mesajın başka bir önerisinden açılan söz bu kapıyı tetiklemez (Q1-b, Haiku 10-17: "Teknisyen 10:00 / Klima için usta 11:00"
        // — ilk onay ikinciyi gizliyordu); onun saati uyuşuyorsa aşağıdaki aynı-an kapısı yine gizler.
        const sibling = `sugg:${suggestionKey("commitment", m.id)}`;
        const isSibling = (c: (typeof commitments)[number]) => c.clientRequestId === sibling || Boolean(c.clientRequestId?.startsWith(`${sibling}:`));
        // Sözü YAPAN iki tarafta da biliniyor ve farklı (teknisyen gelecek ↔ ben getireceğim) → ayrı söz: ne gizler ne taşır (Opus O1;
        // Haiku 10-17 gece 2. tur: aynı an / sonraki söz kapısında da).
        const otherActor = (c: (typeof commitments)[number]) => {
          const a = actorOf(c);
          return a !== null && promise.actor !== null && a !== promise.actor;
        };
        if (
          commitments.some(
            (c) =>
              c.kind === promise.kind &&
              commitmentTopicsCompatible(c.topic, promise.topic) &&
              sourceAt(c) >= m.createdAt.getTime() &&
              !isSibling(c) &&
              !otherActor(c),
          )
        ) {
          continue;
        }
        let { dayKey, dueAt, window } = absolutePromiseWindow(promise, m.createdAt, tz);
        // Aynı söz = aynı tür + aynı an + aynı KESİNLİK ("Havlu getireceğim" günü ile "Akşam havlu getireceğim" aynı 23:59'da biter ama ayrı
        // sözdür — Opus 10-17 gece O20).
        const slotOf = () => ({
          kind: promise.kind,
          dueAt,
          topic: promise.topic,
          duePrecision: window.precision,
          dayPart: window.precision === "part" ? window.dayPart : null,
        });
        // Aynı tür + aynı an için öneriyi TAMAMEN karşılayan AÇIK söz zaten varsa (mesajdan ÖNCE elle açılmış ya da ev sahibi aynı sözü sonraki
        // mesajda tekrarlamış) öneri gösterilmez — onay hiçbir şey değiştirmezdi ve öneri yenilemede geri gelirdi: ölü "Onayla" düğmesi (Opus
        // 10-15 B1). Konusuz elle söz + KONULU öneri gösterilir: onay söze konu yazar (kurucu Q1 "a", `commitmentSlotAbsorbs`).
        // `taskId` dolu: onayın bağlanabildiği küme ile BİREBİR (`createGuestCommitment` görevsiz söze bağlanmaz — Haiku 10-17).
        const slotPeers = commitments.filter((c) => c.status === "open" && c.taskId !== null && commitmentSlotAbsorbs(c, slotOf()));
        // Aynı andaki BAŞKA yapanın sözü bu öneriyi gizlemez; onayda yazma katmanı da ona birleşmez (yapan kayıtta, kilit içinde).
        const absorbing = slotPeers.filter((c) => !otherActor(c));
        // Q1-b (kurucu 10-17): KONUSUZ öneri aynı saatte İKİ ya da daha çok FARKLI konulu söze uyuyorsa hangisi olduğu belli değil → öneri
        // gösterilir, onayda "hangi söze bağlansın?" sorulur (ya da yeni söz). Tek söze uyuyorsa bugünkü gibi gizlenir.
        const attachTopics = promise.topic === null ? [...new Set(absorbing.map((c) => c.topic).filter(isCommitmentTopic))].sort() : [];
        // Aynı saatte KONUSUZ açık söz varsa konusuz öneri birebir ona uyar → seçim gereksiz, gizli (Opus 10-17 Q1b-A: "yeni söz" seçimi
        // gereksiz ikinci görev açıyordu).
        if (absorbing.length > 0 && (attachTopics.length < 2 || absorbing.some((c) => c.topic === null))) continue;
        // BAĞLAM (kurucu 10-17 gece: "aynı görevin saati güncellensin ama aynı görevden bahsedildiği bağlamdan anlaşılsın — başka bir şeyi
        // değiştirmemeli"): bu mesajdan ÖNCE verilmiş, aynı türde, AÇIK, başka bir an / kesinlikteki söz. Kesin eşleşme → saat güncellemesi;
        // belirsiz → seçim kartı (kendiliğinden ne değiştirir ne ikinci görev açar); FARKLI yapan (teknisyen gelecek ↔ ben getireceğim) →
        // ayrı söz (Opus O1: "Klima kumandasının pilini akşam getireceğim" teknisyen sözünü taşımamalı).
        //  · KESİN: tek aday ∧ (saat değişikliği sözcüğü ("11'e kaydı") ∨ (aynı konu ∧ yapan İKİ tarafta da bilinen ve aynı)).
        //  · SEÇİM: aynı konulu aday(lar) yapanı bilinmiyor / birden çok · konulu söz + konusuz eski söz (O8) · konusuz sözcüksüz yeni saat.
        const earlier = commitments.filter(
          (c) =>
            c.status === "open" &&
            c.taskId !== null &&
            c.kind === promise.kind &&
            sourceAt(c) < m.createdAt.getTime() &&
            !commitmentSlotSame(c, slotOf()) &&
            !isSibling(c),
        );
        const relevant = (promise.topic !== null ? earlier.filter((c) => c.topic === promise.topic) : earlier).filter((c) => !otherActor(c));
        // Kendi ZAMANI olmayan söz ("Evet, klima için teknisyen gelecek, merak etmeyin") yeni bir an söylemez: önceden açılmış uyumlu söz
        // (aynı tür, uyumlu konu, uyumlu yapan) varsa TEKRARDIR — öneri yok; taşıma adayı hiç olamaz → kayıtlı saat / dilim asla "gün"e
        // düşürülmez (Opus 10-17 gece-3 F3: aynı gün kesin eşleşme sayılıp 15:00'ı siliyordu).
        const timeless = !hasPromiseTime(promise);
        if (timeless && earlier.some((c) => commitmentTopicsCompatible(c.topic, promise.topic) && !otherActor(c))) continue;
        // R1 (sert itirazcı 10-17 gece-4): yeni pencere kayıtlı uyumlu sözü KAPSIYORSA ("Evet, klima için teknisyen yarın gelecek" ↔ kayıtlı
        // yarın 15:00; "öğleden sonra gelecek" ↔ bugün 15:00) aynı sözün tekrarıdır — öneri yok; kayıtlı saat asla "gün"e düşürülmez.
        const span = windowSpan(dayKey, dueAt, window.precision, window.precision === "part" ? window.dayPart : null, tz);
        if (
          span !== null &&
          !promise.dayUnclear && // gün tahmin; tahmini güne göre "tekrar" denmez (Opus gece-4 F10)
          window.precision !== "time" &&
          earlier.some((c) => {
            if (!commitmentTopicsCompatible(c.topic, promise.topic) || otherActor(c)) return false;
            if ((PRECISION_RANK[c.duePrecision ?? "time"] ?? 3) < PRECISION_RANK[window.precision]!) return false;
            const stored = windowSpan(commitmentDayKey(c, tz), c.dueAt, c.duePrecision, c.dayPart, tz);
            return stored !== null && span[0] <= stored[0] && stored[1] <= span[1];
          })
        )
          continue;
        let certain: (typeof commitments)[number] | null = null;
        if (relevant.length === 1 && !timeless) {
          const c = relevant[0]!;
          if (promise.reschedule) certain = c;
          // Saat değişikliği sözcüğü yok + gün sözcüğü yok ("Klima için teknisyen 11'de gelecek") → yeni saat hangi güne? Eski söz mesajın
          // kendi günündeyse tek okuma o gün; başka günse (yarın 10:00) kart sorar — kendiliğinden bugüne taşımaz (Haiku 10-17 gece 2. tur).
          else if (
            promise.topic !== null &&
            promise.actor !== null &&
            actorOf(c) === promise.actor &&
            (promise.dayExplicit || promise.inMinutes !== null || commitmentDayKey(c, tz) === dayKey)
          )
            certain = c;
        }
        const moveCandidates = certain
          ? []
          : relevant.length > 0
            ? relevant
            : promise.topic !== null
              ? earlier.filter((c) => c.topic === null && !otherActor(c))
              : [];
        // F11: her seçeneğin TAŞINACAĞI an — sözün kendi günü yoksa hedef sözün günü (O4 ile aynı kural); geçmişte kalan seçenek sunulmaz.
        // Şimdiye bağlı söz ("birazdan", "30 dakika içinde") hedef sözün gününe kaymaz (Opus gece-4 F8). Hedef gündeki an geçmişse seçenek
        // DÜŞMEZ, sözün kendi anına taşır (Opus gece-4 F7: seçenek elenince belirsiz durum otomatik İKİNCİ söze dönüyordu).
        const ownWin = { dayKey, dueAt, window };
        const anchoredNow = promise.dayExplicit || promise.inMinutes !== null || promise.soon;
        const moveChoices = moveCandidates.flatMap((c) => {
          const preferred = anchoredNow ? ownWin : (windowOnDay(promise, commitmentDayKey(c, tz), tz) ?? ownWin);
          for (const target of preferred === ownWin ? [ownWin] : [preferred, ownWin]) {
            const tday = relativeDayOf(target.dayKey, target.dueAt, now, tz);
            if (tday) return [{ c, target, tday }];
          }
          return [];
        });
        // Gün sözcüğü olmayan saat değişikliği ("Teknisyen 11'e kaydı") eski sözün GÜNÜNE uygulanır (Opus O4: bugüne kayıyordu).
        if (certain && promise.reschedule && !promise.dayExplicit && promise.inMinutes === null && !promise.soon) {
          const onDay = windowOnDay(promise, commitmentDayKey(certain, tz), tz);
          if (onDay) ({ dayKey, dueAt, window } = onDay);
        }
        // Gün belirsiz kart (D3) tahmini "bugün" anı geçince kaybolmaz — yarın okuması hâlâ ileride ise kart kalır (Opus gece-4 F10).
        if (promise.dayUnclear && !relativeDayOf(dayKey, dueAt, now, tz)) {
          const alt = absolutePromiseWindow({ ...promise, day: "tomorrow" }, m.createdAt, tz);
          if (relativeDayOf(alt.dayKey, alt.dueAt, now, tz)) ({ dayKey, dueAt, window } = alt);
        }
        // Kurucu T5: açık "bugün" + mesaj YAZILDIĞINDA geçmiş saat → gizlenmez, aynı gün boyunca kart olarak görünür (kendiliğinden kaydedilmez).
        const pastDue =
          promise.dayExplicit &&
          promise.day === "today" &&
          window.precision === "time" &&
          dueAt.getTime() < m.createdAt.getTime() - 5 * 60_000 &&
          dayKey === dateKeyInTimeZone(now, tz);
        const day = pastDue ? "today" : relativeDayOf(dayKey, dueAt, now, tz);
        if (!day) continue;
        // Gün sözcüğü olmayan saat değişikliği eski sözün gününe uygulandıysa gün bellidir (↑ O4). Değişikliğin bağlanacağı söz YOKSA
        // ("Teknisyen 11'e kaydı." önceki kayıt olmadan) hangi günün saati değişti bilinmez → kart günü sorar (Haiku gece-4: bugüne açılıyordu).
        const orphanReschedule = promise.reschedule && !promise.dayExplicit && certain === null && moveChoices.length === 0;
        const dayUnclear = orphanReschedule || (promise.dayUnclear && !(certain && promise.reschedule && !promise.dayExplicit));
        const whenFull = commitmentWhenText(day, window);
        const whenNoDay = whenFull.replace(/^(?:bugün|yarın),?\s*/u, "");
        const when = !dayUnclear ? whenFull : whenNoDay === "(saat belirtilmedi)" ? "gün ve saat belirtilmedi" : `gün belirtilmedi, ${whenNoDay}`;
        const baseProposal = {
          messageId: m.id,
          commitmentKind: promise.kind,
          topic: promise.topic,
          day,
          time: window.precision === "time" && !read.timeChoices ? window.time : "",
          precision: window.precision,
          ...(window.precision === "part" ? { dayPart: window.dayPart } : {}),
          dueAt: dueAt.toISOString(),
          dayKey,
          // Mesajda birden çok saat var — kendiliğinden kaydedilmez, ev sahibi saati seçer (O9).
          ...(promise.timeAmbiguous || read.timeChoices ? { timeAmbiguous: true as const } : {}),
          ...(read.timeChoices ? { timeChoices: read.timeChoices } : {}),
          ...(promise.tentative ? { tentative: true as const } : {}),
          ...(pastDue ? { pastDue: true as const } : {}),
          ...(dayUnclear ? { dayUnclear: true as const } : {}),
          actor: promise.actor,
        };
        const describe = (c: (typeof commitments)[number]) =>
          `${commitmentLabel(c.kind as CommitmentKind, c.topic)} — ${storedCommitmentWhen(c, now, tz)}`;
        // Kesin taşıma kesinliği düşürüyorsa (kayıtlı saat → yalnız gün / dilim) kendiliğinden uygulanmaz (R1).
        const lowersPrecision = certain !== null && (PRECISION_RANK[window.precision] ?? 3) < (PRECISION_RANK[certain.duePrecision ?? "time"] ?? 3);
        if (certain) {
          out.push({
            key,
            kind: "commitment",
            title: `Söz saatini güncelle: ${commitmentLabel(promise.kind, promise.topic ?? certain.topic)} — ${storedCommitmentWhen(certain, now, tz)} → ${when}`,
            detail: "Mesajınızda aynı sözün yeni saati var — görev ve söz yeni saate taşınır, yeni görev açılmaz",
            evidenceAt: fmtAt(m.createdAt),
            proposal: { ...baseProposal, reschedule: { commitmentId: certain.id }, ...(lowersPrecision ? { lowersPrecision: true as const } : {}) },
          });
          continue;
        }
        out.push({
          key,
          kind: "commitment",
          title: `Söz kaydet: ${commitmentLabel(promise.kind, promise.topic)} — ${when}`,
          detail:
            moveChoices.length > 0
              ? "Aynı türde açık söz var — bu onun yeni saati mi, ayrı bir söz mü?"
              : attachTopics.length >= 2
                ? `Aynı saatte kayıtlı sözler var (${attachTopics.map((t) => COMMITMENT_TOPIC_LABELS[t]).join(", ")}) — hangisine bağlanacağını seçin`
                : pastDue
                  ? "Mesajınızdaki saat yazıldığı anda geçmişti — saati düzeltin ya da yok sayın"
                  : dayUnclear
                    ? "Mesajınızda sözün günü belli değil — günü seçin"
                    : read.timeChoices
                      ? `Saat sabah mı akşam mı belli değil (${read.timeChoices.join(" / ")}) — saati seçin`
                      : promise.timeAmbiguous
                        ? "Sözün saati mesajdan net anlaşılmadı — saati seçin"
                        : promise.tentative
                          ? "Kesin söz değil (mesajda belirsizlik var) — kesinse onaylayın, söz + görev açılır"
                          : "Misafire yazdığınız mesajdan — açık söz + görev açılır",
          evidenceAt: fmtAt(m.createdAt),
          proposal: {
            ...baseProposal,
            ...(moveChoices.length > 0
              ? {
                  moveOptions: moveChoices.map(({ c, target, tday }) => ({
                    commitmentId: c.id,
                    label: `${describe(c)} → ${commitmentWhenText(tday, target.window)}`,
                    day: tday,
                    time: target.window.precision === "time" ? target.window.time : "",
                    precision: target.window.precision,
                    ...(target.window.precision === "part" ? { dayPart: target.window.dayPart } : {}),
                    dueAt: target.dueAt.toISOString(),
                    dayKey: target.dayKey,
                  })),
                }
              : attachTopics.length >= 2
                ? { attachTopics }
                : {}),
          },
        });
      }
    }
  }
  return out;
}

/** Wi-Fi düzeltme penceresi (gün) — ev sahibinin yeni şifreyi yazdığı mesaj bundan eski olmamalı. */
const WIFI_WINDOW_DAYS = 14;

/**
 * Bir mülkün B (Wi-Fi) önerileri: ev sahibinin misafire yazdığı şifre / ağ adı bilgi tabanının Wi-Fi kaleminde GEÇMİYORSA → "bilgi
 * tabanını güncelle". Alan başına yalnız EN YENİ değer. HEDEF BELİRSİZSE öneri YOK (Haiku 10-12): birden çok Wi-Fi kalemi (ana / misafir
 * ağı) ya da kalemde o alan için birden çok değer. Kalemin son düzenlemesinden ÖNCEKİ mesaj öneri üretmez. Anahtar mesaja bağlı (`kb_wifi:<mesaj>:<alan>`) — hedef kalem değişse de "yok say" kalır.
 */
export async function getPropertyWifiSuggestions(organizationId: string, propertyId: string, now: Date = new Date()): Promise<SuggestionView[]> {
  const kbItems = await prisma.knowledgeBaseItem.findMany({
    where: { propertyId, property: { organizationId }, category: "wifi", isActive: true },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    select: { id: true, content: true, updatedAt: true },
  });
  if (kbItems.length !== 1) return [];
  const target = kbItems[0];
  const since = new Date(now.getTime() - WIFI_WINDOW_DAYS * 86_400_000);
  // Kalem mesajdan SONRA düzenlendiyse mesajdaki değer bayat sayılır (ev sahibi kalemi o mesajı gördükten sonra elle güncellemiş olabilir —
  // eski şifre yenisinin üstüne yazılmasın; Haiku 10-12 2. tur). Yalnız kalemin son düzenlemesinden SONRAKİ mesajlar.
  const after = target.updatedAt.getTime() > since.getTime() ? target.updatedAt : since;
  const [messages, decided] = await Promise.all([
    prisma.message.findMany({
      where: { conversation: { propertyId, property: { organizationId } }, direction: "outbound", createdAt: { gt: after, lte: now } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 200,
      select: { id: true, body: true, direction: true, authorType: true, senderName: true, systemEventType: true, createdAt: true, channelSenderRole: true },
    }),
    decidedSuggestionKeys(organizationId, since),
  ]);
  const out: SuggestionView[] = [];
  const seenField = new Set<string>();
  for (const m of messages) {
    // L5 (10-17): kanalın KENDİ şablonundaki Wi-Fi değeri ev sahibinin yeni yazdığı değer değildir (şablon eski şifreyi taşıyabilir).
    if (resolveMessageAuthor(m).authorType !== "host" || isChannelAutomation(m)) continue;
    const values = extractWifiValues(m.body);
    for (const field of ["password", "network"] as const) {
      const value = values[field];
      if (!value || seenField.has(field)) continue;
      seenField.add(field); // alan başına en yeni değer (daha eskisi önerilmez)
      if (kbContainsValue(target.content, value, field === "password")) continue;
      // Kalemde hedef belirsiz (iki değer / okunamayan etiket) ya da eski değer metinde birden çok yerde → hangisi? öneri yok.
      if (wifiTargetAmbiguous(target.content, field) || applyWifiValue(target.content, field, value) === null) continue;
      const key = suggestionKey("kb_wifi", `${m.id}:${field}`);
      if (decided.has(key)) continue;
      out.push({
        key,
        kind: "kb_wifi",
        title: field === "password" ? "Bilgi tabanındaki Wi-Fi şifresini güncelle" : "Bilgi tabanındaki Wi-Fi ağ adını güncelle",
        detail: `Misafire yazdığınız değer (${field === "password" ? maskSecret(value) : value}) bilgi tabanında yok`,
        evidenceAt: fmtAt(m.createdAt),
        proposal: { kbItemId: target.id, messageId: m.id, field, masked: field === "password" ? maskSecret(value) : value },
      });
    }
    if (seenField.size === 2 || out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}
