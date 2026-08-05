// ---------------------------------------------------------------------------
// GÜVENLİK AÇIĞI BİLDİRİM POLİTİKASI (VDP).
//
// ⚠️ BU DOSYA `legal-text-hash.ts`'E BİLİNÇLİ OLARAK EKLENMEZ. O hash yalnız
// kullanıcının ONAYLADIĞI sözleşme metinlerini (kosullar/gizlilik/
// mesafeli-satis/on-bilgilendirme) kapsar. VDP bir sözleşme değil, tek taraflı
// bir taahhüt — buraya eklemek her düzenlemede `LEGAL_VERSION` bump'ı ve
// consent damgası kayması demek olurdu. Kayıt akışı bu metni onaylatmıyor.
//
// 🚩 AVUKAT ONAYI BEKLEYEN BÖLÜM: "Yasal güvence". `disclose.io`'nun hazır
// safe-harbour metinlerinin TÜRKÇE VARYANTI YOK (ABD/Kanada/Belçika/Hollanda/
// İsviçre var). Aşağıdaki ifadeler bilerek DAR tutuldu: yalnız BİZİM
// yapacağımız/yapmayacağımız şeyi söylüyor, hukuki bağışıklık VAAT ETMİYOR.
// Sebep: TCK 243'ün şikâyete mi bağlı yoksa resen mi kovuşturulduğu kaynaklarda
// çelişkili; resen ise bizim vaadimiz bir kovuşturmayı durduramaz ve metnin
// durdurabilirmiş gibi yazılması araştırmacıyı yanıltır.
// ---------------------------------------------------------------------------

export interface Section {
  title: string;
  body?: string[];
  list?: string[];
}

export const SECURITY_CONTACT = "security@lixusai.com";

/** ISO 8601 — `public/.well-known/security.txt` içindeki `Expires` ile AYNI
 *  olmalı; ikisinin ayrışması testte kırmızıya döner. */
export const SECURITY_TXT_EXPIRES = "2027-06-01T00:00:00Z";

