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
// ⚠️ SAVUŞTURMA YOKLUK İTİRAFI DEĞİLDİR: "ev sahibinizle iletişime geçebilirsiniz"
// bilginin kayıtlarda olmadığını SÖYLEMEZ. Bu ayrım bilinçli — sözleşme yalnız
// AÇIK yokluk beyanını yakalar, kapıyı gereksiz yere geniş tutmaz.
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
    ALL_ABSENCE_PATTERNS.some((re) => re.test(plain) || re.test(turkish)) || narratesInternalSource(plain) || narratesInternalSource(turkish)
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
    `${L}(?:bilgi ?taban\\p{L}{0,8}|veri ?taban\\p{L}{0,8}|sistem sorgu\\p{L}{0,8}|` +
      `kay[ıi]tlar[ıi]m(?:[ıi]z)?(?:da|dan|a göre)(?![\\p{L}])|notlar[ıi]m(?:[ıi]z)?(?:da|dan|a göre)(?![\\p{L}])|` +
      `bilgiler[ıi]m(?:[ıi]z)?(?:de|den|e göre)(?![\\p{L}])|elimdeki (?:bilgi|not|kay[ıi]t|veri|kaynak)\\p{L}{0,8}|` +
      `bana ${TR_GIVEN} (?:bilgi|not|kay[ıi]t|veri|talimat)\\p{L}{0,8}|bilgilendirme not\\p{L}{0,8}|` +
      // Canlı ölçüm 10-22: "…bilgiler daire için hazırlanmış bilgilendirme notlarında yer alıyor".
      `(?:ev sahibi(?:niz|nizin|nin)?|dairenin|daireye ait) (?:bilgilendirme )?not(?:lar)?(?:ı|i|ın|in|ında|inde|da|de)\\p{L}{0,4}(?![\\p{L}])|` +
      // Canlı ölçüm 10-22 (anahtarlar kapalı): "…bilgiler daire için hazırlanmış yazılı bilgilendirmeden … alınmıştır". Yalnız "-den / -e göre"
      // (kaynak bildirir); dairedeki basılı kart ("yazılı bilgilendirme kartı masada") yakalanmaz.
      `yaz[ıi]l[ıi] bilgilendirme(?:den|lerden|ye göre|lere göre)(?![\\p{L}]))`,
    "u",
  ),
  new RegExp(
    `${L}(?:knowledge[ -]?base|database|system prompt|context window|(?:in|from) (?:my|our) (?:records|system)(?![\\p{L}])|` +
      "(?:my|our) (?:notes|records|files) (?:say|says|show|shows|indicate|indicates|mention|mentions|state|states)(?![\\p{L}])|" +
      "according to (?:my|our|the) (?:notes|records|information|info|data|files|system)(?![\\p{L}])|" +
      "(?:the )?(?:information|info|details|notes|data) (?:i have|i've got|i was given|i've been given|provided to me|given to me)(?![\\p{L}])|" +
      // Canlı ölçüm 10-22: "I use the apartment's own written information and instructions that your host has provided".
      "(?:information|details|instructions|notes) (?:that )?(?:your|the) host (?:has )?(?:provided|shared|given|set up|prepared|written)(?![\\p{L}])|" +
      "(?:i|we) (?:only )?(?:use|rely on|go by|work from|draw on) (?:the |only |what )?(?:[\\p{L}'’]{1,20} ){0,3}(?:information|details|notes|data)(?![\\p{L}]))",
    "u",
  ),
  /(?<![\p{L}])(?:wissensdatenbank|datenbank|(?:meinen|unseren) unterlagen|mir vorliegend\p{L}{0,3}|base de (?:données|connaissances)|(?:mes|nos) (?:notes|fiches|dossiers|registres)(?![\p{L}])|base de datos|(?:mis|nuestras) notas|(?:mis|nuestros) registros|баз\p{L}{0,3} данных|(?:наших|моих) (?:записях|заметках)|قاعدة (?:ال)?بيانات|سجلات(?:نا|ي)|ملاحظات(?:نا|ي))/u,
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
