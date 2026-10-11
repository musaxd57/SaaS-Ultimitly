import "server-only";

import { prisma } from "@/lib/db";
import { aiReadableForConflicts, kbTimeConflicts } from "@/lib/kb-time-conflicts";
import { KB_CATEGORY } from "@/lib/constants";

// ---------------------------------------------------------------------------
// MÜLK HAFIZASI — OLASI ÇELİŞKİ UYARISI (değişmez 13; karar 26, kurucu 10-11: "1 ile 2 beraber; bilgi tabanı ve şikâyet iki kaynak
// birbiriyle çelişiyorsa uyarı gibi göster; bilerek olduğu işaretlenirse sorun yok").
//  (1) BİLGİ TABANI ↔ MİSAFİR: bilgi tabanında bir konuda kalem varken son 30 günde en az 3 AYRI misafir (konuşma) o BİLGİNİN yanlış /
//      olmadığını söyledi ("şifre yanlış", "otopark yok"). Arıza şikâyeti ("Wi-Fi çalışmıyor") SAYILMAZ (kurucu 10-11). Konu, anlama
//      katmanının konuşma öğesinden; "bilgi yanlış" kararı mesaj metninden (`statesInfoWrong`). Metin taşınmaz, yalnız sayılır.
//  (2) BİLGİ TABANI ↔ BİLGİ TABANI / MÜLK AYARI: uyuşmayan giriş / çıkış saatleri (`kb-time-conflicts.ts`, bilgi tabanı sayfasıyla aynı).
// Yalnız EV SAHİBİNE gösterilir; yapay zekâya GİTMEZ, cevapları değiştirmez. Ev sahibi "Bilerek böyle" derse ilgili hafıza kalemlerine
// `humanOverrideAt` yazılır ve uyarı kalkar; kalem sonradan değişirse (`observedAt` > işaret) uyarı yeniden değerlendirilir.
// LLM yok, deterministik; şema değişikliği yok (alanlar V1'de vardı).
// ---------------------------------------------------------------------------

export const CONTRADICTION_WINDOW_DAYS = 30;
export const CONTRADICTION_MIN_GUESTS = 3;

/**
 * Konuşma öğesi konusu (anlama niyeti) → bilgi tabanı kategorisi. Yalnız "bilgi yanlış" cümlesinin tanımlı olduğu konular (aşağıda);
 * giriş / çıkış SAATİ çelişkisi metinle değil (2) saat denetimiyle bulunur.
 */
export const ITEM_TOPIC_TO_KB: Readonly<Record<string, string>> = Object.freeze({
  wifi: "wifi",
  parking: "parking",
  cleaning_linen: "cleaning",
  trash: "trash",
  access_keys: "checkin",
  directions_transport: "location",
});

/**
 * 🚨 ÇELİŞKİ = misafir bilgi tabanındaki BİLGİNİN KENDİSİNİN yanlış ya da olmadığını söylüyor (kurucu 10-11: "Wi-Fi'nin çalışmamasının
 * sebebi şifre veya yanlış ağ olması değil"). İlk kural "Wi-Fi çalışmıyor" ARIZA şikâyetini de sayıyor ve ev sahibine "bilgi güncel mi?"
 * diyordu — yanlıştı. SAYILAN: şifre / kapı kodu yanlış, kabul edilmiyor, değişmiş · "X diye bir ağ yok" / ağ adı yanlış · otopark / havlu /
 * çöp konteyneri yok · adres / konum yanlış. SAYILMAYAN: arıza / kesinti / yavaşlık ("Wi-Fi çalışmıyor", "internet yok", "kapı kodu tuş
 * takımı çalışmıyor"), anlık durum ("otopark dolu", "No parking spaces left", "havlu kirli", "temiz havlu yok"), bulamamak ("otoparkı
 * bulamadık" — misafir kaybolmuş olabilir), soru / tahmin ("şifre yanlış mı", "yanlış olabilir mi", "Could the password be wrong"), koşul
 * ("yanlışsa"), olumsuzlama ("yanlış değil"), misafirin kendi hatası ("yanlış yazmıştım", "I typed the password wrong"), telefonun konumu.
 * 🚨 Özne ile fiil arasına YALNIZ dolgu sözcükleri girebilir (`FILLER`: "verdiğiniz", "hâlâ", "is", "you gave"…, en çok 6): Haiku 10-11
 * "Kapı kodu tuş takımı çalışmıyor", "Otopark yakınında market yok" gibi araya başka bir şey giren cümlelerin sayıldığını gösterdi.
 * Yalnız Türkçe + İngilizce (öteki diller sayılmaz — temkinli: uyarı kaçabilir, yanlış uyarı üretmez). Metin Türkçe ASCII katlanır, yatay
 * boşluk dizisi teke iner (geriye bakışlar sabit uzunlukta kalır — karesel iş yok).
 */
