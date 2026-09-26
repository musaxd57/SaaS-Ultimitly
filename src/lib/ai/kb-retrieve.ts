import type { KbChunkSource } from "@/lib/ai/retrieval/chunker";
import {
  pendingGuestMessages,
  retrievalNeeded,
  selectKbForPrompt,
  type KbRetrievalEvidence,
  type KbSelectInput,
  type KbSelectResult,
} from "@/lib/ai/retrieval/select";
import { kbRetrievalMode, rerankRetrievalInfo } from "@/lib/ai/retrieval/flag";
import { prepareSemanticScores } from "@/lib/ai/embeddings/semantic-retrieval";
import { prepareRerankScores, type RerankOutcome } from "@/lib/ai/semantic/rerank";
import { understandGuestMessages, understandingEnabled, type UnderstandingOutcome } from "@/lib/ai/semantic/understand";
import { understandingQueries, type MessageUnderstanding } from "@/lib/ai/semantic/understanding-schema";
import type { StayTimes } from "@/lib/ai/semantic/stay-change";
import { conversationStateEnabled } from "@/lib/ai/conversation-state";
import { stayTimeline, understandingDateLine, writtenAtEn } from "@/lib/ai/stay-timeline";
import { orgTimezone } from "@/lib/timezone";
import { conversationItemsEnabled } from "@/lib/conversation-items/flag";

// ---------------------------------------------------------------------------
// BİLGİ SEÇİMİ — YÜZEYLERİN TEK GİRİŞİ (09-23).
//
// Dört AI yüzeyi (oto-yanıt, QR, inbox öneri, Ayarlar testi) bunu çağırır; bu da TEK boğaz
// `selectKbForPrompt`i. Aradaki iş ağ gerektiren hazırlıktır (seçici SAF ve SENKRON kalır):
//  1. ANLAMA KATMANI (09-24, `AI_UNDERSTANDING_ENABLED`): model misafirin sorusunu anlar ve temiz,
//     geçmişle çözülmüş arama sorgularına yeniden yazar (sorgu yeniden yazma / çoklu sorgu). Sorgular
//     deterministik alt sorgulara BİRLEŞİM olarak girer (payı sınırlı, geri çekilmeyi daraltamaz).
//     🚨 GECİKME (inceleme 09-24): retrieval sorgulara İHTİYAÇ DUYMUYORSA (küçük KB — tipik host — ya da
//     legacy acil durdurma) anlama BEKLENMEZ; cevap üretimiyle PARALEL koşar ve yalnız kapıdan önce
//     `await result.understanding` ile alınır. Böylece misafir yalnız sorgular gerçekten kullanıldığında bekler.
//  2. ANLAMSAL HAZIRLIK (`KB_SEMANTIC_RETRIEVAL`): alt sorgu başına gömme puanları — yeniden yazılmış
//     sorgular da gömülür.
//  3. YENİDEN SIRALAYICI (#186, `KB_RERANK_ENABLED`): YALNIZ anlamsal puanlar bu kararda seçiciye ulaştıysa
//     (`sem: ok`) ve seçici gerçekten sıraladıysa (`fb: none`). Seçicinin aday listelerinden ilk 20'yi modele
//     "cevaplıyor / ilgili" diye işaretletir; seçici puanlarla YENİDEN koşar — küme aynı adaylardan, yalnız SIRA
//     değişir. Her arıza (zaman aşımı 2,5 sn dahil) bugünkü sonucun KENDİSİ + kanıtta `rr: failed`.
// Anahtarlar kapalıyken sonuç `selectKbForPrompt(input)` ile BİREBİR aynıdır ve kanıta yeni alan
// girmez (davranışsal pin).
// ---------------------------------------------------------------------------

export interface KbRetrieveInput<T extends KbChunkSource> extends KbSelectInput<T> {
  /** Anlama katmanı için mülkün standart saatleri (konaklama isteğinin "standart dışı" kararı). */
  stayTimes?: StayTimes | null;
  /** Anlama katmanına gitmeden redakte edilecek bilinen adlar. */
  redactNames?: readonly (string | null | undefined)[];
  /**
   * Anlama katmanının tarih satırı için (Konuşma Anlama Durumu; bayrak `AI_CONVERSATION_STATE_ENABLED` KAPALIYKEN
   * KULLANILMAZ → katmanın girdisi ve önbellek anahtarı bayt bayt eskisi). `reservation` verilmezse (QR) rezervasyon
   * hakkında hiçbir şey yazılmaz; `null` = bu konuşmaya bağlı rezervasyon yok.
   */
  dateContext?: {
    now: Date;
    timeZone: string | null | undefined;
    reservation?: { status: string; arrivalDate: Date | string; departureDate: Date | string } | null;
  };
}

export type KbRetrieveResult<T extends KbChunkSource> = KbSelectResult<T> & {
  /**
   * Anlama katmanının çıktısı. Kapıdan ÖNCE `await` edilir; katman kapalı/başarısızsa `undefined`.
   * Asla reddedilmez (katman fırlatmaz).
   */
  understanding: Promise<MessageUnderstanding | undefined>;
  /** Katmanın durumu (`failed` kanıtta "kapalı"dan AYRI görünsün — ikinci inceleme 09-24). Asla reddedilmez. */
  understandingStatus: Promise<"off" | "ok" | "cached" | "failed">;
  /**
   * Karar kaydı için kanıt: katman retrieval'da beklenmediyse (küçük KB / legacy — PARALEL koştu) `un/unMs/ui`
   * burada eklenir; beklendiyse `evidence` ile aynıdır. Kapıdan sonra çağrılır. Asla reddedilmez.
   */
  evidenceAfterUnderstanding: () => Promise<KbRetrievalEvidence | null>;
};

