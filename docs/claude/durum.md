# Durum tarihçesi (10-07 ve öncesi)

> CLAUDE.md'den 2026-10-08'de AYNEN taşındı (kurucu: ".md'ye yığma, gerekli yerlere taşı, gerekli şeyleri silme").
> Bu dosyadaki kurallar CLAUDE.md'deki kadar BAĞLAYICIDIR. İlgili alanda iş yapmadan önce oku.

## Durum
> Tur anlatıları (09-23 → 10-01 gece 2) 10-02'de AYNEN arşive taşındı (kurucu: ".md çok uzamış … gerekli yerlere taşırsın"):
> `docs/history/CLAUDE-2026-10-02-sadelestirme-3-oncesi-tam-metin.md` ("Durum" bölümü). Kuralları yukarıdaki bölümlerde; yalnız Durum'da
> yazılı olan kurallar (konuşma öğeleri, ev kuralları, canlı bayraklar) 10-02'de ilgili bölümlere taşındı. Bekleyen onaylar ↓.

**10-15 gündüz (güncel) — Geçmişten öğren (migration 65, hiçbir yere uygulanmadı; `HISTORY_LEARN_ENABLED` KAPALI):** müşteri "Geçmişi oku"
→ Luna (gpt-6-luna / low) geçmiş soru ↔ cevaplardan bilgi tabanı TASLAĞI çıkarır (ad / telefon / IBAN / TC / kapı kodu modele gitmeden
maskelenir; taslak onaysız kullanılmaz; 300 mesajda 13/14 olgu, 0 sızıntı, ~$0,005). Operatöre (kurucu 10-15 kararı) "Cevapları karşılaştır":
geçmiş sorulara canlı cevap modeliyle kuru koşu (gönderim yok, kapı sonucu + kapanış), İyi / Düzeltilmeli / Kötü + "Böyle yapsın" (talimat +
bekleyen taslak). Daire tercihleri: müşteri HAZIR SEÇENEKTEN seçer, serbest metin yalnız operatör; isteme yalnız
`PROPERTY_INSTRUCTIONS_PROMPT_ENABLED` ile (KAPALI). Opus üç tur + derin denetim + Haiku turları + mutasyon (44/39 + yaşayan 5 için test).
Kararlar `docs/KURUCU-YOKKEN-KARARLAR-2026-10-09.md` "10-15 sabah"; bayraklar `docs/RAILWAY-ACILIS-2026-10-15.md` §5; görsel açıklama
https://claude.ai/artifact/Sk4aX2p11CVVbHeKbtJ4Jj. Opus dördüncü derin denetim (HL4, `0 P0 · 3 P1 · 7 P2`) kodda kapandı: kilit / kutu bağlamında kod
maskesi + taslak kapısı, pasaport / kart / etiketli telefon maskesi, talimat kapısına acil / konaklama kararı / iletişim / dil / platform dışı
sınıfları, "Böyle yapsın" serbest metin yetkisi, müşteri anahtarı kapanınca müşterinin serbest metni istemden düşer (`byOperator`), misafir
silmesi yoldaki koşuyu durdurur, ücretli özellik kapısı, karşılaştırma talimatı anahtar kapalıyken dener, bayat cevaba karar 409. F6 (QR kapı
kodu boşluğu, önceden var) kurucu onayıyla ana dalda: tek anlamlı kilit adları + değer (`secret-filter-lock-nouns.test.ts`).

