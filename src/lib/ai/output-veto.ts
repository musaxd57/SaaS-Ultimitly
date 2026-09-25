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
    `|(?:iletmiş|bildirmiş|aktarmış|yönlendirmiş|ulaştırmış) bulunuyor(?:um|uz))${NR}` +
    // Soru eki: "Size ulaştık mı?" iddia değil soru.
    `(?!\\s+m[iıuü](?!\\p{L}))` +
    // Şimdiki zaman: "Durumu ev sahibine iletiyorum / aktarıyorum / yönlendiriyorum" (eylem şu an yapılıyor iddiası).
    `|${NL}(?:ileti|aktarı|yönlendiri|bildiri|haber veri|ulaştırı|bilgilendiri)yor(?:um|uz)${NR}` +
    // BEKLEME SÖZÜ (09-25), inceleme düzeltmesi: yalnız 1. TEKİL ("Takvimi kontrol ediyorum", "Hemen bakıyorum", "Kontrol
    // edip dönüyorum") — 1. çoğul ev sahibinin SÜREÇ anlatımıdır ("Her misafirden önce daireyi kontrol ediyoruz").
    // "teyit ediyorum" YOK: "Teyit ediyorum, giriş 15:00" bilinen bir olgunun onayıdır.
    `|${NL}(?:danışı|kontrol edi|bakı|dönü|araştırı)yorum${NR}` +
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
  "|cevap verece|yanıt verece|yanıtlayaca|arayaca|bakaca|öğrenece|söyleyece|aktaraca|araştıraca";