export async function retrieveKbForPrompt<T extends KbChunkSource>(input: KbRetrieveInput<T>): Promise<KbRetrieveResult<T>> {
  const { stayTimes, redactNames, dateContext, ...selectInput } = input;
  // Tarih satırı TEK karar noktası burada: bayrak kapalıyken hesaplanmaz, katmana alan hiç gitmez.
  const timeZone = dateContext ? orgTimezone(dateContext.timeZone) : null;
  const dateLine =
    dateContext && timeZone && conversationStateEnabled()
      ? understandingDateLine(
          stayTimeline({ now: dateContext.now, timeZone, reservation: dateContext.reservation }),
          dateContext.reservation !== undefined,
        )
      : null;
  // F14b: mesajların YAZILDIĞI an — tarih satırıyla AYNI karar (bayrak kapalıyken fonksiyon gitmez, girdi bayt bayt aynı).
  const writtenStamp = dateLine && timeZone ? (at: Date) => writtenAtEn(at, timeZone) : null;
  // Çağrı HEMEN başlar (async fonksiyon ilk await'e kadar eşzamanlı koşar); kimse beklemese de paraleldir.
  const pending: Promise<UnderstandingOutcome> = understandGuestMessages({
    guestMessage: selectInput.guestMessage,
    history: selectInput.history,
    stayTimes,
    names: redactNames,
    ...(dateLine ? { dateLine } : {}),
    ...(writtenStamp ? { writtenStamp } : {}),
    // Konuşma öğeleri kipi — TEK karar noktası burada (bayrak kapalıyken alan hiç gitmez, çağrı bayt bayt eskisi).
    ...(conversationItemsEnabled() ? { items: true } : {}),
  });
  const queriesNeeded =
    understandingEnabled() &&
    (selectInput.mode ?? kbRetrievalMode()) === "hybrid" &&
    retrievalNeeded(selectInput.items, selectInput.fullSetMaxItems);
  const und: UnderstandingOutcome = queriesNeeded ? await pending : { status: "off" };
  const understood = und.status === "ok" ? und.value : undefined;
  const extraQueries = understandingQueries(understood);
  const withExtra: KbSelectInput<T> = extraQueries.length > 0 ? { ...selectInput, extraQueries } : selectInput;

  const sem = await prepareSemanticScores(withExtra);
  const semInput: KbSelectInput<T> = sem.bySubquery ? { ...withExtra, semanticBySubquery: sem.bySubquery } : withExtra;
  const rerankOn = sem.status === "ok" && rerankRetrievalInfo().enabled;
  let lists: readonly (readonly { id: string; key: string }[])[] = [];
  let result = selectKbForPrompt(
    rerankOn
      ? {
          ...semInput,
          onCandidates: (l) => {
            lists = l;
            semInput.onCandidates?.(l);
          },
        }
      : semInput,
  );
  let rr: RerankOutcome | null = null;
  if (rerankOn && result.evidence?.fb === "none") {
    rr = await prepareRerankScores({
      items: selectInput.items,
      guestMessage: selectInput.guestMessage,
      pending: pendingGuestMessages(selectInput.history, selectInput.guestMessage),
      candidates: lists,
      names: redactNames,
    });
    // Boş puan haritası ("hiçbiri cevaplamıyor") seçiciyi yeniden koşturmaz: sıra zaten bugünkü.
    if (rr.status === "ok" && rr.scores.size > 0) result = selectKbForPrompt({ ...semInput, onCandidates: undefined, rerankScores: rr.scores });
  }
  let evidence = result.evidence;
  if (evidence && sem.status !== "off") evidence = { ...evidence, sem: sem.status, semMs: sem.ms };
  if (evidence && rr) evidence = withRerank(evidence, rr);
  if (evidence && und.status !== "off") evidence = withUnderstanding(evidence, und);
  const base = evidence;
  return {
    ...result,
    evidence,
    understanding: pending.then((o) => (o.status === "ok" ? o.value : undefined)),
    understandingStatus: pending.then((o) => (o.status === "ok" ? (o.cached ? "cached" : "ok") : o.status)),
    evidenceAfterUnderstanding: async () => {
      if (!base || und.status !== "off") return base;
      const o = await pending;
      return o.status === "off" ? base : withUnderstanding(base, o);
    },
  };
}

/** Kanıta yeniden sıralayıcının özetini ekler (metin YOK: durum, süre, "cevaplıyor" denen aday sayısı). */
function withRerank(evidence: KbRetrievalEvidence, o: RerankOutcome): KbRetrievalEvidence {
  return {
    ...evidence,
    rr: o.status,
    rrMs: o.ms,
    ...(o.status === "ok" ? { rrA: [...o.scores.values()].filter((s) => s === 3).length } : {}),
  };
}

/** Kanıta anlama katmanının kapalı-küme özetini ekler (metin YOK: durum, süre, niyet etiketleri). */
function withUnderstanding(evidence: KbRetrievalEvidence, o: Exclude<UnderstandingOutcome, { status: "off" }>): KbRetrievalEvidence {
  return {
    ...evidence,
    un: o.status === "ok" ? (o.cached ? "cached" : "ok") : "failed",
    unMs: o.ms,
    ...(o.status === "ok" && o.value.requests.length > 0 ? { ui: o.value.requests.map((r) => r.intent) } : {}),
  };
}
