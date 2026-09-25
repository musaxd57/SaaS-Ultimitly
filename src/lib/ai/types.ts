import type { ClaimAudit } from "./claim-support";
import type { StayChangeDeclaration } from "./semantic/stay-change";
import type { Priority, ReplyTone } from "@/lib/constants";

export interface KbContext {
  category: string;
  title: string;
  content: string;
}

export interface ReservationContext {
  guestName: string;
  arrivalDate: Date | string;
  departureDate: Date | string;
  status: string;
  /** The guest's own previously-stated check-out time ("HH:MM"), if known. */
  guestCheckoutTime?: string | null;
}

/** Neighbouring bookings for the SAME property — for turnover-day reasoning. */
export interface AdjacencyContext {
  /** Nearest prior booking's check-out date (same property), or null. */
  previousDeparture?: Date | string | null;
  /** Nearest following booking's check-in date (same property), or null. */
  nextArrival?: Date | string | null;
  /**
   * Önceki çıkış bu girişle AYNI takvim gününde mi — KODDA, müsaitlik motorunun tarih kuralıyla
   * (mülk dilimi) hesaplanır (`getAdjacency`). Verilmezse istem eski UTC-günü karşılaştırmasına düşer.
   */
  previousSameDay?: boolean;
  /** Sonraki giriş bu çıkışla AYNI takvim gününde mi (aynı kural). */
  nextSameDay?: boolean;
}

export interface PropertyContext {
  name: string;
  checkInTime: string;
  checkOutTime: string;
  address?: string | null;
  city?: string | null;
}

export interface HistoryMessage {
  direction: "inbound" | "outbound";
  body: string;
}

export interface SuggestReplyInput {
  guestMessage: string;
  property: PropertyContext;
  reservation?: ReservationContext | null;
  knowledgeBase: KbContext[];
  /**
   * `knowledgeBase` SORGUDA kesildiyse (adet tavanı `KB_ITEM_CAP`), kaç kalemin
   * dışarıda kaldığı. İstem bunu modele SÖYLER: aksi hâlde AI, host'un yazdığı
   * ama bu yanıta alınmayan bir konuda kendinden emin "bilgim yok" der — oysa
   * doğru davranış insana devretmektir. Verilmezse 0 (kesme olmadı) sayılır.
   */
  knowledgeBaseDropped?: number;
  /**
   * RAG dilim 1 (09-09): `knowledgeBase` bilgi tabanının TAMAMI mı ("all",
   * varsayılan — legacy) yoksa SORUYA GÖRE SEÇİLMİŞ parçalar mı ("retrieved",
   * `KB_RETRIEVAL_MODE=hybrid`). İstemdeki kesme notunun DÜRÜST wording'i
   * buna bağlıdır: seçilmeyen kalem "yer sınırı nedeniyle" düşmedi, "soruya
   * göre seçilmedi" — ama sonuç aynı: konu yukarıda yoksa 'bilgi yok' DEME.
   */
  knowledgeBaseSelection?: "all" | "retrieved";
  /**
   * Seçicinin DÜRÜST notları (hibrit): örn. bütçeye sığmayan saat çelişkisi.
   * Bilgi bloğunun sonuna `[NOT]` satırı olarak girer; PII taşımaz.
   */
  knowledgeBaseNotes?: string[];
  history?: HistoryMessage[];
  /**
   * Bağlam PENCERESİ DIŞINA taşan, misafirin kapanmamış konularının kapalı-küme
   * kategori kodları (PII YOK). Uzun sohbette eski bir şikâyet sessizce
   * kaybolmasın diye taşınır; bir DEVİR sebebi değildir (kapı yalnız güncel
   * mesaja bakar) ve çözülmüş konular buraya girmez.
   */
  openTopics?: string[];
  /**
   * KONUŞMA DURUMU — KODDA hesaplanır, modelden ÇIKARIM İSTENMEZ.
   *
   * 🚨 Canlı kusur (kurucu/Codex 09-08): asistan hemen sonraki cevapta yeniden
   * "Merhaba" diyordu. Sebep modelin hatası DEĞİLDİ: üslup kuralı koşulsuz
   * "misafiri adıyla selamla" diyordu ve "daha önce cevap verdin mi" bilgisi
   * hiçbir yerde SÖYLENMİYORDU. Geçmiş isteme giriyordu ama ondan bu sonucu
   * çıkarmasını beklemek tam da başarısız olan şeydi.
   *
   * Alan OPSİYONEL: verilmezse istem hiçbir ek kısıt yazmaz (uydurma kural yok).
   */
  conversationState?: {
    /** Bu sohbette misafire DAHA ÖNCE hiç cevap gitmedi mi? */
    isFirstOperatorReply: boolean;
  };
  tone: ReplyTone;
  language: string;
  /** Distilled guide of the host's own reply style (optional, learned). */
  styleProfile?: string | null;
  /** Neighbouring bookings (same property) for early-checkin/late-checkout calls. */
  adjacency?: AdjacencyContext | null;
  /**
   * Host-configured late-checkout / stay-extension offer (their own price/terms),
   * or null/empty when not set. Surfaced ONLY on an actual late-checkout / extend
   * request — an explicit, host-scoped exception to the "never quote a price" rule.
   * The reply stays payment-method-neutral and still defers final confirmation to
   * the host. Empty/absent → today's behavior (no price, defer to host).
   */
  lateCheckoutOfferText?: string | null;
  /**
   * PUBLIC anonymous surface (QR concierge) where the caller has ALREADY
   * verified an active stay but deliberately passes no reservation PII.
   * Suppresses the "prospective guest / complete your booking" framing while
   * KEEPING the no-secrets policy (it's still an open channel).
   */
  verifiedActiveStay?: boolean;
  /**
   * Org'un IANA saat dilimi (`Organization.timezone`): istemdeki "bugün / yarın" ve konaklama evresi bu dilimde, takvim
   * günü kuralıyla (`stay-timeline.ts`) hesaplanır. Verilmezse uygulamanın varsayılan dilimi (`orgTimezone(null)`).
   */
  timeZone?: string | null;
  /** Hesap anı (test/önizleme için sabitlenebilir); verilmezse şimdi. */
  now?: Date;
}

