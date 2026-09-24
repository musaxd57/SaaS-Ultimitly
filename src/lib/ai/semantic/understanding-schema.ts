/* ---------------------------------------------------------------------------
 * ANLAMA KATMANI — ŞEMA (saf; DB/ağ yok). Misafir mesajı → kapalı niyet kümesi + her soru için
 * bağımsız (geçmişle çözülmüş) arama sorgusu + konaklama değişikliği yuvaları.
 *
 * Kurucu sorusu (09-24): "cümlenin anlamına ve amacına bakıyor muyuz?" — "Giriş saati kaç?",
 * "Sana kaçta gelebiliriz?", "Anahtarı ne zaman alabiliyoruz?" aynı niyettir (checkin_time); bunu
 * kelime kuralıyla değil modelin ANLAMA adımıyla yakalarız ve çıktıyı bu şemaya zorlarız. Kod şemayı
 * AYRICA doğrular (sağlayıcı garantisi tek başına kanıt değildir).
 *
 * KULLANIM (yalnız ekler, hiçbir şeyi daraltmaz ya da yetkilendirmez):
 *  · retrieval: sorgular deterministik alt sorgulara BİRLEŞİM olarak eklenir (Türkçe sorgu, Türkçe
 *    bilgi tabanında Almanca soruyu da buldurur; "Peki ya köpek?" geçmişle çözülür);
 *  · konaklama politikası: `stay` istek sinyali (`AI_STAY_POLICY=enforce` ile karar verir);
 *  · kanıt: niyet etiketleri (kapalı küme, PII yok).
 * ------------------------------------------------------------------------- */

import { STAY_CHANGE_KINDS, normalizeHhmm, type UnderstandingStaySignal } from "./stay-change";

/** Kapalı niyet kümesi — yönlendirme, arama ve analitik için ETİKET; karar vermez. */
export const UNDERSTANDING_INTENTS = [
  "checkin_time",
  "checkout_time",
  "early_checkin",
  "late_checkout",
  "extend_stay",
  "date_change",
  "availability",
  "luggage",
  "access_keys",
  "wifi",
  "parking",
  "directions_transport",
  "amenities",
  "appliance_help",
  "house_rules",
  "pets",
  "cleaning_linen",
  "trash",
  "local_recommendations",
  "payment_invoice",
  "cancellation_refund",
  "complaint_issue",
  "emergency",
  "human_request",
  "greeting_thanks",
  "other",
] as const;
export type UnderstandingIntent = (typeof UNDERSTANDING_INTENTS)[number];

export const UNDERSTANDING_LANGUAGES = ["tr", "en", "de", "fr", "es", "ru", "ar", "other"] as const;

/** Tek mesajdan en fazla bu kadar istek (şemada `maxItems` yok — strict alt küme; kodda kesilir). */
export const MAX_UNDERSTOOD_REQUESTS = 5;
/** Sorgu tavanı (karakter). */
export const UNDERSTOOD_QUERY_MAX_CHARS = 160;

export const UNDERSTANDING_JSON_SCHEMA = {
  name: "guest_message_understanding",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["language", "requests", "stay_change"],
    properties: {
      language: { type: "string", enum: [...UNDERSTANDING_LANGUAGES] },
      requests: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["intent", "query_tr", "query_original"],
          properties: {
            intent: { type: "string", enum: [...UNDERSTANDING_INTENTS] },
            query_tr: { type: "string" },
            query_original: { type: "string" },
          },
        },
      },
      stay_change: {
        type: "object",
        additionalProperties: false,
        required: ["requested", "kind", "checkin_time", "checkout_time"],
        properties: {
          requested: { type: "boolean" },
          kind: { type: "string", enum: [...STAY_CHANGE_KINDS] },
          checkin_time: { type: ["string", "null"] },
          checkout_time: { type: ["string", "null"] },
        },
      },
    },
  },
} as const;

export interface UnderstoodRequest {
  intent: UnderstandingIntent;
  queryTr: string;
  queryOriginal: string;
}

export interface MessageUnderstanding {
  language: (typeof UNDERSTANDING_LANGUAGES)[number];
  requests: UnderstoodRequest[];
  stay: UnderstandingStaySignal;
}

function member<T extends string>(set: readonly T[], v: unknown): v is T {
  return typeof v === "string" && (set as readonly string[]).includes(v);
}

/** Sorgu metni: boşluk tekleşir, tavan uygulanır; boşsa null. Kontrol karakteri taşınmaz. */
function cleanQuery(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, UNDERSTOOD_QUERY_MAX_CHARS);
  return t.length > 0 ? t : null;
}

/**
 * Model çıktısını STRICT çözer. Üst düzey biçim bozuksa `null` (= katman başarısız). Tek tek istek
 * kalemleri daha yumuşak: tanınmayan niyet ya da boş sorgu taşıyan kalem DÜŞER (geri kalanı kullanılır).
 */
export function parseUnderstanding(raw: unknown): MessageUnderstanding | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!member(UNDERSTANDING_LANGUAGES, r.language) || !Array.isArray(r.requests)) return null;
  const sc = r.stay_change as Record<string, unknown> | null;
  if (!sc || typeof sc !== "object" || typeof sc.requested !== "boolean" || !member(STAY_CHANGE_KINDS, sc.kind)) return null;
  const requests: UnderstoodRequest[] = [];
  for (const it of r.requests.slice(0, MAX_UNDERSTOOD_REQUESTS)) {
    if (!it || typeof it !== "object") continue;
    const x = it as Record<string, unknown>;
    const queryTr = cleanQuery(x.query_tr);
    const queryOriginal = cleanQuery(x.query_original) ?? queryTr;
    if (!member(UNDERSTANDING_INTENTS, x.intent) || !queryTr || !queryOriginal) continue;
    requests.push({ intent: x.intent, queryTr, queryOriginal });
  }
  return {
    language: r.language,
    requests,
    stay: { requested: sc.requested, kind: sc.kind, checkinTime: normalizeHhmm(sc.checkin_time), checkoutTime: normalizeHhmm(sc.checkout_time) },
  };
}

/**
 * Retrieval'a eklenecek sorgular: tekilleştirilmiş; ÖNCE her isteğin Türkçe sorgusu (bilgi tabanının dili),
 * SONRA özgün dildeki sorgular. Selamlama / teşekkür kalemleri ARAMA SORGUSU DEĞİLDİR (inceleme 09-24:
 * "teşekkürler" sorgusu seçimi bozuyordu).
 * 🚨 SIRA (ikinci inceleme 09-24): eskiden [TR, özgün] ÇİFTLERİ tavana (6) kadar diziliyordu → Türkçe olmayan
 * misafirin 4. ve 5. sorusu HİÇ sorgu almıyordu; round-robin payını da özgün dil tekrarları yiyordu. Türkçe
 * sorgular önce gelince her istek tavandan önce en az bir sorgu alır.
 */
export function understandingQueries(u: MessageUnderstanding | null | undefined, max = 6): { text: string; turkish: boolean }[] {
  if (!u) return [];
  const out: { text: string; turkish: boolean }[] = [];
  const seen = new Set<string>();
  const requests = u.requests.filter((r) => r.intent !== "greeting_thanks");
  const passes: [(r: UnderstoodRequest) => string, boolean][] = [
    [(r) => r.queryTr, true],
    [(r) => r.queryOriginal, u.language === "tr"],
  ];
  for (const [textOf, turkish] of passes) {
    for (const r of requests) {
      const text = textOf(r);
      const k = text.toLocaleLowerCase("tr");
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ text, turkish });
      if (out.length >= max) return out;
    }
  }
  return out;
}
