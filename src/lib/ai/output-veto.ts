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
 * ⚠️ İNGİLİZCE KAPSAM SIFIR ve bu BİLİNÇLİ bir sınır: yüklemler yalnız Türkçe
 * gövde taşır. "Your host will contact you soon" BUGÜN DE geçer. Türkçeyi açıp
 * İngilizceyi açmamak gönderim politikasını dile göre ayrıştırır; o AYRI bir
 * tur ve AYRI bir karardır — yan etki olarak yapılmadı, burada YAZILI.
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
  `${NL}(?:ilett[iı]m|iletti[kğ](?:[iı]m|[iı]m[iı]z)?|oluşturdum|oluşturduk|kontrol ettim|kontrol ettik|ayarladım|ayarladık|bildirdim|bildirdik|not ettim|talep oluşturdum)${NR}`,
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
  const lower = reply.toLocaleLowerCase("tr");
  if (
    ACTIVE_PAST_CLAIM.test(reply) ||
    ACTIVE_PAST_CLAIM.test(lower) ||
    ACTIVE_FUTURE_CLAIM.test(reply) ||
    ACTIVE_FUTURE_CLAIM.test(lower)
  ) {
    return "unverified_commitment";
  }
  return null;
}
