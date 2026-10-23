// ---------------------------------------------------------------------------
// CEVAP PARÇALARI — ihtiyaç başına cevap + kod doğrulaması + kod birleştirmesi (kurucu 10-23 A; anahtar `AI_ANSWER_PARTS_ENABLED`,
// varsayılan KAPALI; yalnız konuşma öğeleri kipinde).
//
// Kurucunun akışı (aynen): "Mesajı anlamlandır → gerçek ihtiyaçları ayır → her ihtiyaca kaynak bul → cevapları ayrı üret → uygun
// parçaları birleştir → yalnız gerçekten cevaplanan işleri kapat." · "'Sauna hakkında bilgim yok' üretilip sonra ayıklanmasın."
//
// Cevap modeli KONUŞMA ÖĞELERİ bloğundaki her cevaplanacak istek (R1, R2 …) için bir parça yazar: durum ("answered" | "no_info"),
// yalnız o isteğin cevabı (selam / kapanış / başka istek YOK) ve o cevabı destekleyen BİREBİR alıntı. Kod (model çağrısı YOK):
//   1. alıntıyı istemde gösterilen bir kaynakta bulur (bilgi tabanı satırı ya da mülk bilgisi; okuyucunun kanıt kuralı — NFKC + görünmez
//      karakter + benzer harf). İstem satırına kimlik EKLENMEDİ (`[K1]`): kalem satırının biçimi seçicinin bütçe ölçüsüyle pinli; alıntı
//      kaynağı zaten tek başına belirler.
//   2. `answer-binding` ile değer ↔ konu ↔ koşul ↔ olumsuzluk ↔ yön bağını doğrular. Parça okuyucusu koşarken (Codex S3, 10-23 sabah-3)
//      kod yalnız yapıyı ve kaynak geçerliliğini TUTAR (`CODE_KEPT_ISSUES`); anlam denetimleri iz için yazılır, kararı okuyucu verir.
//   3. Doğrulanan parçaları istek sırasıyla birleştirir; misafire giden metin YALNIZ bunlardır. "no_info" ve doğrulanamayan parça HİÇBİR
//      cümle üretmez (iç kayıt) — istek ev sahibinin panelinde açık kalır, cevaplandı sayılmaz.
// Birleşik metin bugünkü bütün kapılardan (çıktı vetosu, sır, iç kaynak, kıdemli okuyucu …) yine geçer; parça doğrulaması onların YERİNE
// değil, ÖNÜNE eklenir.
// ---------------------------------------------------------------------------

import "server-only";

import { askedAspects, askedConditions, askedDirection, checkAnswerBinding, missesAskedFacility, missingAspects, type BindingIssue } from "@/lib/ai/answer-binding";
import { stripLeadingGreeting } from "@/lib/ai/code-greeting";
import { quoteGroundedIn } from "@/lib/ai/semantic/absence-judge";
import type { PartReaderHold } from "@/lib/ai/semantic/part-reader";

/** Anahtar yalnız tam "1" ile açılır (`STRICT_ONE_FLAGS`). */
export function answerPartsEnabled(): boolean {
  return process.env.AI_ANSWER_PARTS_ENABLED === "1";
}

export const ANSWER_PART_STATUSES = ["answered", "no_info"] as const;
export type AnswerPartStatus = (typeof ANSWER_PART_STATUSES)[number];

export interface AnswerPart {
  ref: string;
  status: AnswerPartStatus;
  text: string;
  evidence: string;
}

export type AnswerPartsDeclaration = { ok: true; parts: AnswerPart[] } | { ok: false; reason: "missing" };

/** Parça metni / alıntı tavanı (karakter). Uzun parça doğrulanamaz sayılır — bir isteğin cevabı birkaç cümledir. */
export const PART_TEXT_MAX = 600;
export const PART_EVIDENCE_MAX = 600;

/**
 * Modelin `answers` alanını çözer: dizi değilse "missing" (kapı tutar). Bozuk kayıt, tanınmayan istek kimliği ve aynı kimliğin ikinci
 * kaydı TEK TEK atlanır (Haiku 10-23: tek bir "R0" bütün doğrulanmış parçaları düşürüyordu) — atlanan kayıt hiçbir isteği cevaplamaz,
 * misafire giden metne giremez; güvenli yön.
 */