const W = "(?<![\\p{L}\\p{N}])"; // sözcük başı
const E = "(?![\\p{L}\\p{N}])"; // sözcük sonu
const FILLER = [
  "de", "da", "hic", "hala", "bile", "maalesef", "malesef", "galiba", "sanirim", "herhalde", "gercekten", "tamamen", "kesinlikle", "yine",
  "gene", "hep", "bu", "su", "o", "sizin", "bize", "bizim", "verdiginiz", "verilen", "gonderdiginiz", "gonderilen", "paylastiginiz",
  "paylasilan", "yazdiginiz", "yazan", "yazili", "belirtilen", "listedeki", "ilandaki", "rehberdeki", "karttaki", "mesajdaki",
  "mesajinizdaki", "uygulamadaki", "ilanda", "rehberde", "kartta", "mesajda", "denedik", "denedim", "denedigimiz", "aslinda", "resmen",
  "zaten", "artik", "simdi", "suan", "kesin", "cidden",
  "is", "was", "are", "were", "seems", "seem", "seemed", "still", "also", "just", "really", "you", "gave", "sent", "provided", "listed",
  "given", "shared", "wrote", "in", "on", "the", "a", "an", "your", "our", "us", "me", "guide", "listing", "message", "card", "app", "book",
  "manual", "instructions", "we", "i", "got", "that", "which", "from", "again", "definitely", "totally", "apparently", "actually", "simply",
  "completely", "always", "has", "have", "had", "been", "be", "it", "its", "it's", "clearly", "unfortunately", "sadly", "they", "there",
  "here", "for", "this", "said", "says",
].join("|");
const SEP = "[ :\"'“”–-]{1,3}";
/** Özne ile fiil arası: ayraç + en çok 6 dolgu sözcüğü. */
const GAP = `(?:${SEP}(?:${FILLER})${E}){0,6}${SEP}`;
/** Misafirin KENDİ hatası (birinci kişi: "yazmışım / girmiştim / seçtim"); "yanlış yazılmış / vermişsiniz" ev sahibinin hatasıdır, sayılır. */
const SELF = "(?:yaz|gir|tusla|kullan|sec)(?:d[iu]m|d[iu]k|mis(?:im|iz|tim|tik)|iyor(?:um|uz))";
/** Fiilden sonra: soru eki ("yok mu"), olumsuzlama ("yanlış değil"), tahmin ("olabilir"), kendi hatası ("yanlış yazmışım"). */
const TAIL = `${E}(?! (?:m[iu]\\p{L}{0,4}${E}|degil|olabilir|\\p{L}{1,12} olabilir|${SELF}${E}))`;
/** İngilizce kendi hatası fiilden ÖNCE gelir ("I typed the password wrong"); sınırlı geriye bakış. */
const SELF_EN_BEFORE =
  "(?<!(?:typed|typing|type|entered|entering|enter|put|putting|used|using|use|tried|trying|try|mistyped|input|chose|picked|selected)[\\p{L}' -]{1,30})";
/** Türkçe kendi hatası özneden ÖNCE ("girdiğim şifre yanlış"). */
const SELF_TR_BEFORE = "(?<!(?:girdigi|yazdigi|tusladigi|sectigi|kullandigi)\\p{L}{0,3} )";
const fwd = (subject: string, verb: string) =>
  new RegExp(`${SELF_TR_BEFORE}${W}(?:${subject})${E}${GAP}${SELF_EN_BEFORE}(?:${verb})${TAIL}`, "u");
