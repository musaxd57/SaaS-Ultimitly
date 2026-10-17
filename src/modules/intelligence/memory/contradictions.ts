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
 * ("yanlışsa", "yanlış olursa"), olumsuzlama ("yanlış değil"), misafirin kendi hatası ("yanlış yazmıştım", "girdiğim Wi-Fi şifresi",
 * "I typed the password wrong"), telefonun konumu, "şu an / right now" (anlık), "no parking problem", kapı / ağ görünürlüğü ("kapı kodu
 * açılmıyor", "Wi-Fi adı görünmüyor" — kilit / modem arızası olabilir). Çekince bildirim SAYILIR ("şifre galiba yanlış", "I think the
 * password is wrong" — misafir yaşadığını söylüyor); olasılık SAYILMAZ ("belki", "maybe", "olabilir", "could be"). Soru işaretli cümlede
 * yalnız son virgül bölümü soru sayılır ("Şifre yanlış, kontrol eder misiniz?" → sayılır).
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
  "zaten", "artik", "kesin", "cidden", "bizde",
  "is", "was", "are", "were", "seems", "seem", "seemed", "still", "also", "just", "really", "you", "gave", "sent", "provided", "listed",
  "given", "shared", "wrote", "in", "on", "the", "a", "an", "your", "our", "us", "me", "guide", "listing", "message", "card", "app", "book",
  "manual", "instructions", "we", "i", "got", "that", "which", "from", "again", "definitely", "totally", "apparently", "actually", "simply",
  "completely", "always", "has", "have", "had", "been", "be", "it", "its", "it's", "clearly", "unfortunately", "sadly", "they", "there",
  "here", "for", "this", "said", "says",
].join("|");
const SEP = "[ ,:\"'“”–-]{1,3}";
/** Özne ile fiil arası: ayraç + en çok 6 dolgu sözcüğü. */
const GAP = `(?:${SEP}(?:${FILLER})${E}){0,6}${SEP}`;
/** Misafirin KENDİ hatası (birinci kişi: "yazmışım / girmiştim / seçtim"); "yanlış yazılmış / vermişsiniz" ev sahibinin hatasıdır, sayılır. */
const SELF = "(?:yaz|gir|tusla|kullan|sec)(?:d[iu]m|d[iu]k|mis(?:im|iz|tim|tik)|iyor(?:um|uz)|d[iu]g[iu]m(?:[iu]z)?\\p{L}{0,3})";
/** Fiilden / sıfat öbeğinden sonra: soru eki ("yok mu"), olumsuzlama ("yanlış değil"), olasılık / koşul ("olabilir", "olursa"), kendi hatası. */
const NOT_AFTER = `m[iu]\\p{L}{0,4}${E}|degil|olabilir|olursa|cikarsa|ise${E}|\\p{L}{1,12} olabilir|(?:ben |biz )?${SELF}${E}`;
/** Ayraç (virgül dahil) ardından da okunur — Haiku 10-11 3. tur: "Şifre yanlış, olabilir" virgül yüzünden sayılıyordu. */
const tailWith = (extra = "") => `${E}(?!${SEP}(?:${NOT_AFTER}${extra ? `|(?:${extra})${E}` : ""}))`;
const TAIL = tailWith();
/** İngilizce kendi hatası fiilden ÖNCE gelir ("I typed the password wrong"); sınırlı geriye bakış. */
const SELF_EN_BEFORE =
  "(?<!(?:typed|typing|type|entered|entering|enter|put|putting|used|using|use|tried|trying|try|mistyped|input|chose|picked|selected)[\\p{L}' -]{1,30})";
const WIFI_WORD = "(?:wifi|wi-?fi|wi fi|internet|modem|wlan)(?:'?\\p{L}{0,4})?";
/** Türkçe kendi hatası özneden ÖNCE ("girdiğim şifre", "girdiğim Wi-Fi şifresi"; birinci kişi — "girdiğiniz" ev sahibininkidir). */
const SELF_TR_BEFORE = `(?<!(?:girdigi|yazdigi|tusladigi|sectigi|kullandigi)m\\p{L}{0,3} (?:${WIFI_WORD} |kapi\\p{L}{0,4} )?)`;
/**
 * Anlık durum: "şu an otopark yok", "Otopark yok şu an", "No parking right now" bilgi çelişkisi değildir (yalnız VARLIK kategorilerinde —
 * "şu an şifre yanlış" yine bilgi yanlışıdır). Önde zarf ile özne arasına en çok iki dolgu / gün parçası sözcüğü girebilir (Haiku 3. tur:
 * serbest 20 karakterlik pencere "Bugün ev sahibi bize yanlış şifre verdi"yi düşürüyordu).
 */
