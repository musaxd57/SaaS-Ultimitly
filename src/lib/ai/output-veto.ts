/* ---------------------------------------------------------------------------
 * ÇIKTI VETOSU — modelin cevabı GÖNDERİLMEDEN ÖNCE son deterministik denetim.
 *
 * 🚨 NEDEN VAR (Codex denetimi bulgu 1+5, 09-12; ölçüm
 * `docs/DENETIM-2026-09-12-codex-ai-raporu.md` §A): iki gönderim kapısı da
 * cevap METNİNE bakmıyordu. Tek istisna `admitsMissingKnowledge` idi. Yani
 * model "Wi-Fi şifresi [ŞİFRE] olarak görünüyor" ya da "Talebinizi ilettim"
 * dediğinde ürün bunu MİSAFİRE GÖNDERİYORDU — `hasUnsourcedSpecificClaim`
 * ise `QR_INFORMATIONAL_BAND_ENABLED` bloğunun içinde olduğu ve o bayrak
 * hiçbir üretim yolunda set edilmediği için ÜRETİMDE HİÇ KOŞMUYOR.
 *
 * 🚨 KAPSAM ÖLÇÜLEREK DARALTILDI — BURASI BU DOSYANIN EN ÖNEMLİ KISMI.
 *
 * Bağlamadan önce batarya koşuldu (77 meşru cevap + 45 gerçek iddia + 40
 * satırlık genişletilmiş tuzak). `tests/helpers/claim-detectors.ts`teki ölçüm
 * yüklemi BUGÜNKÜ HÂLİYLE KAPI OLAMAZ: 9 yanlış pozitif verdi ve genişletilmiş
 * tuzakta 20 satırın 19'u yanlış çıktı.
 *
 * KÖK NEDEN: Türkçe EDİLGEN ÇATI yüzeyde ayrışmıyor. Aynı kip iki bambaşka iş
 * yapıyor ve biçimleri BİREBİR AYNI:
 *
 *   MEŞRU (gitmeli)                          MAKBUZSUZ (gitmemeli)
 *   "Gürültü şikâyetleri … bildirilir."      "Giriş detayları size iletilir."
 *   "Fatura … e-posta ile gönderilir."       "Bilgi paylaşılacaktır."
 *   "Bina kuralları … bildirilmiştir."       "Konu … bildirilmiştir."
 *
 * Son çift DİLBİLGİSEL OLARAK AYNI ŞABLON. Bunlar oto-yanıtın VAR OLMA SEBEBİ
 * olan SSS cevapları; bloklanırsa kanalda mesaj hiç gitmez, QR'da misafir
 * cevap yerine devir metni alır. "Aşırı eşleşme bedava" DEĞİL.
 *
 * → BU YÜZDEN KAPIYA YALNIZ **ETKEN** DALLAR BAĞLANDI. Ölçülen sonuç:
 *   A (77 meşru cevap): **0 yanlış pozitif**
 *   B (45 gerçek iddia): 34 → 22 yakalama (kaybedilen 12'nin TAMAMI edilgen)
 * Yön güvenli: kaçan iddia bugünkü durumdan KÖTÜ DEĞİL (bugün hiç veto yok),
 * kazanılan şey hiçbir meşru cevabın bloklanmaması.
 *
 * 🚨 EDİLGEN DALLAR BURAYA EKLENMEZ. Ölçüm dosyasında (`claim-detectors.ts`)
 * KALIRLAR — orada rapor üretirler, burada veto etmezler. Eklemek için ya
 * konuşma bağlamı gerekir (bu modül SAF: DB yok, ağ yok) ya da `actionReceipt`
 * gerçekten uygulanır ve edilgen dal YALNIZ makbuz yokken vetolar.
 *
 * 🚨 "MUHATAP ÇAPASI" DENENDİ, ÖLÇÜLDÜ, REDDEDİLDİ (tekrar tasarlanmasın):
 * edilgen dalı "siz/size/2. çoğul iyelik" şartına bağlamak DİLBİLGİSEL OLARAK
 * KEYFÎ — iyelik eki ünsüzle biten gövdede `-ınız`, ünlüyle bitende `-nız`
 * olduğu için çapa rastgele tutuyor ("Faturanız … gönderilir" temiz ama
 * "Kargolarınız … gönderilir" hâlâ yanlış pozitif; "Konu apartman yönetimine
 * bildirilmiştir" GERÇEK iddiası kaçıyor). Aynı anlam sınıfının iki üyesi
 * yalnız gövdenin son harfi yüzünden farklı karar alıyor — kural değil kaza.
 *
 * ✅ İNGİLİZCE KAPANDI (kurucu kararı 09-12). Önceki sürümde kapsam SIFIRDI ve
 * "ayrı tur" diye yazılıydı; kurucu "kapatmadıklarını kapat" dedi ve aynı
 * disiplinle (ETKEN + AGENT çapası, çıplak `will` YOK) ölçülerek eklendi:
 * 24 meşru cevapta 0 yanlış pozitif, 12 gerçek iddiada 0 kaçırma.
 * ⚠️ İngilizcede de EDİLGEN dal YOK — "has been passed on" ile "is served at 8"
 * aynı belirsizliği taşır. Diğer diller (DE/FR/RU/AR) HÂLÂ kapsam dışı.
 *
 * ⚠️ BU MODÜL SAF: DB yok, ağ yok, LLM yok, `server-only` yok. Tek girdi metin.
 * ------------------------------------------------------------------------- */

import { kbPlaceholderTokens } from "@/lib/kb-placeholders";
import { ANY_DOUBLE_BRACE } from "@/lib/template-apply";

/** Kapalı küme — `RiskEvent.reason` ile aynı sözleşme (PII taşımaz). */
export type OutputVetoReason = "placeholder_in_reply" | "unverified_commitment";

/** Unicode-farkında kelime sınırı: JS `\b` yalnız ASCII bilir. */
const NL = "(?<!\\p{L})";
const NR = "(?!\\p{L})";

/**
 * ETKEN GEÇMİŞ EYLEM İDDİASI — "ilettim", "oluşturduk", "kontrol ettim".
 *
 * `claim-detectors.ts`teki `PAST_ACTION`ın YALNIZ BİRİNCİ alternatifi.
 * İkinci alternatif (edilgen: "iletildi", "bildirilmiştir") BİLEREK YOK ↑.
 */
