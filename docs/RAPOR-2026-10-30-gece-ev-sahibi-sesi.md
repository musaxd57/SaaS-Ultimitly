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

## 5. Railway açılış günü eklenecekler (unutmayın)

- **Decisions API sıralayıcısı:** `KB_RERANK_ENGINE=decisions`, `KB_RERANK_DECISIONS_MODEL` (ölçümle açılır).
- **Kıdemli okuyucu:** `AI_SENIOR_READER_ENABLED=1` (iç sistem anlatımı 56/56).
- Prompt caching kendiliğinden açık; kapatma `OPENAI_PROMPT_CACHE_DISABLED=1`.
- WhatsApp: `HOST_CHANNEL_ENABLED`, `HOST_QUESTIONS_ENABLED`, `HOST_CHANNEL_ORG_IDS=<kurucu org>` + sırlar — kurulum adımları
  `docs/TASARIM-2026-10-30-whatsapp-ev-sahibi-dongusu.md` §9 (Meta hesabı, ayrı numara, şablon onayı, kalıcı belirteç).
- Tam liste: `docs/RAILWAY-ACILIS-2026-10-15.md` §0.