const NOW_WORDS = "su an|su anda|suan|simdi|simdilik|bugun|bu aksam|bu gece|henuz|currently|right now|today|tonight|at the moment|for now";
const NOT_NOW_BEFORE = `(?<!${W}(?:${NOW_WORDS})(?:${SEP}(?:${FILLER}|sabah|aksam|ogle|oglen|gece|morning|evening|afternoon|night)){0,2}${SEP})`;
/**
 * Özne + dolgu + fiil. `selfEn`: İngilizce kendi hatası geriye bakışı (yalnız "wrong" ailesinde anlamlı). `enterGap`: misafirin şifreyi
 * GİRDİĞİNİ söyleyip reddedildiğini anlattığı yol ("Şifreyi girdim ama kabul etmiyor") — yalnız açık ret fiillerinde kullanılır.
 */
const ENTER_FILLER = "girdim|girdik|denedim|denedik|yazdim|yazdik|tusladim|tusladik|ama|fakat|ancak|entered|tried|typed|but|and";
const fwd = (subject: string, verb: string, opts: { selfEn?: boolean; enterGap?: boolean; now?: boolean } = {}) =>
  new RegExp(
    `${opts.now ? NOT_NOW_BEFORE : ""}${SELF_TR_BEFORE}${W}(?:${subject})${E}${opts.enterGap ? `(?:${SEP}(?:${FILLER}|${ENTER_FILLER})${E}){0,6}${SEP}` : GAP}${opts.selfEn ? SELF_EN_BEFORE : ""}(?:${verb})${opts.now ? tailWith(NOW_WORDS) : TAIL}`,
    "u",
  );
/**
 * Sıfat / "there is no" + özne (bitişik; araya yalnız tanımlık ve izinli ön ek). Kendi hatası ("typed in the wrong password", "yanlış şifre
 * girmişim", "the wrong password I typed"), olumsuzlama / olasılık ("yanlış şifre değil / olabilir") ve `notAfter` (anlık durum) hariç.
 */
const rev = (adj: string, subject: string, notAfter = "", now = false) =>
  new RegExp(
    `(?<!(?:typed|typing|type|entered|entering|enter|put|putting|used|using|use|tried|trying|try|chose|picked|selected)[\\p{L}' -]{0,30} )${now ? NOT_NOW_BEFORE : ""}${W}(?:${adj}) (?:the |a |an |any |bir )?(?:${subject})${E}(?!${SEP}(?:${NOT_AFTER}|(?:i|we) (?:typed|entered|used|put|tried|chose|picked)${E}${notAfter ? `|(?:${notAfter})${E}` : ""}))`,
    "u",
  );

const WRONG_TR =
  "yanlis(?:ti|mis|tir)?|hatali(?:ydi|ymis|dir)?|gecersiz(?:di|mis|dir)?|dogru degil(?:di|mis)?|gecerli degil(?:di|mis)?|degis(?:mis|ti|tirilmis|tirildi|tirmissiniz|tirdiniz|tirmis)";
const WRONG_EN = "wrong|incorrect|invalid|outdated|changed|not correct|not right|isn'?t correct|isn'?t right|not valid";
const REJECTED = "kabul (?:etmiyo(?:r(?:du)?)?|etmedi|etmez|edilmiyo(?:r)?|edilmedi)|not accepted|isn'?t accepted|wasn'?t accepted|rejected|doesn'?t accept|didn'?t accept";
/** "Açmıyor / açılmıyor" YOK: kapının / kilidin arızası olabilir (Haiku 10-11, kurucunun Wi-Fi örneğiyle aynı sınıf). */
const NOT_WORK =
  "calismiyo(?:r(?:du)?)?|calismadi|olmuyo(?:r(?:du)?)?|olmadi|tutmuyo(?:r)?|tutmadi|ise yara(?:miyo(?:r)?|madi)|doesn'?t work|does not work|didn'?t work|did not work|isn'?t working|not working|won'?t work";
const MISSING_TR = "yok(?:tu|mus|tur)?|bulunmuyo(?:r(?:du)?)?|mevcut degil(?:di)?|eksik(?:ti|tir)?|konulmamis|konmamis|verilmemis";
const MISSING_EN = "missing|not there|wasn'?t there|weren'?t there|isn'?t there|aren'?t there|doesn'?t exist|does not exist|don'?t exist|didn'?t exist|not provided|wasn'?t provided|weren'?t provided";
const NO_EN = "there(?:'s| is| was| are| were) no|there (?:aren'?t|weren'?t|isn'?t|wasn'?t) any|(?:we )?(?:don'?t|didn'?t) have(?: any)?|no";