const ACTIVE_PAST_CLAIM = new RegExp(
  `${NL}(?:ilett[iı]m|ilettik|oluşturdum|oluşturduk|kontrol ettim|kontrol ettik|ayarladım|ayarladık|bildirdim|bildirdik|not ettim|talep oluşturdum` +
    // 09-25 (mesaj anlama çekirdeği denetimi): aynı ETKEN 1. şahıs geçmiş sınıfının kaçan üyeleri — "Ev sahibinize haber
    // verdim", "Temizlikçiyi aradım", "Taksinizi rezerve ettim". Ölçüm: 1.287 model cevabında (cevap kıyası ×4 + konaklama
    // eval'i) yalnız 1 yeni veto ve o da gerçek iddia ("Ertelemeyi hallettim"); 2. şahıs / sıfat-fiil biçimleri
    // ("gönderdiğiniz", "paylaştığım gibi") kelime sınırı yüzünden eşleşmez.
    `|haber verdim|haber verdik|bilgi verdim|bilgi verdik|bilgilendirdim|bilgilendirdik|aradım|aradık|ulaştım|ulaştık` +
    `|rezerve ettim|rezerve ettik|rezervasyon yaptım|rezervasyon yaptık|ayırttım|ayırttık|yönlendirdim|yönlendirdik` +
    `|aktardım|aktardık|hallettim|hallettik|çağırdım|çağırdık|sipariş ettim|sipariş verdim` +
    // İnceleme (09-25): "Erken girişinizi onayladım", "Kaydınızı güncelledim", "Ev sahibiyle görüştüm", "mesaj attım",
    // resmî "bildirmiş bulunuyorum". "gönderdim/paylaştık" BİLEREK YOK: gerçekten giden önceki mesaja (otomatik giriş
    // talimatı) atıf yapar ("talimatları dün size gönderdik") — iddia değil, olgu.
    `|onayladım|onayladık|güncelledim|güncelledik|görüştüm|görüştük|mesaj attım|mesaj attık|kaydettim|kaydettik` +
    `|iletişime geçtim|iletişime geçtik|uzattım|uzattık|başlattım|başlattık` +
    // İkinci inceleme (09-25): "Ev sahibinize sordum", "Rezervasyonunuza baktım", "not aldım", "onay aldım", "iptal
    // ettim", "Rezervasyonunuza not ekledim". ("yazdım" YOK: "yukarıda yazdığım gibi" önceki mesaja atıftır.)
    `|sordum|sorduk|baktım|baktık|not aldım|not aldık|onay aldım|onay aldık|onay verdim|iptal ettim|iptal ettik|ekledim|ekledik` +
    `|takip ettim|takip ettik|e-?posta attım|mail attım|iade(?:nizi)?\\s+(?:yaptım|ettim)` +
    // Alıcısı ev sahibi/ekip olan "yazdım" ("Temizlik ekibine yazdım"); çıplak "yazdım" önceki mesaja atıftır.
    `|(?:sahib|ekib|görevli|temizlikçi|yönetici|teknisyen|tesisatçı)\\p{L}*\\s+(?:de\\s+)?yazdım` +
    `|(?:iletmiş|bildirmiş|aktarmış|yönlendirmiş|ulaştırmış) bulunuyor(?:um|uz))${NR}` +
    // Soru eki: "Size ulaştık mı?" iddia değil soru.
    `(?!\\s+m[iıuü](?!\\p{L}))` +
    // Şimdiki zaman: "Durumu ev sahibine iletiyorum / aktarıyorum / yönlendiriyorum" (eylem şu an yapılıyor iddiası).
    // İkinci inceleme: ardından iki nokta gelen biçim bir DUYURU kalıbıdır ("Sizi bilgilendiriyoruz: yarın su kesintisi var").
    `|${NL}(?:ileti|aktarı|yönlendiri|bildiri|haber veri|ulaştırı|bilgilendiri)yor(?:um|uz)${NR}(?![^.!?\\n]*:)` +
    // BEKLEME SÖZÜ (09-25), inceleme düzeltmesi: yalnız 1. TEKİL ("Takvimi kontrol ediyorum", "Hemen bakıyorum", "Kontrol
    // edip dönüyorum") — 1. çoğul ev sahibinin SÜREÇ anlatımıdır ("Her misafirden önce daireyi kontrol ediyoruz").
    // "teyit ediyorum" YOK: "Teyit ediyorum, giriş 15:00" bilinen bir olgunun onayıdır.
    // İkinci inceleme: "arıyorum / çağırıyorum / takip ediyorum / ilgileniyorum" da iddiadır; "her sabah / her misafirden
    // önce" gibi ALIŞKANLIK anlatımı değildir (yapay zekâ ev sahibinin sesiyle yazar: "Her misafirden önce daireyi
    // kontrol ediyorum").
    `|${NL}(?<!(?<!\\p{L})her\\s+(?:\\p{L}+\\s+){1,5})(?:danışı|kontrol edi|bakı|dönü|araştırı|arı|çağırı|takip edi|ilgileni)yorum${NR}` +
    // "soruyorum" yalnız EV SAHİBİNE soruluyorsa söz: "Emin olmak için soruyorum: …" misafire sorulan netleştirmedir.
    `|${NL}sahib\\p{L}*\\s+(?:\\p{L}+\\s+){0,3}?(?:soru|danışı)yor(?:um|uz)${NR}`,
  "iu",
);

/**
 * ETKEN GELECEK/GENİŞ ZAMAN TAAHHÜDÜ — "döneceğim", "ev sahibiniz iletecek",
 * "hallederiz".
 *
 * 🚨 LOOKAHEAD GENİŞLETİLDİ (ölçülmüş düzeltme ①, BEDELSİZ: A'da −2 yanlış
 * pozitif, genişletilmiş tuzakta −6, B'de **0 kayıp**). Eski fren
 * `(?!s?[iı]n[iı]z)` yalnız İKİ 2. şahıs biçimini kapatıyordu (`-ceğiniz`,
 * `-ceksiniz`); kapatmadığı ikisi:
 *   · `-cekseniz` / `-caksanız` — lookahead `s?` sonrası `[iı]` bekliyor, gelen
 *     `e`/`a` → fren geçiyordu ("Talebinizi yazılı olarak İLETECEKSENİZ…").
 *   · `-cek mi(siniz)` — soru parçacığı AYRI kelime, lookahead menzilinde değil
 *     ("Fotoğrafı GÖNDERECEK MİSİNİZ?" — ürünün yapması GEREKEN netleştirme).
 * Genişletilmiş bataryada bu sınıf 7/7 tetikliyordu; ikisi de MEŞRU cevap.
 */
const SECOND_PERSON = "(?!s?[iı]n[iı]z)(?!s[ae]n[iı]z)(?!l[ae]r[iı]n[iı]z)";
const QUESTION_PARTICLE = "(?!\\s+m[iıuü](?:y[iıuü]m|y[iıuü]z|s[iıuü]n(?:[iıuü]z)?|d[iıuü]r)?(?!\\p{L}))";
/** 09-12 gövdeleri (ölçülmüş: 77 meşru cevapta 0 yanlış pozitif) — kişi ayrımı yok. */
const OLD_FUTURE_STEMS =
  "dönüş yapaca|dönece|ilete?ce|paylaşaca|bilgilendirece|haber verece|gönderece|hallede?ce|değerlendirece|inceleyece|iletişime geçece|ayarlayaca|çağıraca|yazaca";
