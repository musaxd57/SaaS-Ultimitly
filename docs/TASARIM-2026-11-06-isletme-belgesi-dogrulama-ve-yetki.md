# TASARIM — İşletme belgesi doğrulama, belgeye bağlı yetkiler ve belge devri (Claude önerisi)

> **Durum: ÖNERİ, kod YOK.** Kurucu 11-06: "bu tarz bir özellik ekleyeceğiz, mimariyi düşün, bana yaz … son akışı üçümüzün (sen, ben,
> Codex) birleşimini oluşturup seçeriz." Bu belge Claude'un önerisidir; §13'teki karar tablosu üç önerinin yan yana konması içindir.
> **Girdi:** kurucunun mesajı + 3 ekran görüntüsü (ChatGPT özeti: A/B/C grupları, resmî kayıttan doğrulama, otomatik yetki, sürekli
> denetim, belge devri, tur dosyası). ChatGPT'nin hukuki iddiaları Ek A'da kaynaklarıyla denetlendi ("ChatGPT de yanlış söylüyor
> olabilir" — kurucu kuralı). Taslak bir Opus sert incelemesinden geçti (9 P1, 10 P2, 1 P3); uygulanışı §15.
> **Bağlayıcı kurallar:** SORMADAN SİSTEM KURULMAZ · KODDAN ÖNCE UZUN DÜŞÜN · EKSİK OKUMA HÜKÜM VERMEZ (F16) · PERİYODİK İŞİN ALARMI
> GEÇİŞ TABANLIDIR · BİR YÜZEYİ KAPATIRKEN VERİNİN ÜRETİLDİĞİ YERİ KAPAT · müşteriye giden metin sade · mutlak iddia yok.

## 0. Bir bakışta

1. **Üç ayrı kimlik var, karıştırılmaz:** *kişi* (giriş yapan insan) · *hak sahibi* (belgede adı yazan şirket ya da şahıs) · *belge* (tür +
   numara + grup / sınıf + neyi kapsadığı). Lixus'taki işletme hesabı bir ya da birkaç hak sahibini temsil eder. Başkasının dairesini
   işleten ev sahibi (bugünkü müşterilerin çoğu) için ayrıca **yetkilendirme kaydı** gerekir: malik / izin sahibi o daire için hesabı
   yetkilendirir.
2. **Yetki bir kutucuk olarak saklanmaz; her seferinde belgelerden HESAPLANIR** (kodda tek kural tablosu). Bu yalnız yeni işlemler için
   değil, **yayındaki her şey** için de geçerlidir: ilan sayfası, tur tanıtımı, işaret ve asistanın önerdiği turlar her gösterimde aynı
   kapıdan geçer (verinin üretildiği yer kapanır). İncelemedeki (bayraklı) bir belge mevcut yayını 72 saate kadar sürdürür ama yeni bir
   şey açmaz.
3. **Bir belge ancak iki kanıtla "doğrulandı" olur:** K2 resmî kayıtta var, geçerli ve kayıttaki hak sahibi = başvuran şirket; K3 başvuran
   kişi o şirketi gerçekten temsil ediyor. Fotoğraf ya da numara tek başına hiçbir şey açmaz. Resmî kayıtların hangi iletişim alanlarını
   gösterdiği henüz doğrulanamadığı için K3'ün varsayılan yolu: **şirket yetkilisinin e-imzalı onayı** (ya da belge seti + operatör).
4. **Numarayı yazmak hiçbir şeyi kilitlemez.** Bekleyen başvurular paralel ve süreli; K3'ü ilk tamamlayan kazanır. Kilit (bir belge = bir
   hesap) yalnız doğrulanmış belgede vardır — rakip bir deneme hesabı gerçek sahibin önünü tıkayamaz.
5. **"Devir" üç ayrı olaydır:** belge devri (belge başka şirkete geçer) · şirket / hisse devri (şirket aynı, sahipleri değişir) · tesisin
   işletmecisinin değişmesi. Belge devri **Bakanlık siciline işlendiği gün** hüküm doğurur: o an eski sahibin kaydı kapanır, yeni sahip
   ancak ondan sonra doğrulanır; devir sürerken o belgeyle yeni tur tanıtımı açılmaz.
6. **Sürekli denetim:** resmî kayıt açıkça "iptal" derse ilanlar ve tanıtımlar hemen kalkar. "Bulunamadı" ya da "okunamadı" tek okumayla
   hüküm değildir (F16); eşik ve tolerans aşılınca insan / askı.
7. **⚠️ Hukuki konumumuz değişir.** Avukat talebinde "yazılımımız ilan yayınlamaz, rezervasyon almaz, ödeme aracılık etmez" diyoruz
   (`docs/legal/HUKUKI-DANISMANLIK-TALEBI.html` §8). Konaklama ilanı ya da tur tanıtımı bunu değiştirir → kod yazılmadan önce avukat (§11).
8. **Önerilen ilk adım (Faz 1a, küçük):** belge GÖRÜNTÜSÜ saklanmaz (bütün altyapımız yurt dışında; görüntü zaten tek başına hiçbir şey
   açmıyor); operatör resmî kaydı okur, yetkili e-imzayla onaylar, **belge ve kapsam başına süreli bir "eşleşti" işareti** çıkar. Satış,
   ilan, otomatik okuma, devir akışı yok — ama veri modeli ve kurallar bunları baştan taşıyacak biçimde kurulur.

**Araştırmanın tasarımı değiştiren bulguları (Ek A, kaynaklı):**
- **Tur:** tur ve paket turu yalnız lisanslı acenta düzenleyip satar; otel istisnası bulunamadı. Acenta ürünleri seyahat dışı
  e-ticaret alanlarında satılamaz — yalnız **tanıtım ve acentanın kendi satış kanalına yönlendirme** serbest (Seyahat Acentaları
  Yönetmeliği m.17/3). → Önerim: Lixus turun satıcısı OLMAZ; tanıtır ve yönlendirir (K-16).
- **Konaklama ilanı:** ilan yayımlayan herkes (platformlar dahil) belge / izin numarasını **Bakanlık veri tabanından doğrulayıp** ilanda
  göstermek zorunda (2634 m.33 — 7565 sk. 2025; 7464 Tebliği RG 31.12.2025); uyarıdan sonra 24 saatte kaldırılmayan ilana ilan / konut
  başına ceza. Bakanlık platformlara ve acentalara bir **Veri Doğrulama API'si** açtı (Genelge 2026/4, 14.08.2026; tam metni ve başvuru
  koşulları doğrulanamadı — orta güven). Konut izninin herkese açık sorgusu bulunamadı → konut ilanı ancak bu API ile.
- **Belge devri:** acenta belgesi Bakanlık izniyle devredilebilir; devir sicile işlendiği gün hüküm doğurur, o güne kadar devralan acentalık
  yapamaz; süreç tarafların birlikte aldığı **"devir ön izni"** ile başlar; belge devralan adına **yeni acenta unvanıyla** düzenlenir
  (1618 m.4/3). Basit konaklama belgesi 26.08.2026'dan beri (miras dışında) devredilemez.
