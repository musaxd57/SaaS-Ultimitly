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
//   2. `answer-binding` ile değer ↔ konu ↔ koşul ↔ olumsuzluk ↔ yön bağını doğrular.
//   3. Doğrulanan parçaları istek sırasıyla birleştirir; misafire giden metin YALNIZ bunlardır. "no_info" ve doğrulanamayan parça HİÇBİR
//      cümle üretmez (iç kayıt) — istek ev sahibinin panelinde açık kalır, cevaplandı sayılmaz.
// Birleşik metin bugünkü bütün kapılardan (çıktı vetosu, sır, iç kaynak, kıdemli okuyucu …) yine geçer; parça doğrulaması onların YERİNE
// değil, ÖNÜNE eklenir.
// ---------------------------------------------------------------------------

import "server-only";

import { askedAspects, askedDirection, checkAnswerBinding, missesAskedFacility, missingAspects, omitsGeneralRule, type BindingIssue } from "@/lib/ai/answer-binding";
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

/** Kodun kapsam denetimleri: sorulan yön / tesis / genel kural (Soru 9). */
type ScopeIssue = "aspect_missing" | "subject_partial" | "general_omitted";
/** Parça okuyucusunun tuttuğu parça (Soru 11; `semantic/part-reader.ts`). */
type ReaderIssue = `reader_${PartReaderHold}`;

export type PartVerdict =
  | { ref: string; status: "verified"; source: string }
  | { ref: string; status: "no_info" | "missing" }
  | { ref: string; status: "rejected"; issues: (BindingIssue | "text_missing" | "too_long" | "source_not_found" | ScopeIssue | ReaderIssue)[] };

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
  verified: { ref: string; text: string; evidence: string; source: string }[];
}

/**
 * Parçaları doğrular ve birleştirir. Saf; istek sırası `needs` sırasıdır (R1, R2 …).
 *  · `askedContext`: misafirin bu turdaki ve önceki mesajları — Soru 9'da sorulan değişke ("cumartesi geliyoruz") buradan da okunur.
 *  · `holds`: parça okuyucusunun TUTTUĞU parçalar (Soru 11). Yalnız kodun bütün denetimlerinden GEÇMİŞ parçaya uygulanır; okuyucu hiçbir
 *    parçayı serbest bırakamaz.
 */
export function composeVerifiedReply(input: {
  parts: readonly AnswerPart[];
  needs: readonly PartNeed[];
  sources: readonly PartSource[];
  askedContext?: readonly string[];
  holds?: ReadonlyMap<string, PartReaderHold>;
}): ComposedReply {
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
    const source = input.sources.find((s) => quoteGroundedIn(s.text, part.evidence));
    if (!source) {
      verdicts.push({ ref: need.ref, status: "rejected", issues: ["source_not_found"] });
      continue;
    }
    // İstemdeki öteki kaynaklar da okunur (Opus 10-23 O6): aynı konunun koşullu değişkesi başka kalemde olabilir ("Havuz 20:00" ↔ ayrı
    // kalemde "Hafta sonu havuz 23:00") — genel değer o değişkeyi anmadan gitmez; uydurma koşul kıyası da bütün kaynaklarla.
    const otherSources = input.sources.filter((s) => s !== source).map((s) => s.text);
    const binding = checkAnswerBinding({
      part: part.text,
      evidence: part.evidence,
      sourceText: source.text,
      otherSources,
      needTerms: need.terms,
      needTopics: need.topics,
    });
    if (!binding.ok) {
      verdicts.push({ ref: need.ref, status: "rejected", issues: binding.issues });
      continue;
    }
    // Doğru ama sorulanı cevaplamayan parça isteği KAPATMAZ ve gitmez (Opus e2e 10-23 F2 / F3): "Havuz kaçta açılıyor?" ↔ "Havuz
    // ısıtmalıdır."; "Sauna ve havuz kaçta?" ↔ yalnız havuz. İstek ev sahibinde açık kalır.
    const queries = need.queries ?? [];
    const scope: ScopeIssue[] = [];
    if (missingAspects(part.text, askedAspects(queries), askedDirection(queries), need.terms, queries).length > 0) scope.push("aspect_missing");
    if (missesAskedFacility(part.text, queries)) scope.push("subject_partial");
    // Soru 9 (kurucu 10-23 sabah): misafirin sormadığı istisnayı genel kuralı anmadan veren parça gitmez ("Havuz 22:00'ye kadar açık mı?" ↔
    // "Hafta sonu 23:00'e kadar açık." — kalemde hafta içi 22:00). Misafir o günü sorduysa / önceden söylediyse gider.
    if (
      omitsGeneralRule({
        part: part.text,
        sourceText: source.text,
        otherSources,
        needTerms: need.terms,
        needTopics: need.topics,
        askedContext: [...queries, ...(input.askedContext ?? [])],
      })
    ) {
      scope.push("general_omitted");
    }
    if (scope.length > 0) {
      verdicts.push({ ref: need.ref, status: "rejected", issues: scope });
      continue;
    }
    // Soru 11: kodun bütün denetimlerinden geçen parçayı okuyucu TUTABİLİR (sorulanı cevaplamıyor / yarım / yanlış bağ / tek başına istisna
    // / okunamadı). Okuyucunun "evet"i ayrıca izin değildir — bu noktaya yalnız kodun doğruladığı parça gelir.
    const hold = input.holds?.get(need.ref);
    if (hold) {
      verdicts.push({ ref: need.ref, status: "rejected", issues: [`reader_${hold}`] });
      continue;
    }
    // Aynı metin iki isteği birlikte cevaplayabilir ("Havuz kaçta açılıyor, kaçta kapanıyor?" ↔ "Havuz 09:00-20:00 arası açıktır.") — iki istek
    // de kapanır, metin misafire BİR kez gider (Opus e2e 10-23 F7: aynı satır iki kez gidiyordu).
    // Anahtar selamsız metinden (Haiku 10-23 gece-3: "Merhaba! Havuz …" ile "Havuz …" iki kez gidiyordu); ayraç sökülmez — "1.500 TL" ile
    // "1,500 TL" farklı tutarlardır, yalnız büyük / küçük harf, boşluk ve sondaki noktalama eşitlenir.
    const key = stripLeadingGreeting(part.text).toLocaleLowerCase("tr").replace(/\s+/gu, " ").replace(/[\s.!?]+$/u, "").trim();
    if (!seen.has(key)) {
      seen.add(key);
      // İkinci ve sonraki parçanın baştaki selamı atılır (metnin ortasında "Merhaba!" kalmasın); ilk parçanınki kodun selam kuralına kalır.
      texts.push(texts.length > 0 ? stripLeadingGreeting(part.text) : part.text);
    }
    refs.push(need.ref);
    verdicts.push({ ref: need.ref, status: "verified", source: source.id });
    verified.push({ ref: need.ref, text: part.text, evidence: part.evidence, source: source.id });
  }
  return { reply: texts.join("\n"), refs, verdicts, verified };
}
