# İNCELEME 2026-11-13 gece — günün işinin iki bağımsız incelemesi (Haiku D5 + Opus sert inceleme) ve sonuçları

> Kural (kurucu 11-13, CLAUDE.md): "ajan hata bulmak için hata bulmaz; hata olmayanı hata gibi göstermek çok daha kötüdür". Her bulgu kodda
> doğrulandı; yanlış çıkan bulgu "yanlıştı" diye yazılır. Kapsam `40dc29b9..` (UX kararları, ödeme onayı, Girişler'den atama, "Giriş mesajını
> gönderin", yerel sır taraması). Ajan raporları `scratchpad/handoff/` altında (repoya alınmadı).

## 1. Haiku — "Giriş mesajını gönderin" (D5) dar incelemesi: 6 bulgu, 6'sı doğru
| # | Bulgu | Doğrulama | Ne yapıldı |
|---|---|---|---|
| 1 | Kesin ret sonrası damga geri alınamazsa elle yolda alarm yok (mesaj bir daha denenmez, ikinci deneme "zaten gönderildi" görür) | doğru (`sendCheckinNow` `rolledBack`'i okumuyordu) | otomatik gönderimle aynı alarm (`rollback_failed`) — `5cad75e1` |
| 2 | Liste gönderimden hemen sonra yenileniyor → düğme satırdan kalkınca bileşen sökülüyor, sonuç cümlesi (belirsiz teslim uyarısı dahil) görünmeden kayboluyor | doğru | liste sonuç penceresi KAPANINCA yenilenir — `c7090deb` (kırmızı-önce 3) |
| 3 | Kalıcı kuyrukta ertelenmiş satır elle gönderimde öne çekilmiyor | doğru | ertelenmiş (hata bilgisi boş) satır öne çekilir — `5cad75e1` |
| 4 | Kuyrukta başarısız satır varken her dokunuş "zaten gönderim sırasında" | doğru | satırın durumuna göre cevap (sonra Opus B1 ile yeniden düzenlendi, §2) |
| 5 | Kuyrukta satır varken düğme sunulmaya devam ediyor | doğru | düğme gizlenir (`queuedCheckinRefs`) |
| 6 | Yükleme sürerken kapatılan pencere, önizleme cevabı gelince yeniden açılıyor | doğru | istek numarası — `c7090deb` |

## 2. Opus — günün işinin sert incelemesi: P1 1 (koşullu) · P2 0 · P3 2 · emin değilim 6 · karar bedeli 5
### 2.1 Kanıtlı bulgular — üçü de doğru, üçü de düzeltildi
- **B1 · P1 (koşullu):** kalıcı kuyruk o işletmeye açıkken "Giriş mesajını gönderin" mesajı kuyruğa yazıyor ve "birkaç dakika içinde gider"
  diyordu; kuyruk işçisi giriş mesajı satırını işletmenin OTOMATİK giriş anahtarına göre iptal ediyor (`outbox/worker.ts` `orgSwitchCancelReason`)
  — elle gönderim tam da o anahtar kapalıyken sunulduğu için misafir kapı kodunu hiç almıyordu ve bir daha gönderilemiyordu. Testler işçiyi
  koşturmadığı için görmedi. Bugün zarar yok (kuyruk anahtarı kapalı, Railway kapalı) ama açılış planı kuyruğu önce kurucu org'da açmak.
  **Düzeltme (Claude kararı — onaylanan özelliğin davranışını geri getirir, misafire giden metin değişmez):** elle gönderim kuyruğa YENİ satır
  yazmaz, doğrudan yoldan gider (ev sahibinin açık kararı otomatik anahtara bağlı değildir — elle cevap gibi). Kuyrukta otomatik göndericinin
  satırı zaten varsa bugünkü cevaplar korunur (ertelenmiş → öne çekilir; gönderildi / doğrulanamadı / uçuşta ayrı cevap); misafire ULAŞMAMIŞ
  satır (iptal / kesin başarısız) engellemez; operatörün "bekleyen gönderimleri duraklat" anahtarı bu işletmede elle gönderimi de durdurur.
  Kırmızı-önce: kuyruk açık + otomatik giriş kapalı → eski kodda mesaj gönderilmiyordu (kuyruğa yazılıyordu), yeni kodda doğrudan gider.
- **B2 · P3:** sunucu yalnız şablon sürümünü karşılaştırıyordu; arada imza, daire adı ya da misafir adı değişirse misafire onay penceresindekinden
  farklı metin giderdi. **Düzeltme:** önizleme metnin özetini (sha256) verir, gönderim onu taşır; gönderim anında yeniden kurulan metnin özeti
  farklıysa gitmez ("Mesaj ya da rezervasyon bu arada değişti").
- **B3 · P3:** yerel sır taramasında önbellekteki ikili bozulursa her koşu "sızıntı bulundu" diyordu (gitleaks'in kendi hata kodu da 1).
  **Düzeltme:** çıkarılan ikilinin sha256'sı her koşuda doğrulanır, tutmazsa yeniden indirilir (elle denendi: 100 bayta kesilen ikili geri
  geldi); sızıntı ayrı kodla (3) istenir, araç hatası "tarama YAPILAMADI" (2) olur.

### 2.2 Emin değilim — değerlendirme
| # | Konu | Hüküm | Ne yapıldı |
|---|---|---|---|
| E1 | Yönetici "Yapılamıyor" görevi yeniden atayınca yazılan durum kaydı görevi "başlanmış" saydırıyor → Girişler'den ikinci kez atanamıyor | kodda kesin; güvenli yönde (yanlış kişiyi düşürmez); temizlikçi aktarımıyla AYNI tanım (kurucu onaylı "başlanmış iş aktarılmaz") | değişmedi — soru (S-E1): "Yapılacak'a geri alma" kaydı iş sayılmasın mı? İkisini birlikte değiştirir |
| E2 | Kartla deneme fiyat kimliği ortamda değişirse açık eski sekmede uyarı görünmüyor | kodda doğru; yalnız yapılandırma değiştiği anda açık sekmede | kayıt (düşük öncelik) |
| E3 | Yükseltme onayının kanıtı "en iyi çaba" — kayıt yazılamazsa fark yine tahsil ediliyordu | doğru — cayma istisnası kanıtsız kalırdı | **düzeltildi:** kayıt tek kullanımlık onay tüketilmeden önce ZORUNLU yazılır; yazılamazsa 503, ücret alınmaz, aynı onayla yeniden denenebilir (ayrı dosyada arıza testi) |
| E4 | Kullanım Koşulları md. 20 "kullanmaya devam = kabul" | doğru | kurucunun kaydettirdiği dört sorudan (3) |
| E5 | Sır taraması betiğinin "doğrudan mı çalıştırıldı" kontrolü sembolik bağlı yolda tutmaz → tarama sessizce atlanır, kapı "yeşil" derdi | Node iç davranışı; burada tetiklenmiyor ama sessiz yeşil sınıfı | **düzeltildi:** betik koşulsuz çalışır, saf parçalar ayrı modülde (`scripts/secret-scan-core.mjs`); kaynak pini |
| E6 | Elle giriş mesajı abonelik erişimine bakmıyor | kod doğru; elle cevap da ücretsiz ("The manual send itself stays free") | değişmedi — soru (S-E6): elle giriş mesajı "elle cevap" mı, "ücretli otomatik gönderim" mi? |

### 2.3 Karar bedeli notları
K1 elle gönderim genel acil durdurmayı onurlandırır (S-1b) · K2 (B1 düzeltmesiyle kalktı: iptal / başarısız satırda doğrudan gider) · K3 tarama
commit edilmiş ağaca bakar — kapı özeti artık "sır yeşil (HEAD)" der · K4 ağsız ilk koşuda tarama kırmızı (bilinçli: taranmayan "temiz" değil) ·
K5 Girişler kesik liste cümlesi (pratikte görülmez).

### 2.4 Doğru bulduğu kritik noktalar (özet)
Otomatik gönderici ortak yardımcıya taşınırken davranışı değişmedi (satır satır) · elle ↔ otomatik ve iki sekme tek kazanan · iptal / silinmiş /
pencere dışı / metni değişmiş rezervasyona gitmez · atamanın ön şartı satır kilidinden sonra · ödeme onayında istemci ve sunucu aynı kaynaktan
karar verir, yükseltme onayı tek kullanımlık önizleme tüketilmeden önce · yasal metinler kutularla çelişmiyor.

## 3. Ders
- **İşçiyi koşturmayan kuyruk testi yarım testtir.** "Sıraya alındı" cevabını sınamak, mesajın gerçekten gideceğini sınamaz; kuyruğa giren
  yeni bir mesaj türü / yolu için işçinin veto kuralları (işletme anahtarı, abonelik, pencere) ayrıca okunur.
- **Ev sahibinin onay penceresinde gördüğü = gidecek olan** eşitliği sürümle değil metnin kendisiyle (özet) kurulur.
- **Hukuki kanıt "en iyi çaba" yazılmaz:** onay kaydı yazılamazsa işlem yapılmaz.