export function parseAnswerParts(raw: unknown, refs: readonly string[]): AnswerPartsDeclaration {
  if (!Array.isArray(raw)) return { ok: false, reason: "missing" };
  const parts: AnswerPart[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    if (typeof r.ref !== "string" || !refs.includes(r.ref)) continue;
    if (!(ANSWER_PART_STATUSES as readonly unknown[]).includes(r.status)) continue;
    if (parts.some((p) => p.ref === r.ref)) continue;
    const text = typeof r.text === "string" ? r.text.trim() : "";
    const evidence = typeof r.evidence === "string" ? r.evidence.trim() : "";
    parts.push({ ref: r.ref, status: r.status as AnswerPartStatus, text, evidence });
  }
  return { ok: true, parts };
}

/** İstemde modele gösterilen bir kaynak: bilgi tabanı satırı (`kbLine` biçimi) ya da mülk bilgisi bloğu. */
export interface PartSource {
  id: string;
  text: string;
}

export interface PartNeed {
  ref: string;
  /** İhtiyacın kendi sözcükleri (`topic-absence.needTerms`) ve sözlük konuları. */
  terms: readonly string[];
  topics: readonly string[];
  /**
   * İsteğin anlama katmanı sorguları (Türkçe + özgün dil; plan verir, istemde YOK). Sorulan AÇIK yön (saat / ücret) ve tek sorguda birden çok
   * tesis buradan okunur (Opus e2e 10-23 F2 / F3); yoksa yön denetimi yapılmaz (bugünkü kural).
   */
  queries?: readonly string[];
}

/** Kodun kapsam denetimleri: sorulan yön / tesis. */
type ScopeIssue = "aspect_missing" | "subject_partial";
/** Parça okuyucusunun tuttuğu parça (Soru 11; `semantic/part-reader.ts`). */
type ReaderIssue = `reader_${PartReaderHold}`;

export type PartVerdict =
  | {
      ref: string;
      status: "verified";
      source: string;
      advisory?: (BindingIssue | ScopeIssue)[];
      /** Parça gitti ama ihtiyaç KAPANMADI (okuyucu `only_known_case`: genel soruya yalnız bilinen özel durum) — ev sahibinde açık. */
      openAfterSend?: true;
    }
  | { ref: string; status: "no_info" | "missing" }
  | {
      ref: string;
      status: "rejected";
      issues: (BindingIssue | "text_missing" | "too_long" | "source_not_found" | ScopeIssue | ReaderIssue)[];
      /** Okuyucu tuttuğunda kodun aynı parçada gördüğü anlam bulguları (ölçüm: okuyucu ile kod aynı şeyi mi gördü). */
      advisory?: (BindingIssue | ScopeIssue)[];
    };

export interface ComposedReply {
  /** Misafire gidecek metin: doğrulanan parçalar, istek sırasıyla, satır satır. Hiç yoksa boş dize (hiçbir şey gitmez). */
  reply: string;
  /** Doğrulanan isteklerin kimlikleri (yalnız bunlar "cevaplandı"). */
  refs: string[];
  /** İstek başına karar (iz / ölçüm; metin YOK). */
  verdicts: PartVerdict[];
  /**
   * Doğrulanan parçaların METNİ + alıntısı + kaynağı (doğrulanmış cevap tekrarının gölge ölçümü, migration 85). İzlere / karar kaydına
   * YAZILMAZ; yalnız gölge kayıt tablosuna (misafir metni değil — kalemden doğrulanmış cevap).
   */
  /** `alsoCited`: alıntının dayanak kaleminden SONRA geçtiği öteki kaynaklar (#199). */
  verified: { ref: string; text: string; evidence: string; source: string; alsoCited?: string[] }[];
}

/**
 * Metin karşılaştırma biçimi: harf büyüklüğü (Türkçe noktalı / noktasız i dahil — dil kestirimi olmadan "İ / I / ı" → "i"), boşluk ve sondaki
 * noktalama eşitlenir; ayraç sökülmez ("1.500 TL" ≠ "1,500 TL"). Tekrar anahtarı ve son metin denetimi (automation) AYNI biçimi kullanır
 * (Opus 10-23 G3: biri Türkçe, öteki dilsiz büyütme yapınca "internet" parçası son metinde bulunamıyor, tur sessizce tutuluyordu).
 */
export function foldPartText(text: string): string {
  return text.replace(/[İIı]/gu, "i").toLowerCase().replace(/\s+/gu, " ").replace(/[\s.!?]+$/u, "").trim();
}

/** Parçanın tekrar / varlık anahtarı: selamsız metin, `foldPartText` biçiminde. */
export function partTextKey(text: string): string {
  return foldPartText(stripLeadingGreeting(text));
}