**10-14 akşam → 10-15 gece (kurucu "gece modu — soru sorma, Haiku'yu bol kullan"):** dış inceleme Y1–Y10 kodda kapandı ve itildi
(nezaket girişi, Unicode / çok dilli kapı kodu, QR silme yarışı, iptal / ertelenen rezervasyona giriş, genel kapatma kuyruğu, açık yangın
uyarısı + 25 mesaj penceresi, uyarı adresi kuşak yarışı, ölçerde KATI olgu, dört müşteri ekranı) · kurucu 10-14 kararları (silinen
konaklamada metinsiz acil uyarı, "kısa devre" model karar verir) · Haiku ikinci tur: olası tehlike + anlama katmanı koşmadı → tur ev
sahibine (QR + kanal; `hazardDecisionFor` acil hükmü hiç okunmuyordu) · Claude ölçeri (Anthropic API; ANAHTAR bu ortamda YOK — alt oturum
ücretsiz durdu) · HAZIR YAMALAR: KB içe aktarım istek kimliği (migration 65, mutasyon 10/10) ve G1 + G1b (anlama katmanı son cevaptan
sonraki otomatik şablonu hiç görmüyordu; 25 × 3: 65/75 → 75/75) · RAG: asıl kazanç İngilizce köprü (60 kalem 110 → 117/120); parça tavanı
ve soru başına etiket ölçüldü (etiket kötüleştirdi). Sorular ve ölçümler: `docs/KURUCU-YOKKEN-KARARLAR-2026-10-09.md` "10-14".

**10-13 sabah:** kurucu G1–G11'i cevapladı; G2–G11 uygulandı (gaz / CO dedektörü acili, 2FA kapatma oturum düşürür, demo talebi
günde 50 + özet, Paddle yükü 1 yıl, KVKK telefon / e-posta + üslup profili, çizgi taklidi → insana, kanal iptali geri açmaz + panel satırı,
sağlayıcı arızası tek satır, yakalanmayan hata raporu, imajda yalnız iki betik); G1 hazır yama (kredi gelince ölçüm). Durum ve yeni sorular
H1–H3: `docs/KURUCU-YOKKEN-KARARLAR-2026-10-09.md` "10-13". H1 gerek yok (kurucu verisi), H2 "yeniden aç" düğmesi + H3 duman dedektörü
de doğrudan ev sahibine uygulandı (Haiku son kontrolü üç tur: yanlış negatifler + karesel iş kapandı; geçmiş zaman indirimi kaldırıldı — yeni soru H4).

**10-12 gece geç saat:** madde 10 son yüzeyleri (AI cevap öner + QR konuşma kayıtları sınırlı okuma; QR'da 2.000 satır sınırı,
yabancı konuşmada aşama sızmaz) · DENETIM 08-09 #6/#8/#10/#11/#22/#24–27/#32–37 kapandı ya da doğrulandı, #15 kısmen · ACIK-ISLER 08-08
§11–§15 kısmen (iptaller / gelen kutusu dar `select`, ölü `plan` dışa aktarımdan çıktı, açılış uyarıları RESEND_FROM / OPENAI / yarım
STORAGE_*) · iki kararsız test (gece yarısı "yarın" zaman bombası; kimlik içinde "4200" — CI #1426 kırmızısı) · sabah soruları G1–G7
(`docs/KURUCU-YOKKEN-KARARLAR-2026-10-09.md`). Her iş Haiku sert inceleme + mutasyon + tam kapı. Depo PUBLIC, CI gerçek çalıştırıcıda.

**10-12 gece (güncel; kurucu "gece modu — soru sorma, V'leri bitir, sonra mantıklı işler"):** kurucunun 10-12 cevapları uygulandı — S1 bavul
bırakma kod kapısında (giriş öncesi saat / "erken" bağlamında erken giriş isteği ve izni) · S2 QR'da iptal edilmiş rezervasyon (yapay zekâ çağrılmaz,
kota düşmez, panel kaydı + 6 saatte bir e-posta `QR_ESCALATION_EMAIL_ENABLED` ile) · ⑤ ilk dilim öneriler (görev / Wi-Fi bilgi tabanı / söz, sahip +
yönetici tek tık; `AI_ACTION_SUGGESTIONS_ENABLED` KAPALI; ölçüt yalnız ölçülür) · değişmez 13 düzeltmesi ("bilgi yanlış" beyanı) · kritik akış testleri
(gelen → teslim, özel yükleme oturumu). Her biri Haiku sert inceleme (2–3 tur) + mutasyon + tam kapı. Tablo: `docs/KURUCU-YOKKEN-KARARLAR-2026-10-09.md`
"Uygulama durumu (10-12 gece)"; çizelge `docs/YOL-PLANI-DURUM-2026-10-09.md` ⑤. Ardından kurucunun "goal bitince" notu: **takip numarası
(correlation ID) ilk dilimi** (ödeme zinciri + hata bildirimi + operatör araması, yalnız-ekle olay günlüğü, migration 63) —
`docs/TASARIM-2026-10-10-correlation-id-takip-numarasi.md` §6. ⑤ önerileri dört Haiku turu (Wi-Fi "çalışmıyor" ≠ şifre dersi kod kuralı). Railway hâlâ kapalı.