/**
 * 🚨 BEKLEME SÖZÜ gövdeleri (kurucu kararı 09-25). Bu fiiller ev sahibinin SÜREÇ anlatımında da geçer ("Girişte site
 * güvenliği adınızı soracak", "Temizlik ekibi daireyi kontrol edecek", "Sistem rezervasyonunuzu onaylayacaktır",
 * "çocukların ilgileneceği oyuncaklar") — inceleme ölçtü: ajansız eşleşme bu meşru cevapları tutuyor (kanal) ya da
 * devrediyordu (QR). Bu yüzden YALNIZ 1. şahıs ("soracağım / kontrol edeceğiz") ya da EV SAHİBİ öznesiyle ("ev sahibiniz
 * teyit edecek / size bildirecektir") söz sayılır.
 */
const PROMISE_FUTURE_STEMS =
  "soraca|danışaca|kontrol edece|teyit edece|netleştirece|bilgi verece|ilgilenece|onaylayaca|dönüş sağlayaca|bildirece|ulaşaca" +
  "|cevap verece|yanıt verece|yanıtlayaca|arayaca|bakaca|öğrenece|söyleyece|aktaraca|araştıraca|takip edece|görüşece|hallettirece";
/**
 * Ev sahibi öznesiyle SÖZ gövdeleri: "soracak" YOK (ikinci inceleme 09-25) — "Anahtar tesliminde ev sahibiniz kimliğinizi
 * soracak" bir SÜREÇ anlatımıdır, misafiri bekleten bir söz değil.
 */
const HOST_PROMISE_STEMS = PROMISE_FUTURE_STEMS.replace("soraca|", "");
/** Ev sahibi ÖZNE (yalın hâl): "ev sahibiniz …" — "ev sahibinize/-ne/-nden" (yönelme/ayrılma) özne değildir. */
const HOST_SUBJECT_TR = "(?:(?:ev|mülk|daire)\\s+sahib(?:i|iniz|imiz))";
/**
 * Ekip/görevli ÖZNE (ikinci inceleme 09-25): "Ekibimiz size bilgi verecek", "Yetkilimiz sizi arayacak". Yalnız GERİ DÖNÜŞ /
 * ONAY fiilleriyle söz sayılır — "Görevlimiz bagajlarınızla ilgilenecek" bir HİZMET anlatımıdır (pinli).
 */
const STAFF_SUBJECT_TR = "(?:ekib(?:imiz|iniz)|ekip(?:imiz)?|yetkilimiz|görevlimiz|yöneticimiz|yönetimimiz)";
const STAFF_PROMISE_STEMS =
  "teyit edece|netleştirece|bilgi verece|onaylayaca|dönüş sağlayaca|bildirece|ulaşaca|cevap verece|yanıt verece|yanıtlayaca|arayaca";
const ACTIVE_FUTURE_CLAIM = new RegExp(
  // İkinci inceleme: sıfat-fiil ("göndereceğimiz mesajda", "yazacağı mesajda") ve kalıp ("Sorunuza dönecek olursak")
  // söz değildir.
  `${NL}(?:${OLD_FUTURE_STEMS})[ğgk]${SECOND_PERSON}${QUESTION_PARTICLE}(?!(?:[iı]|[iı]m[iı]z)\\s+\\p{L})(?!\\s+olur(?:sak|sanız))\\p{L}*` +
    // 1. şahıs gelecek: "soracağım", "kontrol edeceğiz", "size bildireceğim" (sıfat-fiil "soracağımız bir şey" DEĞİL).
    `|${NL}(?:${PROMISE_FUTURE_STEMS})[ğg][iı][mz]${NR}${QUESTION_PARTICLE}` +
    // Ev sahibi öznesiyle 3. şahıs: "Müsaitliği ev sahibiniz teyit edecek", "ev sahibiniz size bildirecektir".
    `|${NL}${HOST_SUBJECT_TR}${NR}[^.!?;:\\n]{0,80}?\\s(?:${HOST_PROMISE_STEMS})k(?:t[iı]r)?${NR}${QUESTION_PARTICLE}` +
    `|${NL}${STAFF_SUBJECT_TR}${NR}[^.!?;:\\n]{0,80}?\\s(?:${STAFF_PROMISE_STEMS})k(?:t[iı]r)?${NR}${QUESTION_PARTICLE}` +
    `|${NL}(?:${HOST_SUBJECT_TR}|${STAFF_SUBJECT_TR})${NR}[^.!?;:\\n]{0,80}?\\s(?:bilgi verir|haber verir|size döner|dönüş yapar|dönüş sağlar|size yazar|size ulaşır|sizi arar|sizinle iletişime geçer)${NR}` +
    // İkinci inceleme: ev sahibinin KARARINI bildiren geçmiş ("Ev sahibiniz erken girişinizi onayladı") — makbuzsuz izin iddiası.
    `|${NL}(?:${HOST_SUBJECT_TR}|${STAFF_SUBJECT_TR})${NR}[^.!?;:\\n]{0,80}?\\s(?:onayladı|kabul etti|izin verdi|teyit etti|ayarladı|iptal etti)${NR}` +
    `|${NL}(?:ileti|döne|hallede|haber veri|dönüş yapa|bilgilendiri|paylaşı|gönderi|bildiri|aktarı)r(?:[iı]m|[iı]z)${NR}` +
    // 1. TEKİL geniş zaman (09-25): "Bunu ev sahibinize sorarım", "Öğrenip size yazarım", "dönüş sağlarım". 1. çoğul YOK:
    // "Girişte kimliğinizi sorarız" ev sahibinin alışkanlık/süreç anlatımıdır.
    // "Ben olsam … bakarım" bir TAVSİYEDİR (ikinci inceleme 09-25).
    `|${NL}(?<!(?<!\\p{L})olsam[^.!?\\n]{0,60})(?:sora|danışı|yaza|baka|söyle|öğreni|dönüş sağla|kontrol ede|teyit ede|bilgi veri)r[iı]m${NR}(?!\\s+diye)` +
    // İkinci inceleme (09-25): 1. TEKİL İSTEK KİPİ = "izin verin ben yapayım" sözü — "Hemen ev sahibinize sorayım",
    // "Kontrol edeyim", "Bir bakayım", "İleteyim". Misafire sorulan netleştirme ("Size bir şey sorayım: …?") DEĞİL.
    `|${NL}(?:sor|danış|kontrol\\s+ed|bak|öğren|araştır|ilet|haber\\s+ver|bilgi\\s+ver|bildir|ara|teyit\\s+ed|onayla|gönder|ayarla|halled|takip\\s+ed|not\\s+al|ilgilen)(?:[ey]?eyim|[ay]?ayım)${NR}(?![^.!?\\n]*[:?])`,
  "iu",
);