const PASSWORD_CORE = `sifre(?!siz)\\p{L}{0,6}|parola\\p{L}{0,4}|passwords?|${WIFI_WORD} (?:kod\\p{L}{0,4}|codes?)`;
const PASSWORD = `(?<!(?:kapi|kilit|giris|bina|daire|kutu|kutusu|kasa|door|lock|gate|box|keypad|building|lockbox)\\p{L}{0,4}'? )(?:${PASSWORD_CORE})`;
const NETWORK_NAME = "(?:ag|wifi|wi-?fi|wi fi|network|wlan)(?:'?\\p{L}{0,4})? (?:adi|ismi|name)|ssid";
const DOOR_PLACE = "(?:kapi|giris|bina|daire|kilit|anahtar kutusu|kutu|kasa)\\p{L}{0,4}";
const DOOR_CORE = `kod\\p{L}{0,7}|${DOOR_PLACE} (?:sifre|parola)\\p{L}{0,4}|codes?|pin|(?:door|lock|access|keypad|gate|building|lockbox|key box) (?:codes?|passwords?|pins?)`;
const DOOR_CODE = `(?<!${WIFI_WORD} |ag\\p{L}{0,4} )(?:${DOOR_CORE})`;
const PARKING = "otopark(?:i|imiz|iniz)?|parking(?: lot| garage)?|car park|garage";
const LINEN = "havlu(?:su|lar|lari|larimiz|lariniz)?|nevresim(?:i|ler|leri)?|carsaf(?:i|lar|lari)?|towels?|sheets?|bed ?linens?|linens?";
const BINS = "(?:cop )?konteyner(?:i|ler|leri)?|cop kutusu|cop kovasi|cop alani|cop bidon(?:u|lari)|(?:trash|garbage) (?:bin|can|area)s?|bins?|dumpster";
const PLACE = "(?<!(?:telefon|phone|gps|harita|map|my|benim|google)\\p{L}{0,8}'? )(?:adres(?:iniz|i)?|konum(?:unuz|u)?|address|location|map pin)";
const FULL_NOW = `spaces?|spots?|left|available|nearby|free|problems?|issues?|${NOW_WORDS}`;