**10-11 akşam:** acil numara sorusu Luna 6.0 ile ölçüldü (33 senaryo × 2), modelin kendi açıklaması alındı, kod anahtar arkasında
(`AI_EMERGENCY_NUMBER_ENABLED` KAPALI; servis başına numara, ev sahibi / anlaşmazlık / konaklama konusunda numara yok — ölçüm setinde 62/62)
+ B1 (gelen kutusu "Bilgi tabanına ekle", mülk sayfası "Yerel Tavsiye" hatırlatması). Haiku iki tur, mutasyon iki tur. Kararlar:
`docs/KURUCU-YOKKEN-KARARLAR-2026-10-09.md` "10-11 akşam"; tasarım §8 `docs/TASARIM-2026-10-11-acil-numara-ve-yer-onerisi.md`.

**10-11 sabah:** kurucu gece modundan çıktı, 9 karar soruldu ve cevaplandı; hepsi uygulandı (kendine atamada e-posta yok · önizleme
kotası konuşma başına · QR konaklama başına saatte 40 mesaj + acil e-postası saatte 3 + daire alt kotası · destek görünümünde operatör yazmaları
kapalı · QR'da Wi-Fi verilir, kapı kodu hiçbir biçimde verilmez + çıktı taraması bir kez yeniden yazdırır · gizlilik md.15 + `LEGAL_VERSION`
2026-10 + avukat paketi). Tablo: `docs/KURUCU-YOKKEN-KARARLAR-2026-10-09.md` "Sabah (10-11)".

