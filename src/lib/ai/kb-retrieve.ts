import type { KbChunkSource } from "@/lib/ai/retrieval/chunker";
import {
  pendingGuestMessages,
  retrievalNeeded,
  selectKbForPrompt,
  type CandidateListMeta,
  type KbRetrievalEvidence,
  type KbSelectInput,
  type KbSelectResult,
} from "@/lib/ai/retrieval/select";
import { kbRetrievalMode, rerankRetrievalInfo, wideBudgetInfo } from "@/lib/ai/retrieval/flag";
import { KB_RETRIEVAL_WIDE_CHAR_BUDGET, KB_RETRIEVAL_WIDE_MAX_CHUNKS } from "@/lib/ai/limits";
import { prepareSemanticScores } from "@/lib/ai/embeddings/semantic-retrieval";
import { prepareRerankScores, type RerankOutcome } from "@/lib/ai/semantic/rerank";
import { understandGuestMessages, understandingEnabled, type UnderstandingOutcome } from "@/lib/ai/semantic/understand";
import { understandingQueries, type MessageUnderstanding } from "@/lib/ai/semantic/understanding-schema";
import type { StayTimes } from "@/lib/ai/semantic/stay-change";
import { conversationStateEnabled } from "@/lib/ai/conversation-state";
import { stayTimeline, understandingDateLine, writtenAtEn } from "@/lib/ai/stay-timeline";
import { orgTimezone } from "@/lib/timezone";
import { conversationItemsEnabled } from "@/lib/conversation-items/flag";
import { houseRulesShadowEnabled } from "@/lib/house-rules/flag";
import { fillGuestPlaceholdersInItems, type GuestPlaceholderValues } from "@/lib/kb-placeholders";

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
  /**
   * 🚨 YER TUTUCU İKAMESİ SEÇİMDEN SONRA (#189, 09-26). Verilirse `items` HAM kalemlerdir (`{isim}`/`{daire}` çözülmemiş):
   * seçim, anlamsal puan ve yeniden sıralayıcı ham metinle çalışır; değerler YALNIZ seçilen parçalara uygulanır. Neden:
   * misafir adı metne aramadan ÖNCE girince parça metni her misafirde farklı oluyordu → anlamsal vektör deposu (içerik
   * anahtarlı) yeni misafirin ilk mesajında o parçayı bulamıyor, YARIM HARİTA YOK kuralıyla karar tamamen SÖZCÜKSEL
   * kalıyordu ("cold"). Yer tutucu parça sınırında bölünmez (parçalayıcı cümle sonu ya da boşlukta keser, `{isim}`
   * ikisini de taşımaz) → ikame sonrası parça, ikame edilmiş kalemin bitişik dilimidir. Sır kapısı kararı ÇAĞIRANDA ve
   * ikame SONRASI metinle verilir (bugünkü gibi); buraya yalnız o kapıdan geçen kalemlerin ham hâli gelir.
   */
  placeholders?: GuestPlaceholderValues;
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
  const { stayTimes, redactNames, dateContext, placeholders, ...rest } = input;
  // GENİŞ BLOK BÜTÇESİ (#189, kurucu 09-27 "hazırla, sonra aç"; `KB_RETRIEVAL_WIDE_BUDGET` varsayılan KAPALI): TEK karar noktası.
  // Çağıran bütçeyi kendisi verdiyse (ölçer / test) dokunulmaz. Küçük bilgi tabanı ve legacy yolu bütçe okumaz (etkisiz).
  const wide = wideBudgetInfo().enabled && rest.budgetChars === undefined && rest.maxChunks === undefined;
  const budgeted: KbSelectInput<T> = wide
    ? { ...rest, budgetChars: KB_RETRIEVAL_WIDE_CHAR_BUDGET, maxChunks: KB_RETRIEVAL_WIDE_MAX_CHUNKS }
    : rest;
  // Küçük-KB ölçüsü isteme GİRECEK hâlle (yer tutucular doldurulmuş) yapılır — paketleyiciyle aynı metin (09-27 #209, A5 F5:
  // "{isim}" uzun bir ada dönünce sınırdaki bilgi tabanının kalemi düşüyordu). Seçimin kendisi ham metinle sürer.
  const selectInput: KbSelectInput<T> =
    placeholders && budgeted.sizeItems === undefined ? { ...budgeted, sizeItems: fillGuestPlaceholdersInItems([...budgeted.items], placeholders) } : budgeted;
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
    // Ev kuralı gölge kipi (#188 dilim 3) — aynı karar noktası; kapalıyken alan hiç gitmez.
    ...(houseRulesShadowEnabled() ? { rules: true } : {}),
  });
  const queriesNeeded =
    understandingEnabled() &&
    (selectInput.mode ?? kbRetrievalMode()) === "hybrid" &&
    retrievalNeeded(selectInput.sizeItems ?? selectInput.items, selectInput.fullSetMaxItems);
  const und: UnderstandingOutcome = queriesNeeded ? await pending : { status: "off" };
  const understood = und.status === "ok" ? und.value : undefined;
  const extraQueries = understandingQueries(understood);
  const withExtra: KbSelectInput<T> = extraQueries.length > 0 ? { ...selectInput, extraQueries } : selectInput;

  const sem = await prepareSemanticScores(withExtra);
  const semInput: KbSelectInput<T> = sem.bySubquery ? { ...withExtra, semanticBySubquery: sem.bySubquery } : withExtra;
  const rerankOn = sem.status === "ok" && rerankRetrievalInfo().enabled;
  let lists: readonly (readonly { id: string; key: string }[])[] = [];
  let listMeta: readonly CandidateListMeta[] = [];
  let result = selectKbForPrompt(
    rerankOn
      ? {
          ...semInput,
          onCandidates: (l, meta) => {
            lists = l;
            listMeta = meta;
            semInput.onCandidates?.(l, meta);
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
      candidateMeta: listMeta,
      names: redactNames,
    });
    // Boş puan haritası ("hiçbiri cevaplamıyor") seçiciyi yeniden koşturmaz: sıra zaten bugünkü.
    if (rr.status === "ok" && rr.scores.size > 0) result = selectKbForPrompt({ ...semInput, onCandidates: undefined, rerankScores: rr.scores });
  }
  let evidence = result.evidence;
  if (evidence && wide && result.selection === "retrieved") evidence = { ...evidence, wb: 1 };
  if (evidence && sem.status !== "off") evidence = { ...evidence, sem: sem.status, semMs: sem.ms };
  if (evidence && rr) evidence = withRerank(evidence, rr);
  if (evidence && und.status !== "off") evidence = withUnderstanding(evidence, und);
  const base = evidence;
  return {
    ...result,
    // Yer tutucular YALNIZ seçilen parçalara (↑ `placeholders`); legacy / geri çekilme dalında da kalemlerin kendisine.
    items: placeholders ? fillGuestPlaceholdersInItems(result.items, placeholders) : result.items,
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

/** Kanıta yeniden sıralayıcının özetini ekler (metin YOK: durum, süre, "cevaplıyor" denen aday sayısı, çağrı sayısı). */
function withRerank(evidence: KbRetrievalEvidence, o: RerankOutcome): KbRetrievalEvidence {
  return {
    ...evidence,
    rr: o.status,
    rrMs: o.ms,
    ...(o.status === "ok" ? { rrA: [...o.scores.values()].filter((s) => s === 3).length } : {}),
    ...(o.calls !== undefined && o.calls > 1 ? { rrN: o.calls } : {}),
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
