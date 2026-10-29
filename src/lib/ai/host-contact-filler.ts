// ---------------------------------------------------------------------------
// "BİR SORUN OLURSA EV SAHİBİNİZİ ARAYIN / YAZIN" MİSAFİRE YAZILMAZ (kurucu kararı R13-b / R13-c, 10-28 gece; aynen
// `docs/INCELEME-2026-10-28-opus-ikinci-dilim.md` sonu):
//   "zaten hostla yazışıyorlar … AIımız … host gibi olmalı … 'Bir sorun olursa ev sahibinize yazın.' bu bence gitmesin … kesinlikle bu
//    gidemesin" · "olabildiğince en az aramadan bahsetsin" · "genel 'bir sorun olursa ev sahibinizi arayın/yazın' kapanışı hiç eklenmesin …
//    Yalnız 'Anahtarı kaybedersem ne yapmalıyım?' gibi sorularda, geçerli talimat gerçekten ev sahibine ulaşmaksa kullanılabilsin. Bunu sabit
//    birkaç kelimeyle değil, sorunun amacı ve talimatın gerekliliğiyle ayıralım. Gerekli güvenlik uyarıları korunsun. Misafir zaten sorunu
//    bizim sohbetimize bildiriyorsa tekrar 'ev sahibine yazın' diye başından savrulmasın; mevcut bildirim ve açık iş akışı devam etsin."
//
// Kural (saf; `suggestReply` cevabın SON adımında "talimat yok" silicisinin yanında çağırır → kanal, QR, "AI öner", Ayarlar testi, demo aynı):
//   · Yalnız KOŞULLU ev sahibine başvurma cümlesine dokunulur (`conditionalHostContactKind`: "…olursa ev sahibinizi arayın / yazın", "if
//     anything breaks, contact your host", "varınca ev sahibinizi arayın"). Bilgi yönlendirmesi ("Sauna için ev sahibinize sorabilirsiniz")
//     SİLİNMEZ — "bilgim yok" kuralı onu tutar; silinseydi soru sessizce kaybolurdu (gece-4 S4-09 dersi).
//   · "Yazın / mesaj atın / write / message" → her zaman çıkar (sohbet zaten ev sahibiyle).
//   · "Arayın / ulaşın / contact" → yalnız misafir TAM O DURUMU varsayımsal olarak sorduysa (AMAÇ: koşul eki / "what if" — yaşanan olayı
//     bildirmek değil; GEREKLİLİK: cümlenin konusu misafirin sorusunda geçiyor) VE cümlenin bilgi tabanında dayanağı varsa kalır; yoksa çıkar.
//   · Güvenlik uyarısı (gaz / yangın / duman / acil servis numarası) çıkarılmaz.
//   · Çıkarmadan sonra selam / nezaket dışında içerik kalmazsa metne DOKUNULMAZ, `hostContactOnly` döner → kapı (kanal + QR) cevabı TUTAR,
//     ev sahibi yanıtlar (kurucu: "ilk 3ünde evet kesinlikle tutmalı").
// Misafire yeni söz EKLENMEZ; yalnız cümle ÇIKARILIR. Kalan metin bütün kapılardan yine geçer. Doğrusal.
// ---------------------------------------------------------------------------

import { asksHypotheticalSituation, conditionalHostContactKind, refersGuestToHost } from "./absence";
import { contentStemsOf, isSubstantiveSentence, replySentencesOf, sentenceGroundedInKb } from "./no-instruction-filler";

/**
 * Güvenlik uyarısı: gerçek tehlike / acil servis sözcüğü taşıyan cümle (genel "acil durumda ev sahibinizi arayın" kapanışı DEĞİL).
 * GD9 (gece döngüsü 10-29): Türkçe gövdeler tehlike sözcüğüne benzeyen adları dışlar — gazete / gazino / gazoz / gazi (Gaziantep), polisaj /
 * polisiye / polister, karbonat — yoksa genel "sorun olursa ev sahibinizi arayın" kapanışı güvenlik uyarısı sanılıp misafire giderdi.
 */
const SAFETY_WARNING =
  /(?<![\p{L}\p{N}])(?:gaz(?!ete|ino|oz|i)\p{L}{0,8}|gas|yang[ıi]n\p{L}{0,8}|fire|duman\p{L}{0,8}|smoke|karbon(?!at)\p{L}{0,8}|carbon monoxide|itfaiye\p{L}{0,8}|ambulans\p{L}{0,8}|ambulance|polis(?!aj|iye|ter)\p{L}{0,8}|police|112|911|110|155|feuer|rauch|incendie|fumée|incendio|humo|пожар\p{L}{0,4}|газ\p{L}{0,4}|дым\p{L}{0,4})(?![\p{L}\p{N}])/iu;

/** Konu karşılaştırmasında sayılmayan sözcük kökleri (ev sahibi, başvurma fiilleri, koşul / nezaket dolgusu). */
const NON_TOPIC = new Set([
  "sahib", "evsah", "host", "hosts", "owner", "landl", "hosta", "araya", "arayi", "arayın", "arayı", "ulası", "ulaşı", "ulaşa", "ulasa",
  "call", "conta", "reach", "phone", "lütfe", "lutfe", "pleas", "olurs", "olurz", "durum", "bir", "the", "your", "you", "and", "ile", "için",
  "icin", "ise", "veya", "any", "anyth", "somet", "herha", "kendi", "them", "they", "this", "that", "with", "have", "will", "can", "may",
  "please", "kindl", "dilerseniz", "diler", "isters", "rica", "ederi", "wenn", "bitte", "ihren", "votre", "your", "veuil",
]);

