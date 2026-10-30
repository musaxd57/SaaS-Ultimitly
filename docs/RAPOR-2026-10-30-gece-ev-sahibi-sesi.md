# 10-30 gece raporu — "Mesajı ev sahibi yazıyor" (kurucu 10-30) + WhatsApp + ölçümler

> Kısa özet kurucu için. Ayrıntı: `docs/claude/durum.md` (10-30 akşam-2), kural metni `docs/claude/ai-guvenlik.md`.

## 1. Ne yapıldı

| İş | Durum |
|---|---|
| Ses kapısı (`reply_host_voice`): üçüncü kişi ev sahibi, iç sistem anlatımı, üçüncü taraf işletmeye yönlendirme misafire gitmez; kanal + QR, kapının EN SONUNDA | kodda, varsayılan AÇIK (acil durdurma `AI_HOST_VOICE_GUARD_DISABLED=1`) |
| İstem kuralı: cevap ev sahibinin ağzından (birinci çoğul kişi); "ev sahibinize yazın / gerek yok" yok; ev sahibinin kendi hizmeti önerilir | kodda |
| "Binada sauna var. Detaylar için ev sahibinize yazabilirsiniz." → "Binada sauna var." gider, soru size açık kalır | kodda |
| Okuyucu açıkken ses ihlalinde cevap bir kez ev sahibinin ağzından yeniden yazılır | kodda (kanal + QR) |
| Prompt caching (OpenAI): amaç anahtarı + 24 saat | kodda (acil durdurma `OPENAI_PROMPT_CACHE_DISABLED=1`) |
| WhatsApp ev sahibi döngüsü: tasarım + saf parçalar (soru metni, eşleştirme, cevap türü, cevap kurucu + kod denetimi, Meta imza / ayrıştırma / gönderici, kanal yönlendiricisi) | kodda, bağlı DEĞİL; migration 88 hazır yamada (onay bekliyor) |
| Eski testlerin 25 kırmızısı | kapandı: 1 gerçek hata (erken giriş teşhisi) düzeltildi, 24 test sabiti üçüncü kişiden ev sahibinin sesine çevrildi + eski metnin artık TUTULDUĞU ayrıca pinlendi |
| Süre pini (50.000 karakter) 1,5 sn sınırını aşıyordu | sebep bulundu ve düzeltildi (sınır gevşetilmedi): 1.550 → 680–950 ms |

## 2. Ölçümler (gerçek model, toplam ≈ 0,70 $)

**135 senaryo (önceki istem → yeni istem):** sızıntı 0/52 → 0/52 · doğru bilgi 51 → 55/55 · üçüncü kişi ev sahibi içeren cevap 54 → 41/135 ·
otomatik GİDEN ihlal 1 → 0.

**Yedi dilde 280 zor örnek (gpt-5.1 üretti; her dilde 8'er: üçüncü kişi ev sahibi / iç sistem anlatımı / üçüncü taraf yönlendirme / temiz / temiz-tuzak):**

| Tür | Bugünkü kod kapısı tutuyor | Kıdemli okuyucu (model) tutuyor |
|---|---|---|
| Üçüncü kişi ev sahibi | 53/56 | 56/56 (deneme istemi) |
| İç sistem anlatımı ("kayıtlarımda yok", "ilanda belirtilmemiş") | 27/56 | **56/56** (bugünkü okuyucu, değişiklik yok) |
| Üçüncü taraf yönlendirme | 5/56 | 56/56 (deneme istemi) |
| Temiz cevap yanlış tutuluyor | 1/112 (ses kapısı) | 0/112 (bugünkü okuyucu) · 2/112 (deneme istemi) |

Sonuç: anlamı **model** okuyor (kurucunun 10-30 tercihi); kod kapısı yedek. İç sistem anlatımı için bugünkü okuyucu yeterli —
**`AI_SENIOR_READER_ENABLED=1` Railway açılış listesinde olmalı.**

**Üçüncü taraf yönlendirme — iki deneme (ikisi de gerçek model, aynı 280 örnek):**
- Bugünkü kıdemli okuyucuya EK SORU olarak: yönlendirmelerin hepsi yakalandı ama temiz "tuzak" cevapların 7–18'i / 56 yanlış işaretlendi —
  özellikle ev sahibinin KENDİ transferi ("Havalimanı transferini ben ayarlayabilirim") ve "karşıda eczane var" gibi cevaplar. Bu sizin
  gitmesini istediğiniz cevaplar → bu yol GERİ ALINDI, koda girmedi.
- AYRI, kısa, odaklı bir denetim çağrısı olarak (yalnız taslağı okur): yönlendirmelerin 56/56'sı (41 özel işletme + 15 kamu kurumu ayrı
  ayrı), temiz 112 cevapta yalnız 2 yanlış. Bedeli: otomatik cevap adayı başına bir küçük çağrı daha (≈0,001 $, ~1 sn).