/* ---------------------------------------------------------------------------
 * İNGİLİZCE — kurucu kararı 09-12 ("kapatmadıklarını kapat; 'The team will get
 * back to you shortly' böyle yazma şansı var dimi").
 *
 * 🚨 AYNI DİSİPLİN: yalnız ETKEN + AGENT'A ÇAPALI. İngilizcede de edilgen çatı
 * ("Your message has been passed on" ↔ "Breakfast is served at 8") aynı
 * belirsizliği taşır → EDİLGEN DAL YOK.
 *
 * 🚨 ÇIPLAK `will` KULLANILMAZ — ölçüldü, sınıfı KATLEDERDİ: "Check-in **will
 * be** at 15:00", "The pool **will be** open from 09:00", "You **will find**
 * the towels…" hepsi meşru OLGU cümlesi. Bu yüzden kalıp
 * AGENT (I/we/our team/the team/your host) + EYLEM FİİLİ ikilisine çapalı;
 * "will" tek başına hiçbir şey söylemez.
 *
 * ÖLÇÜM (bağlamadan önce, iki batarya):
 *   A (24 meşru cevap: olgu · kural · netleştirme · nezaket · misafirin KENDİ
 *      eylemi · olasılık kipi · "team/host" İSİM tuzağı) → **0 yanlış pozitif**
 *   B (12 gerçek iddia, kurucunun adıyla andığı cümle dâhil) → **0 kaçırma**
 * ------------------------------------------------------------------------- */
const EN_PAST_CLAIM = new RegExp(
  // "As I noted / mentioned earlier" önceki mesaja ATIFTIR (ikinci inceleme 09-25).
  `${NL}(?<!(?<!\\p{L})as\\s)i(?:'ve| have)?\\s+(?:just\\s+)?(?:forwarded|passed\\s+(?:this|it|that|your\\s+\\p{L}+)\\s+on|passed\\s+on|created|checked|noted|informed|alerted|flagged|contacted|arranged|logged|asked\\s+our\\s+team|raised)${NR}` +
    // İkinci inceleme: "I've asked / told the host", "I've confirmed with the owner", "I've updated your booking".
    `|${NL}(?<!(?<!\\p{L})as\\s)i(?:'ve| have)?\\s+(?:just\\s+|already\\s+)?(?:(?:asked|told)\\s+(?:the|your|our)\\s+(?:host|owner|team|cleaner|manager)|confirmed\\s+with\\s+(?:the|your|our)|updated\\s+(?:your|the)\\s+(?:booking|reservation|calendar|dates)` +
    `|confirmed\\s+(?:your|the)\\s+(?:early|late|booking|reservation|check|extension)|passed\\s+(?:this|it|that|your\\s+\\p{L}+)\\s+along)${NR}` +
    // İkinci inceleme: ev sahibinin KARARINI bildiren geçmiş ("Your host has approved the late checkout") — makbuzsuz izin.
    `|${NL}(?:your|the)\\s+(?:host|owner)\\s+(?:has\\s+|have\\s+)?(?:approved|confirmed|accepted|agreed\\s+to|granted)${NR}` +
    `|${NL}i\\s+have\\s+(?:forwarded|created|checked|noted|informed|alerted|flagged|contacted|arranged|logged|raised)${NR}` +
    // 09-25: kaçan eylem fiilleri ve "we" ajanı ("I have booked a taxi", "I've let the host know", "We've notified the
    // cleaning team"). Aynı ölçüm: 1.287 model cevabında İngilizce yeni veto 0. Bilinen bedel (pinli): "We have booked this
    // flat for you…" gibi rezervasyonun kendisini anlatan cümle de tutulur — taslak ev sahibine gider (güvenli yön).
    // İnceleme (09-25): "we" yalnız İLETİŞİM fiillerinde ajan — "We have reserved a parking spot for every apartment",
    // "We called it the blue room", "the instructions we sent" ev sahibinin OLGU cümleleri; "sent" hiç yok (gerçekten
    // giden önceki mesaja atıf). Rezervasyon/sipariş fiilleri yalnız "I" ile.
    // Önceki mesaja atıf yapan sıfat cümleciği ("The check-in instructions we emailed on Monday …") iddia değil.
    `|${NL}(?<!(?:instructions|details|message|messages|email|link|code|info|information|guide|directions)\\s)(?:i|we)(?:'ve| have)?\\s+(?:just\\s+|already\\s+|also\\s+)?(?:forwarded|notified|messaged|emailed|texted|contacted|informed|reported|escalated` +
    `|passed\\s+(?:this|it|that|your\\s+\\p{L}+)\\s+(?:on\\s+)?to|let\\s+(?:the|your|our)\\s+(?:host|team|cleaner|cleaning\\s+team)\\s+know` +
    // "I've sent a message to your host", "I've reached out to the cleaner" (yalnız ALICI ev sahibi/ekip iken; "the
    // instructions we sent" gibi misafire giden önceki mesaj atfı değil).
    `|sent\\s+(?:a\\s+)?(?:message|note|request)\\s+to\\s+(?:the|your|our)\\s+(?:host|team|cleaner|cleaning\\s+team)|reached\\s+out)${NR}` +
    `|${NL}i(?:'ve| have)?\\s+(?:just\\s+|already\\s+|also\\s+)?(?:booked|reserved|called|phoned|ordered|scheduled|requested|forwarded` +
    // "I've sent someone to fix the shower" — kişi gönderme iddiası ("sent you the code" önceki mesaja atıf, YOK).
    `|sent\\s+(?:someone|somebody|(?:a|the|our)\\s+(?:technician|plumber|cleaner|electrician|handyman|repairman|maintenance\\s+\\p{L}+)))${NR}` +
    `|${NL}consider\\s+it\\s+done${NR}` +
    // Şimdiki zaman: "I'm forwarding this to the host".
    `|${NL}(?:i'm|i\\s+am|we're|we\\s+are)\\s+(?:forwarding|passing\\s+(?:this|it|that|your\\s+\\p{L}+)\\s+on|notifying|contacting|informing(?!\\s+(?:all\\s+guests|everyone|you\\s+that))|letting\\s+(?:the|your|our)\\s+\\p{L}+\\s+know|looking\\s+into|arranging)${NR}` +
    // "Let me forward this / ask the host / check with the host / Let me check." (bekleme sözü — kurucu kararı 09-25,
    // ↓gelecek dalı). 🚨 Aynı cümlede misafire sorulan NETLEŞTİRME söz değildir (inceleme 09-25): "Let me check if I
    // understood correctly: …?", "Let me double-check: is it two adults?" — iki nokta / "if I understood" dalı yok.
    // İkinci inceleme: aynı cümlede iki nokta / soru işareti gelen biçim misafire sorulan NETLEŞTİRMEDİR ("Let me
    // double-check this: two adults and one child, right?"); "let me confirm / see if / get back / take a look / ask them".
    `|${NL}let\\s+me(?![^.!?\\n]*[:?])\\s+(?:just\\s+|quickly\\s+)?(?:forward|pass\\s+(?:this|it|that)\\s+on|ask\\s+(?:the|your|our)|ask\\s+them|find\\s+out|look\\s+into|reach\\s+out` +
    `|see\\s+what\\s+i\\s+can\\s+(?:do|find)|see\\s+if|confirm|get\\s+back|take\\s+a\\s+look` +
    `|(?:double[-\\s]?)?check(?:\\s+(?:with|on\\s+(?:this|that|it)|and|for\\s+you|this|it|that(?!\\s+i\\s)|(?:the|your|our)\\s+\\p{L}+|availability)|(?=\\s*(?:[.!]|$))))${NR}`,
  "iu",
);
/**
 * İNGİLİZCE BEKLEME SÖZÜ / GELECEK TAAHHÜDÜ — ajan + eylem (çıplak `will` YOK, ↑).
 *  · 1. tekil (I'll / I will / I shall / I'm going to / allow me to): yapay zekâ hiçbir şeyi sonra yapamaz → iletişim ve
 *    kontrol fiillerinin HEPSİ söz ("I'll check.", "I'll look into it", "I'll ask them").
 *  · we / ev sahibi / ekip / they / someone: yalnız GERİ DÖNÜŞ ve KARAR fiilleri ("get back", "let you know", "review your
 *    request", "check with/whether"). 🚨 Süreç anlatımı söz DEĞİL (inceleme 09-25 ölçtü): "We will verify your ID at
 *    check-in", "The host will check for damages after checkout", "Someone will verify your booking at the gate".
 *  · "… and get back to you / let you know / confirm" aynı cümlecikte her ajanla söz ("I'll check the router and get back").
 *  · "You'll hear (back) from …".
 */