export const SECTIONS: Section[] = [
  {
    title: "Kısaca",
    body: [
      "Lixus AI'da bir güvenlik açığı bulduysanız bize bildirin. İyi niyetli araştırmayı destekliyoruz: bulgunuzu değerlendirir, düzeltir ve isterseniz teşekkür bölümünde adınıza yer veririz.",
      `Tek resmî kanal: ${SECURITY_CONTACT}. Lütfen bulguyu herkese açık bir yerde (GitHub issue, sosyal medya, forum) paylaşmadan önce bize yazın.`,
    ],
  },
  {
    title: "Kapsam",
    body: ["Aşağıdakiler bizim işlettiğimiz sistemlerdir ve test edilebilir:"],
    list: [
      "www.lixusai.com ve bu alan adı altındaki uygulama arayüzü",
      "Aynı alan adı altındaki API uçları (/api/…)",
      "QR misafir sohbeti (/c/<token>) — YALNIZCA size ait bir token ile",
    ],
  },
  {
    title: "Kapsam dışı",
    body: [
      "Sahibi olmadığımız sistemlerde test yapmaya izin veremeyiz. Aşağıdakiler kapsam dışıdır ve onlara yönelik testler bizim iznimizle korunmaz:",
    ],
    list: [
      "Barındırma ve altyapı sağlayıcılarımız (Railway, Cloudflare), e-posta (Resend), ödeme (Paddle)",
      "Yapay zekâ sağlayıcıları (OpenAI, Anthropic) ve emlak yönetimi entegrasyonu (Hospitable)",
      "Airbnb, Booking.com gibi kanal platformları",
      "Hizmet dışı bırakma (DoS/DDoS), hacim testleri, hız-limiti zorlama",
      "Sosyal mühendislik, oltalama, fiziksel güvenlik, çalışanlarımıza yönelik girişimler",
      "Otomatik tarayıcı çıktısının doğrulanmadan gönderilmesi",
      "Yalnızca sürüm numarasına dayanan, sömürülebilirliği gösterilmemiş bulgular",
    ],
  },
  {
    title: "Nasıl bildirilir",
    list: [
      `E-posta: ${SECURITY_CONTACT}`,
      "Her bulgu için ayrı bir bildirim gönderin",
      "Yeniden üretme adımlarını, etkilenen adresi ve etkiyi yazın; ekran görüntüsü veya kısa video yardımcı olur",
      "Türkçe veya İngilizce yazabilirsiniz",
    ],
  },
  {
    title: "Size ne söz veriyoruz",
    body: [
      "Lixus AI tek kişilik bir ekiple işletiliyor. Bu yüzden aşağıdaki süreler tutabileceğimiz HEDEFLERdir; abartılı bir söz vermek yerine gerçekçi olanı yazmayı tercih ediyoruz.",
    ],
    list: [
      "Aldığımızı onaylama: 5 iş günü içinde",
      "Değerlendirme ve önem derecesi: 10 iş günü içinde",
      "Düzeltme hedefi: kritik 30 gün, yüksek 90 gün, diğerleri elden geldiğince",
      "Koordineli açıklama: bildirimden 90 gün sonra yayımlayabilirsiniz; daha erken yayımlamak isterseniz konuşalım",
      "10 iş günü içinde hiç yanıt alamazsanız bildirimi tekrar gönderin — muhtemelen bize ulaşmamıştır",
    ],
  },
  {
    title: "Sizden ricamız",
    list: [
      "Yalnızca bir açığı KANITLAMAYA yetecek kadar ilerleyin; daha fazlasını denemeyin",
      "Misafir veya müşteri kişisel verisi gördüğünüz anda DURUN ve bize bildirin; veriyi indirmeyin, saklamayın, kimseyle paylaşmayın",
      "Veri silmeyin, değiştirmeyin, hizmeti bozmayın",
      "Başka kullanıcıların hesaplarına erişmeyin; test için kendi hesabınızı açın",
      "Bulguyu bize bildirmeden yayımlamayın ve fidye/ödeme talebiyle ilişkilendirmeyin",
    ],
  },
  {
    title: "Yasal güvence",
    body: [
      "Bu politikaya uygun, iyi niyetli bir araştırma yaptığınız sürece: hakkınızda şikâyette bulunmaz, hukuki takip başlatmaz ve üçüncü kişilerin başlattığı bir takipte araştırmanın bizim iznimizle yapıldığını yazılı olarak teyit ederiz. Kullanım koşullarımızın bu araştırmayı engelleyen hükümlerini, bu politika kapsamında ve bu kapsamla sınırlı olarak uygulamayız.",
      "Bu güvencenin sınırını açıkça belirtmek isteriz: yalnızca BİZİM kontrolümüzdeki talepleri kapsar. Üçüncü kişiler adına (sağlayıcılarımız, kanal platformları, diğer kullanıcılar) taahhüt veremeyiz ve kamu makamlarının resen yürüttüğü işlemleri durduramayız. Kapsam dışı bir sistemde yapılan test bu güvencenin dışındadır.",
      "🚩 Bu bölümün Türk hukuku açısından nihai metni avukat incelemesindedir. Belirsizlik hâlinde lehinize yorumlanmasını isteriz; tereddüde düşerseniz test etmeden önce bize yazın, kapsamı birlikte netleştirelim.",
    ],
  },
  {
    title: "Ödül",
    body: [
      "Şu an nakit ödül veren bir program yürütmüyoruz. Sebebini açıkça yazalım: bildirimleri değerlendiren tek bir kişi var ve ödüllü bir programın getireceği hacmi hakkıyla karşılayamayız.",
      "Geçerli ve daha önce bildirilmemiş bulgular için, isterseniz teşekkür bölümünde adınıza yer veririz.",
    ],
  },
  {
    title: "Bildiriminizdeki veriler",
    body: [
      "Bildiriminizi ve yazışmayı, bulguyu değerlendirmek ve düzeltmek amacıyla işleriz. Bize ilettiğiniz iletişim bilgileri yalnız bu yazışma için kullanılır, pazarlama amacıyla kullanılmaz.",
      "Bildiriminiz üçüncü kişilere ait kişisel veri içeriyorsa bunu bize göndermeyin; verinin varlığını ve nasıl erişildiğini tarif etmeniz yeterlidir.",
    ],
  },
  {
    title: "Sürüm",
    body: [
      `Bu politika ${SECURITY_TXT_EXPIRES.slice(0, 10)} tarihine kadar geçerlidir ve o tarihten önce gözden geçirilir. Makine tarafından okunabilir özeti: /.well-known/security.txt`,
      "Süreç ISO/IEC 29147 (açık bildirimi) ve ISO/IEC 30111 (açık işleme) yaklaşımına göre şekillendirilmiştir.",
    ],
  },
  {
    title: "English summary",
    body: [
      `Found a security issue in Lixus AI? Email ${SECURITY_CONTACT}. In scope: www.lixusai.com, its API, and the QR guest chat with a token you own. Out of scope: our providers (Railway, Cloudflare, Resend, Paddle, OpenAI, Anthropic, Hospitable), channel platforms, DoS, social engineering, physical security.`,
      "We aim to acknowledge within 5 business days, triage within 10, and support coordinated disclosure after 90 days. We run a disclosure policy, not a paid bounty — credit only. Please stop the moment you encounter guest or customer personal data, and report it instead of collecting it.",
      "Safe harbour: for good-faith research within this policy we will not file a complaint or initiate legal action against you, and will confirm in writing that the research was authorised. This binds only claims within our control; we cannot speak for third parties or halt actions brought by public authorities.",
    ],
  },
];
