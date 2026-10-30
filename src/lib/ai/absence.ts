// ---------------------------------------------------------------------------
// "BİLGİM YOK" MİSAFİRE GİTMEZ — KURUCU KURALI (09-11).
//
// Kurucu: *"müşteriye hiçbir zaman 'bilgim yok' mesajı gitmemeli; bilgi yoksa da
// cevap gitmemeli. Host neden 'bilgim yok' mesajı göndersin ki?"*
//
// Haklı ve ölçüldü: o cevabın İKİ parçası var —
//   ① "bu bilgi bende yok"                       → misafire hiçbir işe yaramıyor
//   ② "mesajınız kaydedildi, ev sahibiniz görebilir" → zaten DEVİR metninin kendisi
// Yani model, devir metnini taklit edip başına işe yaramaz bir cümle ekliyordu.
// Devretmek hem misafir için daha iyi hem host için AYNI sonuç.
//
// 🚨 İSTEM KURALI KALDIRILMADI — bilinçli. `prompts.ts` KURAL-3/KURAL-5 modele
// "temellendiremediğinde kayıtlı bilgin olmadığını söyle" diyor ve o kural
// UYDURMAYI ENGELLEMEK için var. Silinseydi model temellendiremediğinde bir şey
// UYDURURDU — işe yaramaz bir cevaptan çok daha kötü. Kural istemde kalır (model
// dürüst davranmaya devam eder), gönderim kapısı burada kapanır. Ayrıca bu,
// fail-safe'i doğru yöne kurar: kapı bir gün delinirse misafir BOZUK bir belirteç
// değil, dürüst bir cümle görür.
//
// 🚨 ÖLÇÜT "KAYNAK YOK" DEĞİL, CEVABIN KENDİ İTİRAFIDIR. `usedSources` yalnız KB
// kalemlerini sayar; giriş/çıkış saati MÜLK ALANINDAN gelir ve o cevap kaynaksız
// göründüğü hâlde DAYANAKLIDIR. "Kaynak yoksa devret" deseydik ürünün EN SIK
// sorusunu ("Giriş saati kaçta?") kırardık — test-pinli.
//
// ⚠️ (09-11) SAVUŞTURMA YOKLUK İTİRAFI DEĞİLDİR: "ev sahibinizle iletişime geçebilirsiniz"
// bilginin kayıtlarda olmadığını SÖYLEMEZ. Bu ayrım bilinçli — sözleşme yalnız
// AÇIK yokluk beyanını yakalar, kapıyı gereksiz yere geniş tutmaz.
// 🚨 10-23 akşam KURUCU KARARIYLA DEĞİŞTİ (4.5): yönlendirme de bilgisizlik sayılır → ↓`refersGuestToHost`.
//
// ---------------------------------------------------------------------------
// 🚨 YENİDEN YAZILDI (09-11, inceleme ajanı + bağımsız doğrulama). İlk sürüm
// düz kalıp listesiydi ve İKİ YÖNDE DE ölçülerek kırıldı (9/9 ve 15/15 üretildi):
//
//   YANLIŞ POZİTİF 18/67 (%27) — işe yarayan cevap misafire GİTMİYORDU:
//     · `\bno` sağ sınırı YOKTU → "**No**thing extra is needed; the information…",
//       "**No**te: all the check-in information…", "**No**body else has the details…",
//       "no worries — the parking details…", "no extra charge; the information pack…"
//     · `not listed` çıplaktı → "The pool is **not listed** as closed, it is open 09:00-20:00."
//     · `kayıtlı${GAP}bilgi` OLUMLU bir Türkçe kalıptır →
//       "**Kayıtlı** rezervasyon **bilgi**leriniz doğru."
//
//   KAÇAK 29/38 — modelin gerçekte yazdığı yokluk ifadelerinin ÇOĞU geçiyordu:
//     "Bu detay bende kayıtlı değil" · "…bir kayıt göremiyorum" · "…bulamadım" ·
//     "Kayıtlarımda bu detay görünmüyor" · "I couldn't locate that detail" ·
//     "I'm not able to find that" · "There are **no records**" (yalnız tekil `record`
//     yazılıydı) · "I don't have that **detail**" (yalnız çoğul `details`) ·
//     "I **didn't** have any information" (yalnız don't/doesn't).
//
// Yeni yapı KALIP LİSTESİ DEĞİL, **NESNE + OLUMSUZLAMA** dilbilgisidir: bir BİLGİ
// NESNESİ (bilgi/kayıt/veri/not/detay/belge · information/record/detail/data/note)
// ile bir YOKLUK YÜKLEMİ arasındaki mesafe SINIRLI. Böylece hem sınıf kapanıyor
// hem yanlış pozitifler yapısal olarak eleniyor.
// ---------------------------------------------------------------------------

import { foldTurkishLower, foldTurkishLowerTr } from "./fallback";
import { containsContactValue } from "../contact-redact";

/**
 * 🚨 CÜMLE SINIRI BOŞLUĞU KESER. Ölçüldü: boşluk cümleleri aşınca
 * "There is no smoking. Details are in the rules." yokluk itirafı sayılıyordu.
 * Sınır = nokta/ünlem/soru + BOŞLUK; "15.00" (Türkçe saat yazımı) BÖLÜNMEZ çünkü
 * noktadan sonra boşluk yok — ilk sürümün `[^.!?\n]` sınıfı tam tersini yapıyor ve
 * "I don't have the **15.00** check-in information" cümlesini KAÇIRIYORDU.
 * ⚠️ Bilinen sınır: "Mr. Yilmaz" gibi kısaltmalar cümle sonu sayılır (pinli).
 */
const SENTENCE_END = /([.!?])(\s|$)/gu;
// 🚨 KAÇIŞ DİZİSİ (09-23): burada eskiden HAM bir NUL baytı vardı — git ve grep dosyayı
// “ikili” sayıp diff'ini gizliyor, kaynak taramalı pinler onu SESSİZCE atlıyordu. Değer aynı.
const SEP = "\u0000";

/**
 * Boşluktaki TEK BİR KELİME. Noktalama (`;` `,` `:` `—` ve cümle sınırı `SEP`)
 * BİLEREK dışarıda: "no extra charge**;** the information" bu yüzden eşleşmez.
 * Nokta/kesme/tire içeride ki "15.00" ve "check-in" tek kelime sayılsın.
 */
const W = "[\\p{L}\\p{N}.'’-]+";
/** Sol kelime sınırı — `\b` Türkçe "ı/ş/ğ" için güvenilir değil. */
const L = "(?<![\\p{L}\\p{N}])";
const gap = (n: number) => `(?:${W} ){0,${n}}`;

// ── Türkçe: BİLGİ NESNESİ ──────────────────────────────────────────────────
// Çekim serbest (bilgim · bilgisi · bilgiye · kayıtlarımda · kaydım · detaylar).
// 🚨 `bilgisayar` DIŞLANIR (bilgi + sayar); `veri` ve `not` yalın hâlde ki
// "veriyorum" ve İngilizce "not" nesne sanılmasın.
const TR_OBJ =
  `${L}(?:bilgi(?!sayar)\\p{L}*|kay[ıi]t\\p{L}*|kayd\\p{L}*|veri|not|detay\\p{L}*|belge\\p{L}*)`;
/**
 * 🚨 DAR yüklem: `yok` NESNEYE BİTİŞİK olmalı (en fazla 1 kelime arayla).
 * Gerekçe ÖLÇÜLDÜ: "sorun yok" / "görevli yok" Türkçenin en yaygın nezaket
 * kapanışlarındandır — geniş boşlukla "Bu **bilgi** rehberde var, **sorun yok**."
 * ve "Otopark **bilgisi**: ücretsiz, kapıda görevli **yok**." yokluk itirafı
 * sayılıyordu. `yoktur` da sayılır, `yokluğu` SAYILMAZ (sağ sınır).
 */
const TR_TIGHT = `yok(?:tur)?(?![\\p{L}])`;
/** Bunlar tek başına yokluk bildirir → boşluk daha geniş olabilir. */
const TR_LOOSE =
  "(?:bulunmuyor|bulunmamakta(?:dır)?|mevcut değil|kayıtlı değil|bulamadım|bulamıyorum|" +
  "göremiyorum|göremedim|görünmüyor|erişimim yok|sahip değilim|" +
  // 10-01 öğlen (karar 23 kör doğrulaması): "…adımları elimdeki bilgilerde yer almıyor".
  "yer almıyor|yer almamaktadır|yer verilmemiş|" +
  // Kör set 6 (10-01 öğleden sonra): "bilgiye ulaşamadım", 1. çoğul "bilgi bulamadık" — yalnız BİLGİ nesnesinden sonra (↑`TR_OBJ`).
  "ulaşamadım|ulaşamıyorum|ulaşamadık|ulaşamıyoruz|bulamadık|bulamıyoruz|göremedik|göremiyoruz|" +
  // 10-01 (15 ajan A05): "bilgi sahibi değilim", "bilgi verilmemiş", "kayıtlarda … değinilmemiş", "bu bilgiye rastlamadım",
  // "kesin bilgi veremiyorum" — yalnız BİLGİ nesnesinden sonra.
  "sahibi değilim|sahibi değiliz|verilmemiş|verilmemektedir|değinilmemiş|değinilmemektedir|rastlamadım|rastlamadık|" +
  "rastlayamadım|veremiyorum|veremiyoruz)";

// ── İngilizce: BİLGİ NESNESİ (tekil VE çoğul — ilk sürümde karışıktı) ──────
const EN_OBJ = "(?:information|info|records?|details?|data|notes?)(?![\\p{L}])";
/** Bilginin YERİ (rehber / notlar / kayıtlar) — "isn't in the guide", "the guide doesn't cover …" (10-01, A05). */
const EN_PLACE = "(?:house\\s+)?(?:guide|manual|handbook|notes?|records?|files?|information|details|knowledge\\s+base)";

/**
 * "Bulamamak" itirafının öznesi (W4 + Haiku 10-21): ben / biz ya da bizim kaynağımız / ekibimiz. Misafir ("you"), üçüncü kişi ("guests",
 * "our cleaners") itiraf öznesi değildir. Özne ile fiil arasında en çok bir zarf ("really", "currently", "genuinely" — -ly sözcükleri).
 */
const FINDER_SUBJECT = "(?:i|we|(?:our|my) (?:team|staff|records?|notes?|system|guide|information|info))";
const FINDER_ADVERB = "(?: (?:just|still|also|\\p{L}{2,15}ly))?";