function topicStems(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLocaleLowerCase("tr").normalize("NFC").match(/\p{L}{3,}/gu) ?? []) {
    const stem = w.slice(0, 5);
    if (!NON_TOPIC.has(stem) && !NON_TOPIC.has(w)) out.add(stem);
  }
  return out;
}

/** Misafir bu durumu VARSAYIMSAL olarak sordu mu ve cümlenin konusu sorusunda geçiyor mu (amaç + gereklilik). */
function guestAskedThisSituation(sentence: string, guestTexts: readonly string[]): boolean {
  const asked = guestTexts.filter((g) => asksHypotheticalSituation(g));
  if (asked.length === 0) return false;
  const mine = topicStems(sentence);
  if (mine.size === 0) return false;
  return asked.some((g) => {
    const theirs = topicStems(g);
    for (const s of mine) if (theirs.has(s)) return true;
    return false;
  });
}

/**
 * GD5 (gece döngüsü 10-29): silinecek cümlenin BAŞKA bir yan cümlesi bilgi taşıyor mu ("Havlular dolapta, bir sorun olursa ev sahibinize
 * yazın.")? Cümle bütün olarak silinirse bilgi de gider; öğe kipinde istek "cevaplandı" kapanır. Yan cümleler virgül / noktalı virgül / iki
 * nokta (ardından boşluk) ve "ve / and / ama / but / fakat / ancak" bağlacından ayrılır. Bilgi yan cümlesi: ev sahibine başvurmuyor, koşul
 * yan cümlesi değil ve içerik kökü genel sorun / yardım sözcüklerinden ibaret değil (ya da sayı taşıyor). Doğrusal.
 */
const OTHER_CLAUSE_SPLIT = /(?<=[,;:])\s+|\s+(?=(?:ve|and|ama|but|fakat|ancak)\s)/iu;
const GENERIC_TROUBLE_STEMS = new Set([
  "sorun", "probl", "issue", "herha", "anyth", "somet", "wrong", "durum", "ihtiy", "konak", "stay", "shoul", "troub", "quest", "conce",
  "yardi", "help", "helpi", "assis", "memnu", "happy", "glad", "sevin", "olsun", "durin", "need", "neede", "olurs", "yasar", "yasad",
]);
function carriesOtherInformation(sentence: string): boolean {
  return sentence.split(OTHER_CLAUSE_SPLIT).some((clause) => {
    if (conditionalHostContactKind(clause) !== null || refersGuestToHost(clause) || asksHypotheticalSituation(clause)) return false;
    if (!isSubstantiveSentence(clause)) return false;
    return /\d/.test(clause) || contentStemsOf(clause).some((stem) => !GENERIC_TROUBLE_STEMS.has(stem));
  });
}

export interface HostContactFillerResult {
  /** Gönderilecek metin (bir şey çıkarılmadıysa ya da yalnız bu cümleler varsa birebir aynı). */
  text: string;
  /** Cevap yalnız çıkarılması gereken ev sahibine başvurma talimatından oluşuyor → kapı tutar (ev sahibi yanıtlar). */
  hostContactOnly: boolean;
}

export function stripHostContactFiller(
  reply: string,
  guestTexts: readonly string[],
  kbTexts: readonly string[] | undefined,
): HostContactFillerResult {
  if (!reply.trim()) return { text: reply, hostContactOnly: false };
  let removed = false;
  // GD1 (gece döngüsü 10-29): çıkarılan cümle misafirin TAM sorduğu durumun cevabıysa ("Wi-Fi bozulursa ne yapmalıyım?" → "… ev sahibinize
  // yazın") cümle silinmez, BÜTÜN cevap tutulur: öğe kipinde model o isteği "cevaplandı" beyan eder, cümle sessizce silinseydi istek ev sahibine
  // hiç görünmeden kapanırdı. Soruyla ilgisiz genel kapanış silinmeye devam eder. GD5: cümle talimatın yanında bilgi de taşıyorsa aynı (↑).
  let answerRemoved = false;
  const lines = reply.split("\n").map((line) => {
    const kept = replySentencesOf(line).filter((s) => {
      const kind = conditionalHostContactKind(s);
      if (!kind) return true;
      if (kind === "call" && SAFETY_WARNING.test(s)) return true;
      const asked = guestAskedThisSituation(s, guestTexts);
      if (kind === "call" && asked && !!kbTexts && kbTexts.length > 0 && sentenceGroundedInKb(s, kbTexts)) {
        return true;
      }
      if (asked || carriesOtherInformation(s)) answerRemoved = true;
      removed = true;
      return false;
    });
    return { text: kept.join("").trim(), dropped: kept.length === 0 && line.trim() !== "" };
  });
  if (!removed) return { text: reply, hostContactOnly: false };
  if (answerRemoved) return { text: reply, hostContactOnly: true };
  // Tamamen çıkarılan satır düşer; özgün boş satır (paragraf arası) kalır.
  const text = lines
    .filter((l) => !l.dropped)
    .map((l) => l.text)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const substantive = text.split("\n").some((l) => replySentencesOf(l).some((s) => isSubstantiveSentence(s)));
  return substantive ? { text, hostContactOnly: false } : { text: reply, hostContactOnly: true };
}
