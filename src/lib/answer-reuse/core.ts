import "server-only";

// ---------------------------------------------------------------------------
// DOĞRULANMIŞ CEVAP TEKRARI — saf karar çekirdeği (kurucu fikri 10-23 + Codex notu; tasarım `docs/TASARIM-2026-10-23-dogrulanmis-cevap-tekrari.md`).
//
// Kurucu: "aynı soru farklı kelimelerle gelince … o host için o daire için tutar, 4. kez aynı soru geldiğinde otomatik doğru yanıt gider
// tekrar aramadan; veri eskide kalmasın diye o cevabın dayandığı kayıt kontrol edilir (değiştirilme tarihi, bilgi değişti mi)".
// Codex: tekrar sayısı DOĞRULUK kanıtı değildir; embedding benzerliği "aynı cevap verilebilir" demek değildir; yalnız dosya tarihi
// yetmez (yeni istisna kalemi, onay kaldırma, silinme).
//
// Bu dosya karar verir, hiçbir şey göndermez / yazmaz:
//  · `reuseGate`  — yeni ihtiyaç, kayıtlı bir cevabın ihtiyacıyla AYNI mı (tür, dil, koşul, sözcük kapsamı, soru yönü). Benzerlik puanı
//                   aday bulur; izin bu kapıdan + güncel kaynakla yeniden doğrulamadan (`revalidateEntry`) gelir.
//  · `entryEligible` — doğrulanmış bir parça tekrar kullanılmaya aday mı (kişiye / zamana bağlı söz yok).
//  · `sameAnswer` — iki taze doğrulanmış cevap aynı bilgiyi mi veriyor (kurucunun "3 kez" kuralı = KARARLILIK, doğruluk değil).
//  · `relatedFingerprint` — cevabın konusunu anan kalemlerin sürüm parmak izi: ilgili kalem eklenir / değişir / silinirse kayıt geçersiz.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { askedConditions, checkAnswerBinding, contentCovered, literallyCovered, partSignature, type BindingIssue } from "@/lib/ai/answer-binding";
import { tokenize } from "@/lib/ai/retrieval/text";
import { topicsWithSymptomsOf } from "@/lib/conversation-items/relation";
import { guestNameMatcher } from "@/lib/conversation-items/topic-label";
import { needTerms, needTermsInStrict } from "@/lib/conversation-items/topic-absence";

/**
 * Tekrar kullanılabilecek ihtiyaç türleri — mülke ait, kişiden bağımsız, sabit bilgi. DIŞARIDA: konaklama değişikliği / müsaitlik /
 * bavul (karar ister), giriş kodu (sır + kişiye özel), ödeme, iade, şikâyet, acil, insan talebi, kaynak sorusu, temizlik / havlu (çoğu
 * hizmet isteği), cihaz yardımı (arıza ile karışır), yerel öneri (öznel, zamanla değişir), selam, diğer.
 */
export const REUSABLE_KINDS: ReadonlySet<string> = new Set([
  "checkin_time",
  "checkout_time",
  "wifi",
  "parking",
  "directions_transport",
  "amenities",
  "house_rules",
  "pets",
  "trash",
]);

/** Kurucu: "3'ten fazla aynı soru gelirse … 4. kez otomatik". Aynı bilgiyi veren BAĞIMSIZ, doğrulanmış taze cevap sayısı. */
export const REUSE_STABLE_COUNT = 3;
/** Kayıt bu kadar günden eskiyse yeniden taze cevap ister (kalemde yazan "bu hafta" gibi süreli bilgi kalıcılaşmasın). */
export const REUSE_MAX_AGE_DAYS = 30;
/**
 * Aday eşiği: anlama katmanının Türkçe sorgularının gömme benzerliği (ham misafir metni DEĞİL — ölçüldü: ham metinde "Otopark var mı?" ↔
 * "Otopark ücretli mi?" 0,86, gerçek eş anlamlılardan yüksek). Geliştirme setinde kapıyla birlikte 0,50–0,65 arası aynı sonucu verdi
 * (yanlış tekrar 0); 0,70 küçük bir güvenlik payıdır. İzin eşikten değil `reuseGate` + `revalidateEntry`den gelir.
 */
export const REUSE_MIN_SIMILARITY = 0.7;

