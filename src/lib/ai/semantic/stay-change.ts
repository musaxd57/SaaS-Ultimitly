/* ---------------------------------------------------------------------------
 * KONAKLAMA DEĞİŞİKLİĞİ — ANLAM KATMANININ ORTAK SÖZLEŞMESİ (09-24, kurucu düzeltmesi).
 *
 * 🚨 NEDEN (ölçüldü): müsaitlik vetosu kelime kalıplarıyla kurulmuştu ve görmediği cümlelerde
 * çöktü — kör bataryada (326 cevap / 268 misafir mesajı, uygulamayı görmeyen ajan) izinlerin
 * 19/60'ı, isteklerin %62'si yakalandı. İnsan dili kalıpla kapatılamaz; kalıp eklemek görülen
 * bataryaya aşırı uyum (overfitting) üretir. Büyük sistemlerin yolu: ANLAMI model çıkarır ve
 * KAPALI bir şemaya doldurur, KARARI kod verir. Bu modül o şemanın tek kaynağıdır.
 *
 * ── KATMANLAR (hepsi YALNIZ SIKILAŞTIRIR, hiçbiri gönderim YETKİSİ vermez) ─────────────────────
 *  1. Cevap modelinin BEYANI (`stayChangeAsked` + `replyStance`, ana JSON'da, ek çağrı YOK):
 *     model kendi cevabını etiketler. İzin/takvim duruşu beyanı VARSAYILAN zorlanır; istek bacağı
 *     `AI_STAY_POLICY=enforce` ile (varsayılan gölge: kanıta yazılır, karar vermez).
 *  2. BAĞIMSIZ BEKÇİ (`guard.ts`, bayrak `AI_STAY_GUARD_ENABLED`, varsayılan kapalı): ikinci bir
 *     model taslağı okur — üreticiyi kandıran bir enjeksiyonun bekçiyi de kandırması gerekir.
 *  3. ANLAMA KATMANI (`understand.ts`, bayrak `AI_UNDERSTANDING_ENABLED`): misafir mesajını niyet +
 *     arama sorgusu + istek yuvalarına çevirir (sorgu yeniden yazma / çoklu sorgu).
 *  4. DETERMİNİSTİK YEDEK (`availability-claims.ts`): model yokken / arızadayken de çalışan dar
 *     kelime ağı. BÜYÜTÜLMEZ (ölçülmüş sınırıyla belgeli).
 *
 * SAAT KIYASI KODDADIR: model istenen saati ÇIKARIR ("HH:MM"), mülkün standart saatiyle
 * karşılaştırmayı kod yapar (`isEarlierThan` / `isLaterThan`) — model aritmetiğine güvenilmez.
 *
 * SAF: DB yok, ağ yok, `server-only` yok.
 * ------------------------------------------------------------------------- */

/** Misafirin talep ettiği, TAKVİME BAĞLI değişiklik türü. */
export const STAY_CHANGE_KINDS = [
  "none",
  "extend",
  "early_checkin",
  "late_checkout",
  "date_change",
  "availability",
] as const;
export type StayChangeKind = (typeof STAY_CHANGE_KINDS)[number];

/** Cevabın konaklama değişikliği / müsaitlik konusundaki DURUŞU. */
export const REPLY_STANCES = ["none", "defers", "grants", "states_calendar", "refuses"] as const;
export type ReplyStance = (typeof REPLY_STANCES)[number];

/** Beyan: alan geldi ama kapalı kümede değilse `unknown` (tanınmayan ≠ temiz; F01 ilkesi). */
export interface StayChangeDeclaration {
  asked: StayChangeKind | "unknown";
  stance: ReplyStance | "unknown";
}

function member<T extends string>(set: readonly T[], v: unknown): v is T {
  return typeof v === "string" && (set as readonly string[]).includes(v);
}

/**
 * Cevap modelinin iki alanını STRICT çözer.
 *  · İkisi de YOK → `null` (model alanı hiç üretmedi = SİNYAL YOK; diğer katmanlar çalışır).
 *  · Biri var ama kapalı kümede değil → o alan `unknown` (coercion YOK, büyük/küçük harf esnetilmez).
 */
export function parseStayChangeDeclaration(asked: unknown, stance: unknown): StayChangeDeclaration | null {
  if (asked === undefined && stance === undefined) return null;
  return {
    asked: member(STAY_CHANGE_KINDS, asked) ? asked : "unknown",
    stance: member(REPLY_STANCES, stance) ? stance : "unknown",
  };
}

/** Beyan edilen duruş takvim iddiası ya da izin mi (varsayılan ZORLANIR). */
export function declaredClaim(d: StayChangeDeclaration | null | undefined): boolean {
  return d != null && (d.stance === "grants" || d.stance === "states_calendar");
}

/** Beyan edilen misafir isteği (bilinmeyen de istek sayılır — tanınmayan ≠ temiz). */
export function declaredRequest(d: StayChangeDeclaration | null | undefined): boolean {
  return d != null && d.asked !== "none";
}

