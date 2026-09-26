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
 *  · konaklama politikası: `stay` istek sinyali (birleşimin bir katmanı; her zaman karar verir);
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

// ─── katmanın gördüğü pencere (TEK kaynak: istem + konuşma öğelerinin mesaj eşlemesi) ────────────────────────────────

/** Katmana giden en fazla cevapsız misafir mesajı ([1]..[n]); daha eskisi GÖRÜLMEZ. */
export const UNDERSTANDING_MAX_UNANSWERED = 5;
/** Son giden mesaja kadarki bağlamdan en fazla bu kadar mesaj. */
export const UNDERSTANDING_MAX_CONTEXT = 6;
/** Mesaj başına karakter tavanı (redaksiyondan SONRA kesilir). */
export const UNDERSTANDING_MESSAGE_CAP = 1_000;
/**
 * Uzunluk payı: modeller mesajı ad/telefon maskesinden (`redactForSemanticModel`) SONRA ve tavanla keserek görür; maske
 * metni uzatabilir → ham uzunluk tavana bu kadar yaklaşınca da "tamamı okunmadı" sayılır (09-24 inceleme).
 */
export const NOT_FULLY_READ_MARGIN = 100;

export interface UnderstandingHistoryEntry {
  /** Mesaj kimliği — yalnız konuşma öğelerinin eşlemesi için; isteme GİRMEZ. */
  id?: string;
  direction: "inbound" | "outbound";
  body: string;
  /** Mesajın YAZILDIĞI an (F14b). */
  at?: Date;
}

/**
 * Katmanın gördüğü mesajlar: boş gövdeler atılır; son GİDEN mesajdan sonraki misafir mesajları cevapsızdır (güncel mesaj
 * dâhil, tekrar etmeden; son UNDERSTANDING_MAX_UNANSWERED tanesi — `unseen` = görülmeyen eski cevapsız sayısı); bağlam son
 * giden mesaja kadarki son UNDERSTANDING_MAX_CONTEXT mesajdır. İstem ([1]..[n] numaraları) ve öğe eşlemesi BU listeyi kullanır.
 */
export function understandingWindow(
  history: readonly UnderstandingHistoryEntry[] | undefined,
  guestMessage: string,
): { context: UnderstandingHistoryEntry[]; unanswered: { id?: string; body: string; at?: Date }[]; unseen: number } {
  const hist = (history ?? []).filter((m) => typeof m.body === "string" && m.body.trim().length > 0);
  const lastOut = hist.map((m) => m.direction).lastIndexOf("outbound");
  const pending = hist
    .slice(lastOut + 1)
    .filter((m) => m.direction === "inbound")
    .map((m) => ({ id: m.id, body: m.body, at: m.at }));
  if (pending[pending.length - 1]?.body !== guestMessage) pending.push({ id: undefined, body: guestMessage, at: undefined });
  const unanswered = pending.slice(-UNDERSTANDING_MAX_UNANSWERED);
  return {
    context: hist.slice(0, lastOut + 1).slice(-UNDERSTANDING_MAX_CONTEXT),
    unanswered,
    unseen: pending.length - unanswered.length,
  };
}

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

/**
 * KONUŞMA ÖĞELERİ KİPİ (09-26, `AI_CONVERSATION_ITEMS_ENABLED`; `src/lib/conversation-items/`): her istek HANGİ cevapsız
 * mesajdan (`message`, 1'den; istemdeki [n]) + misafirin açıkça vazgeçtiği ÖNCEKİ isteklerin niyetleri (`withdrawn`).
 * Temel şemadan türetilir; bayrak kapalıyken yalnız `UNDERSTANDING_JSON_SCHEMA` gider (bayt bayt eski).
 */
const BASE_REQUEST_ITEM = UNDERSTANDING_JSON_SCHEMA.schema.properties.requests.items;
export const UNDERSTANDING_JSON_SCHEMA_ITEMS = {
  name: "guest_message_understanding_items",
  strict: true,
  schema: {
    ...UNDERSTANDING_JSON_SCHEMA.schema,
    required: [...UNDERSTANDING_JSON_SCHEMA.schema.required, "withdrawn"],
    properties: {
      ...UNDERSTANDING_JSON_SCHEMA.schema.properties,
      requests: {
        type: "array",
        items: {
          ...BASE_REQUEST_ITEM,
          required: [...BASE_REQUEST_ITEM.required, "message"],
          properties: { ...BASE_REQUEST_ITEM.properties, message: { type: "integer" } },
        },
      },
      withdrawn: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["intent", "message"],
          properties: { intent: { type: "string", enum: [...UNDERSTANDING_INTENTS] }, message: { type: "integer" } },
        },
      },
    },
  },
} as const;

