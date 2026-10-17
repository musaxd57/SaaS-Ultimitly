# Durum tarihçesi (10-07 ve öncesi)

> CLAUDE.md'den 2026-10-08'de AYNEN taşındı (kurucu: ".md'ye yığma, gerekli yerlere taşı, gerekli şeyleri silme").
> Bu dosyadaki kurallar CLAUDE.md'deki kadar BAĞLAYICIDIR. İlgili alanda iş yapmadan önce oku.

## Durum
> Tur anlatıları (09-23 → 10-01 gece 2) 10-02'de AYNEN arşive taşındı (kurucu: ".md çok uzamış … gerekli yerlere taşırsın"):
> `docs/history/CLAUDE-2026-10-02-sadelestirme-3-oncesi-tam-metin.md` ("Durum" bölümü). Kuralları yukarıdaki bölümlerde; yalnız Durum'da
> yazılı olan kurallar (konuşma öğeleri, ev kuralları, canlı bayraklar) 10-02'de ilgili bölümlere taşındı. Bekleyen onaylar ↓.

**10-17 akşam (güncel):** kurucu cevapları (KURUCU-SORULARI §S) — I1 söz konusu (73) + Q1 "a" sahiplenme (konusuz elle söze konulu öneri bağlanınca
konu yazılır, yeni görev açılmaz) · Q3 aydınlatma cümlesi gizlilik §5'te (90 gün, pinli) · Q4 operatör "Denemeyi bitir / geri ver" · I4 C "Aboneliği
devam ettir" (anahtar `PADDLE_RESUME_ENABLED` KAPALI; C1 küçük yazı, C2 bütün paketler; paket değiştirmeyle aynı para güvenliği) · kartla deneme
kapısı (74; `TRIAL_CARD_GATE_ENABLED` KAPALI + deneme süreli fiyat env'leri şart; ağ / IP sinyali SAYILMAZ) · webhook Paddle `trialing` deneme
sonunu yazar (gizli hata). Paddle sandbox listesi `docs/TASARIM-2026-10-17-paddle-devam-ettir-ve-kartla-deneme.md`; L1/L4 tasarımı (Opus, 6 soru)
`docs/TASARIM-2026-10-17-l1-l4-gecmis-cevaplar-ve-duzenleme-farki.md`. Açık: Q1-b teyidi, Q2, KD1–KD3, L1/L4 6 soru.
**10-17 öğleden sonra:** S2 migration paketi kodda — I3 kuyruk dizini (69) · L2 "eskisinin yerine koy" (70; ekranda görülen kalem
sürümü zorunlu, işlem içi koşul, yerine konan eski değer bir daha önerilmez) + L3 tek konuşmalık işaret (cümlecik bazlı, ev sahibini uğraştırmaz) ·
L5 1. faz (71; kanalın kendi otomatik mesajı öğrenme / üslup / öneride ev sahibi kanıtı değil, "cevap mı" değişmedi — Q2) · K1 (72; ilan tekrarı
denemeyi BİTİRMEZ, işaretler; ham IP saklamayan kayıt ağı izi, anahtar `SIGNUP_NETWORK_TRACE_ENABLED` KAPALI — Q3/Q4). Haiku her parçada (L2 21,
L5 8, K1 12 bulgu), mutasyon L2/L5 28/28. Push: `5ada7188` (CI #1525). Açık: I1 (Q1), L5 2. faz + istem etiketi (Q2/Q2-b), K1 metin / süre (Q3/Q4).

**10-17 sabah:** kurucu kararları S1 (migration'sız) kodda — H9/M1 "talimat yok" silici (izin listesi; Opus P1'ler: kanıtsız cihaz adımı,
göndergesel konu, bilinmeyen konu, selam kabuğu → silinmez, cevap tutulur) · K4 çıkış gününe elle temizlik (görev formu rezervasyon bağlamadığı için
aynı mülkte rezervasyonsuz elle temizlik de sayılır) · N1 abonelik kapalıyken bayat otomatik mesaj gitmez ("en son kapalı görüldü" işareti, kuyruk
satırı iptali, bekleyen karşılama / giriş mesajında varış günü penceresi, tek not) · K3 ödeme ekranı metinleri (`billing-ui-text.ts`). Haiku ×2 +
Opus derin kontrol bulguları işlendi; mutasyon 24/26 (iki gerekçeli eşdeğer). S2 tasarımı (migration 76–79: söz konusu, KB yerine koyma, kanal gönderen
rolü, kayıt ağı izi) hazır, kurucu soruları `docs/arastirma-2026-10-15/KURUCU-SORULARI.md` §Q.

**10-16 akşam :** (1) PARALEL TEST KAPISI — `npm test` = `scripts/test-gate.mjs` (veritabanlı kol tek sıra + veritabanısız kol 3 işçi
aynı anda, süre testleri en sonda tek başına; ölçüm 4 koşu yeşil: 3 işçi 1.790 / 1.766 sn, 4 işçi 1.931 / 1.778 sn; seri 2.163 sn) — geri dönüş
`npm run test:serial`; `docs/arastirma-2026-10-15/test-paralellik.md`. (2) H9 konu bazlı "bilgim yok" kodda, anahtar KAPALI (`topic-absence.ts`;
Haiku: doğrusal satır temizliği, kalan cümle konuya bağlı; Opus: kapsama şartı, satır satır ayıklama, kod selamı muaf, belirsizlik tutulur, kanıt izi
`ta`). (3) Codex akşam 6 bulgu (hepsi kodda yeniden üretildi, düzeltildi, regresyon testli): küçültülmüş Paddle yükü yeniden işlemede ezilmez ·
erişimi kapalı işletmenin kuyruktaki OTOMATİK satırı bekletilir (talep süzgeci + gönderim anı kemeri + sağlık okuması tek kaynak
`outbox/billing-hold.ts`; elle cevap etkilenmez; kader sorusu N1) · KB kopya güncellemesine işlem kimliği · arıza okuyucu tam metin (cevap 200
cümleyi aşarsa tutulur) · gönderilmemiş host mesajı geçmişten öğren kanıtı değil · sağlık yoklaması paylaşılır. (4) Geçmişten öğren × Codex 6 ilke
denetimi kalıcı belgeye (`docs/arastirma-2026-10-15/gecmisten-ogren-6-ilke.md`), sorular L1–L5; "bilgi veremem" sorusu M1.

**10-16 öğleden sonra — Codex incelemesi + kurucunun açık kararları (migration'sız):** ödeme gecikmesinde ek süre YOK (erişim
ödenmiş dönem sonuna kadar; Opus N1: `past_due` olayı dönem sonunu ödenmemiş döneme taşıyabiliyordu → yazılan değer yalnız dönem başı, yoksa
yazılmaz; bilinen sınır dönem içi düşen tahsilat → soru J5); elle mesaj hızlı uyandırma (`kickOutboxDrain`, varsayılan açık, kaçış
`OUTBOX_FAST_WAKE=0`; uyandırma turu kurtarma yapmaz, 5 satır, tek takip zamanlayıcısı, 10 dk bekçi; ölçüm p50 23 ms / p95 36 ms); kuyruk
anahtarları ayrı (`OUTBOX_DELIVERY_PAUSED` yalnız kuyruktaki gönderimi duraklatır, uzlaştırma sürer); QR kilit yenileme + her ücretli adımdan
önce eşzamanlı sahiplik (kota, daire sayacı, getirme, model, yeniden yazdırma, bekçi) + süpürülmüş ama alınmamış kilidi yeniden alma;
POST'tan önce talebi dolmuş satır gönderilmez, bekleyene döner. Mutasyon 18/18 + ikinci tur; Opus N1–N9, Haiku 8 bulgu; Codex C1–C12 hükümleri
ve sorular J1–J9: `docs/arastirma-2026-10-15/KURUCU-SORULARI.md` §J. Codex C6: belgelerde "kişisel veri yok" → "takma adlı kimlik taşır".

**10-16 öğle — kurucu kararları Faz 1 (migration'sız):** migration 68 onaylandı ve ana dalda; söz tekrarı "Bu söz zaten kayıtlı";
e-posta kuyruğu sağlayıcıya satır başına sabit tekrar kimliği; ödeme: `paused` ayrı durum (ek süre yok), bozuk / eksik tutarlı olay fatura
yazmaz ve `needs_review: <kod>` ile yeniden işlenebilir kalır, hesap silinirken gelen ödeme olayı alarm + inceleme (hesap geri açılmaz);
O1 ilk deneme listesi `DURABLE_OUTBOX_ORG_IDS` + anahtar kapatma testleri (eski koda dönmeden önce ana anahtar kaldırılır — tasarım §7); QR
çalışan kilit (120 sn) ≠ tamamlanmış kayıt (24 sa) + işçi jetonu (bayat işçi kaydetmez / başkasının kilidini silmez). Faz 2 (migration
taslağı) / Faz 3 (yapay zekâ, anahtar kapalı) ve sorular I1–I4: `docs/arastirma-2026-10-15/KURUCU-SORULARI.md` §I. Aynı dilimde
(migration'sız): O3 kuyruk alarmı A + B, S4 kayıt tekrarı, Opus dilim sonu 11 bulgusu (KVKK küçültme, silme ↔ ödeme yarışı kilidi, geri dönüş
süzgeci, ödeme inceleme listesi, Resend çakışması, liste `*` kuralı) — §I "Dilim sonu kontrolü".

**10-15 gece — idempotency bitişi + kurucu D1–D7:** iptal yollarının hepsi aynı kilit protokolünde (sekiz yol, iptalden önce başlamış
görev açmaya karşı belirlenimci testler; "zaten iptal" kısa yolu kaldırıldı; ters yön "Yeniden aç" kilitli yoldan). Onarım ≠ alarm: iCal (onarım
taraması, koşu başına 50) ve Hospitable (her senkron) kendiliğinden yeniden dener; dosya / PATCH yolunda otomatik onarım YOK (D5 aracı, onay
bekliyor). Kurucu D1 (form başına kimlik + "Ayrı bir bilgi olarak ekle" + güncel listeden düzenle) · D4 (arıza görev tespiti genişledi; soru /
varsayım / olumsuzlama ayrıldı; başlık "Bakım — misafir bildirimi: <cihaz>"; öncelik değişmedi) · D6 (PATCH + düğme tek kural
`lib/reservations/reopen.ts`) · D7 (yalnız sistem görevi "var" sayılır; bitmiş görev yalnız aynı gün) kodda. D2 + D3 kodu hazır, **migration 68
onayı bekliyor** (yedek dal `backup/d2d3-stash-2026-10-15`). D5 sayım aracı salt-okuma (Railway kapalı → koşulmadı). Ölçülen bulgu: "Kapının
kilidi bozuldu, çıkamıyoruz" acil sayılmıyor (soru G-D4b). Durum + sorular `docs/arastirma-2026-10-15/KURUCU-SORULARI.md` §E–§G; test
paralelleştirme raporu `docs/arastirma-2026-10-15/test-paralellik.md` (öneri; ana yapılandırma değişmedi).
Gece devamı (kurucu inceleme notu "BOZUKLAR İÇİN BİLGİ TABANINDA YAZMAYAN ÖNERİLER VEREMEZ" + TV / çöp vakası): iki anahtar, ikisi KAPALI —
`AI_FAULT_GUARD_ENABLED` (cihaz + arıza ifadesi aynı cümlecikte → kod şikâyet öğesi, arızalı istek ev sahibinde, liste kipi dahil; misafir
"düzeldi" deyince kodun işi kapanır) ve `AI_FIX_SUPPORT_GATE_ENABLED` (arıza adımı tarif, kullanım adımı konu ister; kanal + QR + Ayarlar testi +
karşılaştırma aynı yüklem `relation.fixSupportHolds`; kayıtlı 3.324 cevapta 40 tutuş — hepsi şikâyet senaryosunda uydurma adım —, gönderilmiş
cevapta 0). TV belirti sözcükleri genel konu çıkarımından AYRILDI (Opus N2: "görüntülü diyafon" TV tarifi sayılıyordu). Opus N1–N12 + yaşayan
iki mutant (O1, D2b) kapandı; sorular §H.
10-16 gece (Opus ikinci tur M1–M11, §H8): misafirin ARIZA bildirdiği cihaza adım TARİF ister (yalnız konu yetmez); kibar / yabancı dil adım
biçimleri; kullanım adımı kendi cihazına bakar; arıza okuması cihaz bazında (`faultDevicesOf`: düzelme yalnız kendi cihazını kapatır, soru /
sanı düzelme değil). Anahtarsız iki düzeltme: istek tarafında TV belirtisi yalnız bağlayıcı türde (M6, gevşetiyordu) · görev tespitinde
misafirin kendi eşyası aynı cümlecikte okunur (M5). Geçmişten öğren ad maskesi konuşma başına (M9). Mutasyon 21/24 + üç pin; soru H9.
Opus üçüncü tur (P1-a/b, P2-a…d, P3): TV mobilyası / oda adı yer tarifi; arıza + BAŞKA soru turunda cihazsız cümle arızayı devralmaz (meşru
cevapların %10'u tutuluyordu → %1,5); düzelme sırası cümlecik içinde; genel "görüntü" yalnız arıza yüklemiyle TV. Kurucu sorusu (10-16, dört
görsel — transactional outbox): desen VAR (kimlik e-postası kuyruğu canlı, misafir mesajı kuyruğu hazır + kapalı, olay kuyruğu canlı);
operatör panelinde kuyruk sağlığı + `EMAIL_OUTBOX_ENABLED` kapalıyken açılış uyarısı; plan `docs/TASARIM-2026-10-16-transactional-outbox.md`,
sorular H10 (O1–O3). 10-16 sabah — O1 (misafir mesajı kuyruğunu açma) Opus hazırlık incelemesinin tek ENGEL'i kapandı: öğe kipinde "ev sahibiyle
görüşmek istiyorum" cevabından sonra kuyruk yolu yapay zekâyı 12 saat susturuyordu, satır içi yol susturmuyor. Karar kuyruğa girişte satırla
aynı işlemde işaretlenir (`outbox/handoff-exempt.ts`, göçsüz `SystemLock`); işaret yoksa kilit (güvenli yön). Teslimde turu yeniden kurma denemesi
Haiku (tetik yetmez) ve Opus dilim kontrolü (B1 tehlikeli yön: bu geçiş öğe kipine girmedi ama turda eski öğe vardı; B2) ile çürütüldü.
İşaret süresi dolunca satır hâlâ gidebiliyorsa uzar (Haiku: 402 ile günlerce bekleyen satır). CI #1505 rastlantısal kırmızı: olay günlüğü
süzgeci cuid'deki 7+ rakam dizisini ("…l2070000n…", zaman damgası + sıfır dolgulu sayaç) telefon sanıp `outboxId`'yi düşürüyordu → tam cuid
biçimli `outboxId` / `consentId` için dar muafiyet (en çok 9 rakam; telefon / TC uzunluğu yine düşer). Operatör paneline "son 24 saatte
incelemeye düşen" sayacı; ev sahibi ekranı önerileri O5 / O6 soru. Açmadan önce bilinecek beş madde + O3 ölçülen kapsam H10'da. Ana dalda tip hatası (migration 68
dünyasının alanı `act.ts`e taşınmıştı, çalışma zamanı etkisiz) origin hâline döndü.

**10-15 öğleden sonra — V sonrası işler (kurucu "Vlerden sonra yapacağız dediklerimi yap, soru sorma"):** beş Opus araştırması
`docs/arastirma-2026-10-15/` (idempotency · ödeme · takip numarası · yatay ölçek · deneme kötüye kullanımı). Müşteriye / misafire gideni
değiştirmeyen, migration'sız düzeltmeler SORULMADAN yapıldı: bilgi tabanı ekleme ekranları + kopyalama istek kimliği, rezervasyon görevi /
mesajdan görev / söz / talimat çiftleri kilit altında, kimliksiz CSV eş zamanlı yükleme, QR jetonu koşullu yazım, Paddle imza alarmında
"eski zaman damgası" ayrı teşhis, Sentry sürüm / ortam / alan etiketi + olay günlüğünde Sentry olay kimliği, dört ödeme eşzamanlılık testi
(gerçek PG). Sorular (14 madde, sıralı) `docs/arastirma-2026-10-15/KURUCU-SORULARI.md`; U42'nin basit hâli hazır yama.
Opus son kontrolü (0 P0 · 0 P1 · 2 P2 · 13 P3; rapor özeti KURUCU-SORULARI §A/§C) + Haiku son tur kodda kapandı: söz önerisinde ölü düğme,
iCal testlerinin hedefi, rezervasyon görevi hızlı yol + kilit altında yeniden okuma + iptal temizliği aynı kilit ve kendini onarma, görev hatası
satır hatası sayılmaz, eşzamanlılık testleri kilit sınamasıyla belirlenimci (`tests/helpers/lock-probe.ts`). Mutasyon: ilk tur 14/17 (yaşayan 3
→ belirlenimci testlerle) ikinci tur 20/20.

**10-15 gündüz — Geçmişten öğren (migration 65, hiçbir yere uygulanmadı; `HISTORY_LEARN_ENABLED` KAPALI):** müşteri "Geçmişi oku"
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
