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
  `${NL}(?:ilett[iı]m|iletti[kğ](?:[iı]m|[iı]m[iı]z)?|oluşturdum|oluşturduk|kontrol ettim|kontrol ettik|ayarladım|ayarladık|bildirdim|bildirdik|not ettim|talep oluşturdum` +
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
    `|onayladım|onayladık|güncelledim|güncelledik|görüştüm|görüştük|mesaj attım|mesaj attık` +
    `|(?:iletmiş|bildirmiş|aktarmış|yönlendirmiş|ulaştırmış) bulunuyor(?:um|uz))${NR}` +
    // Soru eki: "Size ulaştık mı?" iddia değil soru.
    `(?!\\s+m[iıuü](?!\\p{L}))` +
    // Şimdiki zaman: "Durumu ev sahibine iletiyorum / aktarıyorum / yönlendiriyorum" (eylem şu an yapılıyor iddiası).
    `|${NL}(?:ileti|aktarı|yönlendiri|bildiri|haber veri|ulaştırı|bilgilendiri)yor(?:um|uz)${NR}`,
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
const SECOND_PERSON = "(?!s?[iı]n[iı]z)(?!s[ae]n[iı]z)";
const QUESTION_PARTICLE = "(?!\\s+m[iıuü](?:y[iıuü]m|y[iıuü]z|s[iıuü]n(?:[iıuü]z)?|d[iıuü]r)?(?!\\p{L}))";
const ACTIVE_FUTURE_CLAIM = new RegExp(
  `${NL}(?:dönüş yapaca|dönece|ilete?ce|paylaşaca|bilgilendirece|haber verece|gönderece|hallede?ce|değerlendirece|inceleyece|iletişime geçece)[ğgk]${SECOND_PERSON}${QUESTION_PARTICLE}\\p{L}*` +
    `|${NL}(?:ileti|döne|hallede|haber veri|dönüş yapa|bilgilendiri|paylaşı|gönderi|bildiri|aktarı)r(?:[iı]m|[iı]z)${NR}`,
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
    `|passed\\s+(?:this|it|that|your\\s+\\p{L}+)\\s+(?:on\\s+)?to|let\\s+(?:the|your|our)\\s+(?:host|team|cleaner|cleaning\\s+team)\\s+know)${NR}` +
    `|${NL}i(?:'ve| have)?\\s+(?:just\\s+|already\\s+|also\\s+)?(?:booked|reserved|called|phoned|ordered|scheduled|requested|forwarded)${NR}` +
    // Şimdiki zaman: "I'm forwarding this to the host".
    `|${NL}(?:i'm|i\\s+am|we're|we\\s+are)\\s+(?:forwarding|passing\\s+(?:this|it|that|your\\s+\\p{L}+)\\s+on|notifying|contacting|informing|letting\\s+(?:the|your|our)\\s+\\p{L}+\\s+know)${NR}`,
  "iu",
);
const EN_FUTURE_CLAIM = new RegExp(
  `${NL}(?:i|we|our\\s+team|the\\s+team|your\\s+host|the\\s+host|someone)(?:'ll|\\s+will)\\s+(?:get\\s+back|follow\\s+up|contact|confirm|let\\s+you\\s+know|reach\\s+out|update\\s+you|inform\\s+you|look\\s+into|arrange|sort\\s+(?:this|it)|handle|be\\s+in\\s+touch` +
    // İnceleme (09-25): "I'll pass this on", "I'll ask the host", "I'll forward your message".
    `|pass\\s+(?:this|it|that|your\\s+\\p{L}+)\\s+on|forward|notify|ask\\s+(?:the|your|our)\\s+(?:host|team|cleaner))${NR}`,
  "iu",
);

/**
 * DE/FR/ES/RU/AR — 09-25 (inceleme: dil kapısı artık misafire kendi dilinde cevap verdiriyor; bu dillerde veto hiç
 * yoktu). Yalnız 1. şahıs geçmiş + İLETİŞİM/REZERVASYON fiili (etken, ajan çapalı; edilgen ve gelecek YOK).
 */
const OTHER_PAST_CLAIM = new RegExp(
  `${NL}(?:ich\\s+habe|wir\\s+haben)\\s+(?:\\p{L}+\\s+){0,6}(?:weitergeleitet|informiert|benachrichtigt|kontaktiert|gebucht|reserviert|angerufen|bestellt)${NR}` +
    `|${NL}(?:j'ai|nous\\s+avons)\\s+(?:\\p{L}+\\s+){0,2}(?:transmis|informé|prévenu|contacté|réservé|appelé|commandé)${NR}` +
    `|${NL}(?:he|hemos)\\s+(?:\\p{L}+\\s+){0,1}(?:reenviado|informado|avisado|contactado|reservado|llamado|notificado)${NR}` +
    `|${NL}я\\s+(?:уже\\s+)?(?:передал|передала|сообщил|сообщила|связался|связалась|забронировал|забронировала|уведомил|уведомила|позвонил|позвонила)${NR}` +
    `|(?:لقد\\s+)?(?:أبلغت|أخبرت|حجزت|تواصلت|اتصلت|أرسلت\\s+رسالتك)`,
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
    OTHER_PAST_CLAIM.test(text)
  ) {
    return "unverified_commitment";
  }
  return null;
}