const EN_COMMON_PROMISE =
  "get\\s+(?:right\\s+)?back|follow\\s+up|reach\\s+out|be\\s+in\\s+touch|get\\s+in\\s+touch|contact|let\\s+you\\s+know" +
  // İkinci inceleme: "reply in English from now on" bir dil değişikliği bildirimidir, söz değil.
  "|keep\\s+you\\s+(?:posted|updated|informed)|update\\s+you|inform\\s+you|revert|reply(?!\\s+in\\s+\\p{L}+)|respond(?!\\s+in\\s+\\p{L}+)" +
  "|confirm(?!\\s+(?:your|the)\\s+(?:id|identity|passport|booking|reservation|name))|look\\s+into|find\\s+out|double[-\\s]?check" +
  // İkinci inceleme: "I'll let the host know", "pass this along", "take care of it", "we'll make sure".
  "|let\\s+(?:the|your|our)\\s+(?:host|owner|team|cleaner|manager)\\s+know|pass\\s+(?:this|it|that|your\\s+\\p{L}+)\\s+along" +
  "|take\\s+care\\s+of\\s+(?:it|this|that)|make\\s+sure" +
  "|check\\s+(?:with|on\\s+(?:this|that|it)|this|that|it|the\\s+(?:calendar|availability)|availability|whether|if)" +
  "|ask\\s+(?:the|your|our)\\s+(?:host|owner|team|cleaner|cleaning\\s+team|housekeeping|staff|concierge|property\\s+manager|manager)|ask\\s+them|forward|notify" +
  "|pass\\s+(?:this|it|that|your\\s+\\p{L}+)\\s+on|message\\s+(?:the|your)\\s+host|have\\s+(?:the|your)\\s+host|arrange" +
  "|sort\\s+(?:this|it)|handle\\s+(?:this|it|your)|send\\s+someone|get\\s+an?\\s+answer|review\\s+(?:your|the)\\s+request" +
  "|get\\s+(?:it|this|that)\\s+(?:fixed|sorted|done|resolved|repaired)";
/** Yalnız 1. tekille söz: çıplak "check." ve kontrol fiilleri (ajan ev sahibiyse süreç anlatımı olabilir). */
const EN_FIRST_ONLY_PROMISE =
  "check(?=\\s*(?:[.!]|$)|\\s+for\\s+you)|look(?=\\s*(?:[.!]|$))|verify(?!\\s+your\\s+(?:id|identity|passport))|investigate" +
  "|see\\s+what\\s+i\\s+can\\s+(?:do|find)" +
  "|check\\s+(?:the|your|our)\\s+\\p{L}+" +
  // İkinci inceleme: "I'll escalate this", "I'll call the host", "I'll book a taxi", "I'll send the plumber over".
  "|escalate|call\\s+(?:the|your|our)\\s+(?:host|owner|cleaner|plumber|technician)|book\\s+(?:a|the|you\\s+a)\\s+\\p{L}+" +
  "|send\\s+(?:the|a|our)\\s+(?:plumber|technician|cleaner|electrician|someone)";
const EN_I = "(?:i(?:'ll|\\s+will|\\s+shall)|i(?:'m|\\s+am)\\s+going\\s+to|allow\\s+me\\s+to)";
const EN_OTHER_AGENT =
  "(?:we(?:'ll|\\s+will)|we(?:'re|\\s+are)\\s+going\\s+to|(?:your|the|our)\\s+(?:host|owner|team)\\s+is\\s+going\\s+to" +
  // İkinci inceleme: "Our cleaning team will …", "Your host, Maria, will …", "Your host should get back …".
  "|(?:(?:your|the|our)\\s+(?:\\p{L}+\\s+){0,2}(?:host|owner|property\\s+manager|manager|team|staff|concierge|cleaner)(?:,\\s*[\\p{L}' -]{1,30},)?|they|someone)(?:'ll|\\s+will|\\s+should))";