/** Ev sahibi ÖZNE (yalın hâl): "ev sahibiniz …" — "ev sahibinize/-ne/-nden" (yönelme/ayrılma) özne değildir. */
const HOST_SUBJECT_TR = "(?:ev|mülk|daire)\\s+sahib(?:i|iniz|imiz)";
const ACTIVE_FUTURE_CLAIM = new RegExp(
  `${NL}(?:${OLD_FUTURE_STEMS})[ğgk]${SECOND_PERSON}${QUESTION_PARTICLE}\\p{L}*` +
    // 1. şahıs gelecek: "soracağım", "kontrol edeceğiz", "size bildireceğim" (sıfat-fiil "soracağımız bir şey" DEĞİL).
    `|${NL}(?:${PROMISE_FUTURE_STEMS})[ğg][iı][mz]${NR}${QUESTION_PARTICLE}` +
    // Ev sahibi öznesiyle 3. şahıs: "Müsaitliği ev sahibiniz teyit edecek", "ev sahibiniz size bildirecektir".
    `|${NL}${HOST_SUBJECT_TR}${NR}[^.!?;:\\n]{0,80}?\\s(?:${PROMISE_FUTURE_STEMS})k(?:t[iı]r)?${NR}${QUESTION_PARTICLE}` +
    `|${NL}${HOST_SUBJECT_TR}${NR}[^.!?;:\\n]{0,80}?\\s(?:bilgi verir|haber verir|size döner|dönüş yapar|dönüş sağlar|size yazar|size ulaşır|sizi arar|sizinle iletişime geçer)${NR}` +
    `|${NL}(?:ileti|döne|hallede|haber veri|dönüş yapa|bilgilendiri|paylaşı|gönderi|bildiri|aktarı)r(?:[iı]m|[iı]z)${NR}` +
    // 1. TEKİL geniş zaman (09-25): "Bunu ev sahibinize sorarım", "Öğrenip size yazarım", "dönüş sağlarım". 1. çoğul YOK:
    // "Girişte kimliğinizi sorarız" ev sahibinin alışkanlık/süreç anlatımıdır.
    `|${NL}(?:sora|danışı|yaza|baka|söyle|öğreni|dönüş sağla)r[iı]m${NR}(?!\\s+diye)`,
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
  `${NL}i(?:'ve| have)?\\s+(?:just\\s+)?(?:forwarded|passed\\s+(?:this|it|that|your\\s+\\p{L}+)\\s+on|passed\\s+on|created|checked|noted|informed|alerted|flagged|contacted|arranged|logged|asked\\s+our\\s+team|raised)${NR}` +
    `|${NL}i\\s+have\\s+(?:forwarded|created|checked|noted|informed|alerted|flagged|contacted|arranged|logged|raised)${NR}` +
    // 09-25: kaçan eylem fiilleri ve "we" ajanı ("I have booked a taxi", "I've let the host know", "We've notified the
    // cleaning team"). Aynı ölçüm: 1.287 model cevabında İngilizce yeni veto 0. Bilinen bedel (pinli): "We have booked this
    // flat for you…" gibi rezervasyonun kendisini anlatan cümle de tutulur — taslak ev sahibine gider (güvenli yön).
    // İnceleme (09-25): "we" yalnız İLETİŞİM fiillerinde ajan — "We have reserved a parking spot for every apartment",
    // "We called it the blue room", "the instructions we sent" ev sahibinin OLGU cümleleri; "sent" hiç yok (gerçekten
    // giden önceki mesaja atıf). Rezervasyon/sipariş fiilleri yalnız "I" ile.
    `|${NL}(?:i|we)(?:'ve| have)?\\s+(?:just\\s+|already\\s+|also\\s+)?(?:forwarded|notified|messaged|emailed|texted|contacted|informed|reported|escalated` +
    `|passed\\s+(?:this|it|that|your\\s+\\p{L}+)\\s+(?:on\\s+)?to|let\\s+(?:the|your|our)\\s+(?:host|team|cleaner|cleaning\\s+team)\\s+know` +
    // "I've sent a message to your host", "I've reached out to the cleaner" (yalnız ALICI ev sahibi/ekip iken; "the
    // instructions we sent" gibi misafire giden önceki mesaj atfı değil).
    `|sent\\s+(?:a\\s+)?(?:message|note|request)\\s+to\\s+(?:the|your|our)\\s+(?:host|team|cleaner|cleaning\\s+team)|reached\\s+out)${NR}` +
    `|${NL}i(?:'ve| have)?\\s+(?:just\\s+|already\\s+|also\\s+)?(?:booked|reserved|called|phoned|ordered|scheduled|requested|forwarded)${NR}` +
    // Şimdiki zaman: "I'm forwarding this to the host".
    `|${NL}(?:i'm|i\\s+am|we're|we\\s+are)\\s+(?:forwarding|passing\\s+(?:this|it|that|your\\s+\\p{L}+)\\s+on|notifying|contacting|informing|letting\\s+(?:the|your|our)\\s+\\p{L}+\\s+know|looking\\s+into|arranging)${NR}` +
    // "Let me forward this / ask the host / check with the host / Let me check." (bekleme sözü — kurucu kararı 09-25,
    // ↓gelecek dalı). 🚨 Aynı cümlede misafire sorulan NETLEŞTİRME söz değildir (inceleme 09-25): "Let me check if I
    // understood correctly: …?", "Let me double-check: is it two adults?" — iki nokta / "if I understood" dalı yok.
    `|${NL}let\\s+me\\s+(?:just\\s+|quickly\\s+)?(?:forward|pass\\s+(?:this|it|that)\\s+on|ask\\s+(?:the|your|our)|find\\s+out|look\\s+into|reach\\s+out` +
    `|see\\s+what\\s+i\\s+can\\s+(?:do|find)` +
    `|(?:double[-\\s]?)?check(?:\\s+(?:with|on\\s+(?:this|that|it)|and|for\\s+you|this|it|that(?!\\s+i\\s)|the\\s+(?:calendar|availability)|availability)|(?=\\s*(?:[.!]|$))))${NR}`,
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
  "get\\s+back|follow\\s+up|reach\\s+out|be\\s+in\\s+touch|get\\s+in\\s+touch|contact|let\\s+you\\s+know" +
  "|keep\\s+you\\s+(?:posted|updated|informed)|update\\s+you|inform\\s+you|revert|reply|respond" +
  "|confirm(?!\\s+(?:your|the)\\s+(?:id|identity|passport|booking|reservation))|look\\s+into|find\\s+out|double[-\\s]?check" +
  "|check\\s+(?:with|on\\s+(?:this|that|it)|this|that|it|the\\s+(?:calendar|availability)|availability|whether|if)" +
  "|ask\\s+(?:the|your|our)\\s+(?:host|owner|team|cleaner|property\\s+manager|manager)|ask\\s+them|forward|notify" +
  "|pass\\s+(?:this|it|that|your\\s+\\p{L}+)\\s+on|message\\s+(?:the|your)\\s+host|have\\s+(?:the|your)\\s+host|arrange" +
  "|sort\\s+(?:this|it)|handle\\s+(?:this|it|your)|send\\s+someone|get\\s+an?\\s+answer|review\\s+(?:your|the)\\s+request";
/** Yalnız 1. tekille söz: çıplak "check." ve kontrol fiilleri (ajan ev sahibiyse süreç anlatımı olabilir). */
const EN_FIRST_ONLY_PROMISE =
  "check(?=\\s*(?:[.!]|$)|\\s+for\\s+you)|look(?=\\s*(?:[.!]|$))|verify(?!\\s+your\\s+(?:id|identity|passport))|investigate" +
  "|see\\s+what\\s+i\\s+can\\s+(?:do|find)" +
  "|check\\s+(?:the|your|our)\\s+\\p{L}+\\s+(?:and|then)";
const EN_I = "(?:i(?:'ll|\\s+will|\\s+shall)|i(?:'m|\\s+am)\\s+going\\s+to|allow\\s+me\\s+to)";
const EN_OTHER_AGENT =
  "(?:we(?:'ll|\\s+will)|we(?:'re|\\s+are)\\s+going\\s+to" +
  "|(?:(?:your|the|our)\\s+(?:host|owner|property\\s+manager|manager|team)|they|someone)(?:'ll|\\s+will))";
const EN_ADVERB = "(?:just\\s+|quickly\\s+|also\\s+|now\\s+|personally\\s+|shortly\\s+|soon\\s+)?";
const EN_FUTURE_CLAIM = new RegExp(
  `${NL}${EN_I}\\s+${EN_ADVERB}(?:${EN_COMMON_PROMISE}|${EN_FIRST_ONLY_PROMISE})${NR}` +
    `|${NL}${EN_OTHER_AGENT}\\s+${EN_ADVERB}(?:${EN_COMMON_PROMISE})${NR}` +
    // Aynı cümlecikte "… and get back to you / let you know / confirm" (her ajanla).
    `|${NL}(?:${EN_I}|${EN_OTHER_AGENT})\\s+(?:[\\p{L}'-]+[\\s,]+){0,8}?and\\s+(?:get\\s+back|let\\s+you\\s+know|confirm|be\\s+in\\s+touch` +
    `|reply|respond|update\\s+you|inform\\s+you|keep\\s+you\\s+(?:posted|updated))${NR}` +
    `|${NL}you(?:'ll|\\s+will)\\s+hear\\s+(?:back\\s+)?(?:from|soon|shortly)${NR}`,
  "iu",
);

/**
 * DE/FR/ES/RU/AR — 09-25 (inceleme: dil kapısı artık misafire kendi dilinde cevap verdiriyor; bu dillerde veto hiç
 * yoktu). Yalnız 1. şahıs geçmiş + İLETİŞİM/REZERVASYON fiili (etken, ajan çapalı; edilgen ve gelecek YOK).
 */
const OTHER_PAST_CLAIM = new RegExp(
  // Tekil 1. şahıs: iletişim + rezervasyon fiilleri; ÇOĞUL yalnız iletişim fiilleri ("wir haben für jede Wohnung einen
  // Parkplatz reserviert" ev sahibi olgusudur — İngilizce "we reserved" ile aynı gerekçe).
  `${NL}ich\\s+habe\\s+(?:\\p{L}+\\s+){0,6}(?:weitergeleitet|informiert|benachrichtigt|kontaktiert|gebucht|reserviert|angerufen|bestellt|geschickt)${NR}` +
    `|${NL}wir\\s+haben\\s+(?:\\p{L}+\\s+){0,6}(?:weitergeleitet|informiert|benachrichtigt|kontaktiert)${NR}` +
    `|${NL}j'ai\\s+(?:\\p{L}+\\s+){0,2}(?:transmis|informé|prévenu|contacté|réservé|appelé|commandé|envoyé\\s+un\\s+message)${NR}` +
    `|${NL}nous\\s+avons\\s+(?:\\p{L}+\\s+){0,2}(?:transmis|informé|prévenu|contacté)${NR}` +
    `|${NL}he\\s+(?:\\p{L}+\\s+){0,1}(?:reenviado|enviado|informado|avisado|contactado|reservado|llamado|notificado)${NR}` +
    `|${NL}hemos\\s+(?:\\p{L}+\\s+){0,1}(?:reenviado|informado|avisado|contactado|notificado)${NR}` +
    `|${NL}я\\s+(?:уже\\s+)?(?:передал|передала|сообщил|сообщила|связался|связалась|забронировал|забронировала|уведомил|уведомила|позвонил|позвонила|написал|написала)${NR}` +
    `|(?:لقد\\s+)?(?:أبلغت|أخبرت|حجزت|تواصلت|اتصلت|أرسلت\\s+(?:رسالتك|طلبك))`,
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
    `|gebe\\s+(?:ihnen|dir|euch)\\s+(?:gerne\\s+)?bescheid|leite\\s+(?:\\p{L}+\\s+){0,4}weiter` +
    `|werde\\s+(?:\\p{L}+\\s+){0,4}(?:fragen|nachfragen|melden|prüfen|klären|bestätigen|informieren|weiterleiten|kontaktieren|bescheid\\s+geben))${NR}` +
    `|${NL}(?:melde|frage|kläre|prüfe|gebe|leite)\\s+ich\\s+(?:\\p{L}+\\s+){0,4}?(?:mich|nach|bescheid|weiter|das)${NR}(?![^.!?\\n]*[:?])` +
    `|${NL}(?:und\\s+melde\\s+mich|wir\\s+melden\\s+uns|(?:ihr|der)\\s+gastgeber\\s+wird\\s+(?:\\p{L}+\\s+){0,4}(?:melden|bestätigen|informieren|kontaktieren|antworten))${NR}` +
    // FR: "je vais vous demander DE …" misafire bir TALİMATtır (anahtarı kutuya bırakın) — söz değil.
    `|${NL}je\\s+(?:vais\\s+(?!vous\\s+demander)(?:\\p{L}+\\s+){0,2}(?:demander(?!\\s+d[e'’])|vérifier|confirmer|transmettre|contacter|informer|revenir\\s+vers|voir\\s+avec|me\\s+renseigner)` +
    `|reviens\\s+vers\\s+vous|vous\\s+recontacte|vous\\s+tiens\\s+(?:au\\s+courant|informée?s?)|me\\s+renseigne` +
    `|demanderai|vérifierai|transmettrai|reviendrai|contacterai|vous\\s+confirmerai|vous\\s+recontacterai|vous\\s+tiendrai|vous\\s+informerai|vous\\s+préviendrai)${NR}` +
    `|${NL}nous\\s+(?:allons\\s+(?:\\p{L}+\\s+){0,2}(?:demander(?!\\s+d[e'’])|vérifier|confirmer|transmettre|contacter|informer|revenir\\s+vers|voir\\s+avec)` +
    `|reviendrons\\s+vers\\s+vous|vous\\s+tiendrons)${NR}` +
    `|${NL}(?:votre|l['’])\\s*hôte\\s+(?:\\p{L}+\\s+){0,3}(?:contactera|confirmera|répondra|reviendra|informera|vous\\s+tiendra)${NR}` +
    // ES
    `|${NL}(?:(?:le|te|les)\\s+(?:confirmaré|avisaré|informaré|escribiré|contactaré)|consultaré|preguntaré|verificaré|comprobaré|averiguaré` +
    `|revisaré|hablaré|me\\s+pondré\\s+en\\s+contacto|nos\\s+pondremos\\s+en\\s+contacto|se\\s+pondrá\\s+en\\s+contacto` +
    `|(?:le|te|les)\\s+(?:aviso|escribo|contacto|confirmo)\\s+(?:en\\s+cuanto|cuando|apenas|tan\\s+pronto)` +
    `|voy\\s+a\\s+(?:consultar|preguntar|verificar|comprobar|confirmar|hablar\\s+con|averiguar|revisar|avisar\\p{L}*|contactar|escribir)(?![^.!\\n]*[:¿?]))${NR}` +
    // RU: "Уточню: вы приезжаете в пятницу?" misafire sorulan netleştirmedir; "я узнаю ваш голос" tanımadır.
    `|${NL}(?:уточню(?![^.!?\\n]*[:?])|уточним(?![^.!?\\n]*[:?])|сообщу|сообщим|свяжусь|свяжемся|свяжется|спрошу|узнаю(?!\\s+(?:ваш|вас))|передам|проверю|проверим` +
    `|напишу|напишем|отвечу|ответит|перезвоню|дам\\s+(?:вам\\s+)?знать|дадим\\s+(?:вам\\s+)?знать)${NR}` +
    // AR: 1. tekil/çoğul ve 3. şahıs gelecek ("سأ… / سوف أ… / سن… / سي…"); "سأسألك" misafire sorulan sorudur.
    `|سأ(?:تواصل|سأل(?!ك)|خبر|بلغ|ؤكد|تحقق|رد|عود|تأكد|علم|رسل|قوم\\s+ب)|سوف\\s+أ(?:سأل(?!ك)|تواصل|خبر|بلغ|تحقق|رد|عود|تأكد)` +
    `|سن(?:تواصل|خبر|بلغ|رد|عود|تحقق|تأكد)|سي(?:تواصل|رد|خبر|بلغ|عود)`,
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