## 3. Sorular (yalnız gerçekten karar gerektirenler)

**S-1 — Üçüncü taraf yönlendirmesi için ayrı denetim çağrısı kurulsun mu, kamu kurumu dahil mi?** Özel işletmeye yönlendirme (taksi, otel
resepsiyonu, restoran, araç kiralama) sizin kararınızla zaten gitmeyecek; kod kapısı bugün bunun yalnız 5/56'sını yakalıyor. Önerim: yukarıdaki
ayrı odaklı denetim (56/56, temizde 2/112). Yeni bir model çağrısı olduğu için onayınızla kurarım. Açık kalan: kamu kurumları.
- Örnek: misafir "Pasaportumu kaybettim" → cevap "Konsolosluğunuzla iletişime geçmeniz gerekiyor." · misafir "Doktora ihtiyacım var" → "En yakın
  hastaneye gidebilirsiniz." · "Şehir turu için meydandaki turizm ofisine danışabilirsiniz."
- **A (önerim):** kamu kurumu yönlendirmesi GİDER (acil / resmi işler için doğru bilgi; ev sahibinin kazancıyla çakışmaz), yalnız özel işletme tutulur.
- **B:** kamu kurumu da tutulur, ev sahibine sorulur.

**S-2 — Birinci kişi erteleme ("Teras kullanımı bizim kararımızdır") konaklama DIŞI konuda gönderildikten sonra misafir "teşekkürler" derse:**
bugün konuşma listeden düşebilir (sözcük dedektörü yalnız üçüncü kişiyi tanıyor; konaklama değişikliğinde karar kaydı zaten koruyor).
- **Önerim:** kapanış dedektörü birinci kişi ertelemeyi de tanısın → konuşma listede kalır (misafire giden metin değişmez). Onay verirseniz yapıyorum.
- Not: canlı durum belgesine göre `AI_HOST_DECISION_HOLD_ENABLED=1` (sizin beyanınız). Bu anahtar açıkken de bugün yalnız ÜÇÜNCÜ kişi "ev sahibinin
  kararı" cümlesi tutuluyor; istem artık birinci kişi yazdırdığı için "Bu bizim kararımızdır" ertelemesi konaklama dışı konuda gidebilir
  (konaklama değişikliğinde iki model zaten tutuyor). Aynı öneri kapsamında.

**S-3 — Migration 88 (WhatsApp için iki YENİ tablo; dolu tabloya dokunmaz):** onay + taze `pg_dump` ile ana dala alınır. Hazır yama:
`docs/hazir-yamalar/2026-10-30-migration-88-host-channel.patch`.

## 4. Sıradaki iş (sorusuz, kuralınızın uygulaması)

- İstemde hâlâ ~30 yerde üçüncü kişi kalıp var ("Bu ev sahibinizin kararıdır; mesajınız kaydedildi, ev sahibiniz görebilir"). Yeni kural
  bunları geçersiz kılıyor ama model yine de 41/135 cevapta üçüncü kişi yazıyor (hepsi şikâyet / devir; misafire GİTMİYOR, ama size gelen
  taslak da üçüncü kişi oluyor). Kalıplar ev sahibinin sesine çevrilecek, 135 senaryoda önce / sonra ölçülecek.
- Okuyucuya üçüncü taraf işletme sorusu (S-1 cevabınıza göre kamu kurumu dahil / hariç).
- WhatsApp: migration 88 onayından sonra kanca ucu + kayıt defteri + Tür A bağlantısı.

## 4b. S-1 sonucu (kurucu onayı 10-30: "S-1 yeni model çağrıları yapabilirsin sormana gerek bile yok")

Kuruldu: `ai/semantic/referral-judge.ts`, anahtar `AI_REFERRAL_JUDGE_ENABLED` (yalnız `AI_SENIOR_READER_ENABLED=1` ile). Kıdemli okuyucunun iki
okumasıyla paralel tek çağrı; özel işletmeye yönlendirme ya da üçüncü kişi ev sahibi → `reply_host_voice` + bir kez ev sahibinin ağzından yeniden
yazma. Kamu kurumu sizin cevabınıza kadar GİDER (yalnız ölçülür).