/** Model çağrısının token kullanımı (yalnız sayılar + sunulan model adı; metin YOK). */
export interface LlmUsage {
  /** prompt_tokens */
  pt?: number;
  /** completion_tokens */
  ct?: number;
  /** prompt_tokens_details.cached_tokens — istem önbelleğinden okunan */
  cpt?: number;
  /** completion_tokens_details.reasoning_tokens */
  rt?: number;
  /** Sağlayıcının yanıtta bildirdiği (sunulan) model. */
  m?: string;
}

export interface SuggestReplyResult {
  intent: string;
  /** 0..1 */
  confidence: number;
  reply: string;
  risk: string | null;
  priority: Priority;
  source: "openai" | "fallback";
  /** What the human operator should do (not what the AI replied). */
  actionSuggestion: string | null;
  /** Overall risk classification for this message. */
  riskLevel: "none" | "low" | "medium" | "high";
  /** BCP-47 language tag detected from the guest message. */
  detectedLanguage: string;
  /**
   * WHY the message is risky — a LABEL, never a decision (the send gate stays
   * in code and only ever tightens on it). Null when not risky / unknown.
   * One of RISK_TYPES (unknown model output is clamped to null).
   */
  riskType: string | null;
  /** Evidence: which context grounded the reply (e.g. "kb:wifi", "reservation:checkOutTime", "property:checkInTime", "history"). */
  usedSources: string[];
  /**
   * A2 — modelin BEYAN ettiği kaynak sayısı ile gerçek girdiye karşı
   * DOĞRULANAN sayı. `usedSources` yalnız doğrulananları taşır; doğrulama
   * eleyince kaç atıfın düştüğü bugüne kadar iz bırakmadan kayboluyordu ve
   * "uydurma atıf" canlıda görünmüyordu.
   *
   * Opsiyonel: yokluğu "ölçülmedi" demektir (0 DEĞİL). Karar kaydına NULL
   * gider; sahte bir sıfır, olmayan bir ölçümü varmış gibi gösterirdi.
   */
  sourceAudit?: { declared: number; verified: number };
  /**
   * §C — İSTEMİN kendi KB muhasebesi: kaç kalem isteme GİREMEDİ (sorgu tavanı +
   * sır süzgeci + seçici + pack karakter bütçesi TOPLAMI).
   *
   * Yüzeyler bu sayıyı `suggestReply`'dan ÖNCE hesaplıyor ve pack'in kendi
   * kesmesini göremiyordu; istem modele "N kalem alınamadı" derken karar kaydı
   * daha küçük bir sayı söylüyordu.
   *
   * Opsiyonel: yokluğu "ölçülmedi" demektir (0 DEĞİL) — fallback yolunda istem
   * hiç kurulmaz, oraya uydurma bir sayı yazmak sahte kesinlik olurdu.
   */
  kbOmittedInPrompt?: number;
  /**
   * İDDİA DESTEĞİ GÖLGE ÖLÇÜMÜ (`claim-support.ts`, 09-23): cevaptaki somut iddiaların modelin
   * gördüğü veride harfiyen geçip geçmediği — PII'siz sayılar + sınıflar. KARAR DEĞİLDİR (hiçbir
   * kapı okumaz). Opsiyonel: yokluğu "ölçülmedi" demektir (fallback, ya da ölçüm hatası).
   */
  claimAudit?: ClaimAudit;
  /**
   * Model çağrısının token kullanımı (`usage`) — "istem önbelleği çalışıyor" iddiasını VARSAYIM
   * olmaktan çıkarıp GÖZLEME çevirir (`cpt/pt` oranı). Metin taşımaz. Opsiyonel = ölçülmedi.
   */
  llmUsage?: LlmUsage;
  /** What was missing to answer fully (short phrases; empty when nothing). */
  missingInfo: string[];
  /** The guest's own stated departure/check-out time as "HH:MM" (24h), or null. */
  statedCheckoutTime: string | null;
  /**
   * Modelin KENDİ cevabı hakkındaki şema beyanı (`stayChangeAsked` + `replyStance`, 09-24): misafir
   * takvime bağlı bir değişiklik istedi mi, cevap ne yaptı (erteledi / izin verdi / takvimden söz
   * etti / reddetti). ETİKETTİR, yetki vermez — kapı yalnız SIKILAŞTIRIR
   * (`ai/semantic/stay-change.ts`). Yokluğu = model alanı üretmedi (fallback dâhil) = sinyal yok.
   */
  stayChange?: StayChangeDeclaration | null;
  /**
   * Modelin GÖRDÜĞÜ bilgi tabanında mülk ayarıyla çelişen giriş/çıkış saatleri (istemin çelişki bloğunu basan AYNI
   * hesap, `findTimeConflicts`). Kapı çelişkili alana değen cevabı TUTAR (P4-b kodda, `time-conflict-gate.ts`) —
   * karar modelin güven puanına bırakılmaz. Yokluğu = istem kurulmadı (fallback) → kapı zaten tutar.
   */
  timeConflicts?: { field: "checkInTime" | "checkOutTime"; propertyValue: string; kbValues: string[] }[];
}

export interface ClassifyResult {
  intent: string;
  priority: Priority;
  isComplaint: boolean;
  confidence: number;
}