export interface ReuseNeed {
  /** Anlama katmanının istek türü. */
  kind: string;
  /** Anlama katmanının Türkçe arama sorgusu (`query_tr`) — misafir hangi dilde yazarsa yazsın Türkçe → sözcük kıyası dilden bağımsız. */
  query: string;
  /** Misafirin dili (cevap parçası bu dilde). */
  language: string;
  /** Anlama katmanı konaklama değişikliği isteği gördü mü. */
  stayChange?: boolean;
}

export type ReuseGateResult =
  | "ok"
  | "kind_not_reusable"
  | "kind_mismatch"
  | "stay_change"
  | "language_mismatch"
  | "condition_mismatch"
  | "terms_not_covered"
  | "aspect_not_answered";

// ─── soru yönü (ne soruluyor: saat · ücret · yer · izin · nasıl) ─────────────────────────────────────────────────────────────────

type Aspect = "time" | "fee" | "location" | "permission" | "howto";

const fold = (s: string) => tokenize(s);

/** Soru metninden (Türkçe sorgu) yön: "kaçta / saat" → saat, "ücret / dahil" → ücret, "nerede" → yer, "izin / kabul / -ebilir" → izin. */
function questionAspects(query: string): Set<Aspect> {
  const out = new Set<Aspect>();
  for (const t of fold(query)) {
    if (/^(saat|kacta|kaca|zaman|ne zaman)/.test(t) || t === "when" || t === "time") out.add("time");
    if (/^(ucret|fiyat|bedava|dahil|para$|odeme|maliyet)/.test(t)) out.add("fee");
    if (/^(nerede|nereye|nerde|neresi|konum)/.test(t)) out.add("location");
    if (/^(izin|kabul|serbest|yasak)/.test(t) || /[ae]bil[iu]r/.test(t) || /[ae]bil[iu]yor/.test(t)) out.add("permission");
    if (/^(nasil|kullanim|talimat)/.test(t)) out.add("howto");
  }
  return out;
}

/** Cevap parçasının KARŞILADIĞI yönler: saat değeri, tutar / ücret sözü, yer sözü, izin / yasak sözü. Dil bağımsız değer + çok dilli söz. */
function answerAspects(part: string): Set<Aspect> {
  const out = new Set<Aspect>();
  const sig = partSignature(part);
  if (sig.values.some((v) => v.startsWith("time:"))) out.add("time");
  if (sig.values.some((v) => v.startsWith("money:"))) out.add("fee");
  for (const t of fold(part)) {
    if (/^(ucret|bedava|ucretsiz|free|gratis|kostenlos|included|dahil|charge|paid|fee)/.test(t)) out.add("fee");
    if (
      /^(bina|kat$|katta|katin|giris|yaninda|karsisinda|saginda|solunda|altinda|ustunde|onunde|arkasinda|metre|sokak|cadde|floor|next|left|right|behind|opposite|entrance|basement|garage|neben|links|rechts)/.test(t)
    )
      out.add("location");
    if (/^(kabul|izin|yasak|serbest|allowed|permitted|welcome|erlaubt|verboten|forbidden|prohibited)/.test(t) || /[ae]bil[iu]rsiniz$/.test(t)) out.add("permission");
    if (/^(basin|acin|kapatin|cevirin|press|turn|switch|open|drucken)/.test(t)) out.add("howto");
  }
  return out;
}

// ─── sözcük kapsamı ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Kaba sözlük konuları kimlik sayılmaz (doğrulayıcıyla aynı: kahvaltı / restoran / kafe → "restaurant"; köpek / kedi → "pets"). */
const COARSE_TOPICS: ReadonlySet<string> = new Set(["restaurant", "pets"]);

/**
 * Yeni sorunun HER ayırt edici sözcüğü kayıtlı sorunun sözcüklerinde ya da kayıtlı cevapta geçiyor mu (çekim toleranslı; ince sözlük
 * konusu da sayılır: "internet" ~ "wifi"). "Otopark ücretli mi?" ← "Otopark var mı?" cevabı ücret anmıyorsa KAPSANMAZ; "Kedi?" ← "Köpek"
 * kaydı kapsanmaz (kaba konu kimlik değil).
 */