/** Misafirin vazgeçtiği istek: niyet + isteğin geçtiği cevapsız mesaj ([n]) ya da 0 = daha önceki (cevaplanmış) konuşma. */
export interface WithdrawnRequest {
  intent: UnderstandingIntent;
  message: number;
}

export interface UnderstoodRequest {
  intent: UnderstandingIntent;
  queryTr: string;
  queryOriginal: string;
  /** Yalnız öğe kipinde: isteğin geldiği cevapsız mesajın numarası (1'den); geçersizse YOK (= eşlenemedi). */
  message?: number;
}

export interface MessageUnderstanding {
  language: (typeof UNDERSTANDING_LANGUAGES)[number];
  requests: UnderstoodRequest[];
  stay: UnderstandingStaySignal;
  /** Yalnız öğe kipinde: misafirin açıkça vazgeçtiği istekler (tekil; tanınmayan niyet / geçersiz numara düşer). */
  withdrawn?: WithdrawnRequest[];
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
 * kalemleri daha yumuşak: tanınmayan niyet taşıyan kalem DÜŞER (geri kalanı kullanılır); boş sorgu kalemi düşürmez.
 */
export function parseUnderstanding(raw: unknown, opts?: { items?: boolean }): MessageUnderstanding | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!member(UNDERSTANDING_LANGUAGES, r.language) || !Array.isArray(r.requests)) return null;
  const sc = r.stay_change as Record<string, unknown> | null;
  if (!sc || typeof sc !== "object" || typeof sc.requested !== "boolean" || !member(STAY_CHANGE_KINDS, sc.kind)) return null;
  const items = opts?.items === true;
  const requests: UnderstoodRequest[] = [];
  for (const it of r.requests.slice(0, MAX_UNDERSTOOD_REQUESTS)) {
    if (!it || typeof it !== "object") continue;
    const x = it as Record<string, unknown>;
    if (!member(UNDERSTANDING_INTENTS, x.intent)) continue;
    // Sorgusuz kalem de TUTULUR (inceleme 09-24): risk niyeti (acil, insan talebi) ve "tek konu mu?" kararı sorgu
    // metnine bağlı değildir — eskiden boş sorgulu kalem DÜŞÜYOR ve o sinyal sessizce kayboluyordu. Sorgu üretimi
    // (`understandingQueries`) boş sorguları atlar.
    const queryTr = cleanQuery(x.query_tr) ?? "";
    const queryOriginal = cleanQuery(x.query_original) ?? queryTr;
    const request: UnderstoodRequest = { intent: x.intent, queryTr, queryOriginal };
    // Öğe kipi: geçersiz numara DÜŞÜRÜLMEZ, numarasız kalır — istek sinyali kaybolmasın; eşleme `conversation-items`te
    // numarasız isteği "eşlenemedi" sayar (tur bugünkü davranışa döner).
    if (items && typeof x.message === "number" && Number.isInteger(x.message) && x.message >= 1) request.message = x.message;
    requests.push(request);
  }
  const out: MessageUnderstanding = {
    language: r.language,
    requests,
    stay: { requested: sc.requested, kind: sc.kind, checkinTime: normalizeHhmm(sc.checkin_time), checkoutTime: normalizeHhmm(sc.checkout_time) },
  };
  if (items) {
    // Geçersiz vazgeçme kaydı DÜŞER (güvenli yön: vazgeçme bir öğeyi KAPATIR; emin olunmayan kayıt kapatmaz).
    const withdrawn: WithdrawnRequest[] = [];
    for (const w of Array.isArray(r.withdrawn) ? r.withdrawn : []) {
      if (!w || typeof w !== "object") continue;
      const x = w as Record<string, unknown>;
      if (!member(UNDERSTANDING_INTENTS, x.intent) || typeof x.message !== "number" || !Number.isInteger(x.message) || x.message < 0) continue;
      const entry = { intent: x.intent, message: x.message };
      if (!withdrawn.some((e) => e.intent === entry.intent && e.message === entry.message)) withdrawn.push(entry);
    }
    out.withdrawn = withdrawn;
  }
  return out;
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
      if (!text) continue;
      const k = text.toLocaleLowerCase("tr");
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ text, turkish });
      if (out.length >= max) return out;
    }
  }
  return out;
}
