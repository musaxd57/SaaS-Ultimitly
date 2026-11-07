// ---------------------------------------------------------------------------
// GEÇMİŞTEN ÖĞREN — SORU ↔ EV SAHİBİ CEVABI EŞLEŞTİRMESİ (tasarım `docs/TASARIM-2026-10-15-gecmisten-ogren.md` §2.2).
//
// 🚨 SAF: model yok, DB yok, ağ yok. Girdi mesaj listesi, çıktı gerçek çiftler. Kurallar Bacak B'nin (`kb-from-history.ts`
// `extractAnswerEvents`) ölçülmüş kurallarıdır, iki farkla:
//  · Kategori KELİME AĞIYLA SEÇİLMEZ: çift modele bütün olarak gider (misafir bloğu birden çok soru taşıyabilir — model hangi
//    bilginin cevaplandığını okur). Bu yüzden "blokta tek kategori" eleme kuralı burada yok.
//  · OTOMATİK ŞABLON MESAJI CEVAP DEĞİLDİR (K7, `message-author.ts`): yalnız şablondan oluşan giden dizi bekleyen misafir
//    bloğunu TÜKETMEZ ve cevap sayılmaz (Bacak B bunu bilmeden yazılmıştı: şablon ardından gelen ev sahibi cevabı kayboluyordu).
//    Kanalın KENDİ otomatik mesajı da (L5, 10-17: `channelSenderRole` "automation") aynı kuralda.
// Ortak kurallar: peş peşe ev sahibi mesajları TEK cevaptır · yapay zekâ cevabı bloğu tüketir (sonraki ev sahibi mesajı o
// sorunun cevabı sayılmaz) · ev sahibi + yapay zekâ karışık dizi DÜŞER (kimin cevabı olduğu belirsiz — fail-closed) · cevap
// misafirin son sorusundan en çok `PAIR_MAX_GAP_MS` sonra · "sorunlu" konuşmadaki cevap BİLGİ SAYILMAZ (özür / tek seferlik
// telafi kalıcı kural sanılmasın).
// ---------------------------------------------------------------------------

import { isHostAuthored, PAIR_MAX_GAP_MS, type HistoryConversation, type HistoryMessage } from "@/lib/kb-from-history";
import { isAutomationMessage, isChannelAutomation } from "@/lib/message-author";

export interface LearnPair {
  conversationId: string;
  propertyId: string;
  /** Cevapsız misafir bloğu (peş peşe misafir mesajları, satır satır). HAM, KIRPILMAMIŞ metin — maske ÖNCE, kırpma SONRA (`mask.ts`). */
  question: string;
  /** Peş peşe ev sahibi mesajlarının birleşik gövdesi. HAM metin. */
  answer: string;
  askedAt: Date;
  answeredAt: Date;
  /** İz (PII taşımaz): kaynak mesaj kimlikleri — inceleme ekranı örneği canlı (saklama süresine tabi) satırdan okur. */
  questionIds: string[];
  answerIds: string[];
}

export interface BuildLearnPairsOptions {
  maxPairGapMs?: number;
}

/**
 * 🚨 YAPAY ZEKÂ TASLAĞININ YANKISI EV SAHİBİ KANITI DEĞİLDİR (Opus H1, 10-15; Codex ilke 2: "AI'ın eski cevabını kendi doğruluğunun kanıtı
 * yapmasını engelle"). "Taslağı kullan" yalnız yazma alanını doldurur, "Gönder" satırı `aiAssisted=false` + ev sahibi yazar → eşleştirici
 * onu ev sahibi cevabı sanıyordu ve yapay zekânın uydurduğu bir çözüm "N konuşmadaki cevaplarınızdan" etiketiyle taslak oluyordu. Misafir
 * bloğunda tutulan taslağın sözcüklerinin büyük kısmı cevapta da varsa çift DÜŞER (şüphede öğrenme yok — kaçan çift ucuz, sahte kanıt
 * pahalı). Doğrusal: sözcük kümesi, en çok ECHO_MAX_TOKENS sözcük.
 */