function covered(incoming: string, cachedQuery: string, part: string): boolean {
  const terms = needTerms([incoming]).filter((t) => !isScaffold(t));
  if (terms.length === 0) return false;
  const pool = `${cachedQuery} \n ${part}`;
  const poolTopics = new Set(topicsWithSymptomsOf(pool).filter((t) => !COARSE_TOPICS.has(t)));
  const forward = terms.every((t) => {
    if (needTermsInStrict([t], pool) > 0) return true;
    const topics = topicsWithSymptomsOf(t).filter((x) => !COARSE_TOPICS.has(x));
    return topics.length > 0 && topics.some((x) => poolTopics.has(x));
  });
  if (!forward) return false;
  // Ters yön — KONU sözcükleri: kayıtlı soru somut bir konu adıyorsa ("köpek") yeni soru da onu anmalı. Genel soruya ("evcil hayvan kabul
  // ediliyor mu") köpek cevabı verilmez (kalem "kedi kabul" diyor olabilir). Kaba konu (evcil hayvan / restoran) kimlik değildir → sözcüğün
  // kendisi şart; ince konu ("kutusu" ~ "çöp") konu üzerinden eşleşir.
  const incomingTopics = new Set(topicsWithSymptomsOf(incoming).filter((t) => !COARSE_TOPICS.has(t)));
  return needTerms([cachedQuery])
    .filter((t) => !isScaffold(t))
    .every((t) => {
      const topics = topicsWithSymptomsOf(t);
      if (topics.length === 0 || needTermsInStrict([t], incoming) > 0) return true;
      const fine = topics.filter((x) => !COARSE_TOPICS.has(x));
      return fine.length > 0 && fine.some((x) => incomingTopics.has(x));
    });
}

/**
 * Anlama katmanının arama sorgusu kurarken eklediği İSKELE sözcükleri (katlanmış): ihtiyacı ayırmaz ("çöp konteyneri YERİ", "evcil hayvan
 * kabul POLİTİKASI", "havuz açık OLDUĞU saatler", "havlu SAĞLANIYOR mu"). Ölçümde (10-23) aynı ihtiyacın yeniden okunuşları yalnız bunlarda
 * ayrışıyordu. Konu, nitelik (ücret / saat / şifre) ya da koşul sözcüğü BURADA YOK.
 */
const SCAFFOLD_ROOTS = ["yer", "alan", "nokta", "oldug", "politika", "hizmet", "imkan", "imkân", "saglan", "bilgi", "mumkun", "durum", "konu", "hakkinda"];
function isScaffold(t: string): boolean {
  return SCAFFOLD_ROOTS.some((r) => t === r || (t.startsWith(r) && t.length - r.length <= 4));
}

// ─── kapı ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Yeni ihtiyaç (`incoming`) kayıtlı cevabın ihtiyacıyla (`cached`) aynı mı. `part` kayıtlı cevap parçası (yoksa yalnız soru kıyaslanır —
 * ölçer). Sıra ucuzdan pahalıya; ilk ret sebebi döner. Benzerlik puanı burada YOK — çağıran adayı bulur, izin buradan.
 */
export function reuseGate(cached: ReuseNeed, incoming: ReuseNeed, part = ""): ReuseGateResult {
  if (!REUSABLE_KINDS.has(incoming.kind)) return "kind_not_reusable";
  if (cached.kind !== incoming.kind) return "kind_mismatch";
  if (incoming.stayChange || cached.stayChange) return "stay_change";
  if (cached.language !== incoming.language) return "language_mismatch";
  // "Cumartesi havuz kaçta?" ≠ "Havuz kaçta?" — genel cevap o güne verilebilir olsa da ilk sürümde yalnız aynı koşul (temkinli).
  if (askedConditions(incoming.query).join(",") !== askedConditions(cached.query).join(",")) return "condition_mismatch";
  if (!covered(incoming.query, cached.query, part)) return "terms_not_covered";
  const answered = new Set([...questionAspects(cached.query), ...answerAspects(part)]);
  for (const a of questionAspects(incoming.query)) if (!answered.has(a)) return "aspect_not_answered";
  return "ok";
}

// ─── kayıt adaylığı ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Kişiye / ana bağlı sözler: kayıtlı cevap başka misafire, başka güne taşınamaz. Geçici durum ("bu hafta", "şu an", "currently",
 * "temporarily") da kalıcılaşmamalı (Opus güvenlik 10-23 F7: "This week the pool closes at 18:00" kayda giriyordu).
 */
