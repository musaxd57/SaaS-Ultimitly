import type { KbChunkSource } from "@/lib/ai/retrieval/chunker";
import {
  retrievalNeeded,
  selectKbForPrompt,
  type KbRetrievalEvidence,
  type KbSelectInput,
  type KbSelectResult,
} from "@/lib/ai/retrieval/select";
import { kbRetrievalMode } from "@/lib/ai/retrieval/flag";
import { prepareSemanticScores } from "@/lib/ai/embeddings/semantic-retrieval";
import { understandGuestMessages, understandingEnabled, type UnderstandingOutcome } from "@/lib/ai/semantic/understand";
import { understandingQueries, type MessageUnderstanding } from "@/lib/ai/semantic/understanding-schema";
import type { StayTimes } from "@/lib/ai/semantic/stay-change";

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
// İki anahtar da kapalıyken sonuç `selectKbForPrompt(input)` ile BİREBİR aynıdır ve kanıta yeni alan
// girmez (davranışsal pin).
// ---------------------------------------------------------------------------

export interface KbRetrieveInput<T extends KbChunkSource> extends KbSelectInput<T> {
  /** Anlama katmanı için mülkün standart saatleri (konaklama isteğinin "standart dışı" kararı). */
  stayTimes?: StayTimes | null;
  /** Anlama katmanına gitmeden redakte edilecek bilinen adlar. */
  redactNames?: readonly (string | null | undefined)[];
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
  const { stayTimes, redactNames, ...selectInput } = input;
  // Çağrı HEMEN başlar (async fonksiyon ilk await'e kadar eşzamanlı koşar); kimse beklemese de paraleldir.
  const pending: Promise<UnderstandingOutcome> = understandGuestMessages({
    guestMessage: selectInput.guestMessage,
    history: selectInput.history,
    stayTimes,
    names: redactNames,
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
  const result = selectKbForPrompt(sem.bySubquery ? { ...withExtra, semanticBySubquery: sem.bySubquery } : withExtra);
  let evidence = result.evidence;
  if (evidence && sem.status !== "off") evidence = { ...evidence, sem: sem.status, semMs: sem.ms };
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

/** Kanıta anlama katmanının kapalı-küme özetini ekler (metin YOK: durum, süre, niyet etiketleri). */
function withUnderstanding(evidence: KbRetrievalEvidence, o: Exclude<UnderstandingOutcome, { status: "off" }>): KbRetrievalEvidence {
  return {
    ...evidence,
    un: o.status === "ok" ? (o.cached ? "cached" : "ok") : "failed",
    unMs: o.ms,
    ...(o.status === "ok" && o.value.requests.length > 0 ? { ui: o.value.requests.map((r) => r.intent) } : {}),
  };
}