const ECHO_MAX_TOKENS = 400;
const ECHO_OVERLAP = 0.6;
/** Bundan kısa taslak ("Evet, var.", "Merhaba") yankı sayılmaz — içinde geçtiği her gerçek cevabı düşürürdü (Haiku 10-15). */
const ECHO_MIN_DRAFT_WORDS = 4;
function wordSet(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLocaleLowerCase("tr").split(/[^\p{L}\p{N}]+/u)) {
    if (w.length >= 2) out.add(w);
    if (out.size >= ECHO_MAX_TOKENS) break;
  }
  return out;
}
export function echoesAiDraft(block: readonly HistoryMessage[], answer: string): boolean {
  const drafts = block.map((q) => q.aiSuggestedReply?.trim()).filter((d): d is string => Boolean(d));
  if (!drafts.length) return false;
  const answerWords = wordSet(answer);
  return drafts.some((d) => {
    const draftWords = wordSet(d);
    if (draftWords.size < ECHO_MIN_DRAFT_WORDS) return false;
    let shared = 0;
    for (const w of draftWords) if (answerWords.has(w)) shared += 1;
    return shared / draftWords.size >= ECHO_OVERLAP;
  });
}

/**
 * Ürünün yapay zekâsının (ya da kaybolmuş kendi çıktımızın) giden mesajı: ev sahibi değil, şablon değil, sistem olayı değil. KANALIN KENDİ
 * otomasyonu (L5, `channelSenderRole` "automation") da DEĞİL: bizim şablonumuz gibi (K7) bloğu tüketmez — yoksa "ev sahibi değil" diye yapay
 * zekâ sayılır, misafir bloğu düşer ve ardından gelen gerçek ev sahibi cevabı öğrenilmezdi.
 */
function isAiOutbound(m: HistoryMessage): boolean {
  return (
    m.direction !== "inbound" &&
    !m.systemEventType &&
    !isAutomationMessage(m) &&
    !isChannelAutomation(m) &&
    !isHostAuthored(m) &&
    Boolean(m.body?.trim())
  );
}

export function buildLearnPairs(
  messages: readonly HistoryMessage[],
  conversations: readonly HistoryConversation[] = [],
  opts: BuildLearnPairsOptions = {},
): LearnPair[] {
  const maxGapMs = opts.maxPairGapMs ?? PAIR_MAX_GAP_MS;
  const excluded = new Set(conversations.filter((c) => c.status === "problem").map((c) => c.id));
  const byConv = new Map<string, HistoryMessage[]>();
  for (const m of messages) {
    if (excluded.has(m.conversationId)) continue;
    const list = byConv.get(m.conversationId);
    if (list) list.push(m);
    else byConv.set(m.conversationId, [m]);
  }

  const pairs: LearnPair[] = [];
  for (const rows of byConv.values()) {
    // Deterministik sıra; eşit damgada `id` kopma noktası (aynı TX'te yazılan satırlar).
    rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    let pending: HistoryMessage[] = [];
    let i = 0;
    while (i < rows.length) {
      if (rows[i].direction === "inbound") {
        if (rows[i].body?.trim()) pending.push(rows[i]);
        i += 1;
        continue;
      }
      const group: HistoryMessage[] = [];
      while (i < rows.length && rows[i].direction !== "inbound") {
        group.push(rows[i]);
        i += 1;
      }
      const host = group.filter(isHostAuthored);
      const ai = group.filter(isAiOutbound);
      // Yalnız şablon / sistem olayı → cevap değil, blok BEKLEMEYE devam eder (K7).
      if (!host.length && !ai.length) continue;
      const block = pending;
      pending = [];
      if (ai.length || !block.length) continue;
      const lastQ = block[block.length - 1];
      const gap = host[0].createdAt.getTime() - lastQ.createdAt.getTime();
      if (gap < 0 || gap > maxGapMs) continue;
      const answer = host.map((h) => h.body!.trim()).join("\n");
      if (echoesAiDraft(block, answer)) continue;
      pairs.push({
        conversationId: lastQ.conversationId,
        propertyId: lastQ.propertyId,
        question: block.map((q) => q.body!.trim()).join("\n"),
        answer,
        askedAt: block[0].createdAt,
        answeredAt: host[host.length - 1].createdAt,
        questionIds: block.map((q) => q.id),
        answerIds: host.map((h) => h.id),
      });
    }
  }
  // Deterministik çıktı: yeni → eski (ilk N çift "son N soru" olsun), eşitlikte konuşma kimliği.
  return pairs.sort((a, b) => b.answeredAt.getTime() - a.answeredAt.getTime() || a.conversationId.localeCompare(b.conversationId));
}