| Gerçek model (10-30) | Denetim tutuyor | Bugünkü kod |
|---|---|---|
| Kör set (ayrı yazar, 7 dil): özel işletmeye yönlendirme | **41/42** | 4/42 |
| Kör set: kamu kurumu (tutulmamalı, ayrılmalı) | 21/21 ayrıldı, 0 tutuş | 0 |
| Kör set: ev sahibi kendisi ayarlıyor / yer bilgisi / acil / düz bilgi (77) | **0 yanlış tutuş** | 0 |
| Geliştirme seti: üçüncü kişi ev sahibi | 56/56 | 53/56 |
| Geliştirme seti: 112 temiz cevap | 1 (kodun da tuttuğu "хозяева животных" = evcil hayvan sahipleri) | 1 |

Kaçan tek örnek: "Marta's Laundry … same-day service, so you may want to drop your clothes off before noon." — denetim bunu "müşteri olarak
gitme daveti" saydı (istemdeki yer bilgisi istisnası); sınırda bir örnek.

Kamu kurumu sorusu (S-1'in ikinci yarısı) hâlâ açık: **A** (önerim) gider · **B** tutulur, ev sahibine sorulur.

## 4c. Yayın öncesi çekişmeli inceleme (10-30 gece, 74 ajanlı iş akışı; doğrulayıcıların çoğu limit yüzünden yarıda kaldı, aşağıdakiler elle doğrulandı)

| Bulgu | Sonuç |
|---|---|
| **B** "Erken giriş yapabilirsiniz. Erken giriş için bir gün önceden ev sahibinize haber verin." → koşul silinip yalnız "Erken giriş yapabilirsiniz." gidiyordu (Türkçe "-ebilirsiniz" izin sayılmıyordu; Türkçe ayağı bu turun gerilemesi, ispanyolca / fransızca / almanca / rusça / arapça ayağı öncesinde de vardı) | **Düzeltildi**: koşulu silinen izin cümlesi varsa cevabın tamamı tutulur (7 dil). 3.274 gerçek cevapta değişen sonuç 0. |
| **C** "Binada sauna var. Wi-Fi şifresi … Detaylar için ev sahibinize yazın." (iki soru) → cevaplanmayan "sauna kaçta açık?" "cevaplandı" sayılıyor, cevaplanan Wi-Fi açık kalıyordu | **Düzeltildi**: konusuz "detaylar için" silmesi birden çok soru varken hiçbir soruyu kapatmaz; bilgi yine gider. |
| **F** QR'da (istek defteri yok) yeni istem kuralı "o isteğe hiç değinme" ev sahibine kalan isteği sessizce düşürüyordu | **Düzeltildi**: 10-29 iki hakem ilkesine dönüldü — "atlama" talimatı yalnız defterli öğe kipinde; başka yerde devir kuralı (cevap misafire gitmez, ev sahibine kalır). |
| **H** "Lale Taksi durağı 100 m ileride, onları arayabilirsiniz." gidiyordu (cümlede 100 / 110 / 155 / "acil" geçince acil muafiyeti) | **Düzeltildi**: muafiyet yalnız gerçek acil çağrı talimatında. |
| **E** Railway'de `OPENAI_PROMPT_CACHE_RETENTION=` boş bırakılırsa 24 saat önbellek sessizce kapanıyordu | **Düzeltildi**: yalnız `in_memory` kısaltır. |
| **A** Kodla kurulan erken giriş POLİTİKA metni "…kararı ev sahibiniz verir / your host decides" (ses kapısı kodla kurulan metni muaf tutuyor) | **Eski durum, sizin kararınızı bekliyor** (SABAH-KARARLARI 10-01 §2). `AI_HOST_DECISION_HOLD_ENABLED=1` açıkken zaten tutuluyor; anahtarsız kurulumda gider. Metnin ev sahibinin ağzından yazılması önerilir ("Erken giriş o günkü temizliğe bağlı; size biz döneceğiz." değil — bekleme sözü yasak; önerim: "Erken giriş o günkü temizliğe bağlıdır; uygun olursa onaylarız." — misafire gideni değiştirdiği için onayınızla). |
| **D** WhatsApp cevap kurucusunun kod denetimi Arapça / Farsça rakamları görmüyor | **Düzeltildi** (WhatsApp inceleme düzeltmeleri: rakamlar denetimden önce ASCII'ye çevrilir). |

## 4d. WhatsApp — gelen uç (web kancası) kodda (10-30 gece-3, anahtarlar KAPALI)

Ne yapıyor: Meta'nın gönderdiği mesajı alır → imzayı doğrular → yalnız GÖNDEREN NUMARADAN işletmeyi bulur → iki şeyi işler: **numara bağlama
kodu** (`LIXUS-7F3K2Q`, ev sahibinin kendi WhatsApp'ından) ve **"DUR" / "STOP"** (bağlantıyı kapatır, "WhatsApp bildirimleri kapatıldı."
der — tasarım §3.5'teki cümle). Ev sahibinin soruya CEVABININ bağlanması sonraki dilim; o gelene kadar `HOST_QUESTIONS_ENABLED` kapalı kalmalı.

Gece modunda sormadan seçtiklerim (hepsi geri alınabilir, misafire giden hiçbir şeye dokunmuyor):

| # | Seçim | Neden |
|---|---|---|
| W1 | Adres tasarımdaki gibi `/api/webhooks/host-channel/whatsapp`; sabit rota (sağlayıcı başına ayrı dosya) | `[provider]` değişkenli rota yerine; aynı adres, daha az kapı |
| W2 | Anahtar kapalıyken el sıkışma da 403 (uç tamamen uyur) | Tasarım §5.1; kurulum sırası Railway belgesine yazıldı: önce anahtar, sonra Meta'da abonelik |
| W3 | Anahtar açık ama sır eksik → 200 + alarm (bir kez + günde bir hatırlatma) | Ödeme web kancasıyla aynı desen; sessiz kayıp yok |
| W4 | "DUR" yalnız DUR / STOP (mesajın tamamı); "iptal" / "durdur" artık kapatmaz | Tasarım §3.5 / §8; "iptal edilsin mi?" sorusuna "İptal" diyen ev sahibinin bağlantısı sessizce kopuyordu |
| W5 | Bağlama kodu doğrulanınca WhatsApp'tan "bağlandı" mesajı GİTMEZ (ekran gösterir) | Tasarım §5.4; yeni cümle sizin onayınız olmadan eklenmedi. İsterseniz: "Lixus bildirimleri bu numaraya bağlandı." |
| W6 | Teslimatta bizim numaramızdan başka numara kimliği varsa hepsi yok sayılır | Karışık teslimatta mesaj başına ayrım yerine en güvenlisi |
| W7 | Bilinmeyen numaradan gelen mesaj: hiçbir kayıt, hiçbir cevap | Numara yoklanamaz; dünyanın her yerinden gelen mesaj seli veritabanına yazı açmaz |
| W8 | Doğrulama anında kullanıcının rolü yeniden okunur (personele düştüyse bağlanmaz); eşzamanlı yanlış kodlar sayacı 5'i aşamaz | Tasarım §5.3; yarış testiyle |

Sizin kararınız gerekenler (sabah): **(1)** W5 "bağlandı" mesajı istiyor musunuz? **(2)** Meta kurulum listesi (tasarım §9) — hesap, ayrı numara,
şablon onayı sizde.

## 5. Railway açılış günü eklenecekler (unutmayın)

- **Decisions API sıralayıcısı:** `KB_RERANK_ENGINE=decisions`, `KB_RERANK_DECISIONS_MODEL` (ölçümle açılır).
- **Kıdemli okuyucu:** `AI_SENIOR_READER_ENABLED=1` (iç sistem anlatımı 56/56) + **S-1 denetimi** `AI_REFERRAL_JUDGE_ENABLED=1` (özel işletme
  yönlendirmesi kör sette 41/42, temizde 0 yanlış).
- Prompt caching kendiliğinden açık; kapatma `OPENAI_PROMPT_CACHE_DISABLED=1`.
- WhatsApp: `HOST_CHANNEL_ENABLED`, `HOST_CHANNEL_ORG_IDS=<kurucu org>` + sırlar (`WHATSAPP_APP_SECRET`, `WHATSAPP_PHONE_NUMBER_ID`,
  `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, `HOST_CHANNEL_HMAC_SECRET`); `HOST_QUESTIONS_ENABLED` cevap dilimi gelene kadar
  KAPALI (§4d) — kurulum adımları
  `docs/TASARIM-2026-10-30-whatsapp-ev-sahibi-dongusu.md` §9 (Meta hesabı, ayrı numara, şablon onayı, kalıcı belirteç).
- Tam liste: `docs/RAILWAY-ACILIS-2026-10-15.md` §0.