const EN_ADVERB = "(?:just\\s+|quickly\\s+|also\\s+|now\\s+|personally\\s+|shortly\\s+|soon\\s+)?";
const EN_FUTURE_CLAIM = new RegExp(
  // Ardından iki nokta gelen 1. şahıs biçim bir DUYURUDUR ("I'll respond to each of your questions below: …").
  `${NL}${EN_I}(?![^.!?\\n]*:)\\s+${EN_ADVERB}(?:${EN_COMMON_PROMISE}|${EN_FIRST_ONLY_PROMISE})${NR}` +
    // İkinci inceleme: "I can ask the host", "I'd be happy to check with the owner" — yapılamayacak eylemin teklifi.
    `|${NL}(?:i\\s+can|i'?d\\s+be\\s+(?:happy|glad)\\s+to|i'?d\\s+love\\s+to)\\s+${EN_ADVERB}(?:ask\\s+(?:the|your|our)\\s+(?:host|owner|team|cleaner|manager)|ask\\s+them|check\\s+with|forward|pass\\s+(?:this|it|that|your\\s+\\p{L}+)\\s+(?:on|along)|contact\\s+(?:the|your)\\s+(?:host|owner)|notify|message\\s+(?:the|your)\\s+host|let\\s+(?:the|your|our)\\s+(?:host|owner|team|cleaner)\\s+know|reach\\s+out|find\\s+out|look\\s+into)${NR}` +
    `|${NL}${EN_OTHER_AGENT}\\s+${EN_ADVERB}(?:${EN_COMMON_PROMISE})${NR}` +
    // Aynı cümlecikte "… and get back to you / let you know / confirm" (her ajanla).
    `|${NL}(?:${EN_I}|${EN_OTHER_AGENT})\\s+(?:[\\p{L}'-]+[\\s,]+){0,8}?and\\s+(?:get\\s+back|let\\s+you\\s+know|confirm(?!\\s+(?:your|the)\\s+(?:id|identity|passport|booking|reservation|name))|be\\s+in\\s+touch` +
    `|reply|respond|update\\s+you|inform\\s+you|keep\\s+you\\s+(?:posted|updated))${NR}` +
    // "you'll hear from building security" bir UYARIDIR; söz yalnız bizden / ev sahibinden duyacağıdır.
    `|${NL}you(?:'ll|\\s+will)\\s+hear\\s+(?:back|(?:back\\s+)?from\\s+(?:us|me|the\\s+host|your\\s+host|the\\s+team|our\\s+team)|soon|shortly)${NR}` +
    `|${NL}you(?:'ll|\\s+will)\\s+(?:receive|get)\\s+(?:a\\s+)?(?:reply|response|answer|message)\\s+from\\s+(?:the|your)\\s+(?:host|owner|team)${NR}`,
  "iu",
);

/**
 * DE/FR/ES/RU/AR — 09-25 (inceleme: dil kapısı artık misafire kendi dilinde cevap verdiriyor; bu dillerde veto hiç
 * yoktu). Yalnız 1. şahıs geçmiş + İLETİŞİM/REZERVASYON fiili (etken, ajan çapalı; edilgen ve gelecek YOK).
 */
const OTHER_PAST_CLAIM = new RegExp(
  // Tekil 1. şahıs: iletişim + rezervasyon fiilleri; ÇOĞUL yalnız iletişim fiilleri ("wir haben für jede Wohnung einen
  // Parkplatz reserviert" ev sahibi olgusudur — İngilizce "we reserved" ile aynı gerekçe).
  `${NL}ich\\s+habe\\s+(?:\\p{L}+\\s+){0,6}(?:weitergeleitet|informiert|benachrichtigt|kontaktiert|gebucht|reserviert|angerufen|bestellt|geschickt|nachgefragt|geprüft|gefragt)${NR}` +
    `|${NL}wir\\s+haben\\s+(?:\\p{L}+\\s+){0,6}(?:weitergeleitet|informiert|benachrichtigt|kontaktiert)${NR}` +
    `|${NL}j'ai\\s+(?:\\p{L}+\\s+){0,2}(?:transmis|informé|prévenu|contacté|réservé|appelé|commandé|envoyé\\s+un\\s+message|demandé)${NR}` +
    `|${NL}nous\\s+avons\\s+(?:\\p{L}+\\s+){0,2}(?:transmis|informé|prévenu|contacté)${NR}` +
    `|${NL}je\\s+(?:l['’]|lui\\s+|leur\\s+)ai\\s+(?:\\p{L}+\\s+){0,2}(?:transmis|informé|prévenu|contacté)${NR}` +
    // "Le he enviado las instrucciones" gerçekten giden mesaja atıftır (İngilizce "sent" gibi) — ikinci inceleme 09-25.
    `|${NL}he\\s+(?:\\p{L}+\\s+){0,1}(?:reenviado|informado|avisado|contactado|reservado|llamado|notificado|preguntado|consultado|hablado|trasladado)${NR}` +
    `|${NL}hemos\\s+(?:\\p{L}+\\s+){0,1}(?:reenviado|informado|avisado|contactado|notificado)${NR}` +
    `|${NL}(?:he|hemos)\\s+(?:\\p{L}+\\s+){0,1}enviado\\s+(?:[\\p{L}]+\\s+){0,4}?(?:al|a\\s+(?:su|la|el|nuestro|nuestra))\\s+(?:anfitri[óo]na?|propietari[oa]|equipo|personal|limpiador[a]?)${NR}` +
    `|${NL}я\\s+(?:уже\\s+|только\\s+что\\s+)?(?:передал|передала|сообщил|сообщила|связался|связалась|забронировал|забронировала|уведомил|уведомила|позвонил|позвонила|написал|написала|спросил|спросила|уточнил|уточнила)${NR}` +
    `|${NL}мы\\s+(?:уже\\s+)?(?:передали|сообщили|уведомили|связались)${NR}` +
    // Özne düşmüş cümle başı: "Передал хозяину вашу просьбу." (ikinci inceleme 09-25)
    `|(?:^|[.!?]\\s+)(?:уже\\s+)?(?:передал|передала|сообщил|сообщила|уведомил|уведомила|связался|связалась)${NR}` +
    // Arapça kelime sınırı (ikinci inceleme 09-25): "إذا حجزتم" (rezervasyon yaptıysanız), "كما أخبرتكم" (size söylediğim
    // gibi) bizim iddiamız değil.
    `|(?:لقد\\s+)?(?:أبلغت|أخبرت|حجزت|تواصلت|اتصلت|سألت|راسلت|أبلغنا|أخبرنا|أرسلت\\s+(?:رسالتك|طلبك))(?![\\u0621-\\u064A])` +
    `|قمت\\s+ب(?:إبلاغ|إخبار|التواصل|حجز)`,
  "iu",
);

/**
 * DE/FR/ES/RU/AR BEKLEME SÖZÜ (kurucu kararı 09-25) — 1. şahıs GELECEK iletişim/kontrol sözü. Şimdiki zaman olgu cümleleri
 * ("Je vous confirme que l'arrivée est à 15h", "Le confirmo que…") BİLEREK yok; yalnız gelecek kip / "werde/vais/voy a".
 */