/** Sıfat / "there is no" + özne (bitişik; araya yalnız tanımlık). Kendi hatası ("typed in the wrong password", "yanlış şifre girmişim") hariç. */
const rev = (adj: string, subject: string, notAfter = "") =>
  new RegExp(
    `(?<!(?:typed|typing|type|entered|entering|enter|put|putting|used|using|use|tried|trying|try|chose|picked|selected)(?: in)?(?: the| a| an)? )${W}(?:${adj}) (?:the |a |an |any |bir )?(?:${subject})${E}(?! ${SELF}${E}${notAfter ? `| (?:${notAfter})${E}` : ""})`,
    "u",
  );

const WRONG_TR =
  "yanlis(?:ti|mis|tir)?|hatali(?:ydi|ymis|dir)?|gecersiz(?:di|mis|dir)?|dogru degil(?:di|mis)?|degis(?:mis|ti|tirilmis|tirildi|tirmissiniz|tirdiniz|tirmis)";
const WRONG_EN = "wrong|incorrect|invalid|outdated|changed|not correct|not right|isn'?t correct|isn'?t right|not valid";
const REJECTED = "kabul (?:etmiyo(?:r(?:du)?)?|etmedi|etmez|edilmiyo(?:r)?|edilmedi)|not accepted|isn'?t accepted|wasn'?t accepted|rejected|doesn'?t accept|didn'?t accept";
const NOT_WORK =
  "calismiyo(?:r(?:du)?)?|calismadi|olmuyo(?:r(?:du)?)?|olmadi|tutmuyo(?:r)?|tutmadi|acmiyo(?:r)?|acmadi|acilmiyo(?:r)?|acilmadi|doesn'?t work|does not work|didn'?t work|did not work|isn'?t working|not working|won'?t work";
const MISSING_TR = "yok(?:tu|mus|tur)?|bulunmuyo(?:r(?:du)?)?|mevcut degil(?:di)?|eksik(?:ti|tir)?|konulmamis|konmamis|verilmemis";
const MISSING_EN = "missing|not there|wasn'?t there|weren'?t there|isn'?t there|aren'?t there|doesn'?t exist|does not exist|don'?t exist|didn'?t exist|not provided|wasn'?t provided|weren'?t provided";
const NO_EN = "there(?:'s| is| was| are| were) no|no";

const WIFI_WORD = "(?:wifi|wi-?fi|wi fi|internet|modem|wlan)(?:'?\\p{L}{0,4})?";
const PASSWORD = `(?<!(?:kapi|kilit|giris|bina|daire|kutu|kasa|door|lock|gate|box|keypad)\\p{L}{0,4}'? )(?:sifre(?!siz)\\p{L}{0,6}|parola\\p{L}{0,4}|passwords?|${WIFI_WORD} kod\\p{L}{0,4})`;
const NETWORK_NAME = "(?:ag|wifi|wi-?fi|wi fi|network|wlan)(?:'?\\p{L}{0,4})? (?:adi|ismi|name)|ssid";
const DOOR_CODE = `(?<!${WIFI_WORD} |ag\\p{L}{0,4} )(?:kod\\p{L}{0,7}|(?:kapi|giris)\\p{L}{0,4} sifre\\p{L}{0,4}|codes?|pin|(?:door|lock|access|keypad) codes?)`;
const PARKING = "otopark(?:i|imiz|iniz)?|parking(?: lot| garage)?|car park|garage";
const LINEN = "havlu(?:su|lar|lari|larimiz|lariniz)?|nevresim(?:i|ler|leri)?|carsaf(?:i|lar|lari)?|towels?|sheets?|bed ?linens?|linens?";
const BINS = "(?:cop )?konteyner(?:i|ler|leri)?|cop kutusu|cop kovasi|cop alani|(?:trash|garbage) (?:bin|can|area)s?|bins?|dumpster";
const PLACE = "(?<!(?:telefon|phone|gps|harita|map|my|benim|google)\\p{L}{0,4}'? )(?:adres(?:iniz|i)?|konum(?:unuz|u)?|address|location|map pin)";
const FULL_NOW = "spaces?|spots?|left|available|nearby|free";