const RELATIVE_TIME = new RegExp(
  String.raw`(?:^|[^\p{L}])(?:bugün|bugun|yarın|yarin|bu akşam|bu aksam|bu gece|bu sabah|bu hafta|bu ay|dün|dun|şu an|su an|şu anda|su anda|şimdi|simdi|şimdilik|simdilik|geçici|gecici|today|tomorrow|tonight|yesterday|this (?:week|evening|morning|month|weekend)|right now|currently|at the moment|temporarily|for now|heute|morgen|gestern|heute abend|diese woche|derzeit|zurzeit|momentan|vorübergehend|vorubergehend|сегодня|завтра|вчера|сейчас|на этой неделе|временно|aujourd|demain|cette semaine|actuellement|temporairement|hoy|mañana|manana|esta semana|actualmente|temporalmente|` +
    // R11: "şimdi / artık / bu sezon / until further notice / next week / aktuell …" da zamana bağlı.
    `now|until further notice|for the time being|these days|next (?:week|month)|this (?:summer|winter|season|year)|aktuell|jetzt|bis auf weiteres|` +
    `n[aä]chste woche|diesen sommer|en ce moment|la semaine prochaine|ahora|la pr[oó]xima semana|este verano|пока|в этом сезоне|` +
    String.raw`bu sezon|şu sıralar|su siralar|artık|artik|gelecek hafta|önümüzdeki|onumuzdeki|yakında|yakinda)(?:[^\p{L}]|$)`,
  "iu",
);

export type EntryEligibility = "ok" | "kind_not_reusable" | "relative_time" | "guest_name" | "empty";

/** Doğrulanmış bir parça kayıt adayı mı: tekrar kullanılabilir tür, metin dolu, göreli zaman yok, misafirin adı yok. */
export function entryEligible(need: ReuseNeed, part: string, guestNames: readonly (string | null | undefined)[] = []): EntryEligibility {
  if (!REUSABLE_KINDS.has(need.kind) || need.stayChange) return "kind_not_reusable";
  if (!part.trim()) return "empty";
  // Belirli tarih ("24 Ekim", "On 24 October") tek seferlik bir duruma aittir.
  if (RELATIVE_TIME.test(part) || partSignature(part).values.some((v) => v.startsWith("date:"))) return "relative_time";
  // Konu etiketinin ad kuralı (çekimli biçim, kesmesiz uzantı, Kiril okunuş): "Mehmetciğim", "Dear Ivan" ← "Иван Петров".
  const { isName } = guestNameMatcher(guestNames);
  if (fold(part).some((w) => isName(w))) return "guest_name";
  return "ok";
}

/** İki taze doğrulanmış cevap aynı bilgiyi mi veriyor: aynı değerler + aynı olumluluk (üslup farkı önemsiz). */
export function sameAnswer(a: string, b: string): boolean {
  const x = partSignature(a);
  const y = partSignature(b);
  return x.negative === y.negative && x.values.join(",") === y.values.join(",");
}

/**
 * Kayıtlı metin + yeni taze cevap → teyit kararı (Opus güvenlik 10-23 F7: değer + olumluluk aynıysa ilk metin aynen kalıyordu; tek misafirin
 * eklediği "Smoking is also allowed inside" cümlesi sonraki misafirlere gidecek metin olurdu). Aynı bilgi + içerik birinin ötekini kapsaması:
 *  · kayıtlı ⊆ yeni → teyit, kayıtlı metin kalır;
 *  · yeni ⊆ kayıtlı → teyit, kayıt YENİ (daha dar) metne iner — fazla içerik düşer;
 *  · ikisi de değil → farklı cevap (sıfırla).
 * Böylece kayıtlı metin her teyidin paylaştığı içeriğe daralır.
 */
export function confirmAnswer(stored: string, fresh: string): { same: false } | { same: true; text: string } {
  if (!sameAnswer(stored, fresh)) return { same: false };
  // Kayıtlı metin yalnız HARFİYEN kapsanıyorsa kalır; taze metin harfiyen ya da aynı söyleyişle (çıkış ~ check-out) kapsanıyorsa onun yerini
  // alır — kayıt hiçbir zaman sözlük konusu kısayoluyla korunmaz (R11).
  if (literallyCovered(stored, fresh)) return { same: true, text: stored };
  if (literallyCovered(fresh, stored) || contentCovered(fresh, stored)) return { same: true, text: fresh };
  return { same: false };
}