const OTHER_FUTURE_CLAIM = new RegExp(
  // DE: 1. şahıs (düz ve DEVRİK dizim: "Dann melde ich mich", "Gerne frage ich beim Gastgeber nach"), "Bescheid geben",
  // "weiterleiten", "wir melden uns", ev sahibi öznesiyle "wird sich melden". Netleştirme ("Ich frage nur nach: …?") DEĞİL.
  `${NL}ich\\s+(?:melde\\s+mich|frage\\s+(?:\\p{L}+\\s+){0,3}nach(?![^.!?\\n]*[:?])|kläre\\s+das|prüfe\\s+(?:das|es|dies)` +
    // İkinci inceleme: "Ich kümmere mich darum", "Ich frage den Gastgeber", "Ich halte Sie auf dem Laufenden".
    `|kümmere\\s+mich|frage\\s+(?:den|die|ihren|ihre|unseren|unsere)\\s+(?:gastgeber|vermieter)\\p{L}*|halte\\s+sie\\s+auf\\s+dem\\s+laufenden` +
    `|informiere\\s+(?:den|die|ihren|ihre)\\s+(?:gastgeber|vermieter)\\p{L}*|erkundige\\s+mich|schaue\\s+(?:gleich\\s+|kurz\\s+|gerne\\s+)?nach(?![^.!?\\n]*[:?])` +
    `|gebe\\s+(?:ihnen|dir|euch)\\s+(?:gerne\\s+)?bescheid|leite\\s+(?:\\p{L}+\\s+){0,4}weiter` +
    `|werde\\s+(?:\\p{L}+\\s+){0,4}(?:fragen|nachfragen|melden|prüfen|klären|bestätigen|informieren|weiterleiten|kontaktieren|bescheid\\s+geben|kümmern|benachrichtigen))${NR}` +
    `|${NL}(?:melde|frage|kläre|prüfe|gebe|leite)\\s+ich\\s+(?:\\p{L}+\\s+){0,4}?(?:mich|nach|bescheid|weiter|das)${NR}(?![^.!?\\n]*[:?])` +
    `|${NL}(?:und\\s+melde\\s+mich|kümmere\\s+ich\\s+mich|(?:wir|und)\\s+melden\\s+uns|wir\\s+kümmern\\s+uns|wir\\s+geben\\s+(?:ihnen\\s+)?(?:gerne\\s+)?bescheid` +
    `|wir\\s+werden\\s+(?:\\p{L}+\\s+){0,4}(?:melden|informieren|prüfen|klären|fragen|bestätigen|kümmern)` +
    // Ev sahibi öznesi (kadın biçimi dahil; model "Ihre Gastgeberin" yazıyor); şimdiki zaman gelecek anlamında ("meldet sich").
    `|(?:ihr|der|die|ihre)\\s+(?:gastgeber|vermieter)(?:in)?\\s+(?:wird\\s+(?:\\p{L}+\\s+){0,4}(?:melden|bestätigen|informieren|kontaktieren|antworten)|meldet\\s+sich))${NR}` +
    // FR: "je vais vous demander DE …" misafire bir TALİMATtır (anahtarı kutuya bırakın) — söz değil.
    // İkinci inceleme: aynı cümlede iki nokta / soru işareti gelen biçim NETLEŞTİRMEDİR ("Je vais juste confirmer avec
    // vous : c'est bien pour deux adultes ?"); "Je reviens vers vous concernant votre question : oui…" bir cevaptır.
    `|${NL}je\\s+(?:vais\\s+(?!vous\\s+demander)(?![^.!?\\n]*[:?])(?:\\p{L}+\\s+){0,2}(?:demander(?!\\s+d[e'’])|vérifier|confirmer|transmettre|contacter|informer|revenir\\s+vers|voir\\s+avec|me\\s+renseigner|en\\s+parler)` +
    `|reviens\\s+vers\\s+vous(?![^.!?\\n]*:)|vous\\s+recontacte|vous\\s+tiens\\s+(?:au\\s+courant|informée?s?)|me\\s+renseigne|m['’]en\\s+occupe` +
    `|(?:la|le|les|lui)\\s+transmets|vous\\s+fais\\s+un\\s+retour|vous\\s+préviens\\s+dès` +
    `|demanderai|vérifierai|transmettrai|reviendrai|contacterai|vous\\s+confirmerai|vous\\s+recontacterai|vous\\s+tiendrai|vous\\s+informerai|vous\\s+préviendrai)${NR}` +
    `|${NL}nous\\s+(?:allons\\s+(?:\\p{L}+\\s+){0,2}(?:demander(?!\\s+d[e'’])|vérifier|confirmer|transmettre|contacter|informer|revenir\\s+vers|voir\\s+avec)` +
    `|reviendrons\\s+vers\\s+vous|vous\\s+tiendrons|vous\\s+recontacterons|vous\\s+contacterons)${NR}` +
    `|${NL}on\\s+(?:revient|reviendra)\\s+vers\\s+vous(?![^.!?\\n]*:)|${NL}on\\s+vous\\s+(?:tient|tiendra)\\s+au\\s+courant${NR}` +
    `|${NL}(?:(?:votre|l['’])\\s*h[ôo]te(?:sse)?|le\\s+propriétaire|votre\\s+propriétaire)\\s+(?:va\\s+vous\\s+(?:contacter|répondre|écrire|informer|recontacter|confirmer)|(?:\\p{L}+\\s+){0,3}(?:contactera|confirmera|répondra|reviendra|informera|vous\\s+tiendra))${NR}` +
    // ES
    // İkinci inceleme: "le escribiré en español" bir dil değişikliği bildirimidir; "se lo confirmaré", "le mantendré informado".
    `|${NL}(?:(?:le|te|les)\\s+(?:confirmaré|avisaré|informaré|escribiré(?!\\s+en\\s+\\p{L}+)|contactaré)|se\\s+lo\\s+(?:confirmaré|diré|comunicaré)` +
    `|(?:le|la|lo|los|las)\\s+mantendré\\s+informad[oa]s?|consultaré|preguntaré|verificaré|comprobaré|averiguaré` +
    `|(?:le|les)\\s+(?:avisaremos|confirmaremos|informaremos|escribiremos|contactaremos)|déjeme\\s+(?:consultar|preguntar|verificar|comprobar|revisar)\\p{L}*` +
    `|(?:el|su)\\s+anfitri[óo]n\\s+(?:le|les)\\s+(?:contactará|responderá|escribirá|avisará|confirmará)` +
    `|revisaré|hablaré|me\\s+pondré\\s+en\\s+contacto|nos\\s+pondremos\\s+en\\s+contacto|se\\s+pondrá\\s+en\\s+contacto` +
    `|(?:lo|la)\\s+(?:reviso|consulto|verifico|compruebo|pregunto)|y\\s+(?:le|les)\\s+(?:digo|decimos|aviso|avisamos|confirmo|confirmamos)` +
    `|vamos\\s+a\\s+(?:consultar|preguntar|verificar|comprobar|confirmar|revisar|averiguar|avisar|contactar)(?:le|lo|la|les|los|las|se)?(?![^.!\\n]*[:¿?])` +
    `|(?:le|te|les)\\s+(?:aviso|escribo|contacto|confirmo)\\s+(?:en\\s+cuanto|cuando|apenas|tan\\s+pronto)` +
    // "Voy a preguntarle al anfitrión" — iyelik/nesne eki bitişik yazılır (ikinci inceleme).
    `|voy\\s+a\\s+(?:consultar|preguntar|verificar|comprobar|confirmar|hablar\\s+con|averiguar|revisar|avisar\\p{L}*|contactar|escribir)(?:le|lo|la|les|los|las|se)?(?![^.!\\n]*[:¿?]))${NR}` +
    // RU: "Уточню: вы приезжаете в пятницу?" misafire sorulan netleştirmedir; "я узнаю ваш голос" tanımadır.
    // İkinci inceleme: "Если консьерж не ответит…" üçüncü kişinin koşulu — "ответит" yalnız ev sahibi öznesiyle; "Отвечу
    // коротко: да…" bir cevaptır.
    `|${NL}(?:уточню(?![^.!?\\n]*[:?])|уточним(?![^.!?\\n]*[:?])|сообщу(?![^.!?\\n]*:)|сообщим|свяжусь|свяжемся|спрошу|узнаю(?!\\s+(?:ваш|вас))|передам|проверю|проверим` +
    `|напишу|напишем|отвечу(?![^.!?\\n]*:)|перезвоню|дам\\s+(?:вам\\s+)?знать|дадим\\s+(?:вам\\s+)?знать` +
    `|посмотрю|выясню|попрошу|перешлю|буду\\s+держать\\s+вас\\s+в\\s+курсе)${NR}` +
    `|${NL}(?:хозя\\p{L}*|владел\\p{L}*)\\s+(?:вам\\s+)?(?:напишет|сообщит|ответит|свяжется|перезвонит|подтвердит)${NR}` +
    // AR: 1. tekil/çoğul ve 3. şahıs gelecek ("سأ… / سوف أ… / سن… / سي…"); "سأسألك" misafire sorulan sorudur.
    `|سأ(?:تواصل|سأل(?!ك)|خبر|بلغ|ؤكد|تحقق|رد|عود|تأكد|علم|رسل|قوم\\s+ب|تصل|ستفسر|تابع|وافي)|سوف\\s+أ(?:سأل(?!ك)|تواصل|خبر|بلغ|تحقق|رد|عود|تأكد)` +
    `|دعني\\s+(?:أسأل|أتحقق|أتأكد|أتواصل|أستفسر|أراجع)` +
    // Üçüncü şahıs gelecek YALNIZ ev sahibi öznesiyle (ikinci inceleme: "سيعود الماء" suyun geri gelmesidir, "سيخبرك حارس
    // المبنى" bina görevlisinin sürecidir).
    `|سن(?:تواصل|خبر|بلغ|رد|عود|تحقق|تأكد|وافي)|سوف\\s+ي(?:تواصل|رد)\\S*\\s+(?:\\S+\\s+){0,2}?(?:المضيف|مضيفك|مضيفكم)` +
    `|سي(?:تواصل|رد|خبر|بلغ|عود)\\S*\\s+(?:معك\\s+|معكم\\s+|إليك\\s+|عليك\\s+|عليكم\\s+)?(?:المضيف|مضيفك|مضيفكم)|(?:المضيف|مضيفك|مضيفكم)\\s+(?:\\S+\\s+){0,2}?سي(?:تواصل|رد|خبر|بلغ|عود)` +
    `|سيقوم\\s+(?:\\S+\\s+){0,3}?بالتواصل`,
  "iu",
);