const INFO_WRONG: Readonly<Record<string, readonly RegExp[]>> = {
  // Şifre yanlış / kabul edilmiyor · ağ adı yanlış · "X diye bir ağ yok". Çıplak "Wi-Fi / internet çalışmıyor / yok" ARIZADIR, öznesi şifre /
  // ağ adı değil; "ağ yok" da arızadır (yalnız "ağ yanlış" sayılır).
  wifi: [
    fwd(PASSWORD, `${WRONG_TR}|${WRONG_EN}|${REJECTED}|${NOT_WORK}`),
    rev("yanlis|hatali|gecersiz|wrong|incorrect|invalid", PASSWORD),
    fwd(NETWORK_NAME, `${WRONG_TR}|${WRONG_EN}|${MISSING_TR}|gorunmuyo(?:r)?|cikmiyo(?:r)?`),
    fwd("ag(?:i|iniz)?", `${WRONG_TR}|${WRONG_EN}`),
    new RegExp(`${W}(?:diye|adli|adinda|isimli|isminde|boyle|bu isimde|bu adda) bir ag(?:i)?${E}${GAP}(?:${MISSING_TR}|gorunmuyo(?:r)?|gorunmedi|cikmiyo(?:r)?|cikmadi)${TAIL}`, "u"),
    new RegExp(
      `${W}(?:no such (?:network|wifi|wi-?fi)|no (?:network|wifi|wi-?fi) (?:called|named)|(?:network|wifi|wi-?fi) (?:called|named)[^.!?;,\\n]{1,40}?(?:not showing|isn'?t showing|doesn'?t show|does not show|not visible|not there|isn'?t there|doesn'?t exist|does not exist|not found|can'?t be found))${E}`,
      "u",
    ),
  ],
  checkin: [fwd(DOOR_CODE, `${WRONG_TR}|${WRONG_EN}|${REJECTED}|${NOT_WORK}`), rev("yanlis|hatali|gecersiz|wrong|incorrect|invalid", DOOR_CODE)],
  // "Otopark dolu" / "otoparkta yer yok" / "No parking spaces left" anlık durumdur, sayılmaz.
  parking: [fwd(PARKING, `${MISSING_TR}|${MISSING_EN}`), rev(NO_EN, PARKING, FULL_NOW)],
  // "Ekstra / fazla / temiz havlu yok" bilgi çelişkisi değildir (önünde niteleyici varsa sayılmaz).
  cleaning: [
    fwd(`(?<!(?:fazla|fazladan|ekstra|extra|yedek|more|additional|yeterli|enough|temiz|clean|baska|yeni|new|spare|fresh) )(?:${LINEN})`, `${MISSING_TR}|${MISSING_EN}`),
    rev(NO_EN, LINEN),
  ],
  trash: [fwd(BINS, `${MISSING_TR}|${MISSING_EN}`), rev(NO_EN, BINS, FULL_NOW)],
  // Adres / konum YANLIŞ ("konum çalışmıyor" ve telefonun konumu sayılmaz).
  location: [fwd(PLACE, `${WRONG_TR}|${WRONG_EN}|tutmuyo(?:r)?|tutmadi`), rev("yanlis|hatali|wrong|incorrect", PLACE)],
};