/** Alıntı cümlesi: nokta / ünlem / soru / üç nokta + boşluk ya da satır sonu ("15.00" bölünmez). */
const QUOTE_SENTENCE_END = /(?<=[.!?…])\s+|\n+/u;
/** Alıntının başındaki kalem başlığı ("Интернет: …", "Pool: …") — en fazla 40 karakter, rakamsız, iki noktayla biter. */
const QUOTE_TITLE = /^[^:\n\p{Nd}]{1,40}:\s+/u;
/** Çok parçalı alıntıda her cümlenin en az bu kadar harfi olmalı (tek sözcüklük parça "dayanak" sayılmaz). */
const MIN_SEGMENT_LETTERS = 8;

const letterCount = (t: string) => (t.match(/\p{L}/gu) ?? []).length;
/** Kıyas biçimi (alıntı kuralının sadeleştirilmiş eşi): harf büyüklüğü, noktalama / simge ve boşluk farkı yok. */
const flat = (t: string) =>
  t
    .normalize("NFKC")
    .toLocaleLowerCase("tr")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Alıntının bir parçasının dayanağı. Önce birebir. Olmazsa: model kalem başlığını misafirin diline çevirip alıntıya katabiliyor (kör set
 * incelemesi 10-23: "Интернет: Wi-Fi adı …" ↔ kalemde "İnternet: Wi-Fi adı …"). Başlık atılır ve kalan YALNIZ bir bilgi tabanı kaleminin
 * İÇERİĞİNİN BAŞINDA aranır — ortadaki bir cümlenin önüne konan "Hafta sonu:" gibi bir niteleyici başlık sayılmaz (Haiku 10-23: koşul
 * alıntıya sızıyordu); kalan en az `MIN_SEGMENT_LETTERS` harf.
 */
function groundedSegment(sources: readonly PartSource[], segment: string): { source: PartSource; quote: string } | undefined {
  const direct = sources.find((src) => quoteGroundedIn(src.text, segment));
  if (direct) return { source: direct, quote: segment };
  const rest = segment.replace(QUOTE_TITLE, "");
  if (rest === segment || letterCount(rest) < MIN_SEGMENT_LETTERS) return undefined;
  // Gün / mevsim / koşul taşıyan "başlık" atılmaz ("Hafta sonu: Havuz 23:00'e kadar açıktır." — kalemin başlığı "Havuz" iken model başına koşul
  // koymuş olabilir; o koşul kalemde yok).
  if (askedConditions(segment.slice(0, segment.length - rest.length)).length > 0) return undefined;
  const head = flat(rest);
  const source = sources.find((src) => {
    // `kbLine` biçimi: "- [KATEGORİ] Başlık: içerik".
    const close = src.text.indexOf("] ");
    const colon = close >= 0 ? src.text.indexOf(": ", close) : -1;
    return colon >= 0 && flat(src.text.slice(colon + 2)).startsWith(head);
  });
  return source ? { source, quote: rest } : undefined;
}

/**
 * Alıntının dayanağı. Bütün alıntı tek kaynakta geçiyorsa o kaynak (bugünkü kural, aynen). Geçmiyorsa alıntı cümlelere bölünür ve HER cümle
 * istemdeki bir kaynakta birebir aranır (kör set incelemesi 10-23: genel kural ve istisnası iki ayrı kalemdeydi, model ikisini tek alıntıda
 * birleştirdi; doğru cevap "kaynak yok" diye tutuluyordu). Tek cümlesi bile bulunamayan alıntı dayanaksızdır. Bağ denetimine giden alıntı
 * dayanak kaleminde geçen ilk cümledir; öteki kalemler zaten `otherSources` olarak okunur. `cited`: alıntının geçtiği bütün kaynaklar (ilki
 * dayanak) — okuyucu hepsini not olarak görür (konu sözcüğü eşleşmeyen ikinci kalem de).
 */
export function groundEvidence(
  sources: readonly PartSource[],
  evidence: string,
): { source: PartSource; quote: string; cited: PartSource[] } | null {
  const whole = groundedSegment(sources, evidence);
  if (whole) return { ...whole, cited: [whole.source] };
  const segments = evidence
    .split(QUOTE_SENTENCE_END)
    .map((x) => x.trim())
    .filter(Boolean);
  if (segments.length < 2) return null;
  const hits: { source: PartSource; quote: string }[] = [];
  for (const seg of segments) {
    const hit = groundedSegment(sources, seg);
    // Harf tabanı dayanağı bulunan metinde (başlığı atılmış hâli) sayılır: "Hafta sonu: 23:00." başlıkla 9 harf, kendisi 0.
    if (!hit || letterCount(hit.quote) < MIN_SEGMENT_LETTERS) return null;
    hits.push(hit);
  }
  return { ...hits[0], cited: [...new Set(hits.map((h) => h.source))] };
}