const ABSENCE_PATTERNS: readonly RegExp[] = [
  new RegExp(`${TR_OBJ} ${gap(1)}${TR_TIGHT}`, "u"),
  // Kurucu 10-17 (M1, aynen: "bilgi veremem cümlesi tabii ki tutulsun — müşteriye öyle denir mi, sussa daha iyi"): geniş zaman / gelecek
  // olumsuzu da. DAR (Opus 10-17): nesne yalın "bilgi" + en çok bir sözcük + yüklem, sağ sınırlı — "Kimlik bilgilerinizi göndermeden giriş
  // kodunu veremeyiz" bir POLİTİKA cümlesidir (bilgisizlik değil), geniş boşlukla tutuluyordu; "verememeniz" de eşleşiyordu.
  new RegExp(
    `${L}bilgi (?:${W} )?(?:veremem|veremeyiz|veremeyeceğim|veremeyeceğiz|verememekteyim|verememekteyiz)(?![\\p{L}])`,
    "u",
  ),
  new RegExp(`${TR_OBJ} ${gap(4)}${TR_LOOSE}`, "u"),
  /(?<![\p{L}])bilmiyorum(?![\p{L}])/u,
  new RegExp(`(?:don't|do not|doesn't|does not|didn't|did not) have ${gap(4)}${EN_OBJ}`, "u"),
  // 🚨 `${L}no ` — sağdaki BOŞLUK şart: "Nothing/Note/Nobody/Normally" artık eşleşmez.
  new RegExp(`${L}no ${gap(3)}${EN_OBJ}`, "u"),
  // Kurucu W4 (10-21, "bağlam bazlı tutsun"): "bulamamak" yalnız BEN / BİZ öznesiyle ya da öznesiz cümle başında itiraftır. Çıplak kalıp
  // misafire talimatı ("If you can't find the keys, they are in the lockbox") ve olguyu ("You can't see the sea") da tutuyordu. Öznesiz
  // cümle soruysa ("Can't find the keys? They are in the lockbox.") yine talimattır.
  new RegExp(`${L}${FINDER_SUBJECT}${FINDER_ADVERB} (?:can't|cannot|can not|couldn't|could not) (?:find|locate|see)(?![\\p{L}])`, "u"),
  new RegExp(
    `${L}${FINDER_SUBJECT}(?:'m|'re| am| are| was| were)?${FINDER_ADVERB} (?:not able|unable) to (?:find|locate|see)(?![\\p{L}])`,
    "u",
  ),
  new RegExp(
    `(?:^|${SEP} ?|${L}(?:sorry|unfortunately|apologies),? )(?:can't|cannot|can not|couldn't|could not|not able to|unable to) (?:find|locate|see)(?![\\p{L}])(?![^?${SEP}]{0,200}\\?)`,
    "u",
  ),
  // 🚨 `confirm` ÇAPA İSTER (ölçülmüş ayrım, `tests/unit/absence-detector.test.ts:48`):
  // "I'm unable to confirm whether parking is available." bir SAVUŞTURMADIR ve o
  // sınıf bilinçli olarak dışarıda — ayrıca "I cannot confirm your reservation
  // without the booking number." MEŞRU bir netleştirme talebidir, bloklanamaz.
  // Yalnız KAYIT nesnesine bağlandığında yokluk beyanı olur.
  new RegExp(
    `(?:can't|cannot|can not|couldn't|could not|not able to|unable to) confirm ${gap(4)}` +
      "(?:record|note|listing|information|data|file)",
    "u",
  ),
  /(?:isn't|is not|aren't|are not) (?:in|on) (?:my|our|the) (?:record|note|file|listing)/u,
  /(?:isn't|is not) (?:available|listed in|something i have)/u,
  /nothing (?:in|on) (?:my|our|the) (?:record|note|file|listing)/u,
  /(?:don't|do not) see anything/u,
  // 🚨 ÇAPALI: çıplak "not listed" meşru cümleleri bloklu yordu (↑başlık).
  /not listed (?:in|on) (?:my|our|the)/u,
  // "aren't specified here" / "not mentioned in my notes" — yer çapası şart ("not specified as closed" olgudur).
  /(?:isn't|is not|aren't|are not|not) (?:specified|mentioned) (?:here|in (?:my|our|the))/u,
  // 10-01 öğlen (karar 23 kör doğrulaması — Luna'nın misafire GİDEN cümlesi): "The coffee machine troubleshooting steps aren't available
  // in the information provided." Yer BİLGİ nesnesine çapalı: "The pool isn't available in the morning" bu kalıba girmez.
  new RegExp(
    `(?:isn't|is not|aren't|are not|not) (?:available|included|listed|provided|covered) in (?:the |my |our |this )?(?:\\p{L}{1,20} )?${EN_OBJ}`,
    "u",
  ),
  // "We don't have (specific) instructions for the coffee machine" — "You don't have to take any steps" eşleşmez (fiil + edat şart).
  /(?:don't|do not) have (?:any )?(?:\p{L}{1,20} )?(?:instructions|steps) (?:for|on|about)(?![\p{L}])/u,
  // Kurucu 10-17 (H9, aynen: "…özel talimatımız yok … bunu yazmasın"): niteleyicili "No special / additional instructions for …" de
  // misafire GİTMEZ (eskiden olgu sayılıyordu). Aynı cümlede yönerge varsa yan cümle `no-instruction-filler.ts` ile silinir.
  // "You need no special instructions for …" = "gerekmiyor" (bilgisizlik değil; Haiku 10-17) → "need / require" fiilinden sonra eşleşmez.
  /(?<![\p{L}])(?<!(?:need|needs|require|requires) )no (?:\p{L}{1,20} )?instructions (?:for|on|about)(?![\p{L}])/u,
  // Kör set 5 (5.1, GİTTİ): "For the terrace jacuzzi, I don't have specific troubleshooting steps in my guide". Özne 1. şahıs ŞART:
  // "You don't have any steps to climb" bir erişilebilirlik olgusudur.
  /(?<![\p{L}])(?:i|we) (?:don't|do not) have (?:any )?(?:\p{L}{1,20} ){0,2}(?:instructions|steps|guidance)(?![\p{L}])/u,
  // Kör set 6 (10-01 öğleden sonra): "I didn't find any information about the speaker" — 1. şahıs + BULMA fiili + bilgi nesnesi ("You won't
  // find any fees", "If we don't see any issues…" eşleşmez: özne / nesne şartı).
  new RegExp(
    `(?<![\\p{L}])(?:i|we) (?:didn't|did not|don't|do not|couldn't|could not|can't|cannot|wasn't able to|was not able to) (?:find|locate|see) (?:any )?(?:\\p{L}{1,20} ){0,2}${EN_OBJ}`,
    "u",
  ),
  // 10-01 (15 ajan A05 — kurucu kuralı "bilgim yok misafire asla gitmez"; 1. şahıs / bilgi yeri çapalı): "I don't know …", "I have no
  // idea", "I'm not aware of …", "not something I have information on", "I don't have that on file", "nothing about X in my notes",
  // "my notes don't mention …", "that detail isn't in the guide", "the guide doesn't cover …", "I lack information", "There aren't any
  // details about …". "You don't know" / "Did you know" (2. şahıs) eşleşmez; belirsizlik ("I'm unsure") BİLEREK dışarıda.
  /(?<![\p{L}])(?:i|we) (?:don't|do not|didn't|did not) know(?![\p{L}])/u,
  /(?<![\p{L}])(?:i|we) have no idea(?![\p{L}])/u,
  /(?<![\p{L}])(?:i'm|i am|we're|we are) not aware(?![\p{L}])/u,
  /not something (?:i|we) (?:have|know)|something (?:i|we) (?:don't|do not) (?:have|know)/u,
  new RegExp(`(?:don't|do not|doesn't|does not) have ${gap(2)}on (?:file|record)(?![\\p{L}])`, "u"),
  new RegExp(`nothing (?:about|on|regarding) (?:\\p{L}{1,20} ){0,3}in (?:my|our|the) ${EN_PLACE}(?![\\p{L}])`, "u"),
  new RegExp(`(?:my|our|the) ${EN_PLACE} (?:don't|do not|doesn't|does not) (?:mention|cover|include|say|contain|specify|list)(?![\\p{L}])`, "u"),
  new RegExp(`(?:isn't|is not|aren't|are not) (?:in|on) (?:my|our|the) ${EN_PLACE}(?![\\p{L}])`, "u"),
  new RegExp(`(?<![\\p{L}])(?:i|we) lack ${gap(2)}${EN_OBJ}`, "u"),
  // Opus 10-15 (ölçüldü): "Televizyon için talimatım yok", "kayıtlı bir talimatımız bulunmuyor" — 1. şahıs iyelik ŞART ("Çöp için özel bir
  // talimat yok" olgudur); "There are no troubleshooting steps for the TV in my notes" — yer çapası ŞART ("There are no steps to the door").
  // Kurucu 10-17 (H9, aynen: "televizyonla ilgili ayrı bir talimatım bulunmuyor — böyle bir şey yazamaz kesinlikle"; "Çıkış için özel
  // talimatımız yok … bunu yazmasın"): Opus N5'in niteleyici istisnası ("özel / ek / başka / ayrı talimatımız yok" olgudur) KALDIRILDI.
  // Aynı cümlede yönerge varsa yan cümle `no-instruction-filler.ts` ile silinir ("Anahtarı masaya bırakmanız yeterli."), yoksa tutulur.
  // Haiku 10-17: "mevcut değil / söz konusu değil" yüklemi de ("Özel talimatımız mevcut değil.").
  new RegExp(
    `${L}talimat(?:ım|ımız|larım|larımız) ${gap(1)}(?:yok(?:tur)?|bulunmuyor|bulunmamaktadır|mevcut değil(?:dir)?|söz konusu değil(?:dir)?)(?![\\p{L}])`,
    "u",
  ),
  /(?<![\p{L}])no (?:\p{L}{1,20} ){0,2}(?:steps|instructions|guidance) (?:[\p{L}\p{N}'-]{1,30} ){0,5}in (?:my|our) (?:notes?|records?|guide|files?|information)(?![\p{L}])/u,
  new RegExp(`there (?:isn't|is not|aren't|are not) (?:any )?${gap(1)}${EN_OBJ}`, "u"),
];

// ── DİĞER DESTEKLENEN DİLLER + TÜRKÇE EK BİÇİMLER (10-01 gece ölçümü) ─────────
// Kurucu kuralı dilden bağımsızdır; yüklem yalnız TR/EN biliyordu ve canlı hat ölçümünde iki itiraf misafire GİTTİ
// ("…kuaför bilgisi elimde olmadığı için…", "…ne sont pas précisées ici."). AYNI dilbilgisi: BİLGİ NESNESİ + OLUMSUZLAMA
// sınırlı boşlukla; çıplak olumsuzluk ("Il n'y a pas de frais", "No se permiten mascotas", "Нет, курить нельзя",
// "لا يوجد رسوم") itiraf DEĞİLDİR — iki yönlü batarya `tests/unit/absence-multilingual.test.ts`.
const FR_OBJ = "(?:informations?|renseignements?|d[ée]tails?|pr[ée]cisions?|donn[ée]es)(?![\\p{L}])";
const DE_OBJ = "(?:informationen|information|angaben|details|daten|hinweise|infos?|auskunft|auskünfte)(?![\\p{L}])";
/** `datos` YALNIZ sahiplik fiiliyle ("no hay datos móviles" bir olgudur). */
const ES_OBJ = "(?:informaci[óo]n|detalles?)(?![\\p{L}])";
const RU_OBJ = "(?:информаци\\p{L}{0,8}|данных|сведений)";
const AR_OBJ = "(?:معلومات|معلومة|تفاصيل|بيانات)";
/** Almanca bilgi nesnesi + talimat ("Anleitung / Anweisung") — yalnız 1. şahıs bulma / sahiplik kalıplarında (kör set 6). */
const DE_INFO = `(?:${DE_OBJ}|anleitung(?:en)?(?![\\p{L}])|anweisung(?:en)?(?![\\p{L}]))`;

const MORE_ABSENCE_PATTERNS: readonly RegExp[] = [
  // TR — nesne + "elimde değil / olmadığı", "bilgim olmadığı için", "bilgi bulunmadığından", "burada belirtilmemiş".
  new RegExp(`${TR_OBJ} ${gap(3)}elimde (?:yok|değil|bulunmuyor|olmadığı\\p{L}{0,12}|olmadığından|mevcut değil)(?![\\p{L}])`, "u"),
  // 10-01 (A05): "Bu bilgi bende de yok", "bilmiyoruz / bilemiyorum", "fikrim yok", "haberim yok", "bununla ilgili bir şey yok".
  new RegExp(`${TR_OBJ} ${gap(2)}bende (?:de |da )?(?:yok|bulunmuyor|mevcut değil)(?![\\p{L}])`, "u"),
  /(?<![\p{L}])(?:bilmiyoruz|bilemiyorum|bilemiyoruz)(?![\p{L}])/u,
  /(?<![\p{L}])(?:fikr|haber)(?:im|imiz) yok(?![\p{L}])/u,
  /(?:bununla|bu konuyla|bu konuda|onunla) ilgili (?:bir |herhangi bir )?(?:şey|bilgi\p{L}*|not|kayıt) (?:yok|bulunmuyor|göremedim|bulamadım)(?![\p{L}])/u,
  // `olmadığı / bulunmadığı` yalnız BİLGİ nesnesiyle ("Kayıt olmadığı sürece…" bir kuraldır).
  new RegExp(`${L}(?:bilgi(?!sayar)\\p{L}{0,24}|detay\\p{L}{0,24}) ${gap(2)}(?:olmadığı|bulunmadığı)\\p{L}{0,12}`, "u"),
  // "Aksi belirtilmemişse" koşuldur → sağ sınır şart.
  new RegExp(`${L}belirtilme(?:miş|mektedir|di)(?:tir)?(?![\\p{L}])`, "u"),
  // FR — "je n'ai pas (d')information", "aucune information", "ne sont pas précisées ici", "je ne dispose pas de…", "je ne sais pas".
  // "indiqué" BİLEREK yok ("il n'est pas indiqué de…" = tavsiye edilmez).
  new RegExp(`n'(?:ai|avons) pas (?:d'|de |des |les |l'|cette |ces |cet |la |le )?${gap(1)}${FR_OBJ}`, "u"),
  // "aucune information" yalnız 1. şahısla ya da "… n'est disponible" yüklemiyle: "Vous n'avez besoin d'aucune information" (gerek yok)
  // itiraf DEĞİLDİR.
  new RegExp(`n'(?:ai|avons) aucune? ${gap(1)}${FR_OBJ}`, "u"),
  new RegExp(
    `${L}aucune? ${gap(1)}${FR_OBJ} (?:n'est|n'a été|ne sont|n'ont été) (?:disponible|pr[ée]cis[ée]|mentionn[ée]|indiqu[ée]|fourni|connu)`,
    "u",
  ),
  /(?:n'est|ne sont) pas (?:pr[ée]cis[ée]|mentionn[ée]|renseign[ée])e?s? (?:ici|dans)/u,
  // 10-01 öğlen (karar 23 kör doğrulaması): "… ne sont pas disponibles dans les informations fournies" — yer BİLGİ nesnesine çapalı
  // ("La piscine n'est pas disponible dans la journée" olgudur).
  new RegExp(
    `(?:n'est|ne sont) pas (?:disponibles?|indiqu[ée]e?s?|fourni(?:e|s|es)?|inclus(?:e|es)?) dans (?:les |l'|mes |nos |ces |cette )?(?:\\p{L}{1,20} )?${FR_OBJ}`,
    "u",
  ),
  new RegExp(`ne dispos\\p{L}{0,8} pas (?:d'|de |des )?${gap(1)}${FR_OBJ}`, "u"),
  /je ne (?:le )?sais pas|je ne (?:trouve|retrouve) pas|je n'ai pas (?:trouvé|retrouvé)/u,
  // 10-01 (A05): "Je n'ai aucune idée", "Cette information ne m'est pas connue", "Je ne connais pas les horaires", "Je ne dispose
  // d'aucune information", "pas d'information / aucune information à ce sujet".
  /aucune idée|ne (?:m'|nous )(?:est|sont) pas connue?s?|(?:je|nous) ne conna(?:is|issons) pas/u,
  new RegExp(`ne dispos\\p{L}{0,8} d'aucune? ${gap(1)}${FR_OBJ}`, "u"),
  new RegExp(`${L}(?:pas d'|aucune? )${gap(1)}${FR_OBJ} (?:à ce sujet|sur ce point|sur cela|là-dessus|concernant)`, "u"),
  // Kör set 5 (Luna, GİTTİ): "Je n'ai pas de consigne disponible pour résoudre le problème du micro-ondes" — 1. şahıs + talimat nesnesi.
  /n'(?:ai|avons) (?:pas|aucune?) (?:de |d'|la |les )?(?:consignes?|instructions?|proc[ée]dures?)(?![\p{L}])/u,
  // Kör set 6: "Je ne trouve aucune information sur l'enceinte" / "Je n'ai trouvé aucune information" — 1. şahıs ŞART ("Vous ne trouverez
  // aucun frais" bir olgudur).
  new RegExp(`(?:je ne|nous ne) (?:trouve|trouvons|retrouve|retrouvons|vois|voyons) aucune? ${gap(1)}${FR_OBJ}`, "u"),
  new RegExp(`(?:je n'ai|nous n'avons) (?:trouvé|retrouvé|vu) aucune? ${gap(1)}${FR_OBJ}`, "u"),
  // DE — "(habe / liegen mir / gibt) keine (genauen) Informationen", "nicht angegeben", "weiß ich nicht", "kann ich nicht finden".
  // "keine" YALNIZ sahiplik / varlık fiiliyle: "Sie brauchen keine weiteren Angaben" (gerek yok) itiraf DEĞİLDİR; "keinen Schlüssel"
  // ve "können" (2. şahıs koşul) eşleşmez.
  new RegExp(`(?:habe|haben|hab|hätte|liegen|liegt|gibt)(?: \\p{L}{1,30}){0,6} keine ${gap(1)}${DE_OBJ}`, "u"),
  /nicht (?:angegeben|vermerkt|hinterlegt|aufgeführt)(?![\p{L}])/u,
  // Kör set 5 (Luna): "… ist dazu keine Anleitung verfügbar" — varlık yüklemi şart ("Sie brauchen keine Anleitung" gerek yoktur).
  new RegExp(`${L}keine ${gap(1)}(?:anleitung(?:en)?|anweisungen?|informationen?|angaben) ${gap(2)}(?:verfügbar|vorhanden|hinterlegt)`, "u"),
  // 10-01 öğlen: "… sind in den vorliegenden Informationen nicht verfügbar" — BİLGİ nesnesine çapalı.
  new RegExp(
    `${L}in (?:den |meinen |unseren |diesen |der )?(?:\\p{L}{1,20} )?${DE_OBJ} (?:leider )?nicht (?:verfügbar|enthalten|vorhanden)`,
    "u",
  ),
  /(?:ich weiß|weiß ich) (?:es |das )?(?:leider )?nicht/u,
  // 10-01 (A05): "liegt mir nicht vor", "ist mir nicht bekannt", "Ich kenne die Öffnungszeiten nicht", "kann Ihnen dazu nichts sagen",
  // "kann ich keine Auskunft geben" (1. şahıs şart).
  new RegExp(`(?:liegt|liegen) (?:mir|uns) ${gap(2)}nicht vor(?![\\p{L}])`, "u"),
  /(?:ist|sind) (?:mir|uns) (?:leider )?nicht bekannt/u,
  new RegExp(`(?<![\\p{L}])(?:ich|wir) kenne\\p{L}? ${gap(3)}nicht(?![\\p{L}])`, "u"),
  // 10-01 gece: "kann ich dazu nichts Konkretes / Genaues / Verlässliches sagen" — sıfat KAPALI küme ("nichts anderes sagen als:
  // willkommen" olumludur, girmez).
  /(?:kann|können) (?:ich|wir) (?:\p{L}{1,30} ){0,3}nichts (?:(?:konkretes|genaues|verlässliches|sicheres|näheres|bestimmtes) )?sagen|(?:ich|wir) (?:kann|können) (?:\p{L}{1,30} ){0,3}nichts (?:(?:konkretes|genaues|verlässliches|sicheres|näheres|bestimmtes) )?sagen/u,
  new RegExp(`(?:kann|können|könnte) (?:ich|wir)(?: \\p{L}{1,30}){0,3} keine ${gap(1)}${DE_INFO} ${gap(1)}geben`, "u"),
  /(?:kann|konnte) (?:ich )?(?:\p{L}{1,30} ){0,2}nicht finden/u,
  // Kör set 6 (misafire GİTTİ — Luna: "Zum kabellosen Lautsprecher finde ich keine Angaben."; 5.1: "Für den kabellosen Lautsprecher habe
  // ich in meinen Unterlagen leider keine spezifische Anleitung"). Özne 1. şahıs ŞART: "Sie finden keine Gebühren", "Wenn Sie den Schlüssel
  // nicht finden…", "Ich finde keine Worte" (nesne bilgi değil) eşleşmez.
  new RegExp(`(?:finde|fand|finden|fanden) (?:ich|wir)(?: \\p{L}{1,30}){0,3} (?:keine|keinerlei) ${gap(1)}${DE_INFO}`, "u"),
  new RegExp(`(?:ich|wir) (?:finde|fand|finden|fanden)(?: \\p{L}{1,30}){0,3} (?:keine|keinerlei) ${gap(1)}${DE_INFO}`, "u"),
  new RegExp(`(?:kann|konnte|können|konnten) (?:ich|wir)(?: \\p{L}{1,30}){0,3} (?:keine|keinerlei) ${gap(1)}${DE_INFO}(?: \\p{L}{1,30}){0,3} finden`, "u"),
  new RegExp(`(?:ich|wir) (?:kann|konnte|können|konnten)(?: \\p{L}{1,30}){0,3} (?:keine|keinerlei) ${gap(1)}${DE_INFO}(?: \\p{L}{1,30}){0,3} finden`, "u"),
  /(?:habe|haben) (?:ich|wir)(?: \p{L}{1,30}){0,4} nichts gefunden|(?:ich|wir) (?:habe|haben)(?: \p{L}{1,30}){0,4} nichts gefunden/u,
  new RegExp(`(?:habe|haben|hätte|hätten) (?:ich|wir)(?: \\p{L}{1,30}){0,6} (?:keine|keinerlei) ${gap(1)}(?:anleitung(?:en)?|anweisung(?:en)?)(?![\\p{L}])`, "u"),
  // ES — "no tengo / no hay información", "no dispongo de esos datos", "no se especifica", "no lo sé".
  // "sé" AKSANLI: "no se permiten" bir kuraldır.
  new RegExp(
    `${L}no (?:tengo|tenemos|dispongo de|disponemos de|cuento con|contamos con|hay|encuentro|encontré) ${gap(3)}${ES_OBJ}`,
    "u",
  ),
  new RegExp(`${L}no (?:tengo|tenemos|dispongo de|disponemos de) ${gap(2)}datos(?![\\p{L}])`, "u"),
  /no se (?:especifica|menciona)n?(?![\p{L}])/u,
  // Kör set 5 türü: "No tengo instrucciones para la cafetera" — YALNIZ 1. şahıs ("No hay instrucciones especiales" olgudur).
  new RegExp(`${L}no (?:tengo|tenemos|dispongo de|disponemos de|cuento con|contamos con) ${gap(2)}(?:instrucciones|indicaciones)(?![\\p{L}])`, "u"),
  // 10-01 öğlen: "… no están disponibles en la información proporcionada" — BİLGİ nesnesine çapalı ("no está disponible en invierno" olgudur).
  new RegExp(
    `${L}no (?:está|están|se encuentra|se encuentran|aparece|aparecen|figura|figuran) (?:disponibles? |incluid[oa]s? |indicad[oa]s? )?en (?:la |las |mi |mis |nuestra |nuestras |esta )?(?:\\p{L}{1,20} )?${ES_OBJ}`,
    "u",
  ),
  // Kör set 6: "No he encontrado información sobre la licuadora" — 1. şahıs ("No encontrará ningún cargo" olgudur; "no encuentro" ↑).
  new RegExp(`${L}no (?:he|hemos|había|habíamos) (?:encontrado|visto|localizado) ${gap(3)}${ES_OBJ}`, "u"),
  /(?<![\p{L}])no (?:lo )?sé(?![\p{L}])/u,
  // 10-01 (A05): "No me consta", "No tengo constancia", "Desconozco el horario".
  /(?<![\p{L}])no (?:me|nos) consta(?![\p{L}])|(?<![\p{L}])no (?:tengo|tenemos) constancia|(?<![\p{L}])(?:desconozco|desconocemos)(?![\p{L}])/u,
  /ninguna informaci[óo]n|ningún (?:detalle|dato)/u,
  // RU — "нет (точной) информации / данных", "не указано", "не знаю", "не могу найти", "информация отсутствует".
  // "нет " BOŞLUKLA: "Нет, курить нельзя" eşleşmez.
  new RegExp(`${L}нет ${gap(2)}${RU_OBJ}`, "u"),
  /(?<![\p{L}])не (?:указан[аоы]?|упомянут[аоы]?)(?![\p{L}])/u,
  /(?<![\p{L}])не знаю(?![\p{L}])/u,
  // "У меня нет инструкций для кофемашины" — YALNIZ sahiplik ("Нет особых инструкций" olgudur).
  new RegExp(`${L}у (?:меня|нас) нет ${gap(2)}инструкци\\p{L}{0,4}`, "u"),
  /(?<![\p{L}])не (?:могу|смог|смогла|удалось) (?:\p{L}{1,30} )?найти/u,
  // Kör set 6: "Я не нахожу информации о колонке" / "Не нашёл информации" — 1. şahıs ("Вы не найдёте…", "Если не найдёте…" eşleşmez).
  new RegExp(`${L}не (?:нахожу|находим|нашёл|нашел|нашла|нашли|вижу|видим) ${gap(2)}${RU_OBJ}`, "u"),
  new RegExp(`${RU_OBJ} ${gap(2)}отсутству\\p{L}{0,8}`, "u"),
  // 10-01 (A05): "Информации об этом нет", "Информации нет".
  new RegExp(`${RU_OBJ} ${gap(2)}нет(?![\\p{L}])`, "u"),
  // 10-01 öğlen: "в предоставленной информации нет / не указано".
  new RegExp(`${L}в (?:\\p{L}{1,20} )?${RU_OBJ} (?:нет|не указан\\p{L}{0,2}|не приведен\\p{L}{0,2})(?![\\p{L}])`, "u"),
  // AR — "ليس لدي معلومات", "لا تتوفر لدي معلومات", "لا أعرف", "غير مذكورة". "غير متاح" (olgu) BİLEREK yok.
  new RegExp(`(?:ليس|ليست) ${gap(1)}(?:لدي|لدينا|عندي|عندنا) ${gap(2)}${AR_OBJ}`, "u"),
  new RegExp(`لا (?:تتوفر|يتوفر|توجد|يوجد) ${gap(2)}${AR_OBJ}`, "u"),
  /لا (?:أعرف|اعرف|أعلم|اعلم|أدري|ادري)(?![\p{L}])/u,
  // Kör set 6: "لا أجد معلومات" / "لم أجد أي معلومات" — 1. şahıs (2. çoğul "إذا لم تجدوا المفتاح" eşleşmez).
  new RegExp(`(?:لا|لم) (?:أجد|اجد|نجد|أعثر|اعثر|نعثر) ${gap(2)}${AR_OBJ}`, "u"),
  // "ليس لدي تعليمات" — YALNIZ sahiplik ("لا توجد تعليمات خاصة" olgudur).
  new RegExp(`(?:ليس|ليست) ${gap(1)}(?:لدي|لدينا|عندي|عندنا) ${gap(2)}تعليمات`, "u"),
  /غير (?:مذكورة?|محددة?)(?![\p{L}])/u,
  // 10-01 öğlen: "غير متوفرة في المعلومات المقدمة" — yalnız BİLGİ nesnesiyle ("غير متاح" tek başına olgudur, BİLEREK yok).
  new RegExp(`غير (?:متوفرة?|متاحة?|موجودة?) في (?:ال)?${AR_OBJ}`, "u"),
  // ── "ÇÖZÜM ÖNEREMİYORUM" (10-01 gece, RC60 regresyon koşusu — kör set 5, Luna, misafire GİTTİ): "Bei der Kaffeemaschine kann ich anhand
  // der vorliegenden Informationen keine passende Lösung nennen." Anlama katmanı bu koşuda arızayı tutulacak öğe saymadı (önceki koşuda
  // saymıştı); bırakılan cihaz kapısı bu yüzden koşmadı, son kemer bu yüklem. Ölçüm: yedi dilde 21 biçimin 21'i kaçıyordu. Özne 1. şahıs
  // + olumsuz kip + ÇÖZÜM nesnesi ŞART: "Çözüm: düğmeye basın", "Size bir çözüm önerim var", "Sie können keine Lösung falsch machen", "Je ne
  // peux que vous proposer une solution" (yalnız = olumlu), "I can't offer a discount" eşleşmez. Kapalı tekrar.
  new RegExp(
    `${L}çözüm(?:ü)? ${gap(2)}(?:öneremiyor|sunamıyor|veremiyor|söyleyemiyor|bulamıyor|getiremiyor)(?:um|uz)(?![\\p{L}])`,
    "u",
  ),
  new RegExp(`${L}çözüm(?:ü)? ${gap(2)}(?:bulamad|öneremed|sunamad|veremed)ı(?:m|k)(?![\\p{L}])`, "u"),
  new RegExp(
    `${L}(?:i(?: am|'m)?|we(?: are|'re)?) (?:can't|cannot|can not|couldn't|could not|won't be able to|unable to|not able to) (?:offer|give|provide|suggest|recommend|propose|share|find)(?: you| any| a| an){0,2} (?:\\p{L}{1,20} )?(?:solutions?|fix(?:es)?|remed(?:y|ies)|troubleshooting)(?![\\p{L}])`,
    "u",
  ),
  new RegExp(
    `(?:kann|können|konnte|konnten|könnte|könnten) (?:ich|wir)(?: \\p{L}{1,30}){0,5} (?:keine|keinen|keinerlei) (?:\\p{L}{1,20} )?(?:lösung\\p{L}{0,12}|abhilfe)(?![\\p{L}])(?!(?: \\p{L}{1,30}){0,3} vorstellen)`,
    "u",
  ),
  new RegExp(
    `${L}(?:ich|wir) (?:kann|können|konnte|konnten|könnte|könnten)(?: \\p{L}{1,30}){0,5} (?:keine|keinen|keinerlei) (?:\\p{L}{1,20} )?(?:lösung\\p{L}{0,12}|abhilfe)(?![\\p{L}])(?!(?: \\p{L}{1,30}){0,3} vorstellen)`,
    "u",
  ),
  new RegExp(
    `${L}(?:je|nous) ne (?:peux|pouvons|pourrai|pourrons|suis|sommes|saurais|saurions) (?:pas|plus)(?: (?!que(?![\\p{L}]))\\p{L}{1,20}| [dl]'\\p{L}{1,20}){0,4} (?:de |d'|une |la |des )?(?:\\p{L}{1,20} )?solutions?(?![\\p{L}])`,
    "u",
  ),
  new RegExp(`${L}(?:je|nous) n'(?:ai|avons) (?:pas|aucune) (?:de |d')?(?:\\p{L}{1,20} )?solutions?(?![\\p{L}])`, "u"),
  new RegExp(
    `${L}no (?:puedo|podemos|podría|podríamos|sabría|sabríamos|estoy en condiciones de|estamos en condiciones de)(?: (?!que(?![\\p{L}]))\\p{L}{1,20}){0,4} (?:una |ninguna |la |alguna )?(?:\\p{L}{1,20} )?soluci[óo]n(?:es)?(?![\\p{L}])`,
    "u",
  ),
  new RegExp(`${L}no (?:tengo|tenemos) (?:una |ninguna )?(?:\\p{L}{1,20} )?soluci[óo]n(?:es)?(?![\\p{L}])`, "u"),
  new RegExp(
    `${L}не (?:могу|можем|смогу|сможем)(?: \\p{L}{1,20}){0,3} (?:предложить|подсказать|дать|назвать|найти|порекомендовать|посоветовать|предоставить)(?: \\p{L}{1,20}){0,2} решени\\p{L}{0,3}`,
    "u",
  ),
  new RegExp(`${L}у (?:меня|нас) нет ${gap(1)}решени\\p{L}{0,3}`, "u"),
  new RegExp(
    `(?:لا|لن) (?:أستطيع|استطيع|نستطيع|يمكنني|يمكننا|أقدر|اقدر|نقدر) ${gap(2)}(?:تقديم|اقتراح|إعطاء|اعطاء|إيجاد|ايجاد|توفير)(?: \\p{L}{1,20}){0,2} (?:أي |اي )?(?:حل|حلا|حلول)(?![\\p{L}])`,
    "u",
  ),
  new RegExp(
    `لم (?:أتمكن|اتمكن|نتمكن|أستطع|استطع|نستطع) (?:من )?(?:تقديم|اقتراح|إيجاد|ايجاد|العثور على) (?:أي |اي )?(?:حل|حلا|حلول)(?![\\p{L}])`,
    "u",
  ),
  // ── "BİLGİ VEREMEM" HİÇBİR DİLDE (kurucu 10-18 T3, AYNEN: "BİLGİ VEREMEM HİÇBİR DİLDE GİTMEMELİ"; 10-17 M1 yalnız Türkçe geniş zamanı
  // tutuyordu). Özne 1. şahıs + olumsuz kip + VERME fiili + BİLGİ nesnesi: "I can't provide information about the TV", "Bu konuda bilgi
  // sağlayamıyorum", "bilgi vermem mümkün değil". "I can't provide early check-in" (nesne bilgi değil), "Bilgilerinizi almadan kodu
  // veremeyiz" (politika — mevcut dar kural) eşleşmez.
  new RegExp(
    `${L}(?:can't|cannot|can not|couldn't|could not|won't be able to|unable to|not able to|not in a position to) (?:provide|give|share|offer|disclose|supply)(?: (?:you|any|more|further|specific|detailed|exact|that|this|such|the)){0,3} ${EN_OBJ}`,
    "u",
  ),
  new RegExp(
    `${TR_OBJ} ${gap(2)}(?:sağlaya(?:mıyorum|mıyoruz|mam|mayız|mayacağım|mayacağız)|paylaşa(?:mıyorum|mıyoruz|mam|mayız)|suna(?:mıyorum|mıyoruz|mam|mayız)|ver(?:mem|memiz) mümkün değil(?:dir)?)(?![\\p{L}])`,
    "u",
  ),
  new RegExp(
    `(?:kann|können|könnte|könnten) (?:ich|wir)(?: \\p{L}{1,30}){0,3} (?:keine|keinerlei) ${gap(1)}${DE_INFO} ${gap(1)}(?:bereitstellen|mitteilen|teilen|nennen|machen|geben)(?![\\p{L}])`,
    "u",
  ),
  new RegExp(
    `${L}(?:je|nous) ne (?:peux|pouvons|suis|sommes) (?:pas|plus)(?: en mesure de)?(?: vous| te)? (?:donner|fournir|communiquer|partager|transmettre) (?:d'|de |des |les |l'|cette |ces |cet |la |le |plus d'|plus de |aucune? )?(?:\\p{L}{1,20} )?${FR_OBJ}`,
    "u",
  ),
  new RegExp(`${L}no (?:puedo|podemos|podría|podríamos)(?: \\p{L}{1,20}){1,3} ${ES_OBJ}`, "u"),
  new RegExp(`${L}не (?:могу|можем|смогу|сможем)(?: \\p{L}{1,20}){1,3} ${RU_OBJ}`, "u"),
  new RegExp(
    `(?:لا|لن) (?:أستطيع|استطيع|نستطيع|يمكنني|يمكننا) ${gap(2)}(?:تقديم|إعطاء|اعطاء|مشاركة|توفير)(?: \\p{L}{1,20}){0,2} (?:أي |اي )?${AR_OBJ}`,
    "u",
  ),
  // ── İÇ KAYNAK / İŞLEYİŞ ANLATIMI (kurucu T1, 10-21: "misafire 'bilgi tabanında yok', 'kayıtlarımdan bulamadım', 'sistemimizde görünmüyor'
  // gibi iç kaynak ve işleyiş anlatımı yazılmayacak"). İlk ikisi ↑ bilgi / kayıt nesnesiyle zaten tutuluyordu; "sistem" yoktu (ölçüldü).
  // DAR: yalnız BULUNMA / ÇIKMA eki ("sistemimizde / sistemde / sistemimden") — "Dairede merkezi ısıtma sistemi yok", "Asansör sistemimiz
  // yok" mülk olgusudur, tutulmaz (Haiku T1 #5). "yok" yalnız hemen ardından ya da kayıt / bilgi / rezervasyon sözcüğünden sonra: "Klima
  // sistemimizde bir sorun yok" normal cevaptır.
  new RegExp(
    `${L}sistem(?:imizde|imizden|imde|imden|de|den)(?![\\p{L}]) (?:${TR_TIGHT}|${gap(3)}${TR_LOOSE}|${gap(2)}(?:kay[ıi]t|kayd|bilgi|rezervasyon)\\p{L}{0,10} ${TR_TIGHT})`,
    "u",
  ),
  /(?<![\p{L}])(?:not|isn't|is not|aren't|are not|doesn't appear|does not appear|don't see (?:it|that|this|them|anything|your \p{L}{1,20})) (?:to be )?(?:in|on) (?:our|my|the) system(?![\p{L}])/u,
  /(?<![\p{L}])(?:our|my|the) system (?:doesn't|does not|didn't|did not) (?:show|have|list|contain)(?![\p{L}])/u,
];

/**
 * NİTELEYİCİLİ "TALİMAT YOK" (kurucu 10-17, H9, aynen: "Çıkış için özel talimatımız yok … bunu yazmasın"; "televizyonla ilgili ayrı bir
 * talimatım bulunmuyor — böyle bir şey yazamaz kesinlikle"). Dil fark etmez: "özel / ek / başka / ayrı bir talimat yok", "No special
 * instructions", "No hay instrucciones especiales", "Нет особых инструкций", "لا توجد تعليمات خاصة", "aucune instruction particulière",
 * "keine besonderen Anweisungen" misafire GİTMEZ ("bilgim yok" ailesi). 1. şahıs iyelikli Türkçe biçim ↑`ABSENCE_PATTERNS`te. Aynı
 * cümlede yönerge varsa yalnız bu yan cümle silinir (`no-instruction-filler.ts`).
 */
const QUALIFIED_NO_INSTRUCTION_PATTERNS: readonly RegExp[] = [
  // Haiku 10-17: 3. şahıs iyelik ("özel talimatı yok"), "belirli / belli / spesifik" niteleyicisi, "mevcut değil / söz konusu değil" yüklemi.
  // Opus 10-17: "bulunmamakta" (-dır'sız).
  new RegExp(
    `${L}(?:özel|ek|başka|farklı|ilave|ekstra|ayrı|belirli|belli|spesifik)\\s(?:bir\\s)?talimat(?:lar|ı|ları)?\\s(?:yok(?:tur)?|bulunmuyor|bulunmamakta(?:dır)?|mevcut\\sdeğil(?:dir)?|söz\\skonusu\\sdeğil(?:dir)?)(?![\\p{L}])`,
    "u",
  ),
  // "No special instructions are needed" = "gerekmiyor" (Haiku 10-17) → "are / is needed · required · necessary" ile devam ederse eşleşmez.
  /(?<![\p{L}])(?<!(?:need|needs|require|requires) )no (?:special|particular|specific|additional|extra|further|other) (?:\p{L}{1,20} )?(?:instructions|steps|guidance)(?![\p{L}])(?! (?:are|is) (?:needed|required|necessary))/u,
  // Opus 10-17 (en doğal İngilizce biçimler kaçıyordu): "There aren't any special instructions", "We don't have any special instructions".
  /(?<![\p{L}])there (?:aren't|are not|isn't|is not) any (?:special|particular|specific|additional|extra|further|other) (?:instructions|steps|guidance)(?![\p{L}])/u,
  /(?<![\p{L}])(?:i|we) (?:don't|do not) have any (?:special|particular|specific|additional|extra|further|other) (?:instructions|steps|guidance)(?![\p{L}])/u,
  /(?<![\p{L}])no hay instrucciones (?:especiales|adicionales|particulares|específicas|concretas)(?![\p{L}])/u,
  /(?<![\p{L}])no hay ninguna instrucción (?:especial|adicional|particular|específica|concreta)(?![\p{L}])/u,
  /(?<![\p{L}])no tenemos instrucciones (?:especiales|adicionales|particulares|específicas|concretas)(?![\p{L}])/u,
  /(?<![\p{L}])нет (?:особых|дополнительных|специальных|конкретных) инструкций(?![\p{L}])/u,
  /(?<![\p{L}])(?:особых|дополнительных|специальных|конкретных) инструкций нет(?![\p{L}])/u,
  /لا (?:توجد|يوجد) تعليمات (?:خاصة|إضافية|محددة)/u,
  /ليس لدينا تعليمات (?:خاصة|إضافية|محددة)/u,
  /(?<![\p{L}])(?<!besoin d')aucune (?:instruction|consigne) (?:particulière|spéciale|supplémentaire|spécifique|précise)(?![\p{L}])/u,
  /(?<![\p{L}])pas d'instructions? (?:particulières?|spéciales?|supplémentaires?|spécifiques?|précises?)(?![\p{L}])/u,
  /(?<![\p{L}])pas de consignes? (?:particulières?|spéciales?|supplémentaires?|spécifiques?|précises?)(?![\p{L}])/u,
  /(?<![\p{L}])(?<!(?:brauchen|benötigen|braucht|benötigt) )keine (?:besonderen|speziellen|zusätzlichen|weiteren|konkreten|spezifischen) (?:anweisungen|anleitungen|hinweise)(?![\p{L}])/u,
  /(?<![\p{L}])(?:besondere|spezielle|zusätzliche|weitere) (?:anweisungen|anleitungen|hinweise) gibt es (?:nicht|keine)(?![\p{L}])/u,
];

/**
 * Silinebilir "talimat yok" YAN CÜMLESİ (`no-instruction-filler.ts`): niteleyicili biçimler + 1. şahıs iyelikli "talimatım(ız) yok" + "özel
 * bir talimat gerekmiyor" (yalnız silme için; tek başına "gerek yok" bilgisi misafire gidebilir, bilgisizlik değildir).
 */
const NO_INSTRUCTION_CLAUSE_PATTERNS: readonly RegExp[] = [
  ...QUALIFIED_NO_INSTRUCTION_PATTERNS,
  new RegExp(
    `${L}talimat(?:ım|ımız|larım|larımız) ${gap(1)}(?:yok(?:tur)?|bulunmuyor|bulunmamaktadır|mevcut değil(?:dir)?|söz konusu değil(?:dir)?)(?![\\p{L}])`,
    "u",
  ),
  new RegExp(`${L}(?:özel|ek|başka|farklı|ilave|ekstra|ayrı)\\s(?:bir\\s)?talimat(?:a|lar)?\\s(?:gerek(?:\\s)?(?:yok|miyor|mez|memektedir))(?![\\p{L}])`, "u"),
];

/** Tek liste (her çağrıda yeniden kurulmasın). Yeni kalıplar KAPALI tekrar (`{0,n}`) kullanır — CLAUDE.md karesel iş kuralı. */
const ALL_ABSENCE_PATTERNS: readonly RegExp[] = [...ABSENCE_PATTERNS, ...MORE_ABSENCE_PATTERNS, ...QUALIFIED_NO_INSTRUCTION_PATTERNS];

// ── İÇ KAYNAK ANLATIMI — KAYNAK İŞARETİ + OLUMSUZLUK AYNI CÜMLEDE (Claude T1 ölçümü 10-21: 30 vakanın 21'i kaçtı) ───────────────────────
// Kurucu T1 (10-21): "misafire 'bilgi tabanında yok', 'kayıtlarımdan bulamadım', 'sistemimizde görünmüyor' gibi iç kaynak ve işleyiş anlatımı
// yazılmayacak". Kaçanlar nesne + yüklem dilbilgisine sığmıyordu: "the material I've been working from", "not in my prompt", "loaded into my
// context", "FAQ entries I can pull up", "the lookup returned nothing", "in der mir vorliegenden Wissensdatenbank nichts hinterlegt", "la fiche du
// logement qui m'a été transmise", "me configuraron para contestar solo con la ficha", "в карточке объекта, которую мне передали", "لا يوجد في
// سجلاتنا", "bana tanımlanan bilgilerin içinde", "sistem sorgusunda eşleştiremedim". Ortak yapı: yapay zekânın KENDİ kaynağını / aramasını anlatan
// bir İŞARET + aynı cümlede olumsuzluk. Yön yalnız TUTMAK (kapı kısıtlayıcı). İşaretler yalnız iç kaynaktır — çıplak "sistem / system / records"
// İŞARET DEĞİL (mülk olgusu: "Klima sistemimizde sorun yok", "The heating system is electric" — ölçer kategorisi "Sistem / kayıt sözcüklü normal
// cevap" 0 kalmalı); Türkçe "elimdeki / bana verilen …" yalnız bulunma ekiyle ("bilgilerde", "notlarında", "içinde"). (Bu liste yalnız
// İTİRAF ailesidir; "elimdeki bilgilere göre otopark ücretsiz" gibi OLUMLU iç kaynak anlatımını kurucu 10-22 ayrıca yasakladı →
// ↓`namesInternalSource`, ayrı ayrıntı kodu `reply_internal_source`.) Olumsuzluk dil başına ayrı (İspanyolca "no" İngilizce "no deposit"i tutmasın). Kalıplar başı sabit
// sözcükle başlar, tekrarlar kapalı — karesel iş yok (`absence-cost.test.ts`).
const TR_GIVEN = "(?:tanımlanan|verilen|iletilen|sağlanan|aktarılan|gönderilen|yüklenen|paylaşılan)";
/** Türkçe "yok" — "sorun / eksik / ücret … yok" (çekimli de: "sorunu yok", "ücreti yok") olgudur, olumsuzluk sayılmaz. */
const TR_PLAIN_YOK =
  "(?<!(?:sorun|problem|eksik|eksiklik|hata|engel|sıkıntı|aksaklık|ücret|endişe|gerek|ihtiyaç|değişiklik)\\p{L}{0,5} (?:[\\p{L}]{1,12} )?)yok(?:tur)?(?![\\p{L}])";
const INTERNAL_SOURCE_RULES: ReadonlyArray<readonly [marker: RegExp, negation: RegExp]> = [
  [
    new RegExp(
      `${L}(?:bilgi ?taban\\p{L}{0,8}|veri ?taban\\p{L}{0,8}|sistem sorgu\\p{L}{0,8}|(?:sorgu|arama|sorgulama)(?:m|mız)(?:da|la)(?![\\p{L}])|` +
        `kay[ıi]tlar[ıi]m(?:[ıi]z)?(?:da|dan)(?![\\p{L}])|notlar[ıi]m(?:[ıi]z)?(?:da|dan)(?![\\p{L}])|bilgiler[ıi]m(?:[ıi]z)?(?:de|den)(?![\\p{L}])|` +
        `(?:elimdeki|bana ${TR_GIVEN}) (?:\\p{L}{1,30} ){0,2}(?:\\p{L}{1,30}(?:de|da|te|ta)|içinde|arasında)(?![\\p{L}]))`,
      "u",
    ),
    new RegExp(
      `${L}(?:${TR_PLAIN_YOK}|değil|bulunmuyor|bulunmamakta|bulunamad|göremiyor|göremed|görünmüyor|bulamad|bulamıyor|eşleştiremed|eşleştiremiyor|` +
        "eşleşmed|eşleşmiyor|rastlamad|rastlayamad|ulaşamad|ulaşamıyor|yer almıyor|yer almamakta|geçmiyor|çıkmad|çıkmıyor|verilmemiş|belirtilmemiş|" +
        "tanımlanmamış|teyit edemiyor|teyit edemed|doğrulayamad|doğrulayamıyor|hiçbir şey)",
      "u",
    ),
  ],
  [
    // Haiku 10-21: çıplak "gave me / the prompt / I have set up" normal cevapta da geçer ("The host gave me the lockbox code, nothing else
    // you need") → işaret yalnız KAYNAK nesnesiyle ("the notes the host gave me", "the guide I have") ya da açıkça iç bağlamla.
    new RegExp(
      `${L}(?:knowledge[ -]?base|database|(?:my|system) prompt(?![\\p{L}])|(?:in|into|to) my context(?![\\p{L}])|context window|` +
        "(?:the|my|a|that|our) look-?up(?![\\p{L}])|faq entries|faqs? (?:i|we) (?:can|could|have)|" +
        "(?:i've been|i have been|i was|i am|i'm) (?:working from|configured|programmed)(?![\\p{L}])|working from|" +
        "(?:loaded|fed) (?:to|into) (?:me|my)(?![\\p{L}])|" +
        "(?:notes?|information|info|details|material|materials|instructions|documents?|guide|sheet|listing|data) (?:that )?(?:(?:the host|your host|the owner|they|you) )?(?:gave|has given|had given|provided|shared|sent|passed) me(?![\\p{L}])|" +
        "(?:notes?|information|info|details|material|materials|guide|sheet|listing|data) (?:i|we) (?:have|was given|were given|got|received|can see|can access)(?![\\p{L}])|" +
        "(?:in|on) (?:our|my) (?:system|records|notes|files)(?![\\p{L}])|" +
        "(?:i|we) (?:searched|checked|queried|looked through|looked in) (?:the |our |my )?(?:knowledge base|records?|system|database|notes|files|faqs?))",
      "u",
    ),
    /(?<![\p{L}])(?:nothing|none of|no (?:mention|record|records|entry|entries|information|info|details?|results?|match|matches|notes?|rule|rules|reference|booking|bookings|reservation|reservations)(?![\p{L}])|(?:isn't|is not|aren't|are not|wasn't|was not|weren't|were not) (?:covered|mentioned|listed|included|there|anything|in|on|loaded|available|part)(?![\p{L}])|(?:don't|doesn't|didn't|do not|does not|did not) (?:mention|cover|include|show|list|contain|say|appear|find|see|turn up)(?![\p{L}])|couldn't find|could not find|can't find|cannot find|unable to find|returned nothing|came up (?:empty|blank|short)|no luck)/u,
  ],
  [
    /(?<![\p{L}])(?:wissensdatenbank|datenbank|datensatz|buchungsdaten|(?:mir|uns) (?:vorliegend\p{L}{0,3}|zur verfügung (?:gestellt|stehend)\p{L}{0,3}|übermittelt\p{L}{0,3}|mitgeteilt\p{L}{0,3})|(?:meinen|unseren) unterlagen|systemabfrage|systemsuche)/u,
    /(?<![\p{L}])(?:nicht|nichts|kein\p{L}{0,3}|keinerlei|fehlt|fehlen)(?![\p{L}])/u,
  ],
  [
    // Haiku 10-21: "Notre système d'eau chaude …, pas besoin de le régler" olgudur → işaret yalnız YER ("dans notre système"), olumsuzluk
    // yalnız YOKLUK yüklemi (çıplak "pas" / "ne" değil).
    /(?<![\p{L}])(?:base de (?:données|connaissances)|(?:qui|que) (?:m'|nous )(?:a|ont) été (?:transmis|fourni|donné|communiqué)\p{L}{0,2}|(?:on|l'hôte) (?:m'a|nous a) (?:transmis|fourni|donné|communiqué)\p{L}{0,2}|dans (?:mon|notre) système|(?:dans|selon) (?:mes|nos) (?:notes|fiches|dossiers|registres)(?![\p{L}])|(?:mes|nos) (?:fiches|dossiers|registres)(?![\p{L}])|fiche (?:du logement|de l'annonce|qui))/u,
    /(?<![\p{L}])(?:ne (?:figure|figurent|contient|contiennent|mentionne|mentionnent|indique|précise|trouve|vois|dispose|comporte|parle|apparaît|apparait)|n'(?:apparaît|apparait|apparaissent|y a (?:rien|pas|aucun)|ai (?:rien|pas trouvé|aucune?)|est pas (?:mentionn|indiqu|précis|renseign))|aucune?(?![\p{L}])|rien(?![\p{L}]))/u,
  ],
  [
    /(?<![\p{L}])(?:base de datos|en (?:nuestro|mi) sistema|(?:en|según) (?:mis|nuestras) notas|(?:nuestros|mis) registros|me (?:configuraron|programaron|pasaron|dieron|facilitaron|proporcionaron)(?![\p{L}])|ficha del alojamiento)/u,
    /(?<![\p{L}])(?:no (?:aparece|aparecen|figura|figuran|consta|constan|encuentro|encontré|he encontrado|veo|vi|se (?:menciona|especifica|indica|recoge))(?![\p{L}])|nada(?![\p{L}])|ningun[oa]?(?![\p{L}])|ningún(?![\p{L}]))/u,
  ],
  [
    /(?<![\p{L}])(?:баз\p{L}{0,3} данных|(?:в|из) (?:нашей|моей) систем\p{L}{0,3}|(?:мне|нам) (?:передали|предоставили|дали|выдали)|(?:переданн|предоставленн)\p{L}{0,4} (?:мне|нам)|(?:наших|моих) (?:записях|заметках)|карточк\p{L}{0,3} объекта)/u,
    // Haiku 10-21: "…выключать не нужно" olgudur → yalnız YOKLUK yüklemi.
    /(?<![\p{L}])(?:ничего не|ничего нет|не (?:указан|упомина|упомянут|найден|нашл|нашёл|нашел|вижу|видим|отображ|значит|сказано|написано|числится)\p{L}{0,4}|нет (?:данных|информации|записей|сведений|брони|бронирования)|отсутству\p{L}{0,6})/u,
  ],
  [
    /(?:سجلات(?:نا|ي)|قاعدة (?:ال)?بيانات|نظام(?:نا|ي)(?![\p{L}])|ملاحظات(?:نا|ي)|ي?زوّ?دني|أعطاني|اعطاني|المقدمة لي)/u,
    // Arapça bağlaç öneki bitişik yazılır ("ولم يظهر", "فلا"). Haiku 10-21: "ولا داعي" (gerek yok) olumsuzluk sayılmaz — yalnız YOKLUK yüklemi.
    /(?<![\p{L}])[وف]?(?:لا (?:يوجد|توجد|يظهر|تظهر|يذكر|تذكر)|لم (?:يظهر|تظهر|يزو|أجد|اجد|نجد|يذكر|يرد|تذكر|أعثر|اعثر)|ليس (?:في|لدي|لدينا|هناك)|غير (?:موجود|مذكور))/u,
  ],
];

/**
 * Bir cümlede iç kaynak işareti + aynı dilin olumsuzluğu var mı (katlanmış metin). Cümle sınırı `SEP` + noktalı virgül + Arapça soru işareti
 * (Haiku 10-21: "Elimdeki bilgilerde girişiniz 15:00; bahçe kapısı kilitli değil." iki ayrı yargıdır).
 */
function narratesInternalSource(folded: string): boolean {
  for (const sentence of folded.split(/[\u0000;؟]/u)) {
    for (const [marker, negation] of INTERNAL_SOURCE_RULES) {
      if (marker.test(sentence) && negation.test(sentence)) return true;
    }
  }
  return false;
}

/** Virgüller arasındaki yumuşatma sözcüğü (↓ `foldedForms`). Boşluklar önceden teke indirildiği için karesel iş yok. */
const INTERJECTION_BETWEEN_COMMAS =
  /\s?,\s?(?:maalesef|ne yaz[ıi]k ki|[üu]zg[üu]n[üu]m|unfortunately|sadly|i'?m afraid|regrettably|leider|malheureusement|h[ée]las|lamentablemente|desafortunadamente|por desgracia|к сожалению|للأسف)\s?,\s?/giu;

/** Ortak hazırlık: `admitsMissingKnowledge` ile aynı normalleştirme + iki katlama. */
function foldedForms(text: string | null | undefined): [string, string] {
  // Görünmez karakter (ZWSP, yumuşak tire, biçim karakteri, boş braille) yalnız EŞLEŞME kopyasından silinir — "bilgim\u200B yok" kuralı
  // atlatmasın (gece-4 S4-07: KB'den yapıştırılan ya da QR misafirince modele yazdırılan görünmez karakter "bilgim yok"u gizliyordu).
  const normalized = (text ?? "")
    .replace(/[\p{Default_Ignorable_Code_Point}\p{Cf}\u2800]/gu, "")
    .normalize("NFC")
    .replace(/[’‘ʼ]/g, "'")
    .replace(/[*_`~]+/g, "")
    .replace(/\s+/g, " ")
    // Virgüller arasındaki ünlem / yumuşatma sözcüğü de yalnız EŞLEŞME kopyasından düşer (Claude 2. dalga #69): "Bu konuda bilgim, maalesef,
    // yok" / "I don't have, unfortunately, any information" kalıbı virgül yüzünden kaçıyordu. Tutucu yön (yalnız tutma artar).
    .replace(INTERJECTION_BETWEEN_COMMAS, " ");
  const marked = normalized.replace(SENTENCE_END, `$1${SEP}$2`);
  return [foldTurkishLower(marked), foldTurkishLowerTr(marked)];
}

/** Metin (bir yan cümle) silinebilir "talimat yok" kalıbı taşıyor mu (↑`NO_INSTRUCTION_CLAUSE_PATTERNS`). */
export function matchesNoInstructionClause(text: string | null | undefined): boolean {
  const [plain, turkish] = foldedForms(text);
  return NO_INSTRUCTION_CLAUSE_PATTERNS.some((re) => re.test(plain) || re.test(turkish));
}

/**
 * Yan cümleden "talimat yok" ifadesi çıkarıldıktan sonra KALAN kısım (katlanmış küçük harf; yalnız karar için — misafire giden metin bu değil).
 * Eşleşme yoksa `null`. Silici bununla yan cümlenin YALNIZ "talimat yok" + kısa konu ("Çıkış için", "for checkout") olduğunu doğrular — aynı
 * yan cümlede başka bilgi varsa ("…yok ve kahvaltı 08.00-10.00 arasıdır") silinmez (Haiku 10-17).
 */
export function noInstructionClauseRest(text: string | null | undefined): string | null {
  for (const form of foldedForms(text)) {
    for (const re of NO_INSTRUCTION_CLAUSE_PATTERNS) {
      const m = re.exec(form);
      if (m) return `${form.slice(0, m.index)} ${form.slice(m.index + m[0].length)}`;
    }
  }
  return null;
}

/**
 * Metinden BÜTÜN "talimat yok" ifadeleri çıkarıldıktan sonra kalan (katlanmış küçük harf; yalnız karar için). Eşleşme yoksa `null`. Silici
 * bununla konusu ADLANDIRILMIŞ ama tanınmayan "talimat yok"u ayırır ("Jakuzi için özel talimatımız yok" → "jakuzi için"; Haiku 10-17 gece-4).
 * En çok 32 ifade çıkarılır (cevap 4.000 karakterle sınırlı); fazlası kalanda kalır → silici tutar (güvenli yön).
 */
export function noInstructionClauseResidue(text: string | null | undefined): string | null {
  let best: string | null = null;
  for (const form of foldedForms(text)) {
    let rest = form;
    let found = false;
    for (let round = 0; round < 32; round += 1) {
      const hit = NO_INSTRUCTION_CLAUSE_PATTERNS.map((re) => re.exec(rest)).find((m) => m !== null);
      if (!hit) break;
      rest = `${rest.slice(0, hit.index)} ${rest.slice(hit.index + hit[0].length)}`;
      found = true;
    }
    if (found && (best === null || rest.length < best.length)) best = rest;
  }
  return best;
}

// ── EV SAHİBİNE YÖNLENDİRME = BİLGİM YOK (kurucu 10-23 akşam 4.5, aynen: "ev sahibinize sorabilirsiniz yazamaz yasak onlar bilgisi yok
// sayılsın cevap tutulsun") ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 09-11 kararı savuşturmayı ("ev sahibinizle iletişime geçebilirsiniz") bilerek DIŞARIDA bırakmıştı (↑dosya başı); kurucu kararıyla artık
// yönlendirme de bilgisizliktir: misafiri bilgi için ev sahibine gönderen cümle gitmez, cevap tutulur, ev sahibi yanıtlar. Konu bazlı
// "bilgim yok" (H9, `conversation-items/topic-absence.ts`) bu cümleyi ayıklayıp aynı mesajdaki cevaplanmış konuları göndermeye devam eder.
// Hariç (cümle bazında):
//   · İletişim DEĞERİ taşıyan cümle ("ev sahibinize 0532 … numarasından ulaşabilirsiniz") sorulan bilgiyi verir — onaylı rezervasyondan
//     önce Airbnb'de ayrıca tutulur (`channels/airbnb-message-policy.ts`).
//   · Olay KOŞULU ("anahtarı kaybederseniz ev sahibinize ulaşın", "if the Wi-Fi fails, message your host") bilgi tabanındaki talimattır —
//     koşul bilgi isteği değilse ("daha fazla bilgi isterseniz" yine yönlendirmedir).
//   · Gelecek zaman sözü ("ev sahibiniz size dönecek") çıktı vetosunun işidir; burada yalnız YETENEK / İSTEK kipleri.
// Kalıplar sabit sözcükle başlar, boşluklar sınırlı ({0,4} sözcük, cümle sınırını geçmez) — karesel iş yok (süre pini testte).
// Opus 10-23 akşam A2: "hosta / host'a", "mülk / daire sahibi", "(site / bina) yöneticisi" de bilgi için başka birine göndermektir.
const HOST_TR = `${L}(?:ev ?sahib(?:i|in|im)\\p{L}{0,8}|host(?:'?(?:unuz|unuza|unuzdan|unuzla|umuz))|host'?a(?![\\p{L}])|m[üu]lk sahib\\p{L}{0,8}|daire sahib\\p{L}{0,8}|(?:site |bina )?y[öo]netici\\p{L}{0,6}|(?:site|bina|apartman) y[öo]netim\\p{L}{0,6})`;
const VERB_TR =
  // "sor-" yalnız misafir öznesiyle ("ev sahibiniz giriş saatinizi sorabilir" ev sahibinin sorusudur — Haiku 10-23 akşam).
  "(?:sor(?:abilirsiniz|man[ıi]z|ar[ıi]m)\\p{L}{0,8}|" +
  // Haiku 10-23 akşam: konuş / görüş / yaz / ara / mesaj yalnız misafir öznesiyle (ikinci çoğul ya da emir; "ev sahibiniz sizi arayabilir" değil).
  "konu[şs](?:abilirsiniz|un(?![\\p{L}])|unuz|man[ıi]z)\\p{L}{0,8}|g[öo]r[üu][şs](?:ebilirsiniz|[üu]n(?![\\p{L}])|[üu]n[üu]z|men[ie]z)\\p{L}{0,8}|" +
  "yaz(?:abilirsiniz|[ıi]n(?![\\p{L}])|[ıi]n[ıi]z|man[ıi]z)\\p{L}{0,8}|ara(?:yabilirsiniz|y[ıi]n(?![\\p{L}])|y[ıi]n[ıi]z|man[ıi]z)\\p{L}{0,8}|" +
  "mesaj (?:atabilirsiniz|g[öo]nderebilirsiniz|yazabilirsiniz|at[ıi]n(?![\\p{L}])|g[öo]nderin)\\p{L}{0,8}|dan[ıi][şs](?:abilir|[ıi]n(?![\\p{L}])|[ıi]n[ıi]z|man[ıi]z)\\p{L}{0,8}|" +
  "ula[şs](?:abilir|[ıi]n(?![\\p{L}])|[ıi]n[ıi]z|man[ıi]z)\\p{L}{0,8}|ba[şs]vur(?:abilir|un(?![\\p{L}])|unuz|man[ıi]z)\\p{L}{0,8}|" +
  "(?:ileti[şs]im|irtibat)\\p{L}{0,2} ge[çc](?:ebilir|in(?![\\p{L}])|iniz|men[ie]z)\\p{L}{0,8}|" +
  // v3 kapsam incelemesi cost-coverage-01: "ev sahibinizle iletişim kurabilirsiniz / temasa geçebilirsiniz" de aynı yönlendirmedir.
  "(?:ileti[şs]im|irtibat|temas)\\p{L}{0,2} kur(?:abilir|un(?![\\p{L}])|unuz|man[ıi]z)\\p{L}{0,8}|temas(?:a|ta)? ge[çc](?:ebilir|in(?![\\p{L}])|iniz|men[ie]z)\\p{L}{0,8}|" +
  "iste(?:yebilir|yin|meniz)\\p{L}{0,8}|teyit (?:edebilir|edin|etmeniz|ettirebilir|alabilir)\\p{L}{0,8}|" +
  // Opus 10-23 akşam A2: "Bu sorunuzu ev sahibinize iletebilirsiniz."
  "ilet(?:ebilirsiniz|in(?![\\p{L}])|iniz|meniz)\\p{L}{0,8}|" +
  // "bilgi verebilir" yalnız ev sahibi öznesiyle (R13, kurucu onayı 10-28): "ev sahibinizi arayıp bilgi verebilirsiniz" misafirin HABER vermesidir.
  "(?:detayl[ıi] |kesin |net |daha fazla )?bilgi (?:alabilir|al[ıi]n(?![\\p{L}])|alman[ıi]z|verebilir(?!siniz)|sa[ğg]layabilir)\\p{L}{0,8}|" +
  "[öo][ğg]ren(?:ebilir|in(?![\\p{L}])|iniz|meniz)\\p{L}{0,8}|yard[ıi]mc[ıi] olabilir\\p{L}{0,8}|netle[şs]tirebilir\\p{L}{0,8}|" +
  "a[çc][ıi]kl[ıi]k getirebilir\\p{L}{0,8}|(?:onaylayabilir|do[ğg]rulayabilir)\\p{L}{0,8}|" +
  // Ev sahibi öznesiyle "size bildirebilir / söyleyebilir / açıklayabilir / haber verebilir" de bilgi yönlendirmesidir (v3 kapsam turu:
  // "Havluların yerini ev sahibiniz size bildirebilir" eskiden yalnız haber-verme kalıbının geniş ekiyle yakalanıyordu).
  "(?:(?:bildir|bilgilendir)ebilir|s[öo]yleyebilir|(?:a[çc][ıi]kla|cevapla|yan[ıi]tla)yabilir|(?:haber|cevap|yan[ıi]t) verebilir)(?!siniz)\\p{L}{0,8})";
const EN_HOST = "(?:your|the) (?:airbnb )?(?:hosts?|landlord|property manager|owner|hostess)";
const DE_HOST = "(?:ihren|ihre|ihrem|ihrer|ihr|den|die|dem|der) (?:gastgeber(?:in)?|vermieter(?:in)?|host)";
const FR_HOST = "(?:votre |l['’] ?|le |la )(?:hôte|hôtesse|propriétaire)";
const ES_HOST = "(?:su|tu|el|la) (?:anfitri[oó]n|anfitriona|propietari[oa])";
const RU_HOST = "(?:хозя\\p{L}{0,6}|владел\\p{L}{0,6}|хост\\p{L}{0,4}|арендодател\\p{L}{0,4})";
const HOST_REFERRAL_PATTERNS: readonly RegExp[] = [
  // Türkçe: ad öbeği önce, yüklem en çok dört sözcük sonra ("Otopark için ev sahibinizle iletişime geçebilirsiniz", "Ev sahibiniz, bu konuda
  // size kesin bilgi verebilir").
  new RegExp(`${HOST_TR},? ${gap(4)}${VERB_TR}`, "u"),
  // Emir "sorun" yalnız yönelme ekli ev sahibinden sonra ("ev sahibinize sorun"); "sorun" ad olarak da geçer.
  new RegExp(`${L}(?:ev ?sahib(?:i|in)ize|host'?unuza),? ${gap(3)}sor(?:un|unuz)(?![\\p{L}])`, "u"),
  new RegExp(
    `${L}(?:ask|check with|confirm with|contact|reach out to|get in touch with|message|consult|speak (?:to|with)|talk to|reach|enquire with|inquire with|email|e-mail|write to|text|call|phone` +
      // Opus 10-23 akşam A2: ulaç ("I'd recommend contacting your host", "consider messaging your host").
      `|asking|checking with|confirming with|contacting|reaching out to|getting in touch with|messaging|consulting|speaking (?:to|with)|talking to|reaching|enquiring with|inquiring with|emailing|writing to|texting|calling) ${EN_HOST}(?![\\p{L}])`,
    "u",
  ),
  new RegExp(
    `${L}${EN_HOST} (?:can|could|may|might|should|should be able to|may be able to|might be able to|could be able to|would be able to|will be able to|is able to|is happy to|would be happy to|will be happy to|will be glad to|will happily) ` +
      `(?:${W} ){0,2}(?:tell|confirm|advise|answer|clarify|let you know|inform|help|assist|update)(?![\\p{L}])`,
    "u",
  ),
  // "Your host would know …", "Your host is the best person to ask" (Opus 10-23 akşam A2).
  new RegExp(
    `${L}${EN_HOST} (?:would|will|should|may|might) know(?![\\p{L}])|${L}${EN_HOST} (?:is|would be|will be) (?:the |your )?best (?:person|one|placed|point of contact|contact)(?![\\p{L}])`,
    "u",
  ),
  // "provide / give / share" yalnız BİLGİ nesnesiyle ("Your host can provide a baby cot" bir hizmet olgusudur).
  new RegExp(
    `${L}${EN_HOST} (?:can|could|may|will be able to|would be able to) (?:provide|give|share|send) (?:you )?(?:(?:more|further|the|exact|precise) )?(?:information|info|details|an answer)(?![\\p{L}])`,
    "u",
  ),
  new RegExp(
    `${L}(?:fragen sie|wenden sie sich (?:(?:bitte|gerne|direkt) ){0,2}an|kontaktieren sie|erkundigen sie sich (?:bitte )?bei|melden sie sich (?:bitte )?bei|klären sie (?:das|dies) (?:bitte )?mit|schreiben sie) (?:(?:bitte|gerne|direkt) )?${DE_HOST}(?![\\p{L}])`,
    "u",
  ),
  new RegExp(`${L}(?:bei|von) ${DE_HOST} (?:${W} ){0,2}(?:erfragen|erfahren|nachfragen)(?![\\p{L}])`, "u"),
  // "Bitte setzen Sie sich mit Ihrem Gastgeber in Verbindung." (Opus 10-23 akşam A2)
  new RegExp(`${L}setzen sie sich (?:(?:bitte|gerne|direkt) )?mit ${DE_HOST} in verbindung(?![\\p{L}])`, "u"),
  new RegExp(
    `${L}(?:ihr|ihre|der|die) (?:gastgeber(?:in)?|vermieter(?:in)?|host) (?:kann|könnte|wird ihnen) (?:${W} ){0,3}(?:sagen|bestätigen|(?:weiter|mit)?helfen|auskunft|mitteilen|beantworten|klären|informieren)(?![\\p{L}])` +
      // v3 kapsam incelemesi: "Ihr Gastgeber hilft Ihnen gerne weiter" ("Your host is happy to help" ile aynı yönlendirme).
      `|${L}(?:ihr|ihre|der|die) (?:gastgeber(?:in)?|vermieter(?:in)?|host) hilft ihnen (?:${W} ){0,2}?(?:weiter|dabei)(?![\\p{L}])`,
    "u",
  ),
  new RegExp(
    `${L}(?:demandez|contactez|adressez-vous|renseignez-vous|voyez|vérifiez|rapprochez-vous)(?: (?:directement|auprès de|à|avec|de))? (?:à |auprès de )?${FR_HOST}(?![\\p{L}])`,
    "u",
  ),
  new RegExp(
    `${L}(?:votre|l['’]) ?(?:hôte|propriétaire) (?:pourra|peut|saura|pourrait) (?:vous )?(?:${W} ){0,2}(?:confirmer|renseigner|indiquer|dire|aider|répondre|préciser|informer)(?![\\p{L}])`,
    "u",
  ),
  new RegExp(
    `${L}(?:pregunte|pregúntele|pregúntale|consulte|contacte|contacta|póngase en contacto con|ponte en contacto con|comuníquese con|hable con|habla con|escriba a) (?:a |con )?${ES_HOST}(?![\\p{L}])`,
    "u",
  ),
  new RegExp(
    // Fiile yapışan zamir ("confirmarle", "indicárselo") → fiil kökünden sonra en çok 4 harf.
    `${L}${ES_HOST} (?:podr[aá]|puede|le podr[aá]|te podr[aá]|sabr[aá]) (?:${W} ){0,2}(?:confirm[aá]r|indic[aá]r|dec[ií]r|ayud[aá]r|inform[aá]r|respond[eé]r|aclar[aá]r)\\p{L}{0,4}(?![\\p{L}])`,
    "u",
  ),
  // Virgüllü "пожалуйста" ("Уточните, пожалуйста, у хозяина") — Opus 10-23 akşam A2.
  new RegExp(`${L}(?:спросите|уточните|обратитесь|свяжитесь|напишите),?(?: пожалуйста,?)?(?: (?:у|к|с|со))?(?: (?:вашим|вашему|вашего|вашей))? ${RU_HOST}`, "u"),
  // Mastar biçimleri (FR / ES / RU) — Opus 10-23 akşam A2: "N'hésitez pas à contacter votre hôte", "Le recomiendo contactar con su anfitrión",
  // "Рекомендую связаться с хозяином".
  new RegExp(
    `${L}(?:n'h[ée]sitez pas [àa]|je vous invite [àa]|nous vous invitons [àa]|vous pouvez|veuillez|merci de) ` +
      `(?:contacter|demander [àa]|vous adresser [àa]|[ée]crire [àa]|joindre|vous renseigner auprès de) ${FR_HOST}(?![\\p{L}])`,
    "u",
  ),
  new RegExp(
    `${L}(?:le recomiendo|te recomiendo|le sugiero|te sugiero|no dude en|no dudes en|puede|puedes|podr[íi]a) ` +
      `(?:contactar(?: con)?|consultar(?: con| a)?|preguntar(?:le)? a|comunicarse con|escribir a|hablar con) ${ES_HOST}(?![\\p{L}])`,
    "u",
  ),
  // R30 (Opus 10-28): iyelik zamiri ("связаться с вашим хозяином") emir kalıbındaki gibi.
  new RegExp(`${L}(?:связаться|обратиться|уточнить|спросить|написать)(?: (?:с|со|к|у))?(?: (?:вашим|вашему|вашего|вашей))? ${RU_HOST}`, "u"),
  new RegExp(`${L}${RU_HOST} (?:сможет|может|подскаж\\p{L}{0,4}|уточнит|расскажет|ответит)(?![\\p{L}])`, "u"),
];
/** Olay koşulu (talimat) — bilgi isteği koşulu DEĞİL. */
const EVENT_CONDITION = new RegExp(
  "(?<![\\p{L}])(?:if|in case|should (?:you|the|there)|unless|falls|wenn|sollte|en cas d|au cas où|en caso de|если|в случае|eğer|" +
    "in an emergency|im notfall|en urgence|en una emergencia|в экстренн\\p{L}*|acil (?:bir )?durumda)(?![\\p{L}])|" +
    "(?<![\\p{L}])si (?!vous souhaitez|vous voulez|usted desea|desea)|" +
    // Türkçe koşul eki SES UYUMUYLA (Opus 10-23 akşam R9: "Of course" -rse sanılıyordu): kalın ünlü + rsa, ince ünlü + rse; olumsuz (-mazsa /
    // -mezse) ve şimdiki zaman (-yorsa) koşulu da koşuldur (R3: "Wi-Fi çalışmazsa" koşul görünmüyordu).
    "\\p{L}(?:[aıou]rsa|[aıou]rsan[ıi]z|[eiöü]rse|[eiöü]rseniz|[aıou]zsa|[aıou]zsan[ıi]z|[eiöü]zse|[eiöü]zseniz|yorsa|yorsan[ıi]z)(?![\\p{L}])|" +
    "(?:ma|me)s[ıi] (?:halinde|durumunda)|(?<![\\p{L}])(?:durumunda|halinde|takdirde)(?![\\p{L}])",
  "u",
);
/**
 * Koşul muafiyeti yalnız OLAY / ARIZA / ACİL koşulunda (Opus 10-23 akşam A1): "If you need parking, ask your host", "ihtiyacınız varsa / merak
 * ederseniz / sorunuz olursa … sorabilirsiniz" ihtiyaç koşuludur ve YÖNLENDİRMEDİR; "anahtarı kaybederseniz / Wi-Fi çalışmazsa / acil bir
 * durumda ev sahibinizi arayın" bilgi tabanındaki talimattır. Sözcük başında, sınırlı ek (doğrusal).
 */
const EVENT_WORDS = new RegExp(
  "(?<![\\p{L}])(?:" +
    // Olay ADI değil olay YÜKLEMİ (Opus 10-23 akşam R2): "alarm şifresi / fire pit / acil çıkış / çalışma saatleri" konu adıdır, olay değildir.
    "lose|loses|lost(?! and found| & found)|locked out|stops? working|stopped working|not working|doesn'?t work|isn'?t working|fails?|failed|broken|" +
    // R14 (Opus 10-28): "break" adı ("a break from the city") olay değil — yalnız fiil biçimleri.
    "breaks|broke|breaks down|break down|(?:should|might|ever|does|to) break|emergency(?! (?:exit|exits|lighting|lights?))|leak\\p{L}{0,4}|power cut|outage|flood\\p{L}{0,4}|" +
    "(?:power|electricity|lights?|heating|wi-?fi|internet|water) (?:goes|went|go|is) (?:out|off)|(?:smoke |fire )?alarm (?:goes|went|is going) off|" +
    "(?:in case of|there is a|there's a) fire|fire breaks out|" +
    // R14: "issues with the check-in time" bilgi konusudur, olay değil.
    "(?:problems?|issues?)(?! with (?:the |your )?(?:check-?in|check-?out|arrival|departure|times?|hours|booking|reservation|payment|prices?|parking|directions|address)(?![\\p{L}]))|(?:goes|go|went) wrong|" +
    "can'?t (?:open|get in|access|enter)|cannot (?:open|get in|access|enter)|forget|forgot|" +
    "kaybed\\p{L}{0,12}|kaybol\\p{L}{0,12}|kaybet\\p{L}{0,12}|[çc]al[ıi][şs]m(?:[ıi]yor|az|ad[ıi])\\p{L}{0,8}|bozul\\p{L}{0,12}|ar[ıi]za\\p{L}{0,12}|" +
    "acil (?:bir )?durum\\p{L}{0,6}|kesil\\p{L}{0,12}|s[ıi]z[ıi]nt[ıi]\\p{L}{0,8}|yang[ıi]n (?:olursa|[çc][ıi]karsa|durumunda|halinde|an[ıi]nda)|" +
    "alarm (?:[çc]alarsa|[öo]terse|[çc]al[ıi]yorsa)|kilitli kal\\p{L}{0,12}|d[ıi][şs]ar[ıi]da kal\\p{L}{0,12}|" +
    // R3: gerçek olay talimatlarının yaygın biçimleri ("Herhangi bir sorun olursa ev sahibinizi arayın"). "Sorunuz olursa" (soru) burada da
    // eşleşir ama bilgi koşulu (`INFO_CONDITION`) onu yönlendirme olarak tutar.
    "sorun\\p{L}{0,6}|problem\\p{L}{0,6}|a[çc]am(?:[ıi]yor|az)\\p{L}{0,8}|a[çc][ıi]lm(?:[ıi]yor|az)\\p{L}{0,8}|" +
    "gelm(?:iyor|ez)\\p{L}{0,8}|yanm(?:[ıi]yor|az)\\p{L}{0,8}|unut\\p{L}{0,10}|ak[ıi]t\\p{L}{0,8}|" +
    "verlier\\p{L}{0,6}|verloren|funktioniert nicht|notfall|perd(?:ez|u|ue|ues|ido|ida)|ne fonctionne pas|panne|urgence|pierd\\p{L}{0,6}|no funciona|" +
    "emergencia|потеря\\p{L}{0,3}|не работает|авари\\p{L}{0,4}|экстренн\\p{L}{0,4})(?![\\p{L}])",
  "u",
);
/** Varış / giriş TALİMATI (bilgi isteği değil): "Please text your host when you arrive", "varış saatinizi ev sahibinize yazın" (Opus A4). */
const ARRIVAL_INSTRUCTION = new RegExp(
  "(?<![\\p{L}])(?:when you arrive|upon arrival|on arrival|on your arrival|before (?:your )?arrival|arrival time|eta|" +
    "var(?:d[ıi][ğg][ıi]n[ıi]zda|[ıi]nca)|geldi[ğg]inizde|gelmeden [öo]nce|giri[şs]ten [öo]nce|var[ıi][şs] saat\\p{L}{0,8}|" +
    "bei (?:ihrer )?ankunft|vor (?:ihrer )?ankunft|ankunftszeit|à votre arrivée|heure d'arrivée|a su llegada|hora de llegada|по прибытии|время прибытия)(?![\\p{L}])",
  "u",
);
/**
 * Bilgi İSTEME fiili (sor / ask / danış …): varış talimatı muafiyeti bunlarda geçmez (Haiku 10-23 akşam: "Upon arrival, you can ask your host
 * about the parking" / "Girişten önce ev sahibinize sorabilirsiniz" bilgi yönlendirmesidir; "varınca ev sahibinizi arayın / yazın" değildir).
 */
const INFO_VERB =
  /(?<![\p{L}])(?:ask\p{L}{0,3}|enquir\p{L}{0,4}|inquir\p{L}{0,4}|check(?:ing)? with|clarif\p{L}{0,4}|sor(?:abilir|man[ıi]z|mak)\p{L}{0,8}|dan[ıi][şs]\p{L}{0,10}|[öo][ğg]ren\p{L}{0,10}|teyit\p{L}{0,6}|fragen|nachfragen|erfragen|demander|preguntar\p{L}{0,3}|consultar|спрос\p{L}{0,4}|уточн\p{L}{0,4})(?![\p{L}])/u;
/**
 * KONU işareti (Opus 10-23 akşam R1 / R4): "otopark İÇİN / havuz HAKKINDA / about the parking / for the pool hours / whether …" — cümle bir BİLGİ
 * konusu için ev sahibine gönderiyor. Konulu cümle varış talimatı muafiyetini alamaz ("For parking, please contact your host before arrival");
 * konusuz cümlede iletişim değeri yan cümle bölmesinden etkilenmez ("Ev sahibinize ulaşabilirsiniz, telefon: 0532 …").
 */
const TOPIC_MARKER = new RegExp(
  "(?<![\\p{L}])(?:i[çc]in|hakk[ıi]nda|konusunda|ile ilgili|about|regarding|concerning|whether|to confirm|to ask|à propos|au sujet|concernant|sobre|acerca|" +
    "über|bezüglich|wegen|по поводу|насч[её]т)(?![\\p{L}])|(?<![\\p{L}])for (?!(?:your )?(?:arrival|check-?in|eta)(?![\\p{L}]))\\p{L}",
  "u",
);
/** "Bu sorunuzu ev sahibinize iletebilirsiniz" — bilgi isteğini İLETME de bilgi yönlendirmesidir (R10). */
const FORWARD_VERB = /(?<![\p{L}])ilet(?:ebilir|in|iniz|meniz)\p{L}{0,8}/u;
/** Yan cümle ayracı (iletişim değeri muafiyeti yalnız yönlendirmenin KENDİ yan cümlesinde — Opus A3; "ve / and" Haiku 10-23 akşam). URL'deki ":" bölünmez. */
const CLAUSE_SPLIT = /[,;]|\s(?:ya da|veya|yahut|ve|or|and|oder|und|ou|et|o|y|и|или)\s/u;
function contactValueInReferralClause(form: string): boolean {
  // Konusuz cümle ("Ev sahibinize ulaşabilirsiniz, telefon: 0532 …", "You can call your host, the number is …") istenen iletişim değerini
  // veriyor — yan cümle bölmesi onu tutmasın (Opus 10-23 akşam R4). Konulu cümlede değer yönlendirmenin KENDİ yan cümlesinde olmalı (A3).
  // R10 (Opus 10-28): konu Türkçede çoğu zaman NESNEDİR ("Otoparkı / Havuz saatlerini ev sahibinize sorabilirsiniz, resepsiyon: 0212 …") — bilgi
  // İSTEME / iletme fiili varsa cümle konusuz sayılmaz, değer yönlendirmenin kendi yan cümlesinde olmalı.
  if (!TOPIC_MARKER.test(form) && !INFO_VERB.test(form) && !FORWARD_VERB.test(form) && containsContactValue(form)) return true;
  const referral = form.split(CLAUSE_SPLIT).filter((c) => HOST_REFERRAL_PATTERNS.some((re) => re.test(c)));
  // Kalıp yan cümle ayracını aşıyorsa ("Ev sahibiniz, bu konuda …") cümlenin tamamına bakılır (eski davranış).
  return referral.length > 0 ? referral.every((c) => containsContactValue(c)) : containsContactValue(form);
}

/**
 * Soru fiilinin "if / si" tümleci ("ask your host IF you can check out late", "your host can tell you IF parking is free", "demandez à votre
 * hôte SI …") koşul değil "-ip -mediği"dir (Haiku 10-23 akşam: yönlendirme koşul sanılıp geçiyordu). Koşul aranmadan önce "whether" olur.
 * "contact your host if you lose the key" (iletişim fiili) koşul kalır.
 */
const WHETHER_IF =
  /(?<![\p{L}])(ask|asking|check|checking|tell|tells|confirm|know|find out|let you know|demandez|demander|vérifiez|pregunte|pregúntele|preguntar|consulte)((?:[^.!?\n]){0,40}?)(?<![\p{L}])(?:if|si)(?![\p{L}])/gu;
/**
 * Yönlendirme fiilinin OLUMSUZU ("ev sahibinize sormanıza gerek yok", "no need to contact your host") yönlendirme değildir (Haiku 10-23 akşam).
 * Gerek sözcüğü fiile bitişik aranır — aynı cümlenin başka bir yerindeki "gerek yok" yönlendirmeyi sessizce kaldırmasın.
 */
const NEG_VERB_TR = "(?:sor|dan[ıi][şs]|ula[şs]|ba[şs]vur|ge[çc]|kur|konu[şs]|g[öo]r[üu][şs]|yaz|ara|iste|[öo][ğg]ren|teyit et|ilet)";
// Olumsuzluk EV SAHİBİNE BAĞLI aranır (Opus 10-23 akşam A5): "… ev sahibinize sorabilirsiniz, taksi aramanıza gerek yok" / "no need to call a
// taxi" yönlendirmeyi KALDIRMAZ; "ev sahibinize sormanıza gerek yok" / "no need to contact your host" kaldırır.
const NEGATED_REFERRAL = new RegExp(
  `${HOST_TR},? ${gap(3)}${NEG_VERB_TR}(?:ma|me)(?:n[ıi]z[ae]?|k|z)? (?:gerek|ihtiya[çc]|l[üu]zum)\\p{L}{0,3} (?:yok|kalmad[ıi])` +
    `|${HOST_TR},? ${gap(3)}${NEG_VERB_TR}(?:ma|me)(?:n[ıi]z[ae])? gerek(?:mez|miyor|memektedir)` +
    `|(?<![\\p{L}])(?:no need|(?:you )?(?:don'?t|do not|won'?t) need|needn'?t|not necessary|unnecessary)(?: for you)? to ` +
    `(?:ask|check with|confirm with|contact|reach out to|reach|message|consult|speak (?:to|with)|talk to|get in touch with|email|write to|call|text|tell|alert|notify|inform|ping) ${EN_HOST}` +
    // Opus v2 incelemesi overhold-5: "don't have to / there's no need to let your host know", Almanca / İspanyolca / Türkçe "bizi aramanıza gerek yok".
    `|(?<![\\p{L}])(?:no need|(?:you )?(?:don'?t|do not) (?:need|have) to|needn'?t)(?: for you)? to let ${EN_HOST} know` +
    `|(?<![\\p{L}])(?:don'?t|do not) have to (?:ask|contact|message|call|text|tell|alert|notify|inform|email|write to) ${EN_HOST}` +
    `|(?<![\\p{L}])(?:müssen|brauchen) (?:sie )?(?:\\p{L}+ ){0,3}?(?:dem|den|ihrem|ihren) (?:gastgeber|vermieter)\\p{L}{0,2} (?:\\p{L}+ ){0,2}?nicht(?![\\p{L}])` +
    `|(?<![\\p{L}])no (?:es necesario|hace falta|tiene que|necesita) (?:avisar|escribir|llamar|contactar)(?:le)?(?: a| al| con)? (?:${ES_HOST}|anfitri\\p{L}+)` +
    `|(?<![\\p{L}])(?:bizi|bize|bana|beni),? ${gap(2)}${NEG_VERB_TR}(?:ma|me)n[ıi]za gerek (?:yok|kalmad[ıi])` +
    `|(?<![\\p{L}])pas besoin de (?:demander [àa]|contacter) ${FR_HOST}|no (?:es necesario|hace falta) (?:preguntar(?:le)? a|contactar(?: con)?|consultar(?: con| a)?) ${ES_HOST}` +
    `|не нужно (?:спрашивать|уточнять|обращаться)(?: (?:у|к|с))? ${RU_HOST}`,
  "u",
);

/**
 * BİRİNCİ KİŞİNİN kendi danışması ("I'll check with the host … and get back to you", "Let me contact your host", "Ich werde bei Ihrem
 * Gastgeber nachfragen") misafiri ev sahibine GÖNDERMEZ — bekleme sözüdür, çıktı vetosunun ve doğrulanmış akışların işidir (tam kapı
 * 10-23 akşam: erken giriş akışının söz pini kırmızıydı). Kalıplara bakılmadan önce bu öbek cümleden silinir; öznesi misafir olan
 * yönlendirme ("I recommend you ask your host") ara sözcük listesinde olmadığı için silinmez. İkinci katlama "I" → "ı" yapar.
 */
const FIRST_PERSON_REFERRAL = new RegExp(
  // "I'd / I would" yalnız "be happy to / be glad to / gladly / happily" ile birinci kişi hizmetidir; tek başına koşullu TAVSİYEDİR ("If I were you,
  // I'd contact your host" — Haiku 10-23 akşam) ve silinmez. "Let's" misafiri de içine alan öneridir, silinmez.
  `(?<![\\p{L}])(?:(?:[iı]|we)(?:['’](?:ll|m|ve)| will| shall| can| could| may| might| must| should| am| are| have| had| need to| want to)?|let me|let us|(?:[iı]|we)(?:['’]d| would) (?:be happy to|be glad to|gladly|happily))` +
    `(?: (?:also|just|quickly|personally|gladly|happily|now|first|immediately|directly|then|going to|be happy to|be glad to|try to)){0,3} ` +
    `(?:ask|check with|confirm with|contact|reach out to|get in touch with|message|consult|speak (?:to|with)|talk to|reach|enquire with|inquire with|email|e-mail|write to|text|call|phone) ${EN_HOST}(?![\\p{L}])` +
    `|(?<![\\p{L}])(?:[iı]ch|wir) (?:werde|werden|kann|können|möchte|möchten|will|wollen)(?: (?:gerne|gern|kurz|direkt|noch|selbst)){0,2} (?:bei|von) ${DE_HOST}(?![\\p{L}])`,
  "gu",
);

const IF_I_WERE_YOU = /(?<![\p{L}])if [iı] (?:were|was) you(?![\p{L}])/gu;

/** Koşul bilgi İSTEĞİYSE ("daha fazla bilgi isterseniz", "if you'd like more details") yine yönlendirmedir. */
const INFO_CONDITION =
  // Soru / merak koşulu da bilgi koşuludur (Haiku 10-23 akşam: "If you have any questions about the alarm, please ask your host" — "alarm"
  // olay sözcüğü sayılıp muaf geçiyordu). Bilmek / öğrenmek isteği de (Opus 10-23 akşam R2: "Alarm şifresini öğrenmek isterseniz …",
  // "If you'd like to know …").
  /(?<![\p{L}])(?:bilgi|detay|ayr[ıi]nt[ıi]|information|info|details|auskunft|informationen|renseignements|información|detalles|информаци|questions?|soru(?:nuz|lar\p{L}{0,6}|su|yu|ya)?(?![\p{L}])|merak\p{L}{0,8}|wonder\p{L}{0,3}|curious|fragen?|pregunta\p{L}{0,1}|вопрос\p{L}{0,3}|[öo][ğg]ren\p{L}{0,10}|emin ol\p{L}{0,8}|know|find out|saber|wissen|savoir|узна\p{L}{0,4})/u;

/**
 * Ev sahibine HABER VERMEK bilgi isteği değildir (R13, kurucu onayı 10-28): "If you lose the key, call your host and let them know", "… so they
 * know", "message your host with the details", "arayıp bilgi verin / verebilirsiniz" olay talimatının parçasıdır; bilgi koşulu aranmadan önce
 * silinir. "for (more) details / information" (bilgi ALMAK) silinmez. Sabit sözcükle başlar, boşluklar tek — doğrusal.
 */
const HOST_NOTICE = new RegExp(
  "(?<![\\p{L}])(?:let (?:them|him|her|us|your host|the host) know|so (?:that )?(?:they|he|she|your host|the host)(?:['’]ll| will| can)? know|" +
    "with (?:the |all the |any |some )?(?:details|information|info)|bilgi ver(?:in|iniz|ebilirsiniz|meniz|menizi))(?![\\p{L}])",
  "gu",
);

/**
 * Satırları cümleye çevirir (Opus 10-23 akşam R4 / R5): YENİ madde / cümle başlatan satır (madde işareti, "1." / "1)" numarası, büyük harf) sınırdır;
 * cümle ortasında kırılan satır ("Please contact\nyour host …") ve telefonla başlayan satır ("…ulaşabilirsiniz:\n0532 …") öncekinin devamıdır.
 * Satır satır kurulur — düzenli ifadeyle satır sonu dizisi karesel geri izliyordu (50.000 "\n" → 10,5 sn ölçüldü).
 */
function joinLines(text: string): string {
  let out = "";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (!out) out = line;
    else out += /^(?:[-•*–]|\p{N}{1,2}[.)](?!\p{N})|\p{Lu})/u.test(line) ? `. ${line}` : ` ${line}`;
  }
  return out;
}

/** Olay / varış koşulu muafiyeti (tek okuma birimi: cümle ya da yönlendirme yan cümlesinin koşul bağlamı). */
function eventOrArrivalExempt(texts: readonly string[]): boolean {
  const eventInstruction = texts.some(
    (f) =>
      (EVENT_CONDITION.test(f) && EVENT_WORDS.test(f)) ||
      (ARRIVAL_INSTRUCTION.test(f) && !INFO_VERB.test(f) && !TOPIC_MARKER.test(f) && !DISCUSS_VERB.test(f)),
  );
  return eventInstruction && !texts.some((f) => INFO_CONDITION.test(f.replace(HOST_NOTICE, " ")));
}
/**
 * R11 (Opus 10-28): varışta ev sahibiyle KONUŞMAK / GÖRÜŞMEK bir konunun görüşülmesidir ("Otopark yerini gelmeden önce ev sahibinizle görüşün",
 * "Havuzun açılış saatini varınca ev sahibinizle konuşabilirsiniz") — varış talimatı yalnız ara / yaz / mesaj / haber ver türündedir.
 */
const DISCUSS_VERB = /(?<![\p{L}])(?:konu[şs]\p{L}{0,14}|g[öo]r[üu][şs]\p{L}{0,14}|speak\p{L}{0,3}|talk\p{L}{0,3}|discuss\p{L}{0,3}|sprechen|besprechen|parlez|parler|hable|hablar|поговор\p{L}{0,4}|обсуд\p{L}{0,4})(?![\p{L}])/u;
/** Cümle sonundaki koşul yan cümlesi ("Contact your host, especially if the Wi-Fi fails") yönlendirmeye aittir. */
const TRAILING_CONDITION = /^\s*(?:especially |only |just |even )?(?:if|in case|when|unless|wenn|falls|si|en caso|если)(?![\p{L}])/u;

/**
 * R12 / R29 (Opus 10-28): muafiyetler YAN CÜMLE düzeyinde. Cümledeki HER yönlendirme yan cümlesi kendi koşul bağlamında (önündeki yönlendirmesiz
 * yan cümleler + kendisi + cümle sonundaki "if …" yan cümlesi) olay / varış koşulu taşımalı ya da KENDİ yan cümlesinde olumsuz olmalı; biri bile
 * koşulsuz bilgi yönlendirmesiyse cevap tutulur ("Havuz saatlerini ev sahibinize sorabilirsiniz, herhangi bir sorun olursa da kendisine
 * ulaşabilirsiniz" · "Wi-Fi şifresi için ev sahibinize sormanıza gerek yok; otopark için ev sahibinize sorabilirsiniz"). Kalıp yan cümle
 * ayracını aşıyorsa ("Ev sahibiniz, bu konuda …") ya da iki katlamanın bölmesi denk değilse cümle bütün okunur (eski davranış). Doğrusal.
 */
const CLAUSE_SPLIT_G = new RegExp(CLAUSE_SPLIT.source, "gu");
/** Yan cümle sınırları (başlangıç, bitiş) — bağlam penceresi ÖZGÜN metinden kesilir ("lost and found" bölünüp "lost" olay sanılmasın). */
function clauseSpans(form: string): [number, number][] {
  const out: [number, number][] = [];
  let from = 0;
  for (const m of form.matchAll(CLAUSE_SPLIT_G)) {
    out.push([from, m.index]);
    from = m.index + m[0].length;
  }
  out.push([from, form.length]);
  return out;
}
function referralUnexempted(forms: readonly string[]): boolean {
  const spans = forms.map(clauseSpans);
  const split = forms.map((f, j) => spans[j].map(([x, y]) => f.slice(x, y)));
  const n = split[0].length;
  const isRef = (k: number) => split.some((cs) => HOST_REFERRAL_PATTERNS.some((re) => re.test(cs[k])));
  const refs = split.every((cs) => cs.length === n) ? [...Array(n).keys()].filter(isRef) : [];
  if (refs.length === 0) return !forms.some((f) => NEGATED_REFERRAL.test(f)) && !eventOrArrivalExempt(forms);
  const refSet = new Set(refs);
  let prev = -1;
  for (const k of refs) {
    // Koşul bağlamı önceki yönlendirme yan cümlesinden SONRA başlar (toplam pencere uzunluğu yan cümle sayısı kadar — doğrusal).
    const a = prev + 1;
    prev = k;
    if (split.some((cs) => NEGATED_REFERRAL.test(cs[k]))) continue;
    const b = k + 1 === n - 1 && !refSet.has(k + 1) && split.some((cs) => TRAILING_CONDITION.test(cs[k + 1])) ? k + 1 : k;
    if (!eventOrArrivalExempt(forms.map((f, j) => f.slice(spans[j][a][0], spans[j][b][1])))) return true;
  }
  return false;
}

/**
 * Cevap misafiri bilgi için ev sahibine yönlendiriyor mu (kurucu 10-23 akşam 4.5)? Cümle bazında; iletişim değeri taşıyan ve olay koşullu
 * cümle hariç (↑). `true` ise cevap "bilgim yok" sayılır (`admitsMissingKnowledge`). Saf, doğrusal.
 */
export function refersGuestToHost(reply: string | null | undefined): boolean {
  // Satır sonu da cümle sınırıdır (Opus 10-23 akşam A6): madde düzenli cevapta başka satırdaki koşul / telefon yönlendirmeyi kurtarmasın.
  // Yalnız bu yüklemde (ortak `foldedForms` öteki kalıpları daraltmasın).
  // Yalnız YENİ madde / cümle başlatan satır sonu sınırdır (madde işareti, rakam, büyük harf) — cümle ortasında kırılan satır ("Please contact\n
  // your host …") boşluk olur (Haiku 10-23 akşam). `\s*\n` boşluk dizisinde karesel (50.000 boşluk 3,3 sn ölçüldü) → ileri bakış satır
  // sonunu GEÇMEZ (`[^\S\n]*`), toplam doğrusal.
  const [plain, turkish] = foldedForms(joinLines(reply ?? ""));
  // İki katlamanın AYNI cümlesi birlikte okunur (SEP katlamadan önce konur → cümle sayısı eşit): Türkçe katlamada "If" → "ıf" olur ve
  // koşul görünmez; yalnız biri yetmez.
  const ps = plain.split(SEP);
  const ts = turkish.split(SEP);
  for (let i = 0; i < ps.length; i++) {
    const forms = [ps[i], ts[i] ?? ps[i]].map((f) => f.replace(FIRST_PERSON_REFERRAL, " "));
    if (!forms.some((f) => HOST_REFERRAL_PATTERNS.some((re) => re.test(f)))) continue;
    if (forms.some((f) => contactValueInReferralClause(f))) continue;
    // "If I were you, …" koşul değil tavsiye kalıbıdır (Haiku 10-23 akşam) — koşul aranmadan önce silinir.
    const conditionForms = forms.map((f) => f.replace(WHETHER_IF, "$1$2whether").replace(IF_I_WERE_YOU, " "));
    if (referralUnexempted(conditionForms)) return true;
  }
  return false;
}

/**
 * R13-b / R13-c (kurucu kararı 10-28 gece, aynen `docs/INCELEME-2026-10-28-opus-ikinci-dilim.md` sonu): "zaten hostla yazışıyorlar … 'Bir sorun
 * olursa ev sahibinize yazın' … kesinlikle bu gidemesin" · "genel 'bir sorun olursa ev sahibinizi arayın/yazın' kapanışı hiç eklenmesin".
 * Tek cümle, `refersGuestToHost`un OLAY / VARIŞ koşulu yüzünden MUAF tuttuğu bir ev sahibine başvurma talimatı mı? `"write"` = yaz / mesaj at /
 * write / message (sohbet zaten ev sahibiyle — hiçbir koşulda gitmez), `"call"` = ara / ulaş / contact (yalnız misafir tam o durumu sorduysa
 * ve dayanağı varsa kalır, `host-contact-filler.ts`). Bilgi yönlendirmesi (kapı zaten tutar), iletişim değeri veren ve olumsuz cümle `null`.
 * Saf, doğrusal.
 */
const WRITE_HOST_VERB =
  /(?<![\p{L}])(?:yaz\p{L}{0,12}|mesaj\p{L}{0,8}|messag\p{L}{0,4}|text\p{L}{0,3}|write|writing|e-?mail\p{L}{0,3}|schreib\p{L}{0,4}|[ée]cri\p{L}{0,6}|escrib\p{L}{0,6}|напиш\p{L}{0,4}|сообщ\p{L}{0,6})(?![\p{L}])/u;
/**
 * Ev sahibine HABER VERME / ulaç biçimi ("ev sahibinizi arayıp bilgi verebilirsiniz", "ev sahibinize haber verin", "ev sahibinizi bilgilendirin")
 * — bilgi yönlendirmesi değil (R13) ama misafiri ev sahibine başvurmaya gönderir. Haber / bildirme yazma türüdür.
 */
// Haber fiili yalnız MİSAFİRİN kipiyle (emir / yeterlik / "-meniz"); ulaç ("arayıp / yazıp") yalnız yönelme / belirtme / birliktelik ekli ev
// sahibiyle. Ev sahibi ÖZNE ise ("Ev sahibiniz size haber verecek", "Ev sahibiniz sizi arayıp bilgilendirecek") bu bir SÖZDÜR — çıktı vetosunun
// işi; süzgeç silerse veto onu göremez ve cevabın geri kalanı giderdi (v3 kapsam turu).
const HOST_TR_OBLIQUE = `${L}(?:ev ?sahib(?:ine|inize|imize|ini|inizi|imizi|iyle|inizle|imizle)|host'?(?:a|unuza|unuzu|unuzla|umuza|umuzla))(?![\\p{L}])`;
const HOST_INFORM = new RegExp(
  `${HOST_TR},? ${gap(4)}(?:(?:haber|bilgi) ver(?:in|iniz|ebilirsiniz|menizi?|melisiniz)|bildir(?:in|iniz|ebilirsiniz|menizi?|melisiniz)|bilgilendir(?:in|iniz|ebilirsiniz|menizi?|melisiniz))(?![\\p{L}])` +
    `|${HOST_TR_OBLIQUE},? ${gap(4)}(?:yaz[ıi]p|mesaj at[ıi]p|aray[ıi]p|ula[şs][ıi]p)(?![\\p{L}])`,
  "u",
);
const CALL_INFORM = /(?<![\p{L}])(?:aray[ıi]p|ula[şs][ıi]p)(?![\p{L}])/u;
export function conditionalHostContactKind(sentence: string | null | undefined): "write" | "call" | null {
  const forms = foldedForms(joinLines(sentence ?? "")).map((f) => f.split(SEP).join(" ").replace(FIRST_PERSON_REFERRAL, " "));
  const referral = forms.some((f) => HOST_REFERRAL_PATTERNS.some((re) => re.test(f)));
  const inform = !referral && forms.some((f) => HOST_INFORM.test(f));
  if (!referral && !inform) return null;
  if (forms.some((f) => contactValueInReferralClause(f) || NEGATED_REFERRAL.test(f))) return null;
  if (refersGuestToHost(sentence)) return null;
  // Haber verme biçiminde yalnız "arayıp / ulaşıp" arama türüdür ("arayıp bilgi verin" — misafir yine arar); öteki haber biçimleri yazmadır.
  if (inform) return forms.some((f) => CALL_INFORM.test(f)) && !forms.some((f) => WRITE_HOST_VERB.test(f)) ? "call" : "write";
  return forms.some((f) => WRITE_HOST_VERB.test(f)) ? "write" : "call";
}

/**
 * Misafirin metni VARSAYIMSAL bir durum mu soruyor ("Anahtarı kaybedersem ne yapmalıyım?", "What if the Wi-Fi stops working?") — yaşanan olayı
 * bildirmekten ("Wi-Fi çalışmıyor") ayrımı koşul ekiyle: 1. / 2. / 3. kişi koşul eki (-sa / -se, -sam / -sem, -sak / -sek, -sanız / -seniz)
 * ya da koşul bağlacı. Saf, doğrusal.
 */
const GUEST_CONDITION = new RegExp(
  "(?<![\\p{L}])(?:if|what if|in case|should (?:i|we|the|there)|wenn|falls|si|если|eğer|egerk?)(?![\\p{L}])|" +
    "\\p{L}(?:[aıoueiöü]r|[aıoueiöü]z|yor)s[ae](?:m|k|n|n[ıi]z)?(?![\\p{L}])",
  "u",
);
/**
 * GD6 (gece döngüsü 10-29): koşul eki sezgisi (`-rsa / -rse`) İngilizce "-rse" sözcüklerine ve "Bursa"ya takılıyordu ("Of course, the router
 * is not working" yaşanan olay varsayımsal sayılıyordu → dayanaklı koşullu "arayın" cümlesi sorunu bildiren misafire gidebiliyordu). Bu
 * sözcükler koşul aranmadan önce silinir (yalnız TUTMA yönü: varsayımsal sayılan metin azalır). Sabit sözcük listesi, doğrusal.
 */
const NOT_CONDITION_WORDS =
  /(?<![\p{L}])(?:course|courses|worse|nurse|horse|purse|verse|universe|reverse|converse|diverse|inverse|adverse|traverse|coarse|hoarse|sparse|terse|curse|rehearse|disperse|immerse|endorse|bursa)(?![\p{L}])/giu;
export function asksHypotheticalSituation(text: string | null | undefined): boolean {
  return foldedForms(text).some((f) => GUEST_CONDITION.test(f.split(SEP).join(" ").replace(NOT_CONDITION_WORDS, " ")));
}

// ── K-1029-A (kurucu 10-29 gece): "EV SAHİBİNİZE YAZIN" HER DİLDE, HER BİÇİMDE ─────────────────────────────────────────────────────────
// "zaten hostla yazışıyorlar" — misafiri ev sahibine yazmaya / mesaj atmaya / ulaşmaya / aramaya / haber vermeye gönderen cümle HİÇBİR
// dilde, HİÇBİR biçimde gitmez (koşullu, koşulsuz, kapanış, yan cümle; ev sahibinin kendi sesiyle "bir sıkıntı olursa bize yazın" da).
// Bugünkü iki dedektör (bilgi yönlendirmesi `refersGuestToHost`, koşullu başvurma `conditionalHostContactKind`) Fransızca / Arapça / Rusça
// / İspanyolca emir kiplerini, "property owner"ı ve ev sahibinin kendi sesini ("bize / us") görmüyordu (ölçüldü: "En cas de problème,
// écrivez à votre hôte." misafire gidiyordu). Üçüncü dedektör: SESLENİLEN (ev sahibi ya da — yalnız koşul / kapanış biçiminde — "biz")
// ile İLETİŞİM FİİLİ aynı cümlede, aralarında en çok dört sözcük.
//   · Ev sahibi ÖZNE ise ("Ev sahibiniz size yazacak", "Your host will message you") eşleşmez: Türkçede seslenilen yönelme / belirtme /
//     birliktelik ekli olmalı, öteki dillerde fiil seslenilenden ÖNCE gelir (emir / mastar kipi).
//   · İletişim DEĞERİ veren, olumsuz ("sormanıza gerek yok") ve birinci kişinin kendi danışması ("I'll check with the host") bugünkü gibi
//     dışarıda.
//   · Yalnız SİLER / TUTAR (çağıran cümleyi çıkarır, isteği açık bırakır); eşleşmeyen metin bugünkü yoldan geçer — hiçbir şeyi gevşetmez.
// Sabit sözcükle başlar, aralık sınırlı ({0,4} sözcük) — doğrusal (süre pini `host-contact-detect-cost.test.ts`).
// Tamlayan eki ("ev sahibinizin bahsettiği sorun", "ev sahibinin") yönelme / belirtme değildir (Opus v2 incelemesi overhold-11).
const HC_GEN = `(?!(?:in|inin|inizin|imizin)(?![\\p{L}]))`;
const HC_ADDR_TR = `${L}(?:ev ?sahib(?!i(?![\\p{L}])|iniz(?![\\p{L}])|imiz(?![\\p{L}]))${HC_GEN}\\p{L}{1,8}|host'?(?:a|unuza|unuzu|unuzla|umuza|umuzla)(?![\\p{L}])|m[üu]lk sahib(?!i(?![\\p{L}]))\\p{L}{1,8}|daire sahib(?!i(?![\\p{L}]))\\p{L}{1,8})`;
const HC_SELF_TR = `${L}(?:bize|bana|bizimle|benimle|bizi|beni)(?![\\p{L}])`;
const HC_WRITE_TR =
  "(?:yaz(?:abilirsiniz|abilirsin|[ıi]n|[ıi]n[ıi]z|man[ıi]z|man[ıi]z[ıi]|maktan)\\p{L}{0,6}|yazar m[ıi]s[ıi]n[ıi]z|mesaj (?:at|g[öo]nder|yaz|b[ıi]rak)\\p{L}{0,14}|not b[ıi]rak\\p{L}{0,12}|" +
  "haber ver\\p{L}{0,12}|bildir(?:in|iniz|ebilirsiniz|meniz)\\p{L}{0,6}|bilgi ver(?:in|iniz|ebilirsiniz|meniz)\\p{L}{0,6}|" +
  "(?:ileti[şs]im|irtibat)\\p{L}{0,2} ge[çc]\\p{L}{0,12}|dan[ıi][şs](?:abilirsiniz|[ıi]n|[ıi]n[ıi]z|man[ıi]z)\\p{L}{0,6}|" +
  // v3 kapsam incelemesi cost-coverage-01: "iletişim / irtibat kurabilirsiniz", "temasa geçin", "e-posta gönderin", "yazışabilirsiniz",
  // "bilgilendirin". Birliktelikli ("ev sahibinizle") "ayarlayın / koordine edin / anlaşın" ayrı kalıpta (`HC_WITH_TR`).
  "(?:ileti[şs]im|irtibat|temas)\\p{L}{0,2} kur(?:abilirsiniz|un|unuz|man[ıi]z|maktan)\\p{L}{0,6}|temas(?:a|ta)? ge[çc]\\p{L}{0,12}|" +
  "e-?(?:posta|mail) (?:g[öo]nder|at|yaz)\\p{L}{0,12}|yaz[ıi][şs](?:abilirsiniz|[ıi]n|[ıi]n[ıi]z|man[ıi]z)\\p{L}{0,6}|" +
  "bilgilendir(?:in|iniz|ebilirsiniz|meniz)\\p{L}{0,6}|" +
  // "sorun" yalnız yüklem olarak (cümle / yan cümle sonu ya da "ve / lütfen" öncesi) — ad "sorun" (problem) değil ("Bize bildirdiğiniz sorun
  // çözüldü" — Opus v2 incelemesi overhold-11).
  "sor(?:abilirsiniz|man[ıi]z|un(?=\\s*(?:[.!?,;:)]|$)|\\s+(?:ve|veya|l[üu]tfen)(?![\\p{L}]))|unuz)\\p{L}{0,6}|yazarsan[ıi]z)(?![\\p{L}])";
const HC_CALL_TR =
  "(?:ara(?:yabilirsiniz|y[ıi]n|y[ıi]n[ıi]z|man[ıi]z|y[ıi]p|maktan|rsan[ıi]z)\\p{L}{0,6}|arar m[ıi]s[ıi]n[ıi]z|ula[şs](?:abilirsiniz|[ıi]n|[ıi]n[ıi]z|man[ıi]z|[ıi]p|maktan|[ıi]rsan[ıi]z|[ıi]labilir)\\p{L}{0,6}|" +
  "telefon (?:a[çc](?:abilirsiniz|[ıi]n|[ıi]n[ıi]z|man[ıi]z)|ed(?:ebilirsiniz|in|iniz)|etmeniz)\\p{L}{0,6})(?![\\p{L}])";
/** Birliktelikli seslenilen ("ev sahibinizle / bizimle") + ortak iş fiili ("ayarlayabilirsiniz", "koordine edin", "anlaşabilirsiniz") —
 *  yalnız birliktelik ekiyle ("Ev sahibinize ait klimayı ayarlayabilirsiniz" değil). */
const HC_WITH_VERB_TR =
  "(?:ayarla(?:yabilirsiniz|y[ıi]n|y[ıi]n[ıi]z|man[ıi]z)|koordine (?:edebilirsiniz|edin|ediniz|etmeniz|olabilirsiniz|olun)|anla[şs](?:abilirsiniz|[ıi]n|[ıi]n[ıi]z|man[ıi]z)|g[öo]r[üu][şs](?:ebilirsiniz|[üu]n|[üu]n[üu]z|men[ie]z)|konu[şs](?:abilirsiniz|un|unuz|man[ıi]z))\\p{L}{0,6}(?![\\p{L}])";
const HC_ADDR_EN =
  "(?:your|the|our) (?:airbnb )?(?:hosts?|landlord|landlady|hostess|owner|home ?owner|house owner|property (?:owner|manager)|apartment owner)";
const HC_WRITE_EN =
  "(?:message|messaging|text|texting|write to|writing to|e-?mail|e-?mailing|reach out to|reaching out to|get in touch with|getting in touch with|" +
  "contact|contacting|inform|let|drop|send|ask|asking|check with|notify|alert|ping|get hold of|reach)";
const HC_CALL_EN = "(?:call|calling|phone|phoning|ring|ringing)";
const HC_ADDR_DE = "(?:ihrem|ihren|ihrer|dem|den|der|ihre|die) (?:gastgeber(?:in)?|vermieter(?:in)?|host|eigentümer(?:in)?)";
const HC_ADDR_FR = "(?:(?:votre |l['’] ?|le |la )(?:h[ôo]te|h[ôo]tesse|propri[ée]taire)|(?:vos |les )(?:h[ôo]tes|h[ôo]tesses|propri[ée]taires))";
const HC_ADDR_ES = "(?:(?:su |tu |el |la |al |a su |a tu )?(?:anfitri[oó]n|anfitriona|propietari[oa]|due[ñn][oa])|(?:sus |los |las |a sus |a los |con los |con sus )(?:anfitrion(?:es|as)|propietari[oa]s|due[ñn][oa]s))";
// "нам / мне" (ev sahibinin kendi sesi) YALNIZ koşul / kapanış izinde sayılır (`HC_SELF_PATTERNS`, tasarım A4) — "Сообщите нам ваше время
// прибытия" bilgi isteğidir (v3 kapsam incelemesi).
const HC_ADDR_RU = "(?:(?:вашим|вашему|вашего|вашей|с|со|к|у) )*(?:хозя\\p{L}{0,6}|владел\\p{L}{0,6}|собственник\\p{L}{0,4}|хост\\p{L}{0,4}|арендодател\\p{L}{0,4})";
/** Rusça yönelme hâli (yalnız "сообщите / напишите … X'e" nesne aralığında — "Напишите номер квартиры хозяина" ilgi hâlidir). */
const HC_DAT_RU = "(?:вашему |вашей )?(?:хозяину|хозяйке|хозяевам|владельцу|владелице|владельцам|собственнику|собственнице|арендодателю|хосту)(?![\\p{L}])";
/** Koşul / kapanış izi — ev sahibinin kendi sesi ("bize / us / uns …") YALNIZ bununla sayılır ("Çıkışta anahtarı bırakıp bize mesaj atın"
 *  bir adım talimatıdır, kurucuya soru F3). */
const HC_CONTINGENCY = new RegExp(
  "(?<![\\p{L}])en cas d['’]|(?<![\\p{L}])(?:sorun\\p{L}{0,6}|s[ıi]k[ıi]nt[ıi]\\p{L}{0,6}|problem\\p{L}{0,6}|aksilik\\p{L}{0,6}|herhangi bir|bir [şs]ey\\p{L}{0,4}|ihtiya[çc]\\p{L}{0,8}|" +
    "soru(?:nuz|lar\\p{L}{0,6}|su)?|iste[ğk]\\p{L}{0,6}|talep\\p{L}{0,6}|\\p{L}{2,}m[ae]zs[ae](?:n[ıi]z)?|devam ederse|if|should|in case|whenever|feel free|don'?t hesitate|do not hesitate|anything|any (?:questions?|issues?|problems?)|" +
    "bei (?:\\p{L}+ )?(?:fragen|problemen|anliegen|schwierigkeiten)|falls|wenn|sollten sie|sollte (?:es|etwas)|z[öo]gern sie nicht|en cas de?|n'h[ée]sitez|pour toute|si|en caso de|no dude|no dudes|cualquier|" +
    "если|в случае|по любым|любые)(?![\\p{L}])|(?:إذا|اذا|في حال|لا تتردد)",
  "u",
);
const HC_SELF_PATTERNS: readonly RegExp[] = [
  new RegExp(`${HC_SELF_TR},? ${gap(3)}(?:${HC_WRITE_TR}|${HC_CALL_TR})`, "u"),
  new RegExp(`${L}(?:${HC_WRITE_EN}|${HC_CALL_EN}|tell) (?:us|me)(?: (?:know|a (?:line|message|note)|directly|anytime|any time|at any time))?(?![\\p{L}])`, "u"),
  new RegExp(`${L}(?:schreiben sie|schreib|kontaktieren sie|rufen sie|melden sie sich|wenden sie sich)(?: (?:bitte|gerne|einfach|direkt|kurz))* (?:(?:an|bei) )?(?:uns|mir)(?![\\p{L}])`, "u"),
  new RegExp(`${L}(?:[ée]crivez|contactez|appelez|joignez)-nous|${L}(?:n'h[ée]sitez pas [àa]|vous pouvez) nous (?:contacter|[ée]crire|appeler|joindre)`, "u"),
  new RegExp(`${L}(?:escr[ií]banos|escr[ií]benos|ll[aá]menos|ll[aá]manos|cont[aá]ctenos|cont[aá]ctanos)|${L}(?:no dude en|no dudes en|puede) (?:escribirnos|llamarnos|contactarnos)`, "u"),
  new RegExp(`${L}(?:напишите|напиши|позвоните|позвони|свяжитесь|свяжись|сообщите|обратитесь)(?: пожалуйста)?,? (?:нам|мне|к нам|с нами)`, "u"),
  /(?:راسل|راسلوا|راسلي|تواصل|تواصلوا|تواصلي|اتصل|اتصلوا|اتصلي|اكتب|اكتبوا)\p{L}{0,2}\s+(?:معنا|لنا|بنا)/u,
  // Opus F2 (10-30) — ev sahibinin sesi, koşul / kapanış izinde:
  //  · alıcısız Türkçe kapanış: koşul eki / "sorunda" HEMEN ardından yazma fiili ("Herhangi bir sorunuz olursa yazabilirsiniz", "… olursa
  //    yazmaktan çekinmeyin", "Herhangi bir sorunda mesaj atabilirsiniz") — "Kodu tekrar yazın" gibi nesneli kullanım eşleşmez;
  new RegExp(
    // v3 kapsam incelemesi cost-coverage-03: "Sorunuz varsa yazın", "… olursa (çekinmeden) sorabilirsiniz / sormanız yeterli / ulaşabilirsiniz".
    `(?<![\\p{L}])(?:olursa|varsa|sorunda|durumda|halinde|takdirde),? (?:(?:[çc]ekinmeden|l[üu]tfen|her zaman|istedi[ğg]iniz zaman|diledi[ğg]iniz zaman|yine) )?` +
      `(?:yaz(?:abilirsiniz|[ıi]n|[ıi]n[ıi]z|man[ıi]z|maktan)|mesaj (?:at|g[öo]nder|b[ıi]rak)\\p{L}{0,14}|sor(?:abilirsiniz|man[ıi]z yeterli(?:dir)?|maktan)|` +
      `ula[şs](?:abilirsiniz|[ıi]n|[ıi]n[ıi]z)|ileti[şs]ime ge[çc](?:ebilirsiniz|in|iniz))(?![\\p{L}])`,
    "u",
  ),
  //  · "sormaktan / yazmaktan / ulaşmaktan çekinmeyin" (nesnesiz kapanış; koşul / kapanış izinde);
  /(?<![\p{L}])(?:sormaktan|yazmaktan|ula[şs]maktan|aramaktan|ileti[şs]ime ge[çc]mekten|mesaj atmaktan|haber vermekten|bildirmekten) [çc]ekinme(?:yin|yiniz)(?![\p{L}])/u,
  //  · İngilizce nesnesiz "feel free to ask", "just ask", "don't hesitate to ask / get in touch", "just send a message" (nesneli "ask the
  //    concierge", "ask for extra blankets" eşleşmez);
  /(?<![\p{L}])(?:feel free to|don'?t hesitate to|do not hesitate to|just|simply) (?:ask|get in touch|reach out|send (?:us |me )?a (?:quick |short )?(?:message|text|note|line)|drop (?:us |me )?a (?:line|message|note))(?=\s*(?:[.!,;)—–]|$)|\s+(?:if|whenever|anytime|any time|at any time)(?![\p{L}]))|(?<![\p{L}])get in touch(?=\s*(?:[.!]|$))|(?<![\p{L}])send (?:us |me )?a (?:quick |short )?(?:message|text|note|line)(?=\s*(?:[.!]|$))/u,
  //  · Almanca "können Sie sich jederzeit an uns wenden", "Wenden Sie sich bei Fragen gerne an uns";
  /(?<![\p{L}])sich(?: \p{L}+){0,3}? an (?:uns|mich)(?![\p{L}])/u,
  //  · Fransızca "n'hésitez pas à me contacter / à demander / à me les poser";
  /(?<![\p{L}])n'h[ée]sitez pas [àa] (?:(?:me|nous) (?:contacter|[ée]crire|appeler|joindre|solliciter|les poser|la poser|le demander|demander|poser vos questions)|demander(?=\s*(?:[.!,;]|$))|poser (?:vos|toutes vos) questions)/u,
  //  · İspanyolca "no dude en preguntar / consultarnos / preguntarme";
  /(?<![\p{L}])no dudes? en (?:preguntar(?:nos|me|le)|consultar(?:nos|me)|contactar(?:nos|me)|escribir(?:nos|me)|llamar(?:nos|me)|preguntar(?=\s*(?:[.!,;]|$)|\s+(?:si|cuando|cualquier)(?![\p{L}])))/u,
  //  · Rusça "не стесняйтесь обращаться / писать", "обращайтесь в любое время", "дайте знать";
  /(?<![\p{L}])не стесняйтесь (?:обращаться|писать|спрашивать|звонить|связываться|задавать (?:вопросы|их))|(?<![\p{L}])(?:обращайтесь|пишите|звоните|спрашивайте)(?: (?:в любое время|всегда|без стеснения|смело))(?=\s*[.!]|$)|(?<![\p{L}])дайте (?:нам |мне )?знать(?=\s*[.!]|$)/u,
  //  · Arapça "لا تتردد في سؤالي / سؤالنا / التواصل", "أرسل لنا رسالة".
  /لا (?:تتردد|تترددوا|تترددي) في (?:سؤال|التواصل|الاتصال|مراسلت|الكتابة|إخبار|اخبار)\p{L}*|(?:أرسل|ارسل)\p{L}{0,2}\s+(?:لنا|لي)(?![\p{L}])/u,
  //  · İngilizce nesnesiz "reach out" (ev sahibinin söz verdiği "the host will reach out" eşleşmez), "give us a call / shout", "a message away";
  /(?<!(?:will|'ll|would|shall|may|might|going to|to you) )(?<!(?:host|owner|he|she|they|someone|staff) (?:can|could|may|might) )(?<![\p{L}])reach out(?: (?:to us|to me|anytime|any time|at any time))?(?=\s*(?:[.!,;:]|$)|\s+(?:if|whenever|anytime|any time|should)(?![\p{L}]))|(?<![\p{L}])give (?:us|me) a (?:call|ring|shout|message|text|buzz)(?![\p{L}])|(?<![\p{L}])(?:just )?a (?:message|text|call) away(?![\p{L}])/u,
  //  · Almanca: "geben / sagen Sie uns Bescheid", "können Sie uns … kontaktieren", "melden Sie sich (einfach)." (alıcısız);
  /(?<![\p{L}])(?:geben|sagen) sie (?:uns|mir) (?:\p{L}+ )?bescheid|(?<![\p{L}])(?:uns|mir)(?: \p{L}+){0,2}? (?:kontaktieren|schreiben|anrufen|bescheid (?:geben|sagen)|eine nachricht (?:schicken|senden|schreiben))(?![\p{L}])|(?<![\p{L}])melden sie sich(?: (?:bitte|gerne|gern|einfach|jederzeit|kurz))*(?: bei (?:uns|mir))?(?=\s*[.!]|$)/u,
  //  · Fransızca / İspanyolca / Rusça / Arapça: "contactez-moi", "envoyez-nous un message", çıplak "n'hésitez pas." / "don't hesitate.",
  //    "no dude en escribirme", "hágamelo saber", çıplak "обращайтесь / пишите / звоните", bitişik zamir "راسلنا".
  /(?<![\p{L}])(?:contactez|[ée]crivez|appelez)-moi|(?<![\p{L}])envoyez-(?:nous|moi) un (?:message|mot|sms|e-?mail)/u,
  // Çıplak "don't hesitate." / "n'hésitez pas." yalnız ihtiyaç / soru / sorun bağlamında ("If you'd like to use the bikes, don't hesitate!" bir
  // davettir — overhold-8).
  /^(?=[\s\S]*(?:questions?|problems?|issues?|need|anything|besoin|probl[èe]mes?|soucis?|quoi que ce soit))[\s\S]*?(?<![\p{L}])(?:n'h[ée]sitez pas|don'?t hesitate|do not hesitate)(?=\s*[.!]|$)/u,
  /(?<![\p{L}])(?:(?:no dude|no dudes|puede) en )?(?:escribirme|llamarme|contactarme|escr[ií]bame|ll[aá]meme|cont[aá]cteme)(?![\p{L}])|(?<![\p{L}])h[aá]g(?:amelo|anoslo|ame) saber(?![\p{L}])/u,
  /(?<![\p{L}])(?:обращайтесь|пишите|звоните|связывайтесь)(?: (?:нам|мне|к нам|с нами))?(?=\s*[.!]|$)|(?<![\p{L}])(?:пишите|звоните|обращайтесь) (?:нам|мне|к нам)(?![\p{L}])/u,
  /(?:راسلنا|راسلني|كلمنا|كلمني|اكتب لنا|ابعث لنا|أخبرنا|اخبرنا)/u,
  // Ev sahibinin sesiyle "yeniden yazın / write again" (koşullu dolgu: "Düzelmezse yeniden yazın").
  // Nesneli "kodu / şifreyi tekrar yazın" kodu yeniden girmektir, ev sahibine yazmak değil (overhold-11).
  /(?<!\p{L}(?:[ıiuü]|y[ıiuü]) )(?<![\p{L}])(?:yeniden|tekrar) (?:yaz(?:abilirsiniz|[ıi]n|[ıi]n[ıi]z)|mesaj at(?:abilirsiniz|[ıi]n))(?![\p{L}])|(?<![\p{L}])(?:message|write to|text) us again(?![\p{L}])/u,
];
const HC_NOT_MODAL = "(?<!(?:will|'ll|would|shall|might|automatically|also|then) )";
const HC_HOST_PATTERNS: readonly RegExp[] = [
  new RegExp(`${HC_ADDR_TR},? ${gap(4)}(?:${HC_WRITE_TR}|${HC_CALL_TR})`, "u"),
  // "tell" yalnız ev sahibine ("tell your host"); "tell me / us your arrival time" bir bilgi isteğidir.
  // Öznesi üçüncü kişi / cihaz olan bildirim ("The door sensor will alert the host", "The cleaner will let the host know") talimat değildir
  // (Opus v2 incelemesi overhold-9).
  new RegExp(`${HC_NOT_MODAL}${L}(?:${HC_WRITE_EN}|${HC_CALL_EN}|tell)(?: (?:directly|right away|immediately|anytime|any time))? (?:to |with )?${HC_ADDR_EN}(?![\\p{L}])`, "u"),
  new RegExp(`${HC_NOT_MODAL}${L}let ${HC_ADDR_EN} know(?![\\p{L}])`, "u"),
  // Edilgen ulaşılabilirlik ("Your host can be reached via the app", "Ev sahibinize uygulamadan ulaşılabilir") — Opus v2 incelemesi launder-08.
  new RegExp(`${HC_ADDR_EN} (?:can|may|could) (?:also )?be (?:reached|contacted)(?![\\p{L}])`, "u"),
  // Emirle seslenilen arasında en çok üç sözcük ("Kontaktieren Sie bei Problemen Ihren Gastgeber", "Fragen Sie am besten Ihren Gastgeber" —
  // v3 kapsam incelemesi cost-coverage-04); "nicht" araya giremez.
  new RegExp(
    `${L}(?:schreiben sie|schreib|kontaktieren sie|rufen sie|melden sie sich|wenden sie sich|informieren sie|benachrichtigen sie|fragen sie|erkundigen sie sich)(?: (?!nicht(?![\\p{L}]))[\\p{L}-]+){0,3}? (?:(?:an|bei|mit) )?${HC_ADDR_DE}(?![\\p{L}])`,
    "u",
  ),
  new RegExp(
    `${L}(?:[ée]crivez|contactez|appelez|joignez|pr[ée]venez|informez|envoyez un message|adressez-vous|prenez contact avec|n'h[ée]sitez pas [àa] (?:contacter|[ée]crire|appeler|joindre|pr[ée]venir))(?: (?:directement|rapidement|imm[ée]diatement))?(?: (?:[àa]|aupr[èe]s de))? ${HC_ADDR_FR}(?![\\p{L}])`,
    "u",
  ),
  new RegExp(
    `${L}(?:escriba|escribe|escr[ií]bale|ll[aá]me|llame|llama|ll[aá]mele|contacte|contacta|comun[ií]quese|p[oó]ngase en contacto|env[ií]e un mensaje|av[ií]se|avisa|informe|inf[oó]rmele|informa|inf[oó]rmale|no dude en (?:escribir|llamar|contactar))(?: (?:directamente|con))? (?:a |al |con )?${HC_ADDR_ES}(?![\\p{L}])`,
    "u",
  ),
  new RegExp(`${L}(?:напишите|напишете|напиши|позвоните|позвони|свяжитесь|свяжетесь|свяжись|сообщите|обратитесь)(?: пожалуйста)?,? ${HC_ADDR_RU}`, "u"),
  /(?:راسل|راسلوا|راسلي|مراسلة|تواصل|تواصلوا|تواصلي|التواصل|اتصل|اتصلوا|اتصلي|الاتصال|اكتب|اكتبوا|أخبر|اخبر|أبلغ|ابلغ|إبلاغ|ابلاغ|إخبار|اخبار|اسأل|اسال)\p{L}{0,2}(?:\s+\S+){0,3}?\s+\S*(?:المضيف|المالك|مضيفك|مالك العقار|صاحب الشقة|مالك الشقة|صاحب العقار|صاحب المنزل|مالك المنزل)/u,
  // "سؤال" (sormak / soru) yalnız kip / rica sözcüğünden sonra ("أجب على سؤال المضيف" ev sahibinin sorusudur).
  /(?:يمكنك|يمكنكم|يرجى|بإمكانك|بامكانك|عليك|الرجاء)\s+سؤال\s+\S*(?:المضيف|المالك|مضيفك|صاحب الشقة|مالك الشقة|صاحب المنزل)/u,
  // ── v3 kapsam incelemesi (cost-coverage-01…07): yaygın yönlendirme biçimleri ──
  // Türkçe birliktelik + ortak iş ("Erken giriş için ev sahibinizle ayarlayabilirsiniz", "ev sahibinizle koordine edin").
  new RegExp(`${L}(?:ev ?sahib\\p{L}{0,6}(?:le|la|yle|yla)|host'?(?:unuzla|umuzla|la)|m[üu]lk sahib\\p{L}{0,6}(?:le|la|yle|yla)|daire sahib\\p{L}{0,6}(?:le|la|yle|yla))(?![\\p{L}]),? ${gap(4)}${HC_WITH_VERB_TR}`, "u"),
  // İngilizce "shoot / drop your host a message", "have a word with your host", "leave a message for your host", "your host is reachable …".
  new RegExp(
    `${L}(?:shoot|drop) ${HC_ADDR_EN} a (?:quick |short )?(?:message|text|note|line|e-?mail)(?![\\p{L}])|${L}have a (?:quick )?(?:word|chat) with ${HC_ADDR_EN}(?![\\p{L}])` +
      `|${L}leave (?:a |an )?(?:message|note|voicemail) for ${HC_ADDR_EN}(?![\\p{L}])|${HC_ADDR_EN} is (?!not |never )(?:[\\p{L}-]+ ){0,2}?reachable(?![\\p{L}])`,
    "u",
  ),
  // Almanca "nehmen Sie (bitte) Kontakt mit Ihrem Gastgeber auf", "treten Sie mit Ihrem Gastgeber in Kontakt", "teilen Sie das Ihrem Gastgeber
  // mit", "melden Sie dies Ihrem Gastgeber", "Sie erreichen Ihren Gastgeber …", "Ihr Gastgeber ist … erreichbar".
  new RegExp(
    `${L}(?:nehmen sie|treten sie)(?: [\\p{L}-]+){0,2}? (?:kontakt mit ${HC_ADDR_DE}(?: [\\p{L}-]+){0,2}? auf|mit ${HC_ADDR_DE} (?:in kontakt|in verbindung))(?![\\p{L}])` +
      `|${L}teilen sie(?: [\\p{L}-]+){0,3}? ${HC_ADDR_DE} mit(?![\\p{L}])|${L}melden sie(?: (?!sich(?![\\p{L}]))[\\p{L}-]+){1,3}? ${HC_ADDR_DE}(?![\\p{L}])` +
      `|${L}sie erreichen ${HC_ADDR_DE}(?![\\p{L}])|${L}(?:ihr|ihre|der|die) (?:gastgeber(?:in)?|vermieter(?:in)?|host) ist (?!nicht )(?:[\\p{L}\\p{N}-]+ ){0,4}?erreichbar(?![\\p{L}])`,
    "u",
  ),
  // Fransızca mastar ("Je vous conseille de contacter votre hôte", "Le mieux est de …", "Mieux vaut écrire à …", "Il faudra voir avec …",
  // "Merci de prévenir …", "Vous pouvez envoyer un message à …").
  new RegExp(
    `${L}(?:je vous (?:conseille|recommande|sugg[èe]re|propose)|nous vous (?:conseillons|recommandons|sugg[ée]rons|proposons)|le mieux (?:est|serait)|mieux vaut|il (?:vaut mieux|faudra|faut|faudrait)|merci|vous pouvez|vous pourrez|veuillez|je vous invite [àa]|nous vous invitons [àa])` +
      `(?: d['’]| de |\\s)(?:contacter|[ée]crire [àa]|envoyer un (?:message|mot|sms|e-?mail) [àa]|pr[ée]venir|informer|appeler|joindre|demander [àa]|voir avec|vous adresser [àa]|prendre contact avec|vous rapprocher d(?:e |['’]))\\s?${HC_ADDR_FR}(?![\\p{L}])`,
    "u",
  ),
  // İspanyolca mastar / dilek kipi ("Le recomiendo ponerse en contacto con su anfitrión", "Lo mejor es consultar con su anfitrión", "Puede
  // enviarle un mensaje a su anfitrión", "Le sugiero que se ponga en contacto con su anfitrión", "Te recomiendo que le escribas a tu anfitrión").
  new RegExp(
    `${L}(?:(?:le|te|les) (?:recomiendo|recomendamos|sugiero|sugerimos|aconsejo|aconsejamos)|lo mejor (?:es|ser[íi]a)|puede|puedes|pueden|podr[íi]as?|deber[íi]as?|tendr[aá] que|tiene que|no dudes? en) ` +
      `(?:ponerse en contacto con|ponerte en contacto con|contactar(?:le)?(?: con)?|consultar(?:lo|le)?(?: con| a)?|escribir(?:le)? a|enviar(?:le)? un (?:mensaje|correo|e-?mail|whatsapp) a|informar(?:le)? a|avisar(?:le)? a|comunicarse con|hablar con|llamar(?:le)? a|preguntar(?:le)? a)` +
      `(?: directamente)? ${HC_ADDR_ES}(?![\\p{L}])` +
      `|${L}(?:le|te) (?:recomiendo|sugiero|aconsejo|pido) que (?:se ponga en contacto con|te pongas en contacto con|contacte|contactes|le escriba|le escribas|escriba|escribas|consulte|consultes|le llame|le llames|llame|llames|le avise|le avises|avise|avises|hable|hables|informe|informes)(?: (?:directamente|con|a|al))? ${HC_ADDR_ES}(?![\\p{L}])`,
    "u",
  ),
  // Rusça nesne aralığı ("Сообщите об этом хозяину", "Задайте этот вопрос хозяину") — yalnız yönelme hâli; mastar ("лучше сообщить хозяину").
  new RegExp(
    `${L}(?:сообщите|напишите|расскажите|задайте|передайте|сообщайте)(?:,? пожалуйста,?)?(?: (?!(?:ему|ей|им|нам|мне)(?![\\p{L}]))\\p{L}+){0,3}? ${HC_DAT_RU}` +
      `|${L}(?:лучше|можете|можно|стоит|нужно|надо|следует|рекомендую|советую|рекомендуем|советуем|просим|прошу)(?: \\p{L}+){0,2}? (?:сообщить|написать|позвонить|связаться|обратиться|рассказать)(?: (?!(?:ему|ей|им|нам|мне)(?![\\p{L}]))\\p{L}+){0,2}? ${HC_ADDR_RU}`,
    "u",
  ),
  // "أرسل" (gönder / gönderdi) yalnız yönelme edatıyla: "أرسل صاحب الشقة رمز الباب" (ev sahibi kodu gönderdi) bir bildirimdir (overhold-9).
  /(?:أرسل|ارسل)\p{L}{0,2}\s+(?:\S+\s+){0,2}?(?:إلى|الى|ل)\s*\S*(?:المضيف|المالك|مضيفك|مالك العقار|صاحب الشقة|مالك الشقة|صاحب العقار|صاحب المنزل|مالك المنزل)/u,
  // Opus F2 (10-30): "give your host a call", "contact host" (belirteçsiz).
  new RegExp(`${L}give ${HC_ADDR_EN} a (?:call|ring|shout|message|text|heads[- ]up)(?![\\p{L}])|${L}(?:contact|message|text|call|e-?mail|ask) (?:host|owner|landlord)(?![\\p{L}])`, "u"),
  // Almanca kip + mastar ("Bei Fragen können Sie sich jederzeit an Ihren Gastgeber wenden", "… Ihren Gastgeber kontaktieren", "geben Sie
  // Ihrem Gastgeber Bescheid", "schicken Sie Ihrem Gastgeber eine Nachricht"). Yalnız yönelme / belirtme belirteci (özne "der / Ihr Gastgeber
  // wird Sie kontaktieren" eşleşmez).
  new RegExp(
    // Yalnız misafire seslenen cümlede ("Sie"): "Die Reinigungskraft wird den Gastgeber informieren" bir bildirimdir (overhold-9).
    `^(?=[\\s\\S]*${L}sie(?![\\p{L}]))[\\s\\S]*?${L}(?:an |bei |mit )?(?:ihrem|ihren|ihrer|dem|den) (?:gastgeber(?:in)?|vermieter(?:in)?|host|eigentümer(?:in)?)(?: \\p{L}+){0,2}? ` +
      `(?:kontaktieren|wenden|schreiben|anrufen|benachrichtigen|informieren|bescheid (?:geben|sagen)|eine nachricht (?:schicken|senden|schreiben)|kontakt aufnehmen|in kontakt treten|in verbindung treten|mitteilen|melden|fragen|erreichen)(?![\\p{L}])` +
      `|${L}(?:geben|sagen) sie (?:ihrem|ihrer|dem) (?:gastgeber(?:in)?|vermieter(?:in)?|host) bescheid` +
      `|${L}(?:schicken|senden) sie (?:ihrem|ihrer|dem) (?:gastgeber(?:in)?|vermieter(?:in)?|host) (?:eine |kurz eine )?(?:nachricht|e-?mail|sms)`,
    "u",
  ),
  // Fransızca "signalez-le à votre hôte", "faites-le savoir à votre hôte", "dites-le à votre hôte".
  new RegExp(`${L}(?:signalez|faites|dites)(?:-le|-la|-les)?(?: savoir)? (?:[àa]|aupr[èe]s de) ${HC_ADDR_FR}(?![\\p{L}])`, "u"),
  // İspanyolca "avísele a su anfitrión", "mándele un mensaje a su anfitrión", "puede contactar a su anfitrión", "escríbale al anfitrión".
  new RegExp(
    `(?<!(?:va a|van a|vamos a|ir[aá] a|autom[aá]ticamente) )${L}(?:av[ií]sele|av[ií]sale|m[aá]ndele un mensaje|m[aá]ndale un mensaje|h[aá]gale saber|d[ií]gale|contactar|escribir(?:le)?|llamar(?:le)?|avisar(?:le)?)(?: (?:directamente|con))? (?:a |al |con )?${HC_ADDR_ES}(?![\\p{L}])`,
    "u",
  ),
  // Rusça bitmemiş görünüş ("пишите хозяину", "обращайтесь к хозяину", "звоните хозяину", "дайте знать хозяину", "можете написать хозяину").
  new RegExp(`${L}(?:пишите|звоните|обращайтесь|связывайтесь|сообщайте|дайте знать|можете (?:написать|позвонить|обратиться|связаться))(?: пожалуйста)?,? ${HC_ADDR_RU}`, "u"),
  // Arapça "سؤال المضيف" ↑; mastar "إبلاغ / إخبار" ↑ fiil listesinde.
];
/**
 * v3 kapsam incelemesi cost-coverage-02: İngilizce iş fiili + NESNE + "with / to your host" ("You can arrange a late checkout with your host",
 * "Please report any damage to your host", "Please raise this with your host", "Please bring this up with your host"). Öznesi birinci kişi
 * ("I'll mention it to your host", "We're happy to arrange this with your host") ya da üçüncü kişi ("The cleaner will report it to the host")
 * olan cümle eşleşmez; "the host's office" sahiplik ekidir.
 */
const HC_FIRST_PERSON_LB =
  "(?<!(?<![\\p{L}])(?:[iı]|we|let me|let us)(?:['’](?:ll|d|m|ve|re)| will| would| can| could| shall| may| might| am| are| have)?(?: (?:be )?(?:happy|glad|able) to| going to| also| gladly| happily| personally| just| quickly| then)? )";
const HC_HOST_GAP_PATTERNS: readonly RegExp[] = [
  new RegExp(
    `${HC_FIRST_PERSON_LB}${HC_NOT_MODAL}${L}(?:arrange|coordinate|report|raise|bring|mention|flag|direct|discuss|sort|settle|follow up|clarify|liaise|agree)` +
      `(?: (?!(?:not|never)(?![\\p{L}]))[\\p{L}\\p{N}'’-]+){0,4}? (?:up |out |on )?(?:with|to) ${HC_ADDR_EN}(?![\\p{L}'’])`,
    "u",
  ),
];
/**
 * Opus F2 ek (10-30): ZAMİRLE gönderme — ev sahibi cümlede önce anılır, talimat zamirle verilir ("Ev sahibiniz Ayşe Hanım çok yardımseverdir,
 * bir sorun olursa ona yazın", "Your host Mehmet is very helpful; just message him", "Ihr Gastgeber …, schreiben Sie ihm", "Votre hôte …,
 * écrivez-lui", "Хозяин всегда на связи, … напишите ему"). Yalnız cümlede ev sahibi ANILIYORSA sayılır (zamir başkası olabilir).
 */
const HC_HOST_MENTION = new RegExp(
  `${L}(?:ev ?sahib\\p{L}{0,10}|host\\p{L}{0,6}|landlord|landlady|owner|gastgeber\\p{L}{0,3}|vermieter\\p{L}{0,3}|h[ôo]te\\p{L}{0,4}|propri[ée]taire|anfitri\\p{L}{0,4}|propietari\\p{L}{0,2}|хозя\\p{L}{0,6}|владел\\p{L}{0,6})|المضيف|المالك`,
  "u",
);
/**
 * Zamir üçüncü kişiye bağlıysa ("the driver will wait, just call him", "Ev sahibinizin annesi alt katta, ona sorun", "Hausmeister … rufen Sie
 * ihn an") ev sahibine başvurma DEĞİLDİR (Opus v2 incelemesi overhold-10). Cümlede böyle bir kişi anılıyorsa zamir kuralı uygulanmaz.
 */
const HC_THIRD_PARTY =
  /(?<![\p{L}])(?:driver|cleaner|cleaning (?:lady|staff)|housekeep\p{L}*|parents|mother|father|janitor|caretaker|neighbou?rs?|reception\p{L}*|concierge|staff|security|doorman|plumber|technician|şoför|temizlikçi|temizlik görevlisi|anne(?:si|niz)|baba(?:sı|nız)|kapıcı\p{L}*|komşu\p{L}*|görevli\p{L}*|resepsiyon\p{L}*|tesisatçı|teknisyen|hausmeister|fahrer|reinigungskraft|putzfrau|nachbar\p{L}*|eltern|rezeption|techniker|chauffeur|femme de ménage|voisin\p{L}*|gardien\p{L}*|plombier|conductor|ch[óo]fer|limpiadora|vecin\p{L}*|portero|padres|t[ée]cnico|водител\p{L}*|уборщиц\p{L}*|сосед\p{L}*|консьерж\p{L}*|родител\p{L}*|сантехник\p{L}*|سائق|عامل|الجار|الفني)(?![\p{L}])/iu;
/**
 * Misafirden BİLGİ isteyen ev sahibi sesi ("let me know your arrival time", "send us a photo of your ID", "schreiben Sie uns Ihre Ankunftszeit",
 * "bize varış saatinizi yazın") başvurma talimatı değildir — misafir zaten cevap yazacak (Opus v2 incelemesi overhold-12).
 */
const HC_INFO_REQUEST =
  /(?<![\p{L}])(?:let (?:me|us) know|send (?:me|us)|tell (?:me|us)|inform (?:me|us)) (?:(?:your|the|when|what|whether|how many|which)(?![\p{L}])|(?:a|an) (?!(?:quick |short )?(?:message|line|note|text|call|shout|e-?mail|whatsapp)(?![\p{L}])))|(?:schreiben|sagen|senden|schicken|geben|nennen) sie (?:uns|mir) (?:bitte )?(?:ihre?n?|wann|ob|wie viele)(?![\p{L}])|(?:envoyez|indiquez|dites|communiquez)-(?:nous|moi) (?:votre|vos|quand|si|combien)(?![\p{L}])|(?:env[ií]enos|d[ií]ganos|ind[ií]quenos|h[aá]ganos saber|com[ée]ntenos) (?:su|sus|cu[aá]ndo|si|cu[aá]nt\p{L}+)(?![\p{L}])|(?:сообщите|напишите) (?:нам|мне) (?:ваш\p{L}*|когда|во сколько|сколько)|(?:bize|bana) (?:\p{L}+ ){0,3}?\p{L}+(?:[ıiuü]n[ıiuü]z[ıiuü]|n[ıi]z[ıi]) (?:yaz|gönder|ilet|bildir|payla[şs])\p{L}*/iu;
/**
 * Bilgi isteğinin nesnesi MİSAFİRİN KENDİ bilgisi mi ("your arrival time", "Ihre Ankunftszeit", "votre heure", "su hora", "ваше время",
 * "varış saatinizi"). Genel ihtiyaç / sorun koşuluyla ("If anything comes up, let us know the details", "If you need anything, let us know
 * when") bilgi isteği değil KAPANIŞTIR — muafiyet yalnız kendi-bilgi nesnesinde kalır (v3 kapsam incelemesi cost-coverage-08).
 */
const HC_INFO_OWN =
  /(?<![\p{L}])(?:let (?:me|us) know|send (?:me|us)|tell (?:me|us)|inform (?:me|us)) (?:your|how many)(?![\p{L}])|(?:schreiben|sagen|senden|schicken|geben|nennen) sie (?:uns|mir) (?:bitte )?ihre?n?(?![\p{L}])|(?:envoyez|indiquez|dites|communiquez)-(?:nous|moi) (?:votre|vos)(?![\p{L}])|(?:env[ií]enos|d[ií]ganos|ind[ií]quenos|h[aá]ganos saber|com[ée]ntenos) (?:su|sus)(?![\p{L}])|(?:сообщите|напишите) (?:нам|мне) ваш\p{L}*|(?:bize|bana) (?:\p{L}+ ){0,3}?\p{L}+(?:[ıiuü]n[ıiuü]z[ıiuü]|n[ıi]z[ıi]) (?:yaz|gönder|ilet|bildir|payla[şs])\p{L}*/iu;
const HC_GENERIC_NEED =
  /(?<![\p{L}])(?:anything|something|any (?:questions?|issues?|problems?|trouble)|need|problems?|issues?|questions?|goes wrong|go wrong|comes up|come up|sorun\p{L}{0,6}|s[ıi]k[ıi]nt[ıi]\p{L}{0,6}|soru(?:nuz|lar\p{L}{0,6})|ihtiya[çc]\p{L}{0,8}|bir [şs]ey\p{L}{0,4}|aksilik\p{L}{0,6}|fragen|probleme?n?|etwas|besoin|probl[èe]mes?|questions?|algo|problemas?|preguntas?|вопрос\p{L}{0,3}|что-(?:то|нибудь)|проблем\p{L}{0,3})(?![\p{L}])/iu;
const HC_PRONOUN_PATTERNS: readonly RegExp[] = [
  new RegExp(`${L}(?:ona|kendisine|onlara) (?:${HC_WRITE_TR}|${HC_CALL_TR})|${L}(?:onu|kendisini|onlar[ıi]) (?:${HC_CALL_TR})`, "u"),
  new RegExp(`${L}(?:message|text|write to|e-?mail|contact|call|ring|phone|tell|ask|reach out to|get in touch with) (?:him|her|them)(?![\\p{L}])|${L}send (?:him|her|them) a (?:message|text|note)`, "u"),
  /(?<![\p{L}])(?:schreiben sie (?:ihm|ihr)|rufen sie (?:ihn|sie) an|kontaktieren sie (?:ihn|sie)|wenden sie sich an (?:ihn|sie)|(?:ihm|ihr) (?:einfach |kurz )?(?:schreiben|bescheid geben))(?![\p{L}])/u,
  /(?<![\p{L}])(?:[ée]crivez-lui|contactez-(?:le|la)|appelez-(?:le|la)|pr[ée]venez-(?:le|la)|envoyez-lui un message)(?![\p{L}])/u,
  /(?<![\p{L}])(?:escr[ií]bale|ll[aá]mele|cont[aá]ctele|av[ií]sele|cont[aá]ctelo|cont[aá]ctela)(?![\p{L}])/u,
  /(?<![\p{L}])(?:напишите|позвоните|пишите|звоните|сообщите|обратитесь|обращайтесь) (?:ему|ей|им|к нему|к ней)(?![\p{L}])/u,
];
const HC_CALL_KIND = new RegExp(
  `(?:${HC_CALL_TR}|(?<![\\p{L}])${HC_CALL_EN}(?![\\p{L}])|(?<![\\p{L}])(?:rufen sie|anruf\\p{L}{0,4}|appelez|appeler|ll[aá]m\\p{L}{0,4}|позвон\\p{L}{0,4})|اتصل|الاتصال)`,
  "u",
);

/**
 * K-1029-A: cümle misafiri ev sahibine (ya da ev sahibinin sesiyle "bize") yazmaya / ulaşmaya / aramaya gönderiyor mu — yedi dil. `"call"` =
 * arama / ulaşma fiili, öteki her biçim `"write"`. Bilgi yönlendirmesi ve koşullu başvurma bugünkü iki dedektörün işi; bu üçüncüsü onların
 * kaçırdığını yakalar. Saf, doğrusal.
 */
export function mentionsHostContact(sentence: string | null | undefined): "write" | "call" | null {
  const forms = foldedForms(joinLines(sentence ?? "")).map((f) => f.split(SEP).join(" ").replace(FIRST_PERSON_REFERRAL, " "));
  // Dışlamalar HER iki katlamada aranır: Türkçe katlama "Ihre" → "ıhre", "Driver" → "drıver" yapar.
  const thirdParty = forms.some((f) => HC_THIRD_PARTY.test(f));
  const infoRequest =
    forms.some((f) => HC_INFO_OWN.test(f)) || (forms.some((f) => HC_INFO_REQUEST.test(f)) && !forms.some((f) => HC_GENERIC_NEED.test(f)));
  const host =
    forms.some((f) => HC_HOST_PATTERNS.some((re) => re.test(f))) ||
    (!thirdParty && forms.some((f) => HC_HOST_GAP_PATTERNS.some((re) => re.test(f)))) ||
    (!thirdParty && forms.some((f) => HC_HOST_MENTION.test(f) && HC_PRONOUN_PATTERNS.some((re) => re.test(f))));
  const self = !host && !infoRequest && forms.some((f) => HC_CONTINGENCY.test(f) && HC_SELF_PATTERNS.some((re) => re.test(f)));
  if (!host && !self) return null;
  if (forms.some((f) => contactValueInReferralClause(f) || NEGATED_REFERRAL.test(f))) return null;
  return forms.some((f) => HC_CALL_KIND.test(f)) && !forms.some((f) => WRITE_HOST_VERB.test(f)) ? "call" : "write";
}

/**
 * Zamirle gönderme, ev sahibi ÖNCEKİ cümlede anıldıysa (Opus v2 incelemesi launder-08: "Your host Mehmet lives nearby. If anything comes up,
 * just message him."): bu cümle zamir + iletişim fiili taşıyor mu. Çağıran (`host-contact-filler.ts`) yalnız önceki cümle ev sahibini andıysa
 * kullanır. Üçüncü kişi anılıyorsa ve olumsuzsa `null`.
 */
export function pronounHostContactKind(sentence: string | null | undefined): "write" | "call" | null {
  const forms = foldedForms(joinLines(sentence ?? "")).map((f) => f.split(SEP).join(" ").replace(FIRST_PERSON_REFERRAL, " "));
  if (forms.some((f) => HC_THIRD_PARTY.test(f)) || !forms.some((f) => HC_PRONOUN_PATTERNS.some((re) => re.test(f)))) return null;
  if (forms.some((f) => NEGATED_REFERRAL.test(f))) return null;
  return forms.some((f) => HC_CALL_KIND.test(f)) && !forms.some((f) => WRITE_HOST_VERB.test(f)) ? "call" : "write";
}

/** Metin ev sahibini anıyor mu (ev sahibi / host / Gastgeber / hôte / anfitrión / хозяин / المضيف) ve üçüncü kişi anmıyor mu. */
export function mentionsHostOnly(text: string | null | undefined): boolean {
  const forms = foldedForms(text);
  return !forms.some((f) => HC_THIRD_PARTY.test(f)) && forms.some((f) => HC_HOST_MENTION.test(f));
}

/** Cümle bir ARAMA fiili taşıyor mu ("arayın", "call", "rufen Sie … an", "appelez", "llame", "позвоните", "اتصل") — güvenlik uyarısında
 *  yalnız "arayın" kalır; "ask / contact / danışın / iletişime geçin" kalmaz (Opus v2 incelemesi safety-wiring-05). */
export function namesCallContact(sentence: string | null | undefined): boolean {
  return foldedForms(joinLines(sentence ?? "")).some((f) => HC_CALL_KIND.test(f.split(SEP).join(" ")));
}

/** Cümle bir YAZMA / mesaj fiili taşıyor mu ("yazın", "message", "écrivez" …) — "yazın" hiçbir koşulda (güvenlik uyarısında da) kalmaz. */
export function namesWriteContact(sentence: string | null | undefined): boolean {
  return foldedForms(joinLines(sentence ?? "")).some((f) => WRITE_HOST_VERB.test(f.split(SEP).join(" ")));
}

/** Üç dedektörün birleşimi: bilgi yönlendirmesi → `"referral"`; koşullu başvurma; yedi dilli başvurma. */
export type HostContactKind = "write" | "call" | "referral";
export function hostContactKindOf(sentence: string | null | undefined): HostContactKind | null {
  if (refersGuestToHost(sentence)) return "referral";
  return conditionalHostContactKind(sentence) ?? mentionsHostContact(sentence);
}

/** Koşul / genel olasılık izi (yan cümle kesiminde yalnız DAHA ÇOK silmek için; `host-contact-filler.ts`). */
export function isConditionLikeClause(clause: string): boolean {
  return foldedForms(clause).some((f) => {
    const g = f.split(SEP).join(" ");
    return EVENT_CONDITION.test(g) || HC_CONTINGENCY.test(g);
  });
}

/**
 * Cevap, bilginin KAYITLARDA OLMADIĞINI açıkça söylüyor mu?
 *
 * `true` ise bu metin MİSAFİRE GÖNDERİLMEZ — çağıran devreder.
 *
 * 🚨 İKİ KATLAMA (projenin `includesAnyFold` doktrini; yalnız EŞLEŞME EKLER):
 * `toLocaleLowerCase("tr")` TEK BAŞINA YANLIŞTI ve ÖLÇÜLDÜ — Türkçe yerelde
 * büyük "I" → "ı" olur, yani İngilizce cevaplar bozuluyordu:
 *   "I have no **I**nformation on that."  → "ı have no **ı**nformation…"  → KAÇIYORDU
 *   "IT IS NOT IN MY RECORDS."            → "ıt ıs not **ın** my records." → KAÇIYORDU
 * Ama Türkçe için tr okuması ŞART ("BİLGİM YOK" → standart küçültme "bi̇lgi̇m"
 * üretir ve kalıba uymaz). Tek doğru katlama yok → ikisi de denenir.
 */
export function admitsMissingKnowledge(reply: string | null | undefined): boolean {
  // 10-01: ayrıştırılmış aksan (NFD "précisées") birleştirilir; kıvrık kesme işareti düz olana iner — kalıplar
  // düz "'" yazılı ve modeller çoğu zaman "don’t / n’ai" yazar (İngilizce kalıplar da bu yüzden kaçırıyordu).
  // 10-01 (15 ajan A05): biçim kalıbı deliyordu — "**don't have**" (kalın), "`…`", çift boşluk / sekme / satır sonu ("I do not\nhave that
  // information"). Vurgu işaretleri silinir, her boşluk dizisi TEK boşluk olur (sınıflandırıcının `normalizeForMatch`iyle aynı; yalnız
  // EŞLEŞME EKLER — kısıtlayıcı kapı).
  const [plain, turkish] = foldedForms(reply);
  return (
    ALL_ABSENCE_PATTERNS.some((re) => re.test(plain) || re.test(turkish)) ||
    narratesInternalSource(plain) ||
    narratesInternalSource(turkish) ||
    refersGuestToHost(reply)
  );
}

// ── İÇ KAYNAK ANLATIMI — OLUMLU DA GİTMEZ (kurucu 10-22, aynen: "bilgi tabanıyla ilgili kendi kullandığı model işlev özellik veri için baktığı
// hiçbir şey müşteriye gitmemeli") ───────────────────────────────────────────────────────────────────────────────────────────────────────
// Canlı ölçümde misafire giden: "Bilgi tabanımda otoparkın günlük ücretinin gişede nakit veya kartla ödenebildiği yazıyor; yani kart da
// geçiyor." ↑`narratesInternalSource` yalnız İŞARET + OLUMSUZLUĞU tutuyordu ("bilgim yok" ailesi). Asıl karar kıdemli okuyucunun
// (`semantic/absence-judge.ts`, anlamla; bir kez yeniden yazdırır); bu liste YEDEKTİR (okuyucu kapalı / düştü / kaçırdı) ve bilerek DAR:
// yalnız yapay zekânın kendi kaynağını adlandıran açık sözcükler. Çıplak "sistem / system / records / guide" YOK (mülk olgusu: "Isıtma
// sistemimiz…", "the guide we have in the drawer" — dairedeki basılı kılavuz iç kaynak değildir). Kalıplar başı sabit sözcükle başlar,
// tekrarlar kapalı — karesel iş yok.
const INTERNAL_SOURCE_NAMED: readonly RegExp[] = [
  new RegExp(
    `${L}(?:bilgi ?taban\\p{L}{0,8}|veri ?taban\\p{L}{0,8}|bilgi banka\\p{L}{0,6}|sistem sorgu\\p{L}{0,8}|` +
      // Opus 10-22: "Sistemde giriş saatiniz 15:00 görünüyor" (istemin kendi örneği), "Kayıtlarda … görünüyor", "Kayıtlı / Mevcut / hazırlanmış
      // bilgilere göre". Çıplak "sistemde" (iyeliksiz bulunma) mülk olgusu değildir ("ısıtma sistemimizde" / "sisteminde" ayrı biçim); "size
      // gönderilen bilgilere göre" misafirin kendi aldığı bilgidir → TR_GIVEN burada YOK.
      `sistemde(?:ki)?(?![\\p{L}])|kay[ıi]tlar(?:da|dan|a göre)(?:ki)?(?![\\p{L}])|` +
      `(?:kay[ıi]tl[ıi]|mevcut|eldeki|hazırlanm[ıi]ş) bilgi(?:ye|lere) göre(?![\\p{L}])|` +
      `kay[ıi]tlar[ıi]m(?:[ıi]z)?(?:da|dan|a göre|a bak\\p{L}{0,8})(?![\\p{L}])|notlar[ıi]m(?:[ıi]z)?(?:da|dan|a göre|a bak\\p{L}{0,8})(?![\\p{L}])|` +
      `bilgiler[ıi]m(?:[ıi]z)?(?:de|den|e göre)(?![\\p{L}])|verilerim(?:iz)?(?:de|den|e göre)(?![\\p{L}])|` +
      `elim(?:iz)?deki (?:bilgi|not|kay[ıi]t|veri|kaynak)\\p{L}{0,8}|` +
      `bana (?:${TR_GIVEN}|bildirilen|söylenen) (?:bilgi|not|kay[ıi]t|veri|talimat)\\p{L}{0,8}|` +
      // Haiku 10-22: yalnız "-da / -dan / -a göre" (kaynak bildirir) — "Bilgilendirme notları dolapta" (dairedeki kâğıt) yakalanmaz.
      // Opus 10-22: önünde yer sıfatı varsa ("mutfaktaki bilgilendirme notunda") dairedeki kâğıttır.
      `(?<![\\p{L}](?:da|de|ta|te)ki )bilgilendirme not(?:un|lar[ıi]n|lar[ıi]m(?:[ıi]z)?)(?:da|dan|a göre)(?![\\p{L}])|` +
      // Canlı ölçüm 10-22: "…bilgiler daire için hazırlanmış bilgilendirme notlarında yer alıyor". Aynı ek kuralı: "Ev sahibinizin notları
      // masada" yakalanmaz.
      // Yalnız ÇOĞUL ("notlarında"): tekil "Ev sahibinizin notunda …" bıraktığı kâğıt olabilir (Opus 10-22).
      `(?:ev sahibi(?:niz|nizin|nin)?|dairenin|daireye ait) (?:bilgilendirme )?notlar[ıi]n(?:da|dan|a göre)(?![\\p{L}])|` +
      // Canlı ölçüm 10-22 (anahtarlar kapalı): "…bilgiler daire için hazırlanmış yazılı bilgilendirmeden … alınmıştır". Yalnız "-den / -e göre"
      // (kaynak bildirir); dairedeki basılı kart ("yazılı bilgilendirme kartı masada") yakalanmaz.
      `yaz[ıi]l[ıi] bilgilendirme(?:den|lerden|ye göre|lere göre)(?![\\p{L}]))`,
    "u",
  ),
  new RegExp(
    `${L}(?:knowledge[ -]?base|database|system prompt|context window|training data|in (?:my|our) (?:records|system)(?![\\p{L}])|` +
      // "from our system" YOK — "… sent from our system" gönderim anlatır (Opus 10-22).
      "from (?:my|our) records(?![\\p{L}])|(?:the|our) system (?:shows|says|indicates|lists)(?![\\p{L}])|(?:i|we) can see (?:in|on) (?:the|our) system(?![\\p{L}])|" +
      // Opus 10-22: "As per our records", "Per my notes", "Based on the information provided".
      "(?:as )?per (?:my|our) (?:records|notes|files|data|information)(?![\\p{L}])|as per the (?:records|notes|information|data|system)(?![\\p{L}])|" +
      "based on (?:the |my |our )?(?:information|info|details|data|notes|records) (?:provided|given|available|i have|we have|on file)(?![\\p{L}])|" +
      // "my" (yapay zekânın kendisi) yeter; "our notes" dairedeki kâğıt olabilir ("in our notes on the fridge").
      "(?:in|from) my (?:notes|files|data)(?![\\p{L}])|" +
      "i(?:'ve| have)? (?:checked|looked at|looked through|went through|double-checked) (?:my|our) (?:notes|records|files|system|information|data)(?![\\p{L}])|" +
      "(?:my|our) (?:notes|records|files|information|info|data) (?:say|says|show|shows|indicate|indicates|mention|mentions|state|states|suggest|suggests)(?![\\p{L}])|" +
      // Haiku 10-22: ardından yer / nesne gelirse dairedeki kâğıt ya da etikettir ("according to the notes on the fridge", "the data plate").
      "according to (?:my|our|the) (?:notes|records|information|info|data|files|system)(?![\\p{L}])(?! (?:on|in|at|by|inside|near|next|plate|sheet|label|sticker|board|sign|card|poster|leaflet|booklet|binder|folder|book)(?![\\p{L}]))|" +
      "(?:the )?(?:information|info|details|notes|data) (?:i have|i've got|i was given|i've been given|i received|i've received|provided to me|given to me|we have on file)(?![\\p{L}])|" +
      // Canlı ölçüm 10-22: "I use the apartment's own written information and instructions that your host has provided". "notes / written"
      // YOK — "The notes your host has written are on the fridge" dairedeki kâğıttır (Haiku 10-22).
      // Ardından platform / uygulama / kitapçık gelirse misafiri oraya yönlendirir ("… your host has provided in the Airbnb app", Opus 10-22).
      "(?:information|details|instructions) (?:that )?(?:your|the) host (?:has )?(?:provided|shared|given|set up|prepared)(?![\\p{L}])" +
      "(?! (?:in|on|via|through) (?:the |your )?(?:airbnb|booking|app|platform|guidebook|guide|manual|welcome|house)(?![\\p{L}]))|" +
      // Misafirin KENDİ bilgisi ("We only use your details to send the access code" — kişisel veri cevabı) kaynak anlatımı değildir.
      "(?:i|we)(?:'m| am|'re| are)? (?:only )?(?:use|using|rely on|relying on|go by|going by|work from|working from|draw on|drawing on) " +
      // "We only use the personal data required for the police registration" kişisel veri cevabıdır (Opus 10-22).
      "(?:the |only |what )?(?!your |you )(?:[\\p{L}'’]{1,20} ){0,3}(?<!(?:personal|your|guest|guests['’]?) )(?:information|details|notes|data)(?![\\p{L}])" +
      "(?! (?:you|that you|which you)(?![\\p{L}])))",
    "u",
  ),
  // Haiku 10-22: yer bildiren ek gelirse dairedeki dosya / kâğıttır ("in unseren Unterlagen im Schrank", "Nos notes sont sur le frigo",
  // "Nuestras notas están en la nevera") — Fransızca / İspanyolca yalnız kaynak edatıyla ("selon / según …").
  // Opus 10-22: "Según nuestros datos", "Meinen Informationen zufolge", "По нашим данным", Arapçada bitişik ön ek ("لسجلاتنا").
  /(?<![\p{L}])(?:wissensdatenbank|wissensbasis|datenbank|(?:meinen|unseren) unterlagen(?! (?:im|in|auf|am|unter|neben)(?![\p{L}]))|(?:laut|nach|gemäß) (?:meinen|unseren) (?:notizen|unterlagen|daten|informationen|aufzeichnungen)|mir vorliegend\p{L}{0,3}|base de (?:données|connaissances)|(?:selon|d['’]après) (?:mes|nos) (?:notes|fiches|dossiers|registres|informations|données)(?![\p{L}])|informations dont (?:je|nous) dispos\p{L}{0,4}|base de datos|base de conocimientos?|(?:según|de acuerdo con) (?:mis|nuestras) notas|en mis notas|(?:según|de acuerdo con|en) (?:mis|nuestros) registros|(?:según|de acuerdo con) (?:mis|nuestros) datos|(?:meinen|unseren) (?:informationen|daten|unterlagen|notizen|aufzeichnungen) zufolge|баз\p{L}{0,3} данных|(?:наших|моих) (?:записях|заметках)|по (?:нашим|моим) (?:данным|записям)|قاعدة (?:ال)?بيانات|[لبو]?سجلات(?:نا|ي)|[لبو]?ملاحظات(?:نا|ي))/u,
];

/**
 * Cevap, bilgiyi NEREDEN bildiğini (bilgi tabanı / kayıt / not / veri tabanı / istem …) adıyla anlatıyor mu — olumlu ya da olumsuz. `true` ise
 * metin misafire gitmez (kanal `reply_internal_source`, QR aynı sebep); okuyucu açıksa bir kez yeniden yazdırılır. Saf, doğrusal.
 */
export function namesInternalSource(reply: string | null | undefined): boolean {
  const [plain, turkish] = foldedForms(reply);
  return INTERNAL_SOURCE_NAMED.some((re) => re.test(plain) || re.test(turkish));
}

/** Rapor/hata metninde gösterilecek insan-okur özet (uydurma liste basma). */
export const ABSENCE_CONTRACT_NOTE =
  "bilginin KAYITLARDA olmadığını açıkça söylemeli (savuşturma değil) — src/lib/ai/absence.ts";
