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
  "ulaşamadım|ulaşamıyorum|ulaşamadık|ulaşamıyoruz|bulamadık|bulamıyoruz|göremedik|göremiyoruz)";

// ── İngilizce: BİLGİ NESNESİ (tekil VE çoğul — ilk sürümde karışıktı) ──────
const EN_OBJ = "(?:information|info|records?|details?|data|notes?)(?![\\p{L}])";

const ABSENCE_PATTERNS: readonly RegExp[] = [
  new RegExp(`${TR_OBJ} ${gap(1)}${TR_TIGHT}`, "u"),
  new RegExp(`${TR_OBJ} ${gap(4)}${TR_LOOSE}`, "u"),
  /(?<![\p{L}])bilmiyorum(?![\p{L}])/u,
  new RegExp(`(?:don't|do not|doesn't|does not|didn't|did not) have ${gap(4)}${EN_OBJ}`, "u"),
  // 🚨 `${L}no ` — sağdaki BOŞLUK şart: "Nothing/Note/Nobody/Normally" artık eşleşmez.
  new RegExp(`${L}no ${gap(3)}${EN_OBJ}`, "u"),
  /(?:can't|cannot|can not|couldn't|could not) (?:find|locate|see)(?![\p{L}])/u,
  /(?:not able|unable) to (?:find|locate|see)(?![\p{L}])/u,
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
  // "No special / additional instructions for checkout" bir OLGUDUR (gerek yok) — o sıfatlar hariç.
  /(?<![\p{L}])no (?!(?:special|particular|additional|extra|further) )(?:\p{L}{1,20} )?instructions (?:for|on|about)(?![\p{L}])/u,
  // Kör set 5 (5.1, GİTTİ): "For the terrace jacuzzi, I don't have specific troubleshooting steps in my guide". Özne 1. şahıs ŞART:
  // "You don't have any steps to climb" bir erişilebilirlik olgusudur.
  /(?<![\p{L}])(?:i|we) (?:don't|do not) have (?:any )?(?:\p{L}{1,20} ){0,2}(?:instructions|steps|guidance)(?![\p{L}])/u,
  // Kör set 6 (10-01 öğleden sonra): "I didn't find any information about the speaker" — 1. şahıs + BULMA fiili + bilgi nesnesi ("You won't
  // find any fees", "If we don't see any issues…" eşleşmez: özne / nesne şartı).
  new RegExp(
    `(?<![\\p{L}])(?:i|we) (?:didn't|did not|don't|do not|couldn't|could not|can't|cannot|wasn't able to|was not able to) (?:find|locate|see) (?:any )?(?:\\p{L}{1,20} ){0,2}${EN_OBJ}`,
    "u",
  ),
];

// ── DİĞER DESTEKLENEN DİLLER + TÜRKÇE EK BİÇİMLER (10-01 gece ölçümü) ─────────
// Kurucu kuralı dilden bağımsızdır; yüklem yalnız TR/EN biliyordu ve canlı hat ölçümünde iki itiraf misafire GİTTİ
// ("…kuaför bilgisi elimde olmadığı için…", "…ne sont pas précisées ici."). AYNI dilbilgisi: BİLGİ NESNESİ + OLUMSUZLAMA
// sınırlı boşlukla; çıplak olumsuzluk ("Il n'y a pas de frais", "No se permiten mascotas", "Нет, курить нельзя",
// "لا يوجد رسوم") itiraf DEĞİLDİR — iki yönlü batarya `tests/unit/absence-multilingual.test.ts`.
const FR_OBJ = "(?:informations?|renseignements?|d[ée]tails?|pr[ée]cisions?|donn[ée]es)(?![\\p{L}])";
const DE_OBJ = "(?:informationen|information|angaben|details|daten|hinweise)(?![\\p{L}])";
/** `datos` YALNIZ sahiplik fiiliyle ("no hay datos móviles" bir olgudur). */
const ES_OBJ = "(?:informaci[óo]n|detalles?)(?![\\p{L}])";
const RU_OBJ = "(?:информаци\\p{L}{0,8}|данных|сведений)";
const AR_OBJ = "(?:معلومات|معلومة|تفاصيل|بيانات)";
/** Almanca bilgi nesnesi + talimat ("Anleitung / Anweisung") — yalnız 1. şahıs bulma / sahiplik kalıplarında (kör set 6). */
const DE_INFO = `(?:${DE_OBJ}|anleitung(?:en)?(?![\\p{L}])|anweisung(?:en)?(?![\\p{L}]))`;

const MORE_ABSENCE_PATTERNS: readonly RegExp[] = [
  // TR — nesne + "elimde değil / olmadığı", "bilgim olmadığı için", "bilgi bulunmadığından", "burada belirtilmemiş".
  new RegExp(`${TR_OBJ} ${gap(3)}elimde (?:değil|bulunmuyor|olmadığı\\p{L}{0,12}|olmadığından|mevcut değil)(?![\\p{L}])`, "u"),
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
];

/** Tek liste (her çağrıda yeniden kurulmasın). Yeni kalıplar KAPALI tekrar (`{0,n}`) kullanır — CLAUDE.md karesel iş kuralı. */
const ALL_ABSENCE_PATTERNS: readonly RegExp[] = [...ABSENCE_PATTERNS, ...MORE_ABSENCE_PATTERNS];

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
  const normalized = (reply ?? "").normalize("NFC").replace(/[’‘ʼ]/g, "'");
  const marked = normalized.replace(SENTENCE_END, `$1${SEP}$2`);
  const plain = foldTurkishLower(marked);
  const turkish = foldTurkishLowerTr(marked);
  return ALL_ABSENCE_PATTERNS.some((re) => re.test(plain) || re.test(turkish));
}

/** Rapor/hata metninde gösterilecek insan-okur özet (uydurma liste basma). */
export const ABSENCE_CONTRACT_NOTE =
  "bilginin KAYITLARDA olmadığını açıkça söylemeli (savuşturma değil) — src/lib/ai/absence.ts";