/**
 * DOLDURULMAMIŞ YER TUTUCU cevabın İÇİNDE.
 *
 * 🚨 SIFIR BELİRSİZLİK: `[ŞİFRE]` misafire giden bir cevapta HER ZAMAN yanlış.
 * Ölçülmüş gerçek davranış (4. gerçek koşu, E4): model "Wi-Fi şifresi
 * kayıtlarımda [ŞİFRE] olarak görünüyor" dedi, güven 0.95, ve ürün bunu
 * MİSAFİRE DÖNDÜRDÜ (gerçek QR rotasında ölçüldü, karakterizasyon pinli).
 * Önerisi `docs/ONAY-yer-tutucu-cikti-vetosu-2026-09-09.md`te duruyordu.
 *
 * Yüklem GÖNDERİCİ KAPISIYLA AYNI KAYNAKTAN türer (`kbPlaceholderTokens` +
 * `ANY_DOUBLE_BRACE`) — yaşam-döngüsü göndericisi ile AI yolu ayrışamaz.
 * `{isim}`/`{daire}` BİLEREK dışarıda: onlar gönderim anında çözülür.
 */
function hasUnfilledPlaceholder(reply: string): boolean {
  return kbPlaceholderTokens(reply).length > 0 || ANY_DOUBLE_BRACE.test(reply);
}

/**
 * Misafire GİDECEK metni son kez denetler.
 *
 * `null` = temiz (gönderilebilir). Aksi hâlde kapalı-küme gerekçe.
 * Yön yalnız KISITLAYICI: bu fonksiyon hiçbir cevabı "gönder" diye
 * YETKİLENDİRMEZ, yalnız durdurabilir.
 */
export function vetoOutgoingReply(reply: string | null | undefined): OutputVetoReason | null {
  if (typeof reply !== "string" || reply.trim() === "") return null;
  if (hasUnfilledPlaceholder(reply)) return "placeholder_in_reply";
  // Cümle başı "İlettim"/"Döneceğim": `/i` bayrağı noktalı İ ↔ i katlamaz →
  // ham metnin YANINDA Türkçe küçük harfe indirilmiş metin de sınanır
  // (yalnız EŞLEŞME EKLER, eksiltmez). `claim-detectors` ile aynı desen.
  // Kıvrık kesme işareti ("I’ve", "I’ll") düz olana çevrilir — model çıktısında sık (inceleme 09-25: hepsi geçiyordu).
  const text = reply.replace(/[\u2018\u2019\u02BC\u2032]/g, "'");
  const lower = text.toLocaleLowerCase("tr");
  if (
    ACTIVE_PAST_CLAIM.test(text) ||
    ACTIVE_PAST_CLAIM.test(lower) ||
    ACTIVE_FUTURE_CLAIM.test(text) ||
    ACTIVE_FUTURE_CLAIM.test(lower) ||
    EN_PAST_CLAIM.test(text) ||
    EN_FUTURE_CLAIM.test(text) ||
    OTHER_PAST_CLAIM.test(text) ||
    OTHER_FUTURE_CLAIM.test(text)
  ) {
    return "unverified_commitment";
  }
  return null;
}
