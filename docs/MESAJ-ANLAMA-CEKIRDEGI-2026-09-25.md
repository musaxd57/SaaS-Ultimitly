# Mesaj anlama çekirdeği — sözcüksel kural yetkisi denetimi (2026-09-25)

Kurucu isteği (ChatGPT'nin 36 maddelik metni): "Kelime/regex kuralları anlam kararı vermesin; 'kapıda' vakasını kök
nedeniyle çöz; mantıklıysa uygula, çok büyük değişiklikse söyle." Bu belge: ne ölçüldü, bu turda ne yapıldı
(küçük, geri alınabilir, davranışı yalnız SIKILAŞTIRAN ya da hiç değiştirmeyen), ve kurucu onayı isteyen büyük mimari
öneri.

## 1. Durum tespiti (kısa)

Bugünkü mimari ChatGPT'nin tarif ettiğine sanıldığından yakın: anlam kararı zaten dört katmanın BİRLEŞİMİ (kelime ağı ·
cevap modelinin şema beyanı · bağımsız bekçi · anlama katmanı), kelime ağı yalnız SIKILAŞTIRIR (birleşim değişmezi,
09-24). Kelime ağının "izin veren" yetkisi dar ve biliniyor. Asıl açıklar üç sınıfta:

| Sınıf | Örnek (ölçüldü) | Etkisi |
|---|---|---|
| Sözcüksel kural İZİN veriyor | Kapanış kısayolu yalnız SON mesaja bakıyordu: "Bir gece daha kalabilir miyiz?" + "Tamam, teşekkürler 🙏" → model hiç çağrılmıyor, istek kuyruktan düşüyordu | Gerçek istek sessizce kayboluyordu → **DÜZELTİLDİ** (`aeda2fc`) |
| Sözcüksel kural bağlamsız ANLAM veriyor | "kapıda" her yerde ödeme yöntemi sayılıyordu → "Anahtar kapıdaki kutuda" yazan erken giriş kuralı kaydedilemiyor / okumada kapanıyordu; "Libanlı" içindeki "iban"; Türkçe büyük harf ("KAPIDA ÖDEME", "İBAN") kaçıyordu | **KÖKTEN DÜZELTİLDİ** (`91e7039`): yer sözcüğü yalnız aynı cümlecikte ödeme bağlamıyla yöntem; Türkçe katlama |
| Model metnine regex (engelleyen yön) eksik | Çıktı vetosu "I have booked a taxi", "Ev sahibinize haber verdim", "I've let the host know" gibi makbuzsuz iddiaları geçiriyordu | **GENİŞLETİLDİ** (etken 1. şahıs disiplini; 1.287 model cevabında 1 yeni veto — o da gerçek iddia) |
| Kelime ağı düşük kesinlikli ETİKET üretiyor | "Is the fireplace working?" → `safety_emergency` ("fire"); "We are departing at 10" → `rule_violation` ("parti") | Yalnız TUTAR (taslak ev sahibine) — yanlış otomatik gönderim YOK, gereksiz inceleme VAR. Düzeltmek için yama değil ölçüm gerekiyor → **karar kaydına ayrım eklendi** (`5c27689`) |

## 2. Bu turda yapılanlar (hepsi kırmızı-önce + mutasyon; migration YOK)

1. **Kapanış kısayolu** (`automation.ts`): yalnız son giden mesajdan SONRAKİ misafir mesajlarının TAMAMI kapanış/övgü
   ise devreye girer. Kırmızı-önce 3 test (cevapsız istek, cevapsız acil durum + nezaket açık, kontrol).