const TR_ASCII: Record<string, string> = { ı: "i", ş: "s", ğ: "g", ç: "c", ö: "o", ü: "u" };
const foldTr = (t: string) =>
  t
    .toLocaleLowerCase("tr")
    .replace(/[ışğçöü]/g, (c) => TR_ASCII[c] ?? c)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[’‘ʼ`´]/g, "'")
    .replace(/[^\S\n]+/g, " ");

/** Soru / tahmin cümlesi: soru işaretiyle biter, İngilizce yardımcı fiille başlar ("Could the password be wrong"), ya da "acaba" içerir. */
const QUESTION_CLAUSE = /\?\s*$|^\s*(?:could|can|is|are|was|were|does|do|did|should|might|may|would|will|has|have)(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])acaba(?![\p{L}\p{N}])/u;

/** Okunan en uzun metin (daha uzun mesajın başı okunur; kalıplar doğrusal). */
export const INFO_WRONG_MAX_CHARS = 8_000;

/** Misafir bu mesajda bu kategorinin bilgisinin YANLIŞ / OLMADIĞINI söylüyor mu (soru / tahmin cümleleri sayılmaz). */
export function statesInfoWrong(body: string, kbCategory: string): boolean {
  const rules = INFO_WRONG[kbCategory];
  if (!rules || typeof body !== "string" || !body.trim()) return false;
  const clauses = foldTr(body.slice(0, INFO_WRONG_MAX_CHARS)).match(/[^.!?;\n]+[.!?;\n]*/g) ?? [];
  return clauses.some((c) => !QUESTION_CLAUSE.test(c) && rules.some((re) => re.test(c)));
}

export interface ConversationItemLite {
  conversationId: string;
  messageId: string;
  kind: string;
  createdAt: Date;
}

/**
 * Misafir mesajında konu öğesi + metin o konunun bilgisinin yanlış / olmadığını söylüyor → (konuşma, bilgi tabanı kategorisi) çiftleri.
 * Metni olmayan mesaj sayılmaz. Şikâyet öğesi ŞART DEĞİL ("Wi-Fi şifresi yanlış" anlama katmanında yalnız wifi olabilir) — karar metinde.
 */
export function infoWrongReports(
  items: readonly ConversationItemLite[],
  bodies: ReadonlyMap<string, string>,
): { conversationId: string; kbCategory: string; at: Date }[] {
  const out: { conversationId: string; kbCategory: string; at: Date }[] = [];
  const seen = new Set<string>();
  for (const i of items) {
    const kb = ITEM_TOPIC_TO_KB[i.kind];
    if (!kb) continue;
    const key = `${i.messageId}:${kb}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!statesInfoWrong(bodies.get(i.messageId) ?? "", kb)) continue;
    out.push({ conversationId: i.conversationId, kbCategory: kb, at: i.createdAt });
  }
  return out;
}

export interface TimeRowLite {
  text: string;
  itemIds: readonly string[];
  /** Mülk ayarı ↔ bilgi tabanı satırı: işaret, mülk ayarı SONRADAN değişirse geçersiz (Haiku 4. tur). */
  againstPropertyUpdatedAt?: Date | null;
}

export interface FactLite {
  id: string;
  category: string;
  /** Kaynak bilgi tabanı kaleminin kimliği (`sourceRef`). */
  kbItemId: string;
  observedAt: Date;
  humanOverrideAt: Date | null;
}

export interface ContradictionWarning {
  kind: "kb_vs_complaints" | "kb_vs_kb";
  /** İlgili bilgi tabanı hafıza kalemleri ("Bilerek böyle" bunlara yazılır). */
  memoryIds: string[];
  text: string;
}

const acknowledged = (facts: readonly FactLite[], alsoAfter: Date | null = null) =>
  facts.length > 0 &&
  facts.every(
    (f) =>
      f.humanOverrideAt !== null &&
      f.humanOverrideAt.getTime() >= f.observedAt.getTime() &&
      (alsoAfter === null || f.humanOverrideAt.getTime() >= alsoAfter.getTime()),
  );