/** Teyidin geldiği konuşmanın kalıcı olmayan izi (kimlik kaydedilmez; aynı konuşma iki kez teyit sayılmaz). */
export function conversationKey(conversationId: string): string {
  return createHash("sha256").update(`reuse:${conversationId}`).digest("hex").slice(0, 16);
}

// ─── geçerlilik ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface FingerprintItem {
  id: string;
  updatedAt: Date;
  text: string;
}

/**
 * Cevabın konusunu anan kalemlerin sürüm parmak izi (kimlik + güncellenme + içerik özeti, sıralı). Kayıt yazılırken ve kullanılmadan önce
 * aynı konu sözcükleriyle hesaplanır: ilgili kalem EKLENİR ("Tadilat nedeniyle bu hafta çıkış 10:00"), değişir, silinir ya da onayı
 * kalkarsa (çağıran yalnız onaylı / etkin kalemleri verir) iz değişir → kayıt geçersiz. İlgisiz kalemin değişmesi kaydı bozmaz.
 */
export function relatedFingerprint(items: readonly FingerprintItem[], subjectQuery: string): string {
  const terms = needTerms([subjectQuery]);
  const topics = new Set(topicsWithSymptomsOf(subjectQuery).filter((t) => !COARSE_TOPICS.has(t)));
  const related = items
    .filter((it) => (terms.length > 0 && needTermsInStrict(terms, it.text) > 0) || topicsWithSymptomsOf(it.text).some((t) => topics.has(t)))
    .map((it) => `${it.id}|${it.updatedAt.toISOString()}|${createHash("sha256").update(it.text).digest("hex").slice(0, 16)}`)
    .sort();
  return createHash("sha256").update(related.join("\n")).digest("hex").slice(0, 32);
}

export interface ReuseEntry {
  need: ReuseNeed;
  partText: string;
  evidence: string;
  /** Dayanak kalemin kimliği (`kb:<id>` ya da `property`). */
  sourceId: string;
  /** Kayıt anındaki ilgili kalem parmak izi. */
  fingerprint: string;
  /** Aynı bilgiyi veren bağımsız taze doğrulanmış cevap sayısı. */
  confirmations: number;
  createdAt: Date;
}

export type RevalidateResult = { ok: true } | { ok: false; reason: "not_stable" | "expired" | "source_gone" | "sources_changed" } | { ok: false; reason: "binding"; issues: BindingIssue[] };

/**
 * Kayıt BUGÜN bu ihtiyaca kullanılabilir mi: kararlı (yeterli bağımsız teyit), süresi dolmamış, dayanak kalem duruyor, ilgili kalem izi
 * aynı, parça GÜNCEL kaynakla yeni ihtiyacın sözcükleriyle yeniden doğrulanıyor (değer ↔ konu ↔ koşul ↔ olumluluk ↔ yön; öteki kalemlerde
 * değişke). Dosya tarihine güvenmez: içerik bugünkü metinle yeniden sınanır.
 */
export function revalidateEntry(
  entry: ReuseEntry,
  current: { sourceText: string | null; otherSources: readonly string[]; fingerprint: string; now: Date },
  incoming: ReuseNeed,
): RevalidateResult {
  if (entry.confirmations < REUSE_STABLE_COUNT) return { ok: false, reason: "not_stable" };
  if (current.now.getTime() - entry.createdAt.getTime() > REUSE_MAX_AGE_DAYS * 86_400_000) return { ok: false, reason: "expired" };
  if (current.sourceText === null) return { ok: false, reason: "source_gone" };
  if (current.fingerprint !== entry.fingerprint) return { ok: false, reason: "sources_changed" };
  const binding = checkAnswerBinding({
    part: entry.partText,
    evidence: entry.evidence,
    sourceText: current.sourceText,
    otherSources: current.otherSources,
    needTerms: needTerms([incoming.query]),
    needTopics: topicsWithSymptomsOf(incoming.query),
  });
  return binding.ok ? { ok: true } : { ok: false, reason: "binding", issues: binding.issues };
}