- **Belediye ruhsatı** tek başına artık konaklama için dayanak değil (2021'den beri Bakanlık ya da basit konaklama belgesi zorunlu).
- **TÜRSAB logosu** işaretimizde kullanılmaz (marka / haksız rekabet riski); mevzuat görsel değil numara istiyor.

## 1. Kurucunun istekleri → tasarımda karşılığı

| İstek (kurucu / ekran görüntüleri) | Karşılığı |
|---|---|
| Acentalarda A/B/C grubu; grup işletme belgesinde ve TÜRSAB kaydında yazar | Belge türü "seyahat acentası işletme belgesi", nitelik `grup`; kayıt okuma §3.2 |
| Otellerde grup yok; turizm belgesi, tesis türü, yıldız; apart / butik / basit konaklama | "Turizm işletmesi belgesi" / "basit konaklama belgesi", nitelikler `tesis türü`, `sınıf`; kapsam = tesis (§2.2) |
| Belge devirle alınabilir | §6 (üç tür devir + yönetici değişimi) |
| Yalnız fotoğrafa güvenme, resmî kayıtla karşılaştır | Kanıt seviyeleri §3.1 (görüntü hiçbir şey açmaz; Faz 1a'da hiç saklanmaz) |
| Gerçek işletme sahibini doğrula (ticaret sicili, yetkili, kurumsal e-posta, yetki belgesi) | Hak sahipliği bağı §3.3 |
| Yetkiler gruba göre otomatik açılsın | Yetki tablosu §5.2 (hesaplanır, saklanmaz) |
| Sürekli denetle; iptal / uyuşmazlıkta askıya al; yönetici değişikliklerini kaydet; iki aşamalı doğrulama | §4.1, §7, §8 |
| Belge devri sürerken tur oluşturma ve satma kapalı; devir bitmeden yeni şirkete yetki yok | §6.1 |
| Otel + anlaşmalı A grubu acenta → anlaşma kapsamında tur sunma | §5.2 (otel tanıtır + yönlendirir; 🔒 hukuk) |
| Aynı işletmenin birden fazla doğrulanmış yetkisi olabilsin | Yetkiler bütün geçerli belgelerin birleşimi §5.3 |
| Tur dosyası (belge sureti, katılımcı listesi, program, rehber, araç, sigorta) | Tur hazır olma kontrolü §5.5 (Faz 4) |

## 2. Kavramlar

### 2.1 Kimlikler
- **Kişi** (`User`, var): giriş yapan insan.
- **İşletme hesabı** (`Organization`, var): Lixus kiracısı; kişiler üyelikle (M-2) bağlanır.
- **Hak sahibi** (yeni): belgede adı yazan tüzel ya da gerçek kişi — ticari unvan, vergi numarası (anahtarlı özet), varsa MERSİS no. Bir
  işletme hesabı birden çok hak sahibini temsil edebilir (aynı grubun otel şirketi + acenta şirketi). Bir hak sahibi aynı anda yalnız bir
  hesapta **doğrulanmış** olabilir (bekleyen başvurular serbest — §4).
- **Belge** (yeni): tür + numara + hak sahibi + kapsam + nitelikler (grup / tesis türü / sınıf) + durum.
- **Birim:** belgenin kapsadığı daire / tesis (`Property`). Konut izni (7464) konut bazındadır; aynı kişinin aynı binadaki konutları tek
  belgede olabilir — bu yüzden konut izninde benzersizlik **(tür, numara, birim)** üzerindendir.
- **Yetkilendirme** (yeni): malik / izin sahibinin, belirli birim(ler) için belirli bir işletme hesabına (yöneticiye) verdiği, süreli,
  e-imzalı izin. Bugünkü müşterilerin çoğu başkasının dairesini işletir; izin ise kişiye ve konuta bağlıdır. Bir malik konutlarını iki
  ayrı yöneticiye verebilir — her birim kendi yetkilendirmesiyle.
- **Anlaşma** (yeni, Faz 3): iki işletme arasında (otel ↔ A grubu acenta), iki tarafın da onayladığı, kapsamı ve süresi belli kayıt.
- **Yetki** (kodda, saklanmaz): "ilan yayını", "tur tanıtımı", "yönlendirme"… §5.2'deki tablodan hesaplanır. **Lixus'ta "satış" yetkisi
  yok** — satış acentanın kendi kanalında olur (K-16).
- ⚠️ Ad çakışmaları (kodda ayrı adlar şart): faturalandırmada `Entitlement` / `getEntitlement` (plan hakları) · kanal katmanında
  "credential" (bağlantı kimlik bilgisi) · `src/lib/legal-entity.ts` (Lixus'un kendi satıcı kimliği). Öneri: `BusinessLicense`,
  `LicenseHolder`, `LicenseUnit`, `UnitMandate`, `LicenseEvent`; yetki fonksiyonu `licenseCapabilities`.

### 2.2 Belge türleri kataloğu (ilk sürüm; dayanaklar Ek A)

| Tür | Kapsam | Resmî kayıt (K2 kaynağı) | Devir | Açabileceği yetki |
|---|---|---|---|---|
| Seyahat acentası işletme belgesi (A / B / C) | Hak sahibi (merkez) | Bakanlık "Seyahat Acentası Arama" (acenta unvanı, ticari unvan, belge no, il, grup, **belge durumu**) · TÜRSAB acenta arama | Var — Bakanlık izniyle, sicile işlendiği gün (§6.1) | Gruba göre tur tanıtımı (§5.2) |
| Şube işletme belgesi | Şube | Aynı | Merkezle birlikte | Merkezin yetkileri, şube için |
| Turizm işletmesi belgesi (kısmi dahil) | Tesis (bütün birimleri) | Bakanlık "Belgeli ve Başvurusu Olan Tesisler" sorgusu (belge no, tür, durum, tesis türü, sınıf, il / ilçe) · Veri Doğrulama API'si | Doğrulanamadı (§6.3) | İlan yayını (o tesis) |
| Basit konaklama turizm işletmesi belgesi | Tesis | Aynı | **Yok** (26.08.2026'dan beri, miras hariç) | İlan yayını (o tesis) |
| Konut izin belgesi (7464) | Konut (bir belgede birden çok konut olabilir) | Herkese açık sorgu bulunamadı → yalnız Veri Doğrulama API'si | Doğrulanamadı | İlan yayını (o konut) |
| Turizm yatırımı belgesi | Tesis | Bakanlık | — | **Hiçbiri** (işletme izni değil) |
| Belediye işyeri açma ve çalışma ruhsatı | Tesis | — | — | **Hiçbiri** (destek belgesi) |
| Turist rehberi çalışma kartı (6326) | Kişi | Doğrulanamadı | — | Tur hazır olma şartı |
| Karayolu taşıma yetki belgesi (A1/A2/B1/B2/D1/D2/D4) | Taşımacı | Doğrulanamadı | — | Taşımalı tur şartı |
| Paket tur sigortası (1618 m.12/a) | Paket tur | Sigortacı | Süreli | Paket tur tanıtımı şartı (§5.5) |

Tesis türleri (otel, butik otel, özel konaklama tesisi, motel, pansiyon, kırsal turizm tesisi, kamping …) nitelik olarak saklanır, yetki
kuralını değiştirmez. Hac / umre (yalnız A grubu + Diyanet yetkisi) önerimde kapsam dışı.

## 3. Doğrulama

### 3.1 Kanıt seviyeleri

| Seviye | Ne | Tek başına ne açar |
|---|---|---|
| K0 Beyan | Kullanıcı numarayı yazdı | Hiçbir şey — ve hiçbir şeyi kilitlemez |
| K1 Belge görüntüsü | PDF / fotoğraf | Hiçbir şey (Faz 1a'da hiç alınmaz) |
| K2 Resmî kayıt eşleşmesi | Numara, tür / grup, durum ve hak sahibi resmî kayıtla eşleşti | Hiçbir şey (belge VAR — ama sizin mi?) |
| K3 Hak sahipliği bağı | Başvuran kişinin o hak sahibini temsil ettiği kanıtlandı | K2 ile birlikte: yetkiler |
| K4 Operatör onayı | İnsan baktı, kararı gerekçesiyle kayıtlı | Kuralın istediği yerde ek şart |

**Kural: yetki = K2 + K3 (+ kuralın istediği yerde K4).** K2 ile K3 aynı hak sahibini göstermeli.

### 3.2 Resmî kayıt okuma (K2)
- **Kaynak bağdaştırıcısı:** her kaynak aynı arayüzle döner: `bulundu | bulunamadı | okunamadı | belirsiz` + normalize alanlar + okuma
  zamanı + kaynak adresi + ham yanıtın SHA-256 özeti. Çekirdek TÜRSAB'ın sayfa yapısını bilmez (kanal katmanındaki ilkenin aynısı).
- **F16:** `okunamadı` / kısmi okuma hüküm vermez. `bulunamadı` da tek başına hüküm değildir — sayfa biçimi değişmiş, sorgu aksamış ya da
  işlem henüz sonuçlanmamış olabilir (Bakanlık "sonuçlanmamış işlemler görünmeyebilir" diyor). Eşikler §4.1.
- **Elle okuma (Faz 1a) = yeniden üretilebilir sorgu kaydı:** kaynak adresi + sorgu değerleri + zaman + yanıt özeti; alanlar (unvan,
  grup, durum, varsa iletişim) kayıttan **kopyalanır**, elle yazılmaz; ekran görüntüsü yalnız ek. Faz 2'nin otomatik okuyucusu ilk koşusunda
  elle doğrulanmış bütün kayıtları yeniden okur.
- **Eşleşme anahtarı açıkça:** resmî kayıtta vergi numarası yok (Ek A R2) → kayıttaki **ticari unvan (+ il)** ile, hak sahibinin vergi
  levhası / Ticaret Sicili Gazetesi kaydındaki unvan eşleştirilir; vergi numarası vergi levhasından gelir. Unvan normalize edilir
  ("Limited Şirketi" = "Ltd. Şti.", Türkçe harfler, noktalama); tutmuyorsa İNSAN, "benziyor" puanıyla otomatik onay YOK.
- **Acentada iki ad:** *ticari unvan* (yasal ad — eşleşme bununla) ve *acenta unvanı* (belgedeki marka adı — devirde değişir, ekranda
  gösterilir).
- **Kaynak alan adları kodda tek listede**, tam eşleşmeyle (sonek değil; punycode normalize): Bakanlık (`kultur.gov.tr`, `ktb.gov.tr`),
  TÜRSAB (`tursab.org.tr`), e-Devlet (`turkiye.gov.tr`), Ticaret Sicili Gazetesi, MERSİS, Gelir İdaresi. "TÜRSAB sorgu" adlı resmî olmayan
  siteler var (Ek A R2); kullanıcının verdiği bir "doğrulama bağlantısı" asla kaynak sayılmaz.

### 3.3 Hak sahipliği bağı (K3)
İlke: kanıt, kullanıcının VERDİĞİ bir adrese / belgeye değil, **resmî kayıtta zaten yazan** bir şeye ya da yalnız yetkili kişinin
üretebileceği bir imzaya dayanır.

| Yöntem | Neyi kanıtlar | Dayanağı doğrulandı mı (Ek A) | Önerilen kullanım |
|---|---|---|---|
| **Şirket yetkilisinin e-imzalı onayı** (nitelikli e-imza; Ticaret Sicili Gazetesi'ndeki yetkili + temsil şekli — müştereken temsilde GEREKEN bütün imzalar) | Şirketi temsile yetkili kişi(ler) bu hesabı yetkilendirdi | Gazete araması: evet · imza doğrulama: teknik olarak mümkün, ürün denemesi yok | **Varsayılan** (şirketler) |
| **Şahıs:** kişinin kendi e-imzası / mobil imzasıyla tek kullanımlık bir metni imzalaması | İmzalayan = hak sahibi kişi | Aynı | **Varsayılan** (şahıs işletmesi, konut izni sahibi) |
| Belge seti + operatör (imza sirküleri + vergi levhası doğrulaması + MERSİS belge doğrulama kodu) | Belgeler gerçek ve aynı şirkete ait; başvuran yetkili listesinde | Kısmen (vergi levhası doğrulaması koşullu) | Yedek; e-imza yoksa |
| Kayıtlı web sitesi — alan adına **DNS TXT** kaydı (dosya çekilmez → SSRF yüzeyi yok) | Başvuran, kayıtlı alan adını yönetiyor | Kayıtlı web adresi yalnız ikincil kaynakta | Destek kanıtı; tek başına yüksek riskli yetkiye yetmez (süresi dolup kapılan alan adı, siteyi yöneten ajans) |
| Resmî kayıttaki iletişim adresine **onay isteği** | Kayıtlı adresin sahibi onayladı | **Doğrulanmadı** (sonuçta iletişim alanı var mı bilinmiyor) | Alan doğrulanırsa ek kanal |
| e-Devlet barkodlu belge / Bakanlık e-imzalı evrak doğrulaması | Belge gerçek (K2'yi güçlendirir); sunanın kim olduğunu GÖSTERMEZ | Doğrulama hizmeti var; hangi turizm belgelerinde barkod olduğu doğrulanamadı | Yalnız K2 desteği |
| Kurumsal e-posta alan adı · görüntülü görüşme | Zayıf destek · son çare | — | Tek başına YETMEZ |

- KEP ve e-Tebligat adresleri herkese açık değil → yöntem olarak YOK.
- **Onay töreni (resmî adrese gidecekse):** kod başvuranın ekranına GİRİLMEZ (aktarılabilir: "TÜRSAB'dan arıyoruz, gelen kodu okur
  musunuz?"); onay **sahibin tarafında** verilir: "Lale Turizm hesabı belgenizi bağlamak istiyor — Onayla / Reddet". Bağlantı yalnız
  sayfayı açar; onay düğmeyle (POST) verilir — e-posta güvenlik tarayıcıları bağlantıya kendiliğinden tıklar (repodaki e-posta doğrulama
  deseniyle aynı). Adres + belge başına gönderim sınırı.
- **İtiraz:** resmî adresten gelen "bu ben değilim" yalnız yeni yetki açılışını dondurur; askıya almayı operatör verir (eski çalışan ya da
  eski web ajansı tek tıkla bir işletmeyi durduramasın).
- TC kimlik numarası yalnız karşılaştırma için işlenir ve **yalnız anahtarlı özeti** saklanır; vergi numarası şifreli + anahtarlı özet.
  Özet anahtarı ayrı, en az 32 karakter, hiç döndürülmeyen bir sırdır; yoksa özellik kapalı (`HOST_CHANNEL_HMAC_SECRET` emsali) —
  `ENCRYPTION_KEY || AUTH_SECRET` sırasına bırakılmaz.
- Dışarıya hiçbir yanıt "bu belge / bu vergi numarası başka bir hesapta" demez (kiracılar arası sızıntı ve yoklama): tek genel cümle
  ("Başvurunuzu aldık, kontrol edip size haber vereceğiz") + hız sınırı; çakışma yalnız operatöre görünür.

### 3.4 Yapay zekânın yeri
- Yalnız **alan okuma yardımı** olabilir (numara / unvan / grup önerir, kullanıcı onaylar). Karar VERMEZ; belge metni veridir, talimat değil
  (repo kuralı K10-s).
- **Faz 1a–2'de yapay zekâ YOK:** kullanıcı numarayı yazar, alanlar resmî kayıttan gelir. Görsel okuma ancak avukat onayı + aydınlatma
  metniyle (kişisel veri yurt dışına gider).

## 4. Belgenin yaşam döngüsü

| Durum | Anlamı | Yetki üretir mi | Kilit (bekçi sütunu) |
|---|---|---|---|
| `bekliyor` | K2 ve / veya K3 bekleniyor; **14 gün** süreli; hesap başına en çok 3 bekleyen başvuru | Hayır | **Yok** — paralel başvurular serbest |
| `devir_bekliyor` | Devralan; sicilin yeni hak sahibini göstermesi bekleniyor; **90 gün** süreli | Hayır | Yok |
| `incelemede` | Doğrulanmamış başvuruda uyuşmazlık / çakışma → insan | Hayır | Yok |
| `doğrulandı` | K2 + K3 (+ K4) tamam. **İnceleme bayrağı** taşıyabilir (uyuşmazlık / itiraz / grup genişledi): yeni açılış donar, mevcut yayın sürer, operatöre 72 saat; karar yoksa askı | **Evet** (bayraklıysa yalnız mevcutlar) | **Var** |
| `askıda` (sebepli, §4.1) | Kayıtta iptal / bulunamadı eşiği / doğrulanamadı / devir / bayrak süresi doldu | Hayır (bağımlılar §5.4) | Var |
| `süresi_doldu` · `devredildi` · `reddedildi` · `zaman_aşımı` · `geri_çekildi` | Kapanış; geçmiş için tutulur | Hayır | Yok |

Değişmezler:
- **Bir belge aynı anda yalnız bir hesapta doğrulanmış olabilir:** bekçi sütunu yalnız `doğrulandı` ve `askıda` durumlarında dolu, öbür
  durumlarda boş (`@unique`, boş bırakılabilir) — repodaki desen: `Membership.singleMembershipGuard`, `CheckoutIntent.openKey`. Kısmi
  dizin yok (sıfır-drift kuralıyla uyumlu). Anahtar: acenta ve tesis belgelerinde (tür, numara); konut izninde (tür, numara, birim).
- **K3'ü ilk tamamlayan kazanır:** bekçi sütununa yazma işlem içinde yapılır; ikinci başvuru bekçi çakışmasıyla `incelemede`ye düşer
  (dışarıya genel cümle).
- **Geçişler sürüm alanıyla CAS'lıdır** (F04 OAuth emsali): eski duruma göre hesaplanmış bir okuma sonucu, aradaki bir devri ya da operatör
  kararını ezemez.
- Her geçiş **yalnız-ekle olay günlüğüne** yazılır (önceki → sonraki, sebep, yapan, kanıt, zaman). ⚠️ Repodaki emsal günlük süreli ve hesap
  silinince siliniyor; belge kanıtının saklama kuralı ayrıdır (K-13, K-24).
- Müşteriye giden e-postalar CLAIM-THEN-NOTIFY ile (işaret + gönderim sonucu okunur).

### 4.1 Askı sebepleri ve çıkışları

| Sebep | Giriş | Çıkış |
|---|---|---|
| **Kayıtta açık iptal / askı** | Hemen | Operatör; kayıt yeniden "geçerli" gösterince |
| **Bulunamadı** | Ardışık N okuma + en az 24 saat, ya da operatör teyidi | İki ardışık eşleşen okuma (histerezis) |
| **Doğrulanamadı** (okunamıyor) | T gün boyunca hiç başarılı okuma yok (K-5) | İlk eşleşen okuma (otomatik) |
| **Uyuşmazlık** (kayıttaki unvan değişti, sürmekte olan bir devir YOK) | Askı değil, **inceleme bayrağı**: yeni açılış durur; operatör 72 saatte Ticaret Sicili Gazetesi'nden ayırır (aynı şirketin unvan değişikliği mi, bildirilmemiş devir mi); karar yoksa askı | Operatör |
| **Grup daraldı** (A → C gibi) | Askı YOK — yetki hemen daralır | — |
| **Grup genişledi** (C → A gibi) | Askı YOK — inceleme bayrağı; operatör onayına kadar eski (dar) yetki | Operatör |
| **İtiraz** (resmî adresten) | Askı değil, **inceleme bayrağı**: yeni açılış donar; askıya alma operatör kararı (72 saat) | Operatör |
| **Devir** (sahip başlattı / ön izin doğrulandı) | Hemen: o belgeyle yeni tur tanıtımı açılmaz | Sicil yeni sahibi gösterince → `devredildi`; devir iptal → operatör |

- **İşlem öncesi okuma** `okunamadı` dönerse işlem durur ama belgenin durumu DEĞİŞMEZ.
- Operatör alarmı geçiş tabanlıdır; ⚠️ mevcut `alertOnTransition` başarılı okumada temizlendiği için dalgalanan bir kaynak her seferinde
  yeniden alarm verir → histerezis bu yüzden şart.

## 5. Yetki kuralları

### 5.1 İlkeler
- **Tek kaynak:** kodda bir kural tablosu; yetki = f(geçerli belgeler, yetkilendirmeler, anlaşmalar, şimdi). Saklanmaz; ekranda hızlı
  göstermek için önbellek olabilir ama **her işlemde ve her herkese açık gösterimde yeniden hesaplanır** (şüphede kapalı).
- Yetkiler gerçek eylemlerdir: **ilan yayını · tur tanıtımı · acentanın kanalına yönlendirme · "eşleşti" işareti**. "Satış" diye bir
  Lixus yetkisi yok.
- Ekran her yetkinin yanında kaynağını ve eksiğini söyler: "Tur tanıtımı: kapalı — eksik: rehber çalışma kartı numarası."
- Plan sınırları (faturalandırma) ile ayrı kapı; ikisi de geçmeli (özelliğin hangi planda olacağı K-28).

### 5.2 Taslak kural tablosu (🔒 = hukuk onayı olmadan açılmaz)

| Yetki | Şart | Dayanak (Ek A) |
|---|---|---|
| **"Eşleşti" işareti** (rozet yerine) | Belge ve kapsam başına: "Bu daire için izin numarası Bakanlık kaydıyla eşleşti · son kontrol 3 Kasım". Metin kaynağa göre (Bakanlık / TÜRSAB / e-Devlet); **N gün yeniden okunmazsa kendiliğinden kalkar**; TÜRSAB logosu YOK; genel bir "doğrulanmış işletme" ifadesi YOK (acenta belgesi, izinsiz bir dairede işaret taşıtmamalı) | R7 |
| İlan yayını (birim X) | X'i kapsayan geçerli turizm işletmesi belgesi · basit konaklama belgesi · konut izin belgesi (7464) — numara **Bakanlık veri tabanından doğrulanmış** (konut izninde API) ve ilanda görünür; yönetici ise ayrıca o birim için geçerli yetkilendirme. Turizm yatırımı belgesi ve belediye ruhsatı AÇMAZ. Taslak / "satışa kapalı" ilan da numarasız yayımlanmaz 🔒 | R4, R5 |
| Kendi turunun tanıtımı | **A grubu:** yurt içi, gelen, giden, paket tur · **C grubu:** yalnız Türk vatandaşlarına yurt içi tur · **B grubu:** YOK | R1 (1618 m.3) |
| Başka acentanın (A grubu) turunu tanıtma | Tanıtan B, C (ya da A); ürün sahibi acenta açıkça yazılı; iki tarafın onaylı anlaşması 🔒 | R1 (2024) |
| Acentanın kanalına yönlendirme | Yalnız resmî kayıtta / acentanın bildirdiği satış kanalı alan adına; değişikliği taze yeniden doğrulama + bütün sahiplere e-posta + bekleme süresi ister | R7 |
| Turun Lixus üzerinden SATILMASI | 🔒 Önerim: YOK (K-16) | R6 (m.17/3) |
| Otelin misafirine tur sunması | Otel kendi adına tur satamaz (istisna bulunamadı) → doğrulanmış acentanın turunu TANITIR, acentanın kanalına yönlendirir; komisyon 🔒 | R6 |
| Misafir asistanının tur önermesi | Yalnız A grubu turları (C grubu misafirin vatandaşlığını bilmediğimiz için önerilmez); öneri metni ödeme yöntemi kuralına (`payment-method-guard`) tabi — IBAN / ödeme yeri yazılmaz | R1, mevcut kural |
| Tur tanıtımının yayını | Tur tanıtımı yetkisi + tur hazır olma kontrolü (§5.5) + belge devirde değil + son başarılı okuma ≤ N gün | — |

### 5.3 Birden çok belge
Yetkiler bütün geçerli belgelerin birleşimidir; her yetki hangi belgeden geldiğini taşır. Bir belge askıya alınınca yalnız ONDAN gelen
yetkiler kapanır (otel belgesi geçerli, acenta belgesi devirde → ilan açık, tur tanıtımı kapalı).

### 5.4 Bağımlı nesneler (yayındakiler kendiliğinden kapanmaz)
"Yetki hesaplanıyor, kapatmayı unutmak imkânsız" yalnız YENİ işlemler için doğrudur. Yayındaki nesneler için her geçişin karşılığı:

| Geçiş | İlan sayfası | Tur tanıtımı | "Eşleşti" işareti | Asistan önerileri | Site haritası / önbellek |
|---|---|---|---|---|---|
| Askı: kayıtta iptal | Kaldır | Kaldır | Kaldır | Üretilmez | Temizle |
| Askı: bulunamadı / doğrulanamadı | Eşik dolunca kaldır | Eşik dolunca kaldır | Kaldır | Üretilmez | Temizle |
| İnceleme bayrağı (uyuşmazlık / itiraz) | Yayında kalır, yeni açılış yok; 72 saatte karar yoksa askı satırları | Aynı | İşaret kalkar | Üretilmez | — |
| Devir başladı | Dokunma (konaklama) | Yeni tanıtım yok; mevcutlar "geçici olarak kapalı" | Kalır | Üretilmez | — |
| Devredildi | Eski sahipte kaldır | Eski sahipte kaldır | Kaldır | Üretilmez | Temizle |

- Herkese açık sayfanın çizimi ve asistanın veri üretimi **aynı kapıdan** geçer; kapı geçilmezse sayfa / öneri hiç üretilmez.
- **Bakanlık uyarısı (24 saat):** belge durumundan bağımsız bir "Bakanlık uyarısı → ilanı kaldır" işlemi + 24 saatlik operatör alarmı
  (2634 m.33 ve 7464'teki "uyarıdan sonra 24 saat" yükümlülüğü). Sorumlusu K-23.

### 5.5 Tur hazır olma kontrolü (Faz 4)
Doğrulanmış erken giriş ile aynı mantık: her şart kodla tek tek denetlenir, biri eksikse tanıtım yayına çıkmaz; yapay zekâ karar vermez.
Mevzuatta "tur dosyası" diye tanımlı bir belge YOK (Ek A R9-f); şartlar şu hükümlerden kurulur:
- **Turda acenta yetkilisinin yanında bulunacaklar (Yönetmelik m.40):** TÜRSAB onaylı işletme belgesi sureti · katılımcı listesi · araç
  kiralıksa kira sözleşmesi · başlangıç noktasını gösteren tur programı · zorunlu sigorta poliçe sertifikası sureti.
- **Rehber (1618 m.10/a):** tur başına 45 kişiye kadar en az bir çalışma kartlı turist rehberi + kapasitesi 45'i aşan her araçta bir
  rehber; yalnız tek otelde konaklama + o otele ulaşımdan oluşan turlar hariç. (Rehber sözleşmesi m.40 listesinde yok.)
- **Sigorta (1618 m.12/a):** Türkiye'de satılan paket turda zorunlu. ⚠️ Yükümlülük SATIŞTA; "poliçe yoksa tanıtım yok" kuralı yasadan
  SIKI bir platform tercihidir (K-19).
- **Taşıma:** uygun yetki belgesi (A1/A2/B1/B2/D1/D2/D4) ya da belge sahibiyle taşıma sözleşmesi; U-ETDS bildirimini acenta yapar.
- Kişi sayısı → rehber sayısı gibi hesaplar kodda; yapay zekâ "yeterli" demez. Süreli belgeler bitince tanıtım kendiliğinden kalkar
  (30 / 7 gün önce hatırlatma).

## 6. Devir

### 6.1 Belge devri (belge başka hak sahibine geçer)
Örnek (kurgusal): *Lale Turizm Ltd. Şti.*'nin seyahat acentası belgesi *Örnek Tur A.Ş.*'ye devrediliyor.

**Hukuki çerçeve (Ek A R3, yüksek güven):** 1618 m.4/3 (7244 sk., 2020) — belge Bakanlık izniyle başka bir tüzel kişiye devredilebilir;
devir **Bakanlık siciline işlendiği tarihte** hüküm doğurur, o zamana kadar devralan acentalık YAPAMAZ. Süreç: taraflar **birlikte "devir
ön izni"** alır → TÜRSAB'a dosya → Bakanlık onayı → belge devralan adına ve **yeni acenta unvanıyla** düzenlenir. Şube belgeleri merkezle
birlikte gider. **Belirsiz:** belge numarasının korunup korunmadığı · sürenin uzunluğu · devredenin süreç boyunca faaliyet gösterip
gösteremeyeceği (→ avukat).

Kurallar:
1. **Numarayı ya da fotoğrafı bilmek belgeyi almak değildir.** Devralan, sicil belgede ONU gösterene kadar `devir_bekliyor`dadır ve o
   belgeden hiçbir yetki almaz (kurucu kuralı = yasa).
2. **Devrin başladığına yalnız güvenilir bir sinyal hükmeder:** (a) mevcut sahip Lixus'ta başlattı / onayladı, (b) Bakanlığın "devir ön
   izni" resmî evrak doğrulamasından geçti (iki tarafın adı üzerinde yazar), ya da (c) sicilde hak sahibi değişti. Üçüncü bir hesabın
   "devraldım" demesi hiçbir şeyi dondurmaz (rakibin satışını durdurma yolu olmasın); mevcut sahibe bildirilir.
   ⚠️ Yasa devredenin süreç boyunca faaliyetini açıkça yasaklamıyor; "devir sürerken yeni tur tanıtımı yok" kuralı (kurucunun tablosu)
   yasadan SIKI olabilir — platform için güvenli taraf; avukata sorulur (K-6).
3. **Mevcut kayıtlar otomatik iptal edilmez;** "devir sırasında açık işler" listesi çıkar (K-6).
4. **Tamamlanma sırası (kilit çakışmasız):** devir SÜRERKEN sicil yeni hak sahibini gösterdiği an → eski sahibin kaydı **hemen**
   `devredildi` (bekçi boşalır; hüküm o an doğar). Sürmekte olan bir devir yokken kayıttaki unvanın değişmesi devir sayılmaz →
   inceleme bayrağı (§4.1; aynı şirketin unvan değişikliği de böyle görünür) → devralanın `devir_bekliyor` kaydı K2'yi geçer → K3 → `doğrulandı` (bekçi dolar) → yetkiler açılır.
   Şubeler birlikte taşınır; herkese açık profilde acenta unvanı yeni adla değişir. Belgenin kimliği "numara" değil "numara + hak sahibi
   + dönem"dir.
5. **Yorum / puan** önceki işletmecinin dönemiyle etiketli kalır, otomatik taşınmaz (K-7).
6. `devir_bekliyor` 90 günde kendiliğinden kapanır; uzayan ya da tartışmalı devir → `incelemede`.

```
Lale (mevcut sahip) devri başlatır / ön izin doğrulanır ─► Lale: doğrulandı → askıda (devir)   [yeni tur tanıtımı yok]
Örnek Tur "devraldım" der                              ─► Örnek Tur: devir_bekliyor          [yetki YOK, kilit YOK]
Bakanlık sicili: hak sahibi = Örnek Tur                ─► Lale: devredildi (kilit boşalır)
                                                          Örnek Tur: K2 ✓ → K3 (e-imzalı onay) → doğrulandı (kilit) → yetkiler
```

### 6.2 Şirket / hisse devri (şirket aynı, sahipler değişir)
- Hak sahibi (vergi numarası) aynı, sicildeki hak sahibi aynı → **belge devri yoktur**; yetkiler sürer (belge şirketindir, kişinin değil).
- Değişen: şirketi temsil eden kişiler ve Lixus hesabının kontrolü → üyelik konusu (M-2; davetle sahip Ü-6, ertelendi). Yeni temsilci için
  K3 yeniden yapılır; bütün sahiplere e-posta; olay günlüğü.
- Şirketin kendi **unvan değişikliği** kayıtta devirle aynı görünür (eşleşme unvanla yapılıyor) → otomatik karar yok, `incelemede`.

### 6.3 Tesisin işletmecisinin değişmesi
- **Basit konaklama belgesi:** 26.08.2026'dan beri miras dışında devredilemez → yeni işletmeci YENİ belge alır; eski işletmecinin o
  tesisteki kaydı kapanır, yeni işletmeci baştan doğrulanır.
- **Turizm işletmesi belgesi:** işletmeci değişikliği prosedürü doğrulanamadı → belge kimin adına düzenlenmişse yetki ondadır; kayıt
  değişmeden yeni işletmeciye yetki yok, kayıt değiştiği an eski işletmecinin o tesisteki ilanları kalkar.
- **Konut izni (7464):** konut + izin sahibine bağlı; devir hükmü doğrulanamadı → yeni sahip kendi iznini alır (avukat).

### 6.4 Yöneticinin (co-host) değişmesi
Malik daireyi başka yöneticiye verirse eski yöneticinin **yetkilendirmesi** biter → o birimdeki ilanı kalkar; yeni yönetici yeni
yetkilendirmeyle açar. İzin belgesi değişmez, belge kaydı malikindir.

## 7. Sürekli denetim
- **Sıklık (öneri, K-12):** acenta belgesi haftalık; konaklama belgeleri aylık; ayrıca **işlem öncesi** — tanıtım / ilan yayınında son
  başarılı okuma N günden eskiyse önce yeniden okunur.
- Eşikler, histerezis ve çıkışlar §4.1; bağımlı nesneler §5.4.
- **Süreli belgeler / yetkilendirmeler:** bitişten 30 / 7 gün önce hatırlatma; bitince bağlı yetki kapanır.
- **Yönetici değişiklikleri:** belge yöneten herkes için iki aşamalı doğrulama ZORUNLU (⚠️ rol bazlı zorunlu 2FA bugün yok — yeni);
  belge ekleme / silme / devir başlatma / yönlendirme adresi değişikliği taze yeniden doğrulama ister; bütün sahiplere e-posta.

## 8. Kötüye kullanım senaryoları (kırmızı takım)

| # | Senaryo | Ne olur |
|---|---|---|
| 1 | Başkasının gerçek belge numarası + sahte görüntü | Görüntü hiçbir şey açmaz; K3 (e-imzalı onay) yetkilide takılması hedeflenir — e-imza kişiye bağlıdır |
| 2 | Kayıtta olmayan sahte belge | K2'de takılır |
| 3 | Rakip, deneme hesabıyla gerçek sahibin numarasını yazıp önünü tıkamaya çalışır | Bekleyen başvuru kilitlemez; paralel; K3'ü ilk bitiren kazanır (§4) |
| 4 | Gerçek şirketin çalışanı belgeyi kendi hesabına bağlar | Varsayılan K3 şirket yetkilisinin e-imzası (çalışan sağlayamaz); kayıtlı adrese giden onay isteği yalnız ek kanal |
| 5 | "TÜRSAB'dan arıyoruz, kodu okur musunuz?" (kod aktarma) | Kod başvuranın ekranına girilmez; onay sahibin tarafında verilir (§3.3) |
| 6 | E-posta güvenlik tarayıcısı onay bağlantısına kendiliğinden tıklar | Bağlantı yalnız sayfa açar; onay POST ile |
| 7 | Eski çalışan / eski web ajansı "bu ben değilim" der | İtiraz yalnız yeni açılışı dondurur; askıya almayı operatör verir |
| 8 | Rakip sahte devir bildirir | Üçüncü taraf beyanı hiçbir şeyi dondurmaz (§6.1-2) |
| 9 | Belge iptal edildi, Lixus'ta "eşleşti" duruyor | Periyodik + işlem öncesi okuma; işaret N günde kendiliğinden kalkar; gösterim anında hesaplanır |
| 10 | Kaynak dalgalanıyor (bulundu / bulunamadı) | Eşik + histerezis; alarm geçiş tabanlı (§4.1) |
| 11 | Devir sicile işlendi, eski sahip iki kontrol arasında tanıtıma devam ediyor | İşlem öncesi okuma yaşı sınırı; sicil değişince eski kayıt hemen `devredildi` |
| 12 | Doğrulamadan sonra yönlendirme adresi / ödeme yeri sahte sayfaya çevrilir (ya da hesap ele geçirilir) | Yönlendirme yalnız kayıtlı satış kanalı alan adına; değişiklik yeniden doğrulama + bütün sahiplere e-posta + bekleme süresi; asistan önerisi `payment-method-guard`a tabi |
| 13 | Vergi numarası / belge numarasıyla yoklama ("başka hesapta mı?") | Tek genel cümle + hız sınırı; çakışma yalnız operatörde (§3.3) |
| 14 | Sahte "resmî sorgu" sitesi / kullanıcının verdiği bağlantı | Kaynak alan adları kodda tek liste, tam eşleşme (§3.2) |
| 15 | Bizim bildirim e-postamızı taklit eden oltalama | E-posta şifre, kod ya da ödeme istemez ve bunu yazar; bağlantı yalnız lixusai.com'a |
| 16 | Süresi dolup başkasının aldığı alan adı (DNS TXT yöntemi) | DNS kanıtı tek başına yüksek riskli yetkiye yetmez |
| 17 | Aynı şirket iki hesapla aynı belgeyi kullanır | Doğrulanmışta tek bekçi; ikincisi `incelemede` |
| 18 | Grup kısıtı dışı tur (C grubu yabancıya) | Tur türü kuralı oluşturma ve yayın anında; asistan C grubunu önermez |
| 19 | Tek operatör tek başına sahte onay verir | Kayıt okuması yeniden üretilebilir sorgu kaydıyla; adres alanları kayıttan kopyalanır; etkisi yüksek onayda 24 saat bekleme + sahiplere bildirim; Faz 2 okuyucusu elle doğrulananları yeniden okur; operatör işlemi `/admin`'den (bürünme salt-okunur — repo kuralı K8) |
| 20 | Belge metnine talimat gömme | Karar modelde değil; Faz 1a–2'de model hiç yok |
| 21 | Doğrulaması olmayan belge (sigorta poliçesi) | Ekranda "eşleşti" değil **"beyan edildi"** |

## 9. Mevcut kodla ilişki (envanter 11-06, Opus kontrolüyle düzeltildi)

| Gereken | Bugün | Not |
|---|---|---|
| Şirket kimliği (unvan, vergi no) | **YOK** — `Organization` yalnız `name` | Yeni hak sahibi tablosu (ad: §2.1) |
| Daire tipi, izin / belge numarası | **YOK** — `Property` adres / şehir / ülke | Belge ↔ birim bağlantısı |
| Belge yükleme | Yalnız görev fotoğrafı (JPEG / PNG / WebP, 5 MB, görev şart, anahtar `org/{id}/task/{id}/…` sabit) | Faz 1a'da GÖRÜNTÜ YOK. İleride: PDF + yeni anahtar biçimi + sihirli bayt + indirme (`attachment`); ⚠️ `ALLOW_LEGACY_LOCAL_UPLOADS` kaçış yolu (oturumsuz `public/uploads`) belge yüklemesine ASLA devredilmez |
| Silme kuyruğu | `StorageDeletion` var ama **görev biçiminde olmayan anahtarı sessizce düşürür**; sahipsiz dosya temizliği ve hesap silme anahtarları yalnız `TaskUpdate.photoUrl`dan toplar | Belge görüntüsü saklanacaksa üçü de genişletilmeli (yoksa ya hiç silinmez ya 24 saatte silinir) |
| Özel depolama + imzalı GET | Var (300 sn) | Aynısı |
| Denetim kaydı | `AuditLog`, `writeAuditInTx` | Belge olayları ayrı yalnız-ekle tablo; saklama kuralı ayrı |
| Operatör onay sırası | **YOK** | Yeni `/admin` ekranı |
| Rol kapısı | `withOwner`, üyelik rolleri | Belge yönetimi yalnız sahip; **rol bazlı zorunlu 2FA YOK** (yeni) |
| Kodla doğrulama kalıbı | Var (e-posta doğrulama: fragment + POST; kanal bağlama: süreli kod + deneme sayacı) | Onay sayfası için aynı desen |
| Benzersizlik bekçisi | Var (`Membership.singleMembershipGuard`, `CheckoutIntent.openKey`) | Belge kilidi için aynı desen |
| Şifreli alan / ayrı HMAC sırrı | Var (`encryptSecretBound`; `HOST_CHANNEL_HMAC_SECRET` emsali) | Vergi no şifreli + ayrı anahtarlı özet |
| Geçiş tabanlı alarm | `alertOnTransition` (başarılı okumada temizlenir) | Histerezis gerekli |
| Kanal yetenek manifestosu | Yalnız kanallar için, gönderimde okunmuyor | Belge yetkileri ayrı tablo; HER gösterimde okunur |
| Hukuk metinleri | `(legal)/kosullar` …, `LEGAL_VERSION` | Yeni maddeler §11.4 |
| Ad çakışmaları | `Entitlement` (plan), kanal "credential", `src/lib/legal-entity.ts` (Lixus satıcısı) | §2.1'deki adlar |

## 10. Veri modeli

**Faz 1a (en küçük; migration ayrıca onayla):**
```
LicenseHolder   id · organizationId · tür (şirket | şahıs) · ticariUnvan · unvanNormalize · vergiNoŞifreli? · vergiNoÖzet (ayrı HMAC)
                · tcknÖzet? (yalnız özet) · bekçi? (@unique; yalnız doğrulanmış hak sahibinde dolu)
BusinessLicense id · organizationId · holderId · tür · numara · numaraNormalize · nitelikler (tür bazında şema) · durum · askıSebebi?
                · sürüm (CAS) · bekçi? (@unique; yalnız doğrulandı / askıda) · sonBaşarılıOkuma? · işaretBitişi? · bekleyenBitişi?
LicenseUnit     lisansId · birimId · bekçi? (konut izninde (tür, numara, birim) kilidi)
LicenseEvent    id · lisansId · önceki → sonraki · sebep · yapan (kişi | sistem | operatör) · kanıt (sorgu kaydı, imza doğrulama sonucu,
                özetler) · zaman                                                                       — YALNIZ EKLE
```
**Faz 1b:** `UnitMandate` (yetkilendirme; ilan özelliğinden ÖNCE). **Sonra:** `LicenseTransfer` (Faz 3) · `AgencyAgreement` (Faz 3) ·
`LicenseDocument` (görüntü kasası; ancak avukat + aktarım dayanağıyla) · `RegistryReading` ayrı tablo (Faz 2'de okuma sayısı artınca).
- Bütün sorgular hesap kapsamlı (`api-route-scoping` pini); ⚠️ o pin "başka hesapta" sızıntısını yakalamaz → ayrı davranışsal test.
- Yeni tablo sonradan eklemek güvenli (dolu tabloya zorunlu sütun / `@unique` eklenmez kuralı yeni tablolarda sorun değil).

## 11. Hukuk ve KVKK

### 11.1 Konumumuz neyle değişir
Bugünkü beyan (avukat talebi §8): "ilan yayınlamaz, rezervasyon almaz, ödeme aracılık etmez".
- **Faz 1a ("eşleşti" işareti):** konum büyük ölçüde aynı; ama işaret bir beyandır → sorumluluk sınırı maddesi (§11.4).
- **Konaklama ilanı:** Lixus "aracı hizmet sağlayıcı" sayılabilir → numarayı Bakanlık veri tabanından doğrulama ve gösterme (7464 Tebliği
  RG 31.12.2025; 2634 m.33 — 7565 sk.); uyarıdan sonra 24 saatte kaldırılmayan içerik için ceza; "satışa kapalı" ilan da ihlal (Genelge
  2026/4 — tam metin doğrulanamadı, orta güven).
- **Tur:** acenta ürünleri seyahat dışı e-ticaret alanlarında satılamaz (m.17/3); TÜRSAB Ocak 2026'da yabancı tur / konaklama
  platformlarına erişim engeli davası açtı (ikincil).
- **Ödeme tahsili:** ödeme hizmetleri mevzuatı (lisanslı kuruluş), iade, sorumluluk.
- **Yabancı platform teklifi:** "Yabancı Dijital Konaklama Platformları" teklifi komisyondan geçti (yasalaşırsa 01.01.2027; ikincil).
  ⚠️ Avukat talebine göre satıcı yurt dışında mukim — teklifin Lixus'a etkisi ve API başvurusunu hangi tüzel kişinin yapacağı (K-27)
  avukata.

### 11.2 Avukata sorular (avukat paketi §8'in devamı)
1. Lixus'ta konaklama ilanı / doğrudan rezervasyon sayfası açarsak "aracı hizmet sağlayıcı" sayılır mıyız? Bakanlık Veri Doğrulama
   API'sine (Genelge 2026/4) kim, hangi koşulla başvurur — yurt dışında mukim satıcı başvurabilir mi?
2. Turlar: yalnız tanıtım + acentanın kendi satış kanalına yönlendirme (m.17/3) ek yükümlülük doğurur mu? Lixus acentanın kendi online
   satış kanalının yazılımı olursa (satıcı acenta; kanalı acenta bildirir) bu "acentanın kendi kanalı" sayılır mı?
3. Otel, misafirine anlaşmalı acentanın turunu tanıtıp yönlendirebilir mi; komisyon alabilir mi?
4. Belge devri sürerken (ön izin → sicile işlenme) devreden acenta faaliyet gösterebilir mi; platform yeni tanıtımı durdurmalı mı?
5. Doğrulama kanıtlarını (sorgu kayıtları, imza doğrulama sonuçları, olay günlüğü) ne kadar saklamalıyız / saklayabiliriz; hesap silinince
   ne olur (iz silme riski)?
6. Resmî kayıt sayfalarını otomatik sorgulamak hukuken mümkün mü?
7. "Bakanlık kaydıyla eşleşti" ifadesi ve TÜRSAB / Bakanlık adının kullanımı; sorumluluk sınırı.
8. Temsil kanıtı olarak e-imzalı onay (müşterek temsilde bütün imzalar) yeterli mi; TCKN işleme dayanağı.
9. Yabancı platform teklifi yasalaşırsa Lixus'u (satıcı yurt dışında) etkiler mi?

### 11.3 KVKK
- **Bütün altyapı sağlayıcılarımız yurt dışında** (avukat talebi §3) → belge görüntüsü saklamak da, imza dosyasını işlemek de yurt dışına
  aktarımdır. **Faz 1a'da görüntü saklanmaz;** e-imza dosyası işlenir, saklanmaz — yalnız doğrulama sonucu + özet kalır. Belge kasası ancak
  aktarım dayanağı kurulup avukat onayladıktan sonra.
- TCKN yalnız anahtarlı özet; vergi numarası şifreli + özet; erişim yalnız hesabın sahipleri + operatör (günlüklü); aydınlatma metnine
  madde.

### 11.4 Koşullara girecek maddeler (taslak, avukata; Ü-6 maddesiyle aynı turda)
- İşletme, bildirdiği belgelerin doğru, geçerli ve kendisine ait olduğunu; iptal, askı, devir ve işletmeci değişikliğini derhal
  bildireceğini beyan eder.
- "Eşleşti" işareti yalnız belgenin belirtilen tarihte resmî kayıtla eşleştiğini gösterir; hizmet kalitesini ya da mevzuata tam uyumu
  garanti etmez.
- Lixus, resmî kayıtla uyuşmazlık, itiraz ya da devir hâlinde ilgili özellikleri askıya alabilir.
- Başkasına ait ya da sahte belge kullanımı hesabın kapatılması ve yetkili makamlara bildirim sebebidir.

### 11.5 Ayrı bulgu (bu özelliğin dışında — doğrulanmalı)
Genelge 2026/1 (16.04.2026; Ek A R4): belgeli konaklama tesisleri **ve yazılım sağlayıcıları** Merkezi Turizm Veri Tabanına API ile veri
göndermek zorunda olabilir. Lixus otellere PMS olarak satılırsa doğrudan ilgili → avukat + ayrı tasarım.

## 12. Aşamalar
- **Faz 0 — kararlar + hukuk:** bu belge + Codex önerisi + kurucunun son akışı (§13); avukat soruları (§11.2).
- **Faz 1a — görüntüsüz doğrulama + "eşleşti" işareti:** §10'daki dört tablo; operatör `/admin`'de resmî kaydı okur (yeniden üretilebilir
  sorgu kaydı), yetkili e-imzayla onaylar, belge ve kapsam başına süreli işaret çıkar. Satış / ilan / devir / otomatik okuma YOK.
- **Faz 1b — yetkilendirme (yönetici) + konut izni:** `UnitMandate`; konut izni için Bakanlık API'si (K-17) gelmeden ilan yok.
- **Faz 2 — otomatik kayıt okuma + sürekli denetim + itiraz:** bağdaştırıcılar (kullanım koşulları izin veriyorsa), §4.1 eşikleri,
  histerezisli alarm, onay isteği / itiraz, elle doğrulananların yeniden okunması.
- **Faz 3 — yetki kapıları gerçek özelliklerde:** ilan yayını / tur tanıtımı, bağımlı nesneler (§5.4), Bakanlık uyarısı akışı, devir,
  anlaşmalar.
- **Faz 4 — tur hazır olma:** rehber / araç / sigorta, süre hatırlatmaları.
- Her fazda: kırmızı-önce testler, mutasyon, tam kapı; müşteriye giden her metin önce / sonra örnekli kurucu onayı; üçüncü kişiye giden
  ilk e-postalar kurucuyla birlikte.

## 13. Karar noktaları — üçlü karşılaştırma tablosu
Codex'in ve kurucunun önerisi aynı satırlara yazılır; farklar satır satır görünür, "Seçilen" sütunu kurucunundur.

| # | Karar | Seçenekler | Claude önerisi | Kurucu | Codex | Seçilen |
|---|---|---|---|---|---|---|
| K-1 | Kapsam | (a) yalnız "eşleşti" işareti · (b) + Lixus'ta konaklama ilanı / doğrudan rezervasyon · (c) + acentanın tur tanıtımı · (d) + otelin misafirine anlaşmalı acenta turu (asistan da önerir) | Çekirdek dördünü taşır; ilk açılan (a) | | | |
| K-2 | Ödemeyi kim alır | (a) işletme kendi alır, Lixus yönlendirir · (b) Lixus tahsil eder | (a); (b) ancak avukat + ödeme kuruluşuyla | | | |
| K-3 | Hangi yetki hangi kanıtı ister | İşaret · ilan · tur tanıtımı | İşaret ve ilan: K2 + K3 · tur tanıtımı: + ilk açılışta K4 | | | |
| K-4 | K3'ün varsayılan yolu | (a) e-imzalı onay · (b) belge seti + operatör · (c) kayıtlı adrese onay isteği · (d) DNS | (a); (b) yedek; (c) alan doğrulanırsa ek; (d) yalnız destek | | | |
| K-5 | "Bulunamadı / okunamadı" eşikleri | N okuma / 24 saat · T gün | Bulunamadı: 3 ardışık okuma + 24 saat · okunamadı: tur 7, konaklama 30 gün | | | |
| K-6 | Devirde açık kayıtlar + devreden faaliyet | Otomatik iptal · eski sahip · yeni sahip · operatör | Otomatik iptal YOK; operatör iki tarafla; devir sürerken yeni tanıtım yok (yasadan sıkı) | | | |
| K-7 | Devirde yorum / puan | Taşınır · taşınmaz · etiketli | "Önceki işletmeci dönemi" etiketiyle | | | |
| K-8 | Belge görseli herkese açık mı | Görsel · numara + kaynak + tarih | Numara + kaynak + son kontrol tarihi; görsel yok | | | |
| K-9 | Bir şirket kaç hesapta doğrulanmış olabilir | Tek · serbest | Tek (şube belgeleri merkezle aynı hesapta) | | | |
| K-10 | C grubu kısıtı | Tur türü kuralı + beyan · misafirden vatandaşlık | Kural + beyan; asistan C grubunu önermez | | | |
| K-11 | Tur tanıtımının ilk açılışında operatör | Yok · ilk tur · her yeni tur türü | İlk tur + her yeni tür | | | |
| K-12 | Yeniden okuma sıklığı | — | Acenta haftalık, konaklama aylık + işlem öncesi ≤ 7 gün | | | |
| K-13 | Belge görüntüsü saklanır mı | Hiç · süreli | Faz 1a'da hiç; sonrası avukatla | | | |
| K-14 | Yapay zekâ belge okuma | Yok · alan önerisi | Faz 1a–2'de yok | | | |
| K-15 | İlk dilim | (a) Faz 1a · (b) bugünkü ev sahipleri için konut izin numarası | (a); (b) Bakanlık API'sine bağlı (herkese açık sorgu yok) | | | |
| K-16 | Turda Lixus'un rolü | (a) tanıtım + yönlendirme · (b) acentanın kendi kanalının yazılımı · (c) pazar yeri / satıcı | (a); (b) avukatla; (c) HAYIR | | | |
| K-17 | Bakanlık Veri Doğrulama API'si | Şimdi · ilandan önce · hiç | Konaklama ilanı kapsamdaysa ilandan ÖNCE | | | |
| K-18 | Operatör kim; dört göz | Tek · iki | Faz 1a tek operatör + 24 saat bekleme + sahiplere bildirim; tur tanıtımında ileride iki | | | |
| K-19 | "Poliçe yoksa paket tur tanıtımı yok" (yasadan sıkı) | Evet · hayır | Evet (platform güvenliği) | | | |
| K-20 | "Eşleşti" işaretinin yeri, metni, süresi | — | Mülk sayfası + (ileride) ilan; kaynağa göre metin; 30 gün okunmazsa kalkar | | | |
| K-21 | Bekleyen başvurunun süresi; paralel başvuruda kazanan | — | 14 gün; hesap başına 3; K3'ü ilk bitiren | | | |
| K-22 | Üçüncü kişiye (resmî adres) giden e-posta | İçerik · sıklık | Yalnız onay isteği; belge başına haftada 1; ilk denemeler kurucuyla | | | |
| K-23 | Bakanlık uyarısı (24 saat) sorumlusu | Kurucu · operatör nöbeti | Kurucuya soru | | | |
| K-24 | Hesap silinince olay / okuma kayıtları | Silinir · süreli saklanır | Avukat; önerim süreli saklama (iz silme riski) | | | |
| K-25 | Yönetici (co-host) yetkilendirmesi | Faz 1b · sonra | Faz 1b (ilan özelliğinden önce şart) | | | |
| K-26 | Grup / unvan değişikliği | Otomatik · insan | Grup daralırsa otomatik kısıt; genişleme ve unvan değişikliği insan | | | |
| K-27 | API başvurusunu hangi tüzel kişi yapar | — | Avukat (satıcı yurt dışında mukim) | | | |
| K-28 | Özellik hangi planda | Bütün planlar · üst plan | Kurucuya soru | | | |

## 14. Kurucuya sorular
- **S1 — Bu özellik kimin için, hangi sırayla?** (K-1, K-16) Örnek: misafir "Kapadokya'da balon turu var mı?" yazınca asistan yalnız
  doğrulanmış A grubu acentaların turlarını tanıtıp acentanın kendi sitesine yönlendirsin (d) mi; acentalar Lixus'ta tur tanıtımı açsın (c)
  mi; yoksa önce yalnız oteller / ev sahipleri belgelerini eşleştirsin (a) mı? Not: yönetmelik satışı acentanın kendi kanalına bırakıyor;
  Lixus'un turu kendisinin satması önerimde yok.
- **S2 — Ödemeyi kim alacak?** (K-2) Önerim: işletme kendisi alır, Lixus yönlendirir.
- **S3 — "Konaklama ilanı" Lixus'ta herkese açık bir ilan / doğrudan rezervasyon sayfası mı?** Öyleyse numara doğrulaması yasal
  yükümlülüğümüz olur ve konut izni için Bakanlık API'si şart (K-17).
- **S4 — Devirde eski sahibin açık kayıtları için kim karar versin?** (K-6) Önerim: operatör iki tarafla; otomatik iptal yok.
- **S5 — Bir şirket yalnız tek hesapta doğrulanmış olsun mu?** (K-9) Önerim: evet.
- **S6 — İlk dilim:** Faz 1a (görüntüsüz doğrulama + "eşleşti" işareti) uygun mu? (K-15)
- **S7 — Bakanlık uyarısı geldiğinde 24 saat içinde ilanı kim kaldıracak?** (K-23) — ilan özelliği açılırsa.
- **S8 — Özellik hangi planda olsun?** (K-28)

## 15. Opus sert incelemesi (11-06) → uygulanışı
Bulgular `scratchpad/opus-isletme-belgesi-inceleme.md`'de; kodla ilgili iddialar repoda doğrulandı (silme kuyruğu, bekçi deseni, HMAC
emsali, avukat talebindeki yurt dışı bilgileri — hepsi doğru).

| # | Bulgu | Uygulanışı |
|---|---|---|
| P1-1 | Numarayı yazmak belgeyi / şirketi kilitliyordu (rakip önünü tıkar) | Kilit yalnız doğrulanmışta; bekleyen paralel + süreli; ilk K3 kazanır (§4) |
| P1-2 | Devirde eski "askıda" + yeni "bekliyor" aynı dizini çiğniyordu | Bekçi sütunu; sicil değişince eski kayıt hemen `devredildi`, yeni ancak sonra (§6.1-4) |
| P1-3 | `askıda` tek durumdu; "bulunamadı → hemen askı" F16'ya aykırıydı; yarış | Sebep başına çıkış tablosu, eşik + histerezis, CAS, işlem öncesi okuma durumu değiştirmez (§4.1) |
| P1-4 | Yayındaki ilan / tanıtım / önbellek kendiliğinden kapanmıyordu; 24 saat uyarısı yoktu | Bağımlı nesneler tablosu + Bakanlık uyarısı akışı (§5.4) |
| P1-5 | K3 birincil yolu Ek A'da dayanaksızdı; "dolandırıcı takılır" mutlak iddiaydı | Yöntemlere dayanak sütunu; varsayılan e-imzalı onay; iddia yumuşatıldı (§3.3, §8-1) |
| P1-6 | Kod aktarılabilir; bildirim aynı adrese; itiraz tek tıkla askı; sınır yok | Onay sahibin tarafında + POST; itiraz yalnız yeni açılışı dondurur; gönderim sınırı (§3.3) |
| P1-7 | Yönetici (co-host) modeli yoktu | Yetkilendirme kaydı + konut izninde (tür, numara, birim) (§2.1, §6.4, Faz 1b) |
| P1-8 | Genel "doğrulanmış işletme" rozeti yanıltıcıydı, süresizdi | Belge + kapsam başına, kaynağa göre metinli, süreli "eşleşti" işareti (§5.2, K-20) |
| P1-9 | Yurt dışı aktarım yapay zekâdan ibaret değil (bütün altyapı yurt dışında) | Faz 1a'da görüntü yok; e-imza işlenir saklanmaz (§11.3) |
| P2-10 | Yönlendirme adresi / ödeme yeri sonradan değiştirilebilir | Kayıtlı alan adı + yeniden doğrulama + bekleme + `payment-method-guard` (§5.2, §8-12) |
| P2-11 | "Lixus yerli" yanlıştı; genelge cümleleri kesin yazılmıştı; 2026/1 Ek A'da yoktu | Düzeltildi; güven düzeyleri; Ek A R4'e eklendi; K-15(b) API notu |
| P2-12 | Eşleşme fiilen unvanla; grup / unvan değişimi askıya alıyordu | Eşleşme anahtarı açık; grup daralma / genişleme ve unvan değişikliği kuralları (§3.2, §4.1, §6.2) |
| P2-13 | DNS / web dosyası SSRF, müşterek temsil, şahısta sunan kim | DNS TXT, temsil şekli + bütün imzalar, şahısta kendi e-imzası (§3.3) |
| P2-14 | "Başka hesapta" sızıntısı; özet anahtarı; TCKN tutarsızlığı | Genel cümle + hız sınırı; ayrı HMAC sırrı; TCKN yalnız özet (§3.3) |
| P2-15 | §9'da silme kuyruğu iddiası yanlıştı; eksik notlar | §9 düzeltildi |
| P2-16 | "Satış" dili; rehber sözleşmesi çelişkisi; "belgedeki unvan" | Eylemler ilan / tanıtım / yönlendirme; örnekler düzeltildi (§5.1, Ek B) |
| P2-17 | Faz 1'de tek operatör tek başına | Yeniden üretilebilir sorgu kaydı, kayıttan kopyalanan alanlar, 24 saat bekleme, yeniden okuma, `/admin` (§3.2, §8-19) |
| P2-18 | Faz 1 fazla büyüktü | Faz 1a: dört tablo, görüntüsüz (§10, §12) |
| P2-19 | Eksik kararlar | K-18 … K-28 |
| P3-20 | Alan adı listesi, oltalama, şube | Kaynak alan adları tek liste; e-posta şifre / kod istemez; K-9 şube notu |

**Haiku tutarlılık incelemesi (11-06):** 11 madde; 9'u uygulandı (atıflar, yetkilendirmenin Faz 1b'de olması, barkod dayanağı, bayrak /
askı ayrımı, "varsa iletişim", K2 ile K3 sonrası ayrı metinler, devir metninin alıcısı, oltalama cümlesi); 2'si gerekçeyle reddedildi —
"kayıttaki unvan farklı" cümlesi sızıntı değil (resmî kayıt herkese açık, başka bir Lixus hesabından söz etmiyor); onay e-postasında
başvuran hesabın adı belge sahibinin karar verebilmesi için gerekli.

## Ek A — Araştırma: hukuki bilgiler (kaynaklı, güven düzeyiyle)
Opus araştırma ajanı, 11-06. Bu ortamın ağ ayarı `mevzuat.gov.tr` ve `tursab.org.tr`'yi doğrudan açtırmadı; bulgular resmî metinlerden
arama alıntılarıyla derlendi, "(ikincil)" yalnız ikincil kaynakta bulunanı gösterir. Avukat onayı yerine geçmez.

- **R1 Gruplar (yüksek):** A — 1618 m.1'deki bütün hizmetler (yurt içi / gelen / giden tur, paket tur, bilet, başka acentanın ürünü).
  B — kara / deniz / hava bileti + A grubunun turlarını satar; kendi turunu düzenleyemez. C — yalnız Türk vatandaşlarına yurt içi tur;
  yabancıya ya da yurt dışına tur yapamaz. B ve C, A grubu ürünlerini satabilir; başka acentanın ürünü satılıyorsa ürün sahibi acenta
  sözleşmede açıkça yazılır (2024). Hac / umre yalnız A grubu + Diyanet yetkisi. 2019–2026 arasında grup yapısında değişiklik bulunmadı.
  mevzuat.gov.tr/MevzuatMetin/1.5.1618.pdf · mevzuat.gov.tr/MevzuatMetin/yonetmelik/7.5.11648.pdf
- **R2 Kayıt ve sorgular (orta):** grup ve numara işletme belgesinde, Bakanlık sicilinde (1618 m.4/3) ve TÜRSAB sicilinde. Bakanlık
  "Seyahat Acentası Arama" (acenta unvanı, ticari unvan, belge no, il, grup, belge durumu; sonuçta iletişim bilgisi olup olmadığı
  doğrulanamadı): yatirimisletmeleruygulama.kultur.gov.tr/acente.web.sorgu/sorgu/acentesorgu · TÜRSAB acenta arama:
  online.tursab.org.tr/publicpages/embedded/agencysearch/ · TÜRSAB dijital doğrulama kayıtlı web adresini gösteriyor (ikincil). Resmî
  kayıtlarda vergi numarası alanı görülmedi. **Bakanlık Veri Doğrulama Sistemi (API):** Genelge 2026/4 (14.08.2026), aracı hizmet
  sağlayıcılar ve acentalar için; kapsamı konaklama tesisi ve konut belge numaraları (acenta belgesi için API bulunamadı); tam metin ve
  başvuru koşulları doğrulanamadı (orta). Resmî olmayan "TÜRSAB sorgu" siteleri var.
- **R3 Devir (dayanak ve süreç yüksek; numara ve süre düşük):** 1618 m.4/3 (7244 sk., 2020) — §6.1'deki çerçeve. Şube ayrı belgedir,
  merkezle birlikte devredilir; grup değişikliğinde belge yeniden düzenlenir. yigm.ktb.gov.tr/TR-269251/seyahat-acentasi-isletme-belgesi-devri-talebi.html
- **R4 Konaklama (yüksek):** Bakanlık: turizm yatırımı belgesi (işletme izni değil) + turizm işletmesi belgesi (kısmi dahil); valilik /
  il müdürlüğü: basit konaklama belgesi (RG 25.09.2021). 7334 sk. (RG 28.07.2021): ruhsatlı her konaklama işletmesi Bakanlık belgesi almak
  zorunda; belgesiz işletme faaliyet gösteremez. 7565 sk. (2025) 2634 m.33: belgesiz tesis ilanına ilan başına 25.000 TL; platform numarayı
  Bakanlık veri tabanından doğrulayıp göstermek zorunda; uyarıdan sonra 24 saatte kaldırılmayan ilana aynı ceza. Basit konaklama belgesi
  26.08.2026'dan beri miras dışında devredilemez. Herkese açık sorgu: ktb.gov.tr/genel/searchhotelgenel.aspx (sonuçlanmamış işlemler
  görünmeyebilir). Bakanlık e-imzalı evrakı e-Devlet'te doğrulanabiliyor. **Genelge 2026/1 (16.04.2026; tga.net.tr kopyası):** belgeli
  tesisler ve yazılım sağlayıcıları Merkezi Turizm Veri Tabanına API ile veri göndermek zorunda — tam metin okunmadı (orta / düşük).
- **R5 7464 (çerçeve yüksek; tutarlar orta):** yürürlük 01.01.2024; ≤100 günlük kiralama; izin konut bazında (aynı kişinin aynı binadaki
  konutları tek belgede, her konuta plaket); başvuru e-Devlet'ten; numara il plaka koduyla başlar; numara her tanıtım ortamında okunaklı
  yer alır. Taban cezalar: izinsiz kiralama konut başına 100.000 TL (15 gün sonra 500.000 TL); izinsiz konutun kiralanmasına aracılık
  sözleşme başına 100.000 TL; aracı hizmet sağlayıcı uyarıdan sonra 24 saatte kaldırmazsa konut başına 100.000 TL (m.4/1-e) — yıllık
  yeniden değerlenir. Tebliğ (RG 31.12.2025): ilan veren herkes numarayı Bakanlık veri tabanından doğrulayıp göstermeli. Genelge 2026/4:
  "satışa kapalı" ilan da ihlal (orta). Herkese açık konut izni sorgusu bulunamadı. Bekleyen: yabancı dijital konaklama platformları
  teklifi (ikincil). mevzuat.gov.tr/MevzuatMetin/1.5.7464.pdf · resmigazete.gov.tr/eskiler/2025/12/20251231-7.htm
- **R6 Tur (rehber ve sigorta yüksek; otel / platform orta):** tur ve paket tur lisanslı acentanın; otel istisnası bulunamadı; acenta
  ürünleri seyahat dışı e-ticaret alanlarında satılamaz, yalnız tanıtım + acentanın kanalına yönlendirme (yönetmelik m.17/3). Rehber
  1618 m.10/a; sigorta 1618 m.12/a; taşıma yetki belgeleri + U-ETDS. "TÜRSAB araç plakası" güncel metinde yok.
- **R7 Gösterme (numara yüksek; görsel ve logo düşük):** belge numarası ve acenta unvanı online satış kanallarının açılış sayfasında ve
  sayfa sonlarında (m.17/3); online kanallar Bakanlığa ve TÜRSAB'a bildirilir. TÜRSAB logosunu kullanma zorunluluğu yok; üçüncü kişinin
  kullanması marka riski. Görseli yasaklayan hüküm yok; mevzuat numara istiyor.
- **R8 Temsil kanıtı (orta):** Ticaret Sicili Gazetesi araması (yetkili atamaları) · MERSİS belge doğrulama kodu (ikincil) · vergi levhası
  doğrulaması (koşullu) · e-Devlet barkodlu belge doğrulama (barkod + belgeye özgü bilgi) · KEP zorunlu değil, rehberi yok · e-Tebligat
  adresleri herkese açık değil.
- **R9 ChatGPT iddiaları:** (a) büyük ölçüde doğru (C de A ürünü satabilir; "yetkili A grubu" ifadesi kanunda yok) · (b) doğru (giriş
  aidatı gruplar için aynı; teminat gruba göre değişir) · (c) büyük ölçüde doğru (1618 m.10/a; +45'i aşan araç; tek otel istisnası) ·
  (d) doğru (sicile işlenince hüküm doğurur) · (e) doğru · (f) kısmen doğru ("tur dosyası" tanımlı değil; m.40 listesi §5.5).
- **Doğrulanamayanlar:** madde metinlerinin birebir hâli · sorgu sonuç alanları (iletişim, iptal / askı gösterimi) · devirde numaranın
  korunması ve süre · belgesiz acentalık cezasının maddesi · belgelerde barkod / QR · herkese açık konut izni sorgusu · Genelge 2026/4 ve
  2026/1'in tam metni · otomatik sorgu kullanım koşulları · vergi levhası doğrulama koşulları · yabancı platform teklifinin ve TÜRSAB
  davasının son durumu.

## Ek B — Müşteriye giden örnek metinler (sade; onaya tabi)
- Başvuru alındı (çakışma dahil her durumda aynı): "Başvurunuzu aldık. Kontrol ettikten sonra size haber vereceğiz."
- Kayıtta bulundu (K2 tamam, K3 bekliyor): "12345 numaralı belge Bakanlık kaydında bulundu. Son adım: şirket yetkilisinin e-imzalı
  onayı."
- Doğrulandı (K2 + K3): "12345 numaralı belgeniz 3 Kasım'da Bakanlık kaydıyla eşleşti ve hesabınıza bağlandı."
- İşaret (mülk sayfasında): "Bu daire için izin numarası Bakanlık kaydıyla eşleşti · son kontrol 3 Kasım"
- Kayıtta yok: "Bu numarayla resmî kayıtta bir belge bulamadık. Numarayı kontrol edip yeniden deneyin."
- Uyuşmazlık: "Resmî kayıttaki unvan, girdiğiniz unvanla aynı değil. Unvanı kontrol edin ya da ekibimizin incelemesini bekleyin."
  (Resmî kayıt herkese açık; bu cümle başka bir Lixus hesabı hakkında bilgi vermez.)
- Askı (kayıtta iptal): "Resmî kayıtta belgeniz geçerli görünmüyor. Bu belgeye bağlı ilan ve tanıtımlar yayından kaldırıldı. Bir hata
  olduğunu düşünüyorsanız bize yazın."
- Devir (yalnız belgenin mevcut sahibine): "Bu belge için devir başladı. Devir resmî kayıtta tamamlanana kadar bu belgeyle yeni tur tanıtımı açılamaz."
- Resmî adrese onay isteği (yalnız o yöntem açıksa): "Lixus'ta Lale Turizm hesabı, 12345 numaralı belgenizi kendi hesabına bağlamak istiyor.
  Siz başlattıysanız lixusai.com'daki sayfadan onaylayın; başlatmadıysanız reddedin. Bu işlem için sizden şifre, kod ya da ödeme
  istemeyiz. Şüphe duyarsanız lixusai.com'u kendiniz açıp kontrol edin." (Başvuran hesabın adı bilerek yazılır: belge sahibi onu
  tanıyıp tanımadığına göre karar verir.)