/** Saf karar: olası çelişkiler (ev sahibinin "bilerek" işaretlediği ve sonra değişmeyenler hariç). */
export function detectContradictions(input: {
  facts: readonly FactLite[];
  topics: readonly { conversationId: string; kbCategory: string; at: Date }[];
  timeRows: readonly TimeRowLite[];
  now: Date;
}): ContradictionWarning[] {
  const out: ContradictionWarning[] = [];
  const since = input.now.getTime() - CONTRADICTION_WINDOW_DAYS * 86_400_000;
  const guestsByCategory = new Map<string, Set<string>>();
  for (const t of input.topics) {
    if (t.at.getTime() < since || t.at.getTime() > input.now.getTime()) continue;
    const set = guestsByCategory.get(t.kbCategory) ?? new Set<string>();
    set.add(t.conversationId);
    guestsByCategory.set(t.kbCategory, set);
  }
  for (const [category, guests] of [...guestsByCategory.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (guests.size < CONTRADICTION_MIN_GUESTS) continue;
    const facts = input.facts.filter((f) => f.category === category);
    if (facts.length === 0 || acknowledged(facts)) continue;
    out.push({
      kind: "kb_vs_complaints",
      memoryIds: facts.map((f) => f.id),
      text: `Son ${CONTRADICTION_WINDOW_DAYS} günde ${guests.size} misafir bilgi tabanındaki "${KB_CATEGORY.label(category)}" bilgisinin yanlış olduğunu bildirdi. Kontrol edin.`,
    });
  }
  for (const row of input.timeRows) {
    const facts = input.facts.filter((f) => row.itemIds.includes(f.kbItemId));
    if (facts.length === 0 || acknowledged(facts, row.againstPropertyUpdatedAt ?? null)) continue;
    out.push({ kind: "kb_vs_kb", memoryIds: facts.map((f) => f.id), text: row.text });
  }
  return out;
}

/** Mülk sayfası için: kiracı + mülk kapsamlı olası çelişkiler. Okunamazsa çağıran boş liste gösterir. */
export async function getMemoryContradictions(organizationId: string, propertyId: string, now: Date = new Date()): Promise<ContradictionWarning[]> {
  const since = new Date(now.getTime() - CONTRADICTION_WINDOW_DAYS * 86_400_000);
  const [property, facts, items, kbItems] = await Promise.all([
    prisma.property.findFirst({ where: { id: propertyId, organizationId }, select: { checkInTime: true, checkOutTime: true, updatedAt: true } }),
    prisma.propertyMemory.findMany({
      where: { organizationId, propertyId, status: "active", kind: "fact", source: "kb_item" },
      select: { id: true, category: true, sourceRef: true, observedAt: true, humanOverrideAt: true },
      orderBy: { id: "asc" },
    }),
    prisma.conversationItem.findMany({
      where: {
        organizationId,
        createdAt: { gte: since, lte: now },
        kind: { in: Object.keys(ITEM_TOPIC_TO_KB) },
        conversation: { propertyId },
      },
      select: { conversationId: true, messageId: true, kind: true, createdAt: true },
      // En yeniden (Haiku 4. tur: sırasız tavan, sayfa açılışları arasında farklı sonuç verebiliyordu); `id` eşitlik bozucu.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 2_000,
    }),
    prisma.knowledgeBaseItem.findMany({
      where: { propertyId, property: { organizationId } },
      select: { id: true, title: true, category: true, content: true, isActive: true, reviewState: true, updatedAt: true, supersededById: true },
    }),
  ]);
  if (!property) return [];
  const timeRows: TimeRowLite[] = kbTimeConflicts(property, aiReadableForConflicts(kbItems)).map((r) => ({
    text: r.text,
    itemIds: r.sides.map((s) => s.itemId),
    againstPropertyUpdatedAt: r.kind === "property" ? property.updatedAt : null,
  }));
  // Karar METİNDE: konu öğesi olan BÜTÜN mesajların metni okunur (500'lük parçalar — Haiku 10-11: eski tavan fazlasını sessizce
  // saymıyordu); kiracı + mülk kapsamlı.
  const candidateMessageIds = [...new Set(items.map((i) => i.messageId))];
  const bodies = new Map<string, string>();
  for (let i = 0; i < candidateMessageIds.length; i += 500) {
    const rows = await prisma.message.findMany({
      where: { id: { in: candidateMessageIds.slice(i, i + 500) }, conversation: { propertyId, property: { organizationId } } },
      select: { id: true, body: true },
    });
    for (const m of rows) bodies.set(m.id, m.body ?? "");
  }
  return detectContradictions({
    facts: facts.map((f) => ({ id: f.id, category: f.category, kbItemId: f.sourceRef, observedAt: f.observedAt, humanOverrideAt: f.humanOverrideAt })),
    topics: infoWrongReports(items, bodies),
    timeRows,
    now,
  });
}

/** "Bilerek böyle": yalnız bu mülkün bilgi tabanı hafıza kalemlerine işaret (başka kiracı / mülk / kaynak sessizce atlanır). */
export async function acknowledgeContradiction(
  organizationId: string,
  propertyId: string,
  memoryIds: readonly string[],
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const res = await prisma.propertyMemory.updateMany({
    where: { id: { in: [...memoryIds] }, organizationId, propertyId, source: "kb_item", kind: "fact" },
    data: { humanOverrideAt: now, humanOverrideUserId: userId },
  });
  return res.count;
}