**10-10 gece (kurucu: "gece modu — soru sorma, Haiku'yu bol kullan"):** Haiku inceleme / tarama turları kodla doğrulanıp işlendi, hepsi
kırmızı-önce + mutasyon + tam kapı ile İTİLDİ (CI yeşil): QR sır süzgecinde "kapı + aç-" biçimi + üç eski tuş paneli kalıbında KARESEL geri izleme
(23.800 boşlukta 2,8 sn → 11 ms; dil eşitliği 2,9 milyon dizede doğrulandı) · operatör uçlarına operatör kimliğine bağlı hız sınırı (2FA sıfırlama,
kalite denetimi, dışa aktarma, bürünme) · misafir sözü KVKK (silme / saklama / dışa aktarma) · değişmez 16 (kimlik parçalı her API rotası bir
kiracılar arası davranışsal teste eşli, mekanik pin) · değişmez 10 (konuşma kopya temizliği QR ipliğini Airbnb ipliğine birleştiriyordu → kopya =
aynı kanal). Kurucu kararı bekleyenler: `docs/KURUCU-YOKKEN-KARARLAR-2026-10-09.md` 15–29 (Mülk Hafızası çelişki tanımı, uygulamada sağlayıcı adı,
görev atama e-postası tavanı, önizleme kotası …). Railway hâlâ kapalı.
**10-08 gece:** Codex `15c8663` bulguları (U16–U44 + yeni 1–11) döngüde dört turda işlendi ve İTİLDİ (`87ba35d`; takip tablosu
`docs/INCELEME-2026-10-07-codex-u16-u44.md`, her bulguda regresyon testi, yarışlar gerçek PostgreSQL'de). Kimlik yarışları (U13/U40/U41/U43/U44),
silinen metnin gönderimi (Y1), özgün mesaj kaybı (Y2), tehlike okuyucu (U3), takvim / CSV / ICS / gün başı / rapor / sağlık düzeltmeleri, ölçer
düzeltmeleri. Next.js 15.5.27 (iki yeni SSG/ISR danışması). Onay bekleyen beş değişiklik HAZIR YAMA (`docs/hazir-yamalar/`, ana dala UYGULANMADI)
+ Sabah Kararları 63–68. Railway hâlâ kapalı.
**10-07:** Host Karar Motoru İTİLDİ (10-03 kurucu "pushu yaptır", migration 59; CI #1292 yeşil) + üç inceleme ajanının bulguları
düzeltildi ve itildi (tasarım §10; rota · depo · tur / bildirim · otomatik onay koruması · panel · metinler); anahtar KAPALI, Railway kapalı. Onay
bekleyen: Sabah Kararları 62 b–f (misafir metinleri, farklı saatle onay dili, rapor sayımı, istem devir satırı, Arapça ortak terim). ⚠️ Ders: konteyner
sıfırlandı, itilmemiş iki commit kayboldu → uzun işte ara commit'ler HEMEN itilir (Railway kapalıyken push = yalnız CI).
**10-02 AKŞAM:** Railway aboneliği BİTTİ → canlı YOK (↑Çalışma biçimi). Kurucu onayları (10-02 akşam): **53 + 47** → RC72 (`d905c41`,
CI #1290 YEŞİL 20:18Z); **24 EK** (yazılı otopark tahsisi müsaitlik iddiası değil), **56** (QR dil kapısı + model ipucu), **55 + 51** (bağlam ilkesi:
açık tehlikede koddan satır, olası tehlikede model, anılışta alarm yok, belirsiz kalıplarda model, kaynaksız güvence yok) + "nasılsın" katmanı
(anahtar KAPALI, Sabah Kararları 61) → RC73 (mutasyon 101/112 → yaşayan 11'in 6'sına pin, 4 ölü kalıp silindi — Arapça / Rusça "acil numara",
sözcük ağı o sözcükleri acil saymıyor —, 2 gerekçeli eşdeğer; hedefli tur 13/14) → itildi 21:36Z, **CI #1291 YEŞİL**. Ardından (kurucu
sırası) **Host Karar Motoru** kodda (yerel dal, İTİLMEDİ — migration 59 onayı + 7 dil karar metni onayı, Sabah Kararları 62): kart + rozet + pano
+ tek e-posta + Onayla / Reddet ucu (yeniden doğrulama + olgu parmak izi), iki UX turu (ekran görüntüleriyle), üç inceleme ajanı, mutasyon.
Yeni sorular: Sabah Kararları 58–60 + 51 EK (Rusça sağlık acil sözcükleri) + 62. Yerel model / çaba değişkenleri: rapor §0b.
**10-02 (sabah):** canlı kod RC70 (`bbbf24b`, CI #1288 yeşil 10:44Z; RC69 dişil ev sahibi kararı + İspanyolca dipnot dahil). RC71 kapıda: QR'da
kapı kodu sızıntısı (sır süzgeci tuş paneli / sözcük sırası / kod sözcüğünün dilleri — bugünkü 5.1 kör QR setinde kodu iki kez yazdı) + geçmiş
turdaki rol değişimi enjeksiyonu (Sabah Kararları 57, onaylı kurallar) + QR ölçeri ve kör QR seti. Railway AKTİF (↑Canlı durum). **Luna katman
sonucu (kurucu: "5.1 yerine Luna, kodları ona göre geliştir, sakın geçmesi için şeyler yapma"; rapor §0a, §7.0, §9.4–9.12):** anlama + bekçi Luna
`low`, çeviri Luna `medium`, üslup Luna `none`, sıralayıcı 5.1'de kalır (Luna `none` iki sorulu mesajda 3/120 geride; Luna yapılandırmasında kalan
maliyetin %71'i bu 5.1 sıralayıcısı). **Cevap modeli:** kör set 11 (aday) Luna = 5.1; kör set 12 (SON KOD = RC69 + 53 + 47, aday dal
`prep/luna-aday-2`) Luna `low` = `medium` olgu 25/27 ↔ aynı kodla 5.1 24/27 ↔ bugünkü 5.1 21/27, sızıntı 0; **QR (ilk ölçüm, kör 64 senaryo):**
kapı kodu Luna 0 ↔ 5.1 2 (süzgeç açığı), olgu `medium` 26/26 · `low` 24/26 · 5.1 24–25/26, dil uyumu tam (bugünkü 5.1 QR'da Fransız misafire
Türkçe yazdı — 56); bedeli QR'da hız (p50 Luna 7,5–8,3 sn ↔ 5.1 5,0 sn). Öneri `OPENAI_MODEL=gpt-6-luna` + `low` (ya da `medium`; Sabah
Kararları 6 EK 4–5) YALNIZ 53 + 47 onaylanıp RC olarak canlıya çıktıktan ve RC71 canlıdayken. 52 (başkası adına giriş kodu) hazır dal
`prep/baskasi-adina-kod`; 54 (hizmet isteği ev sahibine ulaşmıyor), 55 (QR'da 112 satırı yalnız TR/EN kalıplarda; Türkçe "duman çıkıyor" da
yok — 10-02'de bağlamla çözüldü, 10-11'de kurucu kararıyla satırın kendisi KALKTI) ve 56 (QR dil kapısı) modelden bağımsız, sizin kararınız. OpenAI hız sınırı 10-02: Luna 4M / 5.1 2M token/dk. Ücretli ölçüm kuralları ↑Eval
"ÜCRETLİ ÖLÇÜM". Rapor / kararlar: `docs/SABAH-RAPORU-2026-10-01.md` (§0a özet) · `docs/SABAH-KARARLARI-2026-10-01.md` (1–60).