// ─── saat ───────────────────────────────────────────────────────────────────

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "HH:MM" → gün içi dakika; biçim dışı → null (şema zaten zorlar, burada da doğrulanır). */
export function hhmmToMinutes(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = HHMM.exec(v.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Mülkün standart saatleri (şemada zorunlu, varsayılan 15:00 / 11:00). */
export interface StayTimes {
  checkIn?: string | null;
  checkOut?: string | null;
}

/** İstenen GİRİŞ saati standarttan ÖNCE mi? Saatlerden biri çözülemezse `null` (bilinmiyor). */
export function isEarlierThanCheckIn(requested: unknown, stay: StayTimes | null | undefined): boolean | null {
  const r = hhmmToMinutes(requested);
  const s = hhmmToMinutes(stay?.checkIn);
  return r === null || s === null ? null : r < s;
}

/** İstenen ÇIKIŞ saati standarttan SONRA mı? Saatlerden biri çözülemezse `null`. */
export function isLaterThanCheckOut(requested: unknown, stay: StayTimes | null | undefined): boolean | null {
  const r = hhmmToMinutes(requested);
  const s = hhmmToMinutes(stay?.checkOut);
  return r === null || s === null ? null : r > s;
}

// ─── bağımsız bekçi (ikinci model) sözleşmesi ───────────────────────────────

/**
 * OpenAI Structured Outputs şeması (`response_format: json_schema`, `strict: true`): model bu
 * şemanın DIŞINDA çıktı üretemez (enum/boolean sağlayıcıda zorlanır). Yine de çıktı kodda ayrıca
 * doğrulanır (`parseStayGuardVerdict`) — sağlayıcı garantisi tek başına güvenlik kanıtı değildir.
 * Saat alanlarında `pattern` KULLANILMAZ (strict alt küme sınırları); biçim kodda denetlenir.
 */
export const STAY_GUARD_JSON_SCHEMA = {
  name: "stay_change_guard",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "guest_requests_change",
      "kind",
      "requested_checkin_time",
      "requested_checkout_time",
      "reply_states_calendar",
      "reply_grants_change",
      "reply_defers_to_host",
      "reply_refuses",
    ],
    properties: {
      guest_requests_change: { type: "boolean" },
      kind: { type: "string", enum: [...STAY_CHANGE_KINDS] },
      requested_checkin_time: { type: ["string", "null"] },
      requested_checkout_time: { type: ["string", "null"] },
      reply_states_calendar: { type: "boolean" },
      reply_grants_change: { type: "boolean" },
      reply_defers_to_host: { type: "boolean" },
      reply_refuses: { type: "boolean" },
    },
  },
} as const;

export interface StayGuardVerdict {
  guestRequestsChange: boolean;
  kind: StayChangeKind;
  /** "HH:MM" ya da null — biçim dışı değer null'a düşer (yuva yardımcıdır, karar değil). */
  requestedCheckinTime: string | null;
  requestedCheckoutTime: string | null;
  replyStatesCalendar: boolean;
  replyGrantsChange: boolean;
  replyDefersToHost: boolean;
  replyRefuses: boolean;
}

/** Bekçinin sonucu: koşmadı (bayrak kapalı / aday değil) ≠ koştu ama başarısız. */
export type StayGuardOutcome = { status: "ok"; verdict: StayGuardVerdict } | { status: "failed" };

function hhmmOrNull(v: unknown): string | null {
  return hhmmToMinutes(v) === null ? null : (v as string).trim();
}

/**
 * Bekçi çıktısını STRICT çözer. Herhangi bir boolean alan boolean değilse ya da `kind` kapalı
 * kümede değilse → `null` (= bekçi BAŞARISIZ sayılır; çağıran `{status:"failed"}` yazar).
 */
export function parseStayGuardVerdict(raw: unknown): StayGuardVerdict | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const bools = [
    "guest_requests_change",
    "reply_states_calendar",
    "reply_grants_change",
    "reply_defers_to_host",
    "reply_refuses",
  ] as const;
  if (!bools.every((k) => typeof r[k] === "boolean")) return null;
  if (!member(STAY_CHANGE_KINDS, r.kind)) return null;
  return {
    guestRequestsChange: r.guest_requests_change as boolean,
    kind: r.kind,
    requestedCheckinTime: hhmmOrNull(r.requested_checkin_time),
    requestedCheckoutTime: hhmmOrNull(r.requested_checkout_time),
    replyStatesCalendar: r.reply_states_calendar as boolean,
    replyGrantsChange: r.reply_grants_change as boolean,
    replyDefersToHost: r.reply_defers_to_host as boolean,
    replyRefuses: r.reply_refuses as boolean,
  };
}

/**
 * Model yuvasındaki saat mülkün standart saatine göre bir DEĞİŞİKLİK mi (KODDA kıyas)? Model
 * `guestRequestsChange:false` dese bile istenen giriş saati standarttan önceyse ya da çıkış saati
 * sonraysa istek sayılır — iki kaynaktan biri yeter (yalnız sıkılaştırır).
 */
export function slotTimesShifted(
  slots: { checkinTime?: string | null; checkoutTime?: string | null } | null | undefined,
  stay: StayTimes | null | undefined,
): boolean {
  if (!slots) return false;
  return isEarlierThanCheckIn(slots.checkinTime, stay) === true || isLaterThanCheckOut(slots.checkoutTime, stay) === true;
}

/** Anlama katmanının (`understand.ts`) politikaya verdiği konaklama sinyali. */
export interface UnderstandingStaySignal {
  requested: boolean;
  kind: StayChangeKind;
  checkinTime: string | null;
  checkoutTime: string | null;
}

// ─── politika kipi ──────────────────────────────────────────────────────────

export type StayPolicyMode = "shadow" | "enforce";

/**
 * Modelden türeyen İSTEK sinyallerinin (beyan, anlama katmanı) kipi. Varsayılan `shadow`: kanıta
 * yazılır, karar vermez — gerçek model eval'i (`evals/stay-change.json`) koşulmadan zorlanmaz
 * (Türkçe/İngilizce dışı erteleme cümleleri deterministik katmanda tanınmıyor → erken zorlamak
 * doğru cevapları taslağa düşürürdü). Yalnız tam `enforce` değeri açar; gevşek yazım açmaz.
 */
export function stayPolicyMode(): StayPolicyMode {
  return process.env.AI_STAY_POLICY?.trim() === "enforce" ? "enforce" : "shadow";
}