/**
 * Parça okuyucusu koşarken de KODDA kalan denetimler (Codex S3: "kod sayı / birimi, okuyucu tutarın hangi hizmete ve koşula ait olduğunu
 * doğrular"; yetki, sır, kaynak geçerliliği kodda). Alıntı kalemde yok · parçadaki sayı / saat / tutar alıntıda yok · iki kaynak çelişiyor ·
 * ihtiyacın konusu hiç bilinmiyor (okuyucu da neyi cevapladığını sınayamaz). Ötekiler (konu, koşul, değişke, olumluluk, yön, değer bağı,
 * içerik, sorulan yön / tesis) ANLAM denetimidir: okuyucu koşarken tutmaz, `advisory` olarak ize yazılır.
 * Ölçüm (`docs/olcum/part-reader-vs-code-2026-10-23-luna-low.json`, 39 vaka × 2): kodun doğru tuttuğu 23 kötü taslağın 23'ünü okuyucu iki
 * okumada da tuttu; kod 16 doğru cevabın 12'sini gereksiz tuttu, okuyucu 1'ini (iki okumada). Kör setin incelemesi: kodun 19 tutmasının 19'u
 * gereksizdi.
 */
export const CODE_KEPT_ISSUES: ReadonlySet<BindingIssue> = new Set<BindingIssue>([
  "evidence_missing",
  "evidence_not_in_source",
  "value_not_in_evidence",
  "value_conflict",
  "subject_unknown",
]);

/**
 * Parçaları doğrular ve birleştirir. Saf; istek sırası `needs` sırasıdır (R1, R2 …).
 *  · `meaningJudge`: "reader" = parça okuyucusu bu parçaları okuyacak → anlam denetimleri tutmaz, `advisory` olur (yalnız
 *    `CODE_KEPT_ISSUES` tutar). Varsayılan "code" (bugünkü kural: her denetim tutar). Okuyucu düşerse / kapalıysa çağıran bütün parçaları
 *    tutar (`partReaderHolds`), yani "reader" yalnız okuyucu gerçekten okuyacakken anlamlıdır.
 *  · `holds`: parça okuyucusunun TUTTUĞU parçalar (Soru 11; Soru 9 "genel kural + istisna" da okuyucunun sorusudur). Yalnız kodun bütün
 *    denetimlerinden GEÇMİŞ parçaya uygulanır; okuyucu hiçbir parçayı serbest bırakamaz.
 */