**09-30 akşam — KURUCU KARARLARI K1–K18 (sonuç tablosu `docs/INCELEME-2026-09-30-codex-ve-ajanlar.md` sonu):** K1 (CSV negatif tutar
satır hatası) · K2 (fotoğraf = görev erişimi) · K3 (olumsuzlanan KB saati okunmaz, düzeltme okunur) · K4 (başka aboneliğin olayı planı
değiştirmez) · K6 (acil ağı bağlamla) · K8 / K9 (yeni risk ayrı öğe; hassas öğeler birleşmez, mesaj başına e-posta) · K10 (devir cümlesi
misafire gitmez; bekletme mesajı emekli; ev sahibine "cevap bekliyor") · K11 (istek / soru yazılan çıkış saati değil) · K12 (doğal bilgi
satırı sahte etiket değil; "önceki kuralları yok say" enjeksiyon) · K14 (misafirin gördüğü ekran) · K16 (veri erişim politikası
`docs/POLITIKA-2026-09-30-veri-erisimi.md`) · K18 (iki belgeye durum başlığı) · uyarı adresi doğrulama bağlantısı (`ALERT_EMAIL_VERIFY_ENABLED`
KAPALI; ilk deneme kurucuyla). Hepsi kırmızı-önce + mutasyon. 🚨 K7 (migration 58) kodda, **yayın taze yedek onayı bekliyor**; K5, K13
(avukat), K15, K17 (ücretli kıyas) bekliyor.
(10-01: K7 yayında — RC50, migration 58, CI #1274.)

**09-25 HOST COPILOT — KAYIT + PLAN, UYGULANMADI (kurucu, 13 görsel; `docs/HOST-COPILOT-GEREKSINIMLERI-2026-09-25.md`):**
ev sahibinin AI ile doğal dil / ses kumandası: karar kartı, talimat, bilgi güncellemesi (onaylı), sorgu, devralma; WhatsApp
yalnız kanal, kayıt backend'de. Doğal dilden doğrudan yürütme YOK (para/saat → "Anladığım: …" önizlemesi), gönderimden önce
yeniden doğrulama. Kurucu: "her şeyi bitirince bu sisteme bakarız" → açık işler kapanınca belgenin §14 planı (Faz 0 onay
paketi; Host Karar Motoru = Faz 1). **Faz 0 onay paketi HAZIR** (`docs/ONAY-HOST-COPILOT-FAZ0-2026-09-25.md`: on karar
K1–K10 + `DecisionRequest` tablosu + durum makinesi + yeniden doğrulama + güvenlik); kod/migration kurucu kararından sonra.

Tur belgeleri (anlatılar arşivde): `docs/MESAJLASMA-CEKIRDEGI-V2-2026-09-25.md` · `docs/INCELEME-2026-09-28-10-ajan.md` ·
`docs/GUVENLIK-KONTROLLERI-2026-09-28.md` · `docs/RAG-EMBEDDING-SON-DURUM-2026-09-28.md` ·
`docs/TASARIM-2026-09-24-coklu-istek-ve-temizlik-hazir.md` · `docs/DENETIM-*.md`.

**Bekleyen onaylar (eski Durum paragraflarından derlendi; ayrıntı arşivde ve gösterilen belgede):**
- Sabah Kararları 10-01 açık maddeler (özellikle 6, 22, 30, 44a, 46–48, 51) — `docs/SABAH-KARARLARI-2026-10-01.md`; 09-28 kalanları (ör.
  K10-o misafir adının yapısal çözümü) — `docs/SABAH-KARARLARI-2026-09-28.md`; K5, K13 (avukat), K15, K17 —
  `docs/INCELEME-2026-09-30-codex-ve-ajanlar.md`.
- Host Karar Motoru = Host Copilot Faz 1 (`DecisionRequest` migration + 6 dil metin + e-posta; Faz 0 onay paketi ↑); bekleme sırasında
  A/B (SABİTLENMEDİ); CUS v2 defteri (migration).
- İki bayrağın açılması: `AI_ACTION_CLAIMS_ENABLED` (ücretli cevap kıyası) · `AI_CONVERSATION_STATE_ENABLED` (F14; kör eval) — ikisi de
  kurucu onayı.
- Anlama v2 (`act` / `day` / `evidence` / `uncertain` + sözcüksel etiket yetkisinin indirilmesi + eylem beyanı) —
  `docs/MESAJ-ANLAMA-CEKIRDEGI-2026-09-25.md` §4.
- 167b — elle girilen görev saati sunucuda UTC okunuyor (İstanbul'da 10:00 → panoda 13:00; atama e-postası dilimsiz) — e-posta şablonu onayı.
- Erken giriş kanıt modeli kalanları: temizlikçi davet (kimlik akışı → kurucu onayı) · anlama `events[]` + "çıktık" kaydı · varsayılan
  temizlikçi.
- Ev kuralları (#188): kart + gölge canlıda; yapay zekânın kuralı KULLANMASI (gölgeden karara) kurucu onayı.
- #189: ayrı çağrı temiz ölçümü + holdout kabulü + cevap düzeyi ölçüm (± geniş blok); `KB_RERANK_PER_QUESTION` /
  `KB_RETRIEVAL_WIDE_BUDGET` açmak kurucu kararı (↑Retrieval).
- Demo hesabı: kod hazır, canlıya KOŞULMADI (`docs/DEMO-HESABI.md`; canlı koşu = kurucu onayı + taze `pg_dump`).