2. **Ödeme yöntemi süzgeci** (`payment-method-guard.ts`, eski `OFFER_PAYMENT_METHOD_RX` kaldırıldı): anlam parçalara
   ayrıldı — kendi başına yöntem adları (nakit, IBAN, havale, PayPal, Revolut, kripto, banka hesabı…) ve IBAN numarası
   her yerde; YER/BİÇİM/YÖN sözcükleri (kapıda, elden, at the door, on arrival, in person, directly, hesabıma) METİNDE
   ödeme/ücret/para birimi varsa (↓inceleme: ilk sürümün cümlecik kapsamı gerilemeydi). Minimal çift bataryası (aynı yer sözcüğü, bağlamlı/bağlamsız). **Kök regresyon testi 13d**: 13c
   fikstürünün değiştirilmesi sorunu gizlemişti (kurucu kuralı #28) — artık kapı konumu yazan not kuralı kapatmaz.
3. **Kapı kanıtı** (`gate-evidence.ts`): kapı 14 ayrı kontrolü tek `blocked`de topluyordu. Artık karar kaydında
   `g = { d: ilk kapatan kontrol, lx: kelime ağı uyarıları, mi/mt/ml: modelin kapatıcı sinyalleri }` — anlama
   katmanının niyeti zaten `ir`de. Karar DEĞİŞMEDİ (`autoReplyGateFailure` = hükmün gerekçesi, tek kaynak).
   Amaç: "yalnız kelime ağının tuttuğu" mesajları CANLI trafikte saymak — sözcüksel yetkiyi azaltma kararı buna dayanacak.
4. **Çıktı vetosu** (`output-veto.ts`): TR "haber verdim, aradım, rezerve ettim, yönlendirdim, gönderdim, hallettim…",
   EN "booked, notified, called, sent, reported, escalated, let the host know, passed … to" + "we" ajanı. Bilinen bedel
   pinli: "We have booked this flat for you…" da tutulur (taslak, güvenli yön).

### İki bağımsız inceleme (09-25, tur sonu) — düzeltilenler
- **P2 (iki ajan da buldu): ödeme süzgecinin cümlecik bölmesi GERİLEMEYDİ** — "Ödeme: kapıda", "Ödeme şekli: elden",
  "Ücret 300 TL. Kapıda alınır.", "300 TL (kapıda)" eski kalıpta reddediliyordu, ilk sürümde geçti. Kapsam METNE alındı;
  bağlamsız yer sözcüğü ("Kapıda şifreli kilit var", "Anahtar kapıdaki kutuda") hâlâ serbest. Ek: ücretli erken giriş
  notunda bağlam kuraldan gelir ("Kapıda alırız." onay metnindeki ücret cümlesinin yanına eklenir); yöntem adsız yön
  talimatı ("pay the cleaner directly", "hesabıma gönderin") ve IBAN biçimli numara. Adversaryal batarya: 35 kaçak
  cümlenin 35'i, 21 meşru notun 0'ı.
- **P2: çıktı vetosu kıvrık kesme işaretini ("I’ve", "I’ll") hiç eşleştirmiyordu** (eski dallar dahil) → düz olana çevrilir.
- **P3: ilk genişletmenin yanlış pozitifleri** ("talimatları dün size gönderdik" = gerçekten giden önceki mesaja atıf;
  "We have reserved a parking spot for every apartment" = ev sahibi olgusu; "Size ulaştık mı?" = soru) → çıkarıldı/
  daraltıldı; kaçanlar eklendi (iletiyorum, onayladım, güncelledim, I've already forwarded, I'm forwarding, I'll ask the
  host, DE/FR/ES/RU/AR). Korpusta tur öncesine göre fark: 2 yeni veto (gerçek iddia), düşen 0.
- Doğrulandı, kusur YOK: `autoReplyGateFailure` eski gövdeyle birebir (eşleme sonrası diff), `g` son kapı durumundan,
  kapanış kısayolu doğru, kendi deterministik metinlerimiz (bekletme, nezaket, devir, erken giriş onayı) vetoya takılmıyor.
- Açık bırakılan (P3, gerekçeli): kayıtlı erken giriş notu yeni kurala takılırsa kural okumada KAPANIR (fail-closed,
  form boş görünür) — özellik 09-24'te geldi, varsayılan kapalı; "yalnız notu düşür" ürün kararı. Kanal kaydında
  `kbEvidenceJson` artık NULL olmaz (`g` her kararda) — "KB kanıtı var mı" sayımı `retrieved`/`used`a bakmalı.
- Adversaryal ajanın `detectRiskType` bulguları (`açıl`→acil, `extend our stay`→iptal, `mağaza`→gaz, `compartido`→
  parti; eval metinlerinde ~%2,2 iyi huylu mesaj etiket alıyor) yalnız TUTAR, e-posta/aciliyet üretmez → §3 ve §4 Faz 3.

## 3. Ölçülen ama bu turda DOKUNULMAYANLAR (gerekçeli)

- **Kelime ağının alt dize eşleşmesi** (`fire`→fireplace, `parti`→departing/particular, `gaz`→mağaza, `polis`→Metropolis):
  yalnız tutar, kimseye e-posta gitmez (acil yükseltme yalnız model/anlama katmanı sinyaliyle). Tek tek kelime sınırı
  yaması "istisna ekleyerek geçme"nin ta kendisi olurdu; Türkçe ek yapısı sağ sınırı da bozar. Doğru yol: kapı kanıtıyla
  ölç → anlama katmanı "risk yok" dediği hâlde yalnız kelime ağının tuttuğu oran → kurucu kararıyla etiket yetkisini
  "uyarı"ya indir (↓Faz 3).
- **Erken giriş "başka gün" tespiti** (`early-checkin/text-checks.ts mentionsAnotherDay`): tek karar veren kelime listesi
  (domani/amanhã/tmrw/weekend yok). Model bugün devralamaz: anlama katmanına tarih/gün satırı gitmiyor. Maruziyet düşük
  (host kuralı `auto` varsayılan kapalı; onay metni günü açıkça yazar). Doğru çözüm ↓v2 `day` alanı.
- **Kapanış/övgü kısayolu hâlâ sözcüksel İZİN**: nezaket cevabı (kapalıysa hiç mesaj yok) modelsiz gider. Bu turda
  yalnız tüm cevapsızlar şartı eklendi; anlama katmanının `thanks` beyanına bağlamak gecikme ekler (↓Faz 3, isteğe bağlı).

## 4. 🚨 Büyük öneri — KURUCU ONAYI GEREKİR (uygulanmadı)

ChatGPT metninin çekirdeği ("anlam kararını yapılandırılmış anlama çıktısı versin, kelime ağı yalnız yedek") doğru ve
mevcut mimarinin doğal devamı. Ama tek hamlede yapılırsa: istem/şema değişikliği → tüm eval tabanı yeniden ölçülür,
yeni kör set gerekir (A yandı), ücretli koşu, model değişimine duyarlılık. Bu yüzden fazlı:

| Faz | İş | Karar yetkisi | Maliyet / onay |
|---|---|---|---|
| 0 | Anlama şemasına v2 alanları (bayrak kapalı): istek başına `act` (question/request/report/announcement/conditional/thanks), `stay_change.day` (today/tomorrow/other_day/unspecified), `evidence` (kısa alıntı, kodda doğrulanır), `uncertain`; isteme yerel tarih + gün satırı; önbellek anahtarına şema sürümü | YOK | Kod; küçük ücretli regresyon koşusu (`EVAL_STAY_LIMIT`) → onay |
| 1 | v2 alanları + kelime ağı uyuşması karar kaydına (`g` alanının yanına), yalnız kapalı küme kod | YOK | Kod |
| 2 | Karşılaştırma: salt-okuma geri-test (Set B aracı) + YENİ kör set; model başına: yalnız-model tutuşları, yalnız-kelime ağı tutuşları, alıntı kaçırma, `uncertain` oranı | YOK | Kör set yazımı + ücretli koşu → onay |
| 3 | Yalnız SIKILAŞTIRAN yetki (bayrakla): `day ≠ today` → otomatik erken giriş onayı yok; `act` → politika metni yalnız soru iken; `uncertain` → otomatik gönderim yok. Sonra kelime ağı ETİKETİNİN "uyarı"ya inmesi (acil/kural ihlali için anlama katmanı "yok" + model "yok" + kelime ağı "var" → tut ama acil etiketi/rozeti verme) | Sıkılaştırıcı | 🚨 Birleşim değişmezine dokunan kısım (son madde) kurucu kararı |
| — | Cevap modelinin eylem beyanı: `claimedActions` (kapalı küme) — makbuz (`actionReceipt`) yoksa gönderilmez; çıktı vetosunun regex'i yedek kalır | Sıkılaştırıcı | İstem + şema + eval → onay |

Ek öneriler (ChatGPT metninden, doğrulandı): anlama katmanı bugün `OPENAI_MODEL`e düşüyor → Luna'ya geçişte anlama da
sessizce değişir; `AI_SEMANTIC_MODEL` pinlenmeli (kurucu kararı, env). Cevap modeli `json_object` ile çağrılıyor
(strict şema değil) — geçiş ayrı ölçüm ister.

## 5. ChatGPT metnine göre durum (kısa)

- Yapıldı: envanter + sınıflandırma (ajan ölçümü, bu belge §1/§3) · "kapıda" minimal çift bataryası + kök düzeltme ·
  sözcüksel uyarı ↔ anlamsal niyet ayrımı (kayıtta) · karar izi (`g`) · fikstür kuralı #28 (13d kök testi) · yeni
  mutant sınıfları (kısayol yüzeyi, bağlam kesmesi, katlama, sözcük başı, kanıt kablosu).
- Önerildi, onay bekliyor: v2 anlama sözleşmesi · sözcüksel etiket yetkisinin indirilmesi · eylem beyanı ·
  model yönlendirme/kaskad · host geri bildirim döngüsü (taslak düzenleme/ret kaydı — bugün kayıtlı değil).
- Reddedildi/ertelendi: kelime listelerine tek tek istisna (aşırı uyum) · mühürlü setin yeniden açılması.