export function composeVerifiedReply(input: {
  parts: readonly AnswerPart[];
  needs: readonly PartNeed[];
  sources: readonly PartSource[];
  holds?: ReadonlyMap<string, PartReaderHold>;
  meaningJudge?: "code" | "reader";
  /** Gönderilecek ama isteği kapatmayacak parçalar (`PartReaderOutcome.keepOpen`). */
  keepOpen?: ReadonlySet<string>;
}): ComposedReply {
  const byReader = input.meaningJudge === "reader";
  const texts: string[] = [];
  const seen = new Set<string>();
  const refs: string[] = [];
  const verdicts: PartVerdict[] = [];
  const verified: ComposedReply["verified"] = [];
  for (const need of input.needs) {
    const part = input.parts.find((p) => p.ref === need.ref);
    if (!part) {
      verdicts.push({ ref: need.ref, status: "missing" });
      continue;
    }
    if (part.status === "no_info") {
      verdicts.push({ ref: need.ref, status: "no_info" });
      continue;
    }
    if (!part.text || !part.evidence) {
      verdicts.push({ ref: need.ref, status: "rejected", issues: ["text_missing"] });
      continue;
    }
    if (part.text.length > PART_TEXT_MAX || part.evidence.length > PART_EVIDENCE_MAX) {
      verdicts.push({ ref: need.ref, status: "rejected", issues: ["too_long"] });
      continue;
    }
    const grounded = groundEvidence(input.sources, part.evidence);
    if (!grounded) {
      verdicts.push({ ref: need.ref, status: "rejected", issues: ["source_not_found"] });
      continue;
    }
    const { source, quote, cited } = grounded;
    // İstemdeki öteki kaynaklar da okunur (Opus 10-23 O6): aynı konunun koşullu değişkesi başka kalemde olabilir ("Havuz 20:00" ↔ ayrı
    // kalemde "Hafta sonu havuz 23:00") — genel değer o değişkeyi anmadan gitmez; uydurma koşul kıyası da bütün kaynaklarla.
    // Alıntı birden çok kalemden geliyorsa (#199) dayanak metni o kalemlerin TAMAMI: ikinci kalemin değeri konu sözcüğünü anmasa da
    // aranır (öteki kaynaklar yalnız konuyu anıyorsa okunur); alıntının ilk cümlesi dayanak kaleminde geçer.
    const otherSources = input.sources.filter((s) => !cited.includes(s)).map((s) => s.text);
    const binding = checkAnswerBinding({
      part: part.text,
      evidence: quote,
      sourceText: cited.map((c) => c.text).join("\n"),
      otherSources,
      needTerms: need.terms,
      needTopics: need.topics,
    });
    const blocking = byReader ? binding.issues.filter((i) => CODE_KEPT_ISSUES.has(i)) : binding.issues;
    if (blocking.length > 0) {
      verdicts.push({ ref: need.ref, status: "rejected", issues: blocking });
      continue;
    }
    // Doğru ama sorulanı cevaplamayan parça isteği KAPATMAZ ve gitmez (Opus e2e 10-23 F2 / F3): "Havuz kaçta açılıyor?" ↔ "Havuz
    // ısıtmalıdır."; "Sauna ve havuz kaçta?" ↔ yalnız havuz. İstek ev sahibinde açık kalır. Okuyucu koşarken bu da onun sorusudur
    // (answers_request "partly" / "no") — iz için yazılır.
    const queries = need.queries ?? [];
    const scope: ScopeIssue[] = [];
    if (missingAspects(part.text, askedAspects(queries), askedDirection(queries), need.terms, queries).length > 0) scope.push("aspect_missing");
    if (missesAskedFacility(part.text, queries)) scope.push("subject_partial");
    if (scope.length > 0 && !byReader) {
      verdicts.push({ ref: need.ref, status: "rejected", issues: scope });
      continue;
    }
    const advisory: (BindingIssue | ScopeIssue)[] = byReader ? [...binding.issues, ...scope] : [];
    // Soru 11: kodun bütün denetimlerinden geçen parçayı okuyucu TUTABİLİR (sorulanı cevaplamıyor / yarım / yanlış bağ / tek başına istisna
    // / okunamadı). Okuyucunun "evet"i ayrıca izin değildir — bu noktaya yalnız kodun doğruladığı parça gelir.
    const hold = input.holds?.get(need.ref);
    if (hold) {
      verdicts.push({ ref: need.ref, status: "rejected", issues: [`reader_${hold}`], ...(advisory.length > 0 ? { advisory } : {}) });
      continue;
    }
    // Aynı metin iki isteği birlikte cevaplayabilir ("Havuz kaçta açılıyor, kaçta kapanıyor?" ↔ "Havuz 09:00-20:00 arası açıktır.") — iki istek
    // de kapanır, metin misafire BİR kez gider (Opus e2e 10-23 F7: aynı satır iki kez gidiyordu).
    // Anahtar selamsız metinden (Haiku 10-23 gece-3: "Merhaba! Havuz …" ile "Havuz …" iki kez gidiyordu); ayraç sökülmez — "1.500 TL" ile
    // "1,500 TL" farklı tutarlardır, yalnız büyük / küçük harf, boşluk ve sondaki noktalama eşitlenir.
    const key = partTextKey(part.text);
    if (!seen.has(key)) {
      seen.add(key);
      // İkinci ve sonraki parçanın baştaki selamı atılır (metnin ortasında "Merhaba!" kalmasın); ilk parçanınki kodun selam kuralına kalır.
      texts.push(texts.length > 0 ? stripLeadingGreeting(part.text) : part.text);
    }
    // Genel soruya yalnız notların bildiği özel durum (Codex 10-23: "koşullu bilgiyi söylemek ile genel soruyu tamamen cevaplanmış saymak
    // ayrılmalı"): metin gider, istek "cevaplandı" sayılmaz — ev sahibinde açık kalır.
    const openAfterSend = input.keepOpen?.has(need.ref) === true;
    if (!openAfterSend) refs.push(need.ref);
    verdicts.push({
      ref: need.ref,
      status: "verified",
      source: source.id,
      ...(advisory.length > 0 ? { advisory } : {}),
      ...(openAfterSend ? { openAfterSend: true as const } : {}),
    });
    verified.push({
      ref: need.ref,
      text: part.text,
      evidence: part.evidence,
      source: source.id,
      ...(cited.length > 1 ? { alsoCited: cited.slice(1).map((c) => c.id) } : {}),
    });
  }
  return { reply: texts.join("\n"), refs, verdicts, verified };
}