const INFO_WRONG: Readonly<Record<string, readonly RegExp[]>> = {
  // Şifre yanlış / kabul edilmiyor · ağ adı yanlış · "X diye bir ağ yok". Çıplak "Wi-Fi / internet çalışmıyor / yok" ARIZADIR, öznesi şifre /
  // ağ adı değil; "ağ yok" da arızadır (yalnız "ağ yanlış" sayılır).
  wifi: [
    fwd(PASSWORD, `${WRONG_TR}|${WRONG_EN}`, { selfEn: true }),
    fwd(PASSWORD, NOT_WORK),
    fwd(PASSWORD, REJECTED, { enterGap: true }),
    rev("yanlis|hatali|gecersiz|wrong|incorrect|invalid", `(?:${WIFI_WORD} )?(?:${PASSWORD_CORE})`),
    // Ağ adı YANLIŞ sayılır; "Wi-Fi adı görünmüyor" modem kapalı da olabilir → yalnız VERİLEN ada atıfla sayılır: "X diye bir ağ yok /
    // görünmüyor", "böyle bir ağ yok", "no such network" ("böyle / such" verilen adı gösterir — Haiku 3. tur itirazı reddedildi).
    fwd(NETWORK_NAME, `${WRONG_TR}|${WRONG_EN}`, { selfEn: true }),
    fwd("ag(?:i|iniz)?", `${WRONG_TR}|${WRONG_EN}`, { selfEn: true }),
    new RegExp(`${W}(?:diye|adli|adinda|isimli|isminde|boyle|bu isimde|bu adda) bir ag(?:i)?${E}${GAP}(?:${MISSING_TR}|gorunmuyo(?:r)?|gorunmedi|cikmiyo(?:r)?|cikmadi)${TAIL}`, "u"),
    new RegExp(
      `${W}(?:no such (?:network|wifi|wi-?fi)|no (?:network|wifi|wi-?fi) (?:called|named)|(?:network|wifi|wi-?fi) (?:called|named)[^.!?;,\\n]{1,40}?(?:not showing|isn'?t showing|doesn'?t show|does not show|not visible|not there|isn'?t there|doesn'?t exist|does not exist|not found|can'?t be found))${E}`,
      "u",
    ),
  ],
  checkin: [
    fwd(DOOR_CODE, `${WRONG_TR}|${WRONG_EN}`, { selfEn: true }),
    fwd(DOOR_CODE, NOT_WORK),
    fwd(DOOR_CODE, REJECTED, { enterGap: true }),
    rev("yanlis|hatali|gecersiz|wrong|incorrect|invalid", `(?:(?:${DOOR_PLACE}|door|front door|gate|building) )?(?:${DOOR_CORE})`),
  ],
  // "Otopark dolu" / "otoparkta yer yok" / "No parking spaces left" anlık durumdur, sayılmaz.
  parking: [fwd(PARKING, `${MISSING_TR}|${MISSING_EN}`, { now: true }), rev(NO_EN, PARKING, FULL_NOW, true)],
  // "Ekstra / fazla / temiz havlu yok" bilgi çelişkisi değildir (önünde niteleyici varsa sayılmaz).
  cleaning: [
    fwd(`(?<!(?:fazla|fazladan|ekstra|extra|yedek|more|additional|yeterli|enough|temiz|clean|baska|yeni|new|spare|fresh) )(?:${LINEN})`, `${MISSING_TR}|${MISSING_EN}`, {
      now: true,
    }),
    rev(NO_EN, LINEN, `problems?|issues?|${NOW_WORDS}`, true),
  ],
  trash: [fwd(BINS, `${MISSING_TR}|${MISSING_EN}`, { now: true }), rev(NO_EN, BINS, FULL_NOW, true)],
  // Adres / konum YANLIŞ ("konum çalışmıyor" ve telefonun konumu sayılmaz).
  location: [fwd(PLACE, `${WRONG_TR}|${WRONG_EN}|tutmuyo(?:r)?|tutmadi`, { selfEn: true }), rev("yanlis|hatali|wrong|incorrect", PLACE)],
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

/**
 * Soru / olasılık cümlesi: İngilizce yardımcı fiille başlar ("Could the password be wrong" — "can't" değil), "acaba / belki / maybe /
 * perhaps / could be / might be" içerir.
 */
const SPECULATION =
  /^\s*(?:could|can|is|are|was|were|does|do|did|should|might|may|would|will|has|have)(?![\p{L}\p{N}'])|(?<![\p{L}\p{N}])(?:acaba|belki|maybe|perhaps|possibly|(?:could|might|may) be)(?![\p{L}\p{N}])/u;

const HEDGE_TAIL = /^\s*(?:olabilir|olur|olamaz|degil|dogru|oyle|m[iu](?![\p{L}\p{N}])|is it|isn'?t it|right|really|could|maybe|belki|acaba)/u;

/** Okunan en uzun metin (daha uzun mesajın başı okunur; kalıplar doğrusal; sayfa açılışında en çok 2.000 öğe × bu kadar). */
export const INFO_WRONG_MAX_CHARS = 2_000;

/** Misafir bu mesajda bu kategorinin bilgisinin YANLIŞ / OLMADIĞINI söylüyor mu (soru / tahmin cümleleri sayılmaz). */
export function statesInfoWrong(body: string, kbCategory: string): boolean {
  const rules = INFO_WRONG[kbCategory];
  if (!rules || typeof body !== "string" || !body.trim()) return false;
  const clauses = foldTr(body.slice(0, INFO_WRONG_MAX_CHARS)).match(/[^.!?;\n]+[.!?;\n]*/g) ?? [];
  return clauses.some((clause) => {
    let c = clause;
    // Soru işaretli cümlede son virgül bölümü sorudur, öncesi bildirim olabilir ("Şifre yanlış, kontrol eder misiniz?"); virgül yoksa tamamı soru.
    if (/\?[!.…\s]*$/.test(c)) {
      const cut = c.lastIndexOf(",");
      if (cut < 0) return false;
      // Son bölüm onay / olasılık sorusuysa ("…, değil mi?", "…, olabilir mi?", "…, right?") cümlenin tamamı sorudur.
      if (HEDGE_TAIL.test(c.slice(cut + 1))) return false;
      c = c.slice(0, cut);
    }
    return !SPECULATION.test(c) && rules.some((re) => re.test(c));
  });
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
      // Kimlik sırası sabit (Haiku 10-11: veritabanı sırası sayfa açılışları arasında değişebilir).
      memoryIds: facts.map((f) => f.id).sort(),
      text: `Son ${CONTRADICTION_WINDOW_DAYS} günde ${guests.size} misafir bilgi tabanındaki "${KB_CATEGORY.label(category)}" bilgisinin yanlış olduğunu bildirdi. Kontrol edin.`,
    });
  }
  for (const row of input.timeRows) {
    const facts = input.facts.filter((f) => row.itemIds.includes(f.kbItemId));
    if (facts.length === 0 || acknowledged(facts, row.againstPropertyUpdatedAt ?? null)) continue;
    out.push({ kind: "kb_vs_kb", memoryIds: facts.map((f) => f.id).sort(), text: row.text });
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
