# Sabah Kararları — 2026-10-01 (gece modu)

> Gece modunda (kurucu: "soru sorma, ben gelene kadar") onay gerektiren her nokta burada birikir. Hiçbir madde silinmez;
> yanıtlanan madde "KARAR: …" satırıyla kapanır. Her maddede: **durum** · **öneri** · **müşteriye etkisi** · **beklerken yapılmayan**.
> Önceki listeler: `docs/SABAH-KARARLARI-2026-09-28.md` (K1–K10 a–t) ve `docs/INCELEME-2026-09-30-codex-ve-ajanlar.md` (K1–K18).

## 1. "Karar bekliyor" kartı — erken giriş / geç çıkış için onay / ret düğmesi
- **Durum:** Kurucunun istediği akışın üç parçası kodda, anahtar arkasında (`AI_HOST_DECISION_HOLD_ENABLED`, varsayılan KAPALI):
  "ev sahibinizin kararıdır" cümlesi ve iki modelin doğruladığı konaklama ertelemesi misafire **gitmez**; ev sahibine mesaj başına
  **tek** "Misafir cevabınızı bekliyor" e-postası; konuşmanın öğesi **açık** kalır (cevaplandı yazılmaz). Eksik parça: panelde
  "13:00 erken giriş — karar bekliyor" başlıklı kart ve **Onayla / Reddet** düğmeleri (talebin sonuçlanması). Bu, Host Copilot Faz 1
  (Host Karar Motoru) işidir: `DecisionRequest` tablosu (migration) + 6 dilde metin + e-posta. Onay paketi hazır:
  `docs/ONAY-HOST-COPILOT-FAZ0-2026-09-25.md` (K1–K10).
- **Örnek — misafir: "Saat 13:00'te giriş yapabilir miyiz?"**
  - *Bugün (canlı):* iki model ertelemeyi doğrularsa "Standart giriş 15:00. Erken giriş ev sahibinizin kararına bağlıdır." GİDER;
    konuşma "cevaplandı" olur, ev sahibine bildirim YOK (kurucunun tarif ettiği hata).
  - *Anahtar açılınca (bu gece hazır):* misafire HİÇBİR ŞEY gitmez; ev sahibine TEK e-posta "Misafir cevabınızı bekliyor"; konuşmada
    erken giriş öğesi AÇIK; gelen kutusundaki erken giriş kontrol paneli kanıtları gösterir (temizlik "bitti" kaydı ve saati, önceki
    misafirin çıkışı, sonraki / önceki rezervasyon, ücret kuralı). Her şey doğrulanmış ve mülkte "otomatik" kuralı açıksa AI zaten
    KODLA kurulmuş onayı gönderir ("Daireniz hazır; bugün (1 Ekim) saat 13:00 itibarıyla giriş yapabilirsiniz. Erken giriş ücreti
    300 TL.") — bu yol değişmedi.
  - *Faz 1 (onayınızla):* panelde "13:00 erken giriş — karar bekliyor" kartı + **Onayla / Reddet**. Onayla → kod kanıtları yeniden
    doğrular, misafire kodla kurulmuş onay gider; Reddet → nazik ret ("Bugün erken giriş mümkün olmadı; giriş 15:00'ten itibaren.").
    Bildirim tek; talep kararla kapanır; karar kaydı tutulur. (Büyük platformlar da böyle: bekleyen talep kartı + kabul / ret.)
- **Öneri:** Faz 0 paketindeki on kararı verin; ardından migration + kart + düğmeler (kırmızı-önce, tam kapılar, yedek onayıyla).
- **Müşteriye etkisi:** Misafire geçiştirici cevap gitmez; ev sahibi tek bildirimle kararı panelden verir, AI kararı misafire
  kodla kurulmuş metinle iletir.
- **Beklerken yapılmayan:** migration, kart, düğmeler. Anahtar canlıda AÇILMADI.

## 1b. "Daire hazır" kanıtında temizlikçinin FOTOĞRAFI şart olsun mu?
- **Durum:** Bugün "hazır" kanıtı = temizlik görevinin KİMLİKLİ son durum kaydı "bitti" + saati (≥5 dk önceki çıkıştan sonra); fotoğraf
  isteğe bağlı. Kurucu notu: "temizlikçinin attığı fotoya işaretlemesinin saatine bakacak".
- **Öneri:** Otomatik onay için "bitti" kaydında en az bir fotoğraf şartı (fotoğrafsız "bitti" → ev sahibine karar kartı). Elle onayda
  şart yok.
- **Müşteriye etkisi:** Fotoğraf yüklemeyen temizlikçide erken giriş otomatik onaylanmaz, ev sahibine düşer.
- **Beklerken yapılmayan:** kural değişikliği.

## 1c. Erken giriş kanıtlarını cevap modeline "bol bol" vermek (kurucu: "onu bol bol besleyip cevabı EN DOĞRU şekilde")
- **Durum:** Kanıtlar (temizlik "bitti" kaydı ve saati, önceki misafirin çıkışı, sonraki / önceki rezervasyon, ücret kuralı) KODDA
  değerlendiriliyor; otomatik onay yalnız koddan kurulan metinle gider (model izin cümlesi yazamaz). Cevap modeli bu kanıtları GÖRMÜYOR.
- **Öneri:** Kanıtları cevap modeline YALNIZ ev sahibine hazırlanan TASLAK için salt-okuma özet olarak verelim ("Temizlik 12:40'ta
  bitti · önceki misafir 11:05'te çıktı · ücret 300 TL"); misafire otomatik giden metin yine YALNIZ kodla kurulur (model kanıttan izin
  ÇIKARAMAZ). Böylece ev sahibinin önündeki taslak doğru ve dolu olur, karar yine kanıtla verilir.
- **Müşteriye etkisi:** Misafire giden metin değişmez; ev sahibinin taslağı kanıtlı hâle gelir.
- **Beklerken yapılmayan:** istem / bağlam değişikliği.

## 2. Erken giriş BİLGİ cevabındaki "kararı ev sahibiniz verir" cümlesi
- **Durum:** Koddan kurulan politika metni (ör. "Erken giriş ücreti 300 TL. Erken girişin mümkün olup olmadığı o günkü temizliğe
  bağlıdır; kararı ev sahibiniz verir.") 6 dilde bu cümleyi taşır. Anahtar (madde 1) açılırsa bu bilgi cevabı da **tutulur** (pinli).
- **Öneri:** Metni şöyle değiştirelim: "Erken giriş ücreti 300 TL. Erken girişin mümkün olup olmadığı o günkü temizliğe göre
  netleşir." (ev sahibini karar verici diye anmadan; 6 dil).
- **Müşteriye etkisi:** "Erken giriş ücretli mi?" sorusu otomatik cevaplanmaya devam eder; geçiştirici cümle kalkar.
- **Beklerken yapılmayan:** metin değişikliği (müşteriye giden metin → onayınız).

## 3. Şikâyete bağlı istek kuralının kapsamı
- **Durum:** Kurucu talimatıyla CANLIYA HAZIR (anahtarsız, RC49): bu turda tutulan bir **şikâyet** varken, bağımsız bilgi türü
  olmayan istek cevaplanmaz; kapı da (iki öğe doğrudan verilse bile) tutar. Bağımsız türler: Wi-Fi, otopark, giriş / çıkış saati,
  bagaj, ulaşım, çevre önerisi, giriş / anahtar. Olanaklar, cihaz kullanımı, temizlik / çarşaf, çöp, ev kuralları, "diğer" şikâyet
  turunda bağlı sayılır (temkinli).
- **Öneri:** (a) Liste böyle kalsın. (b) Aynı kural **iade / iptal** ve **ev sahibiyle görüşme** isteğine de uygulansın ("İade
  istiyorum, şimdi ne yapacağız?" → hiçbir şey gitmez, ev sahibinde). Öneri: (b).
- **Müşteriye etkisi:** (b) seçilirse iade / görüşme turlarında bağımsız olmayan yardım sorusu da ev sahibine kalır.
- **Beklerken yapılmayan:** iade / görüşme genişletmesi.

## 4. K6 — Meslek / rutin bakım anılması acil sayılmıyor (canlı davranış değişikliği)
- **Durum:** Codex K6'ya göre düzeltildi (RC49): "Doktor olan arkadaşım…", "Avukat arkadaşımızla…", "hastanedeki rutin kontrol
  randevum" artık nötrlenmiş acil sözcüğünü geri açmıyor. "mutfak yanıyor", "kapı kilitli, duman var", "doktor lazım, arkadaşım
  bayıldı", "hastaneye kaldırıldı" acil kalır. Bilgi için: onaylı K kapsamı.
- **Müşteriye etkisi:** Bu tür mesajlara artık otomatik cevap gidebilir (eskiden acil e-posta + cevap yok).

## 5. K5 — Sağlık ("Çocuğun ateşi var") — 09-30'dan devreden
- **Durum:** Değişmedi; karar modelde. **Öneri:** "sağlık" sınıfı: otomatik gönderim yok, ev sahibine bildirim (acil e-posta değil).

## 6. Luna (gpt-6-luna) katman bazında geçiş — ölçüm sonuçlarına göre (bu belgenin sonunda tablo)
- **Durum:** Ölçüm sürüyor (gece bütçesi ~25 USD). Katman bazında model ayarı eklendi (`AI_UNDERSTANDING_MODEL`,
  `AI_STAY_GUARD_MODEL`, `KB_RERANK_MODEL` + `*_REASONING_EFFORT`; boşken bugünkü ortak ayar).
- **Beklerken yapılmayan:** canlı model / bayrak değişikliği.

## 7. Ücret kuralı (kurucu ifadesi) — anahtar `AI_KB_FEE_RULE_ENABLED`
- **Durum:** İstem metni kurucunun ifadesiyle güncellendi ("Onaylı bilgi tabanındaki sabit hizmet ücretini, koşullarıyla birlikte
  söyle. Konaklama fiyatı, indirim, iade veya tazminat konusunda fiyat üretme ya da onay verme."); "ASLA yazma" yasağı anahtar
  açıkken satırın YERİNE geçer. Anahtar KAPALI.
- **Öneri:** Ölçüm sonucuna göre açılış (bu belgenin sonunda).

## 8. Şikâyet takibi istem katmanları — anahtar `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED`
- **Durum:** Kodda, KAPALI. Kod koruması (madde 3) anahtardan bağımsız çalışır.
- **Öneri:** Ölçüm sonucuna göre açılış.

## 9. Aşama 2 (V0–V8) — kurucunun 6 maddesi bekleniyor
- **Durum:** `docs/ASAMA-2-V0-V8-HARITA-2026-09-30.md` taslak. Gece V işine başlanmadı (talimat).

## 10. Devreden: K13 (destek erişimi metni — avukat), K15 (Nodemailer gerçek deneme e-postası), K17 (kod selamı anahtarı)
- **Durum:** Değişmedi.

## 11. Sık okunan belgelerin arşive taşınması (öneri: `docs/ARSIV-ONERISI-2026-10-01.md`)
- **Durum:** Öneri hazır, HİÇBİR metin taşınmadı / silinmedi. CLAUDE.md'nin ~%8,6'sı (≈16k karakter) tur anlatısı, kural içindeki
  eski ölçüm sayısı ve kopya; kural metinleri, siren işaretli cümleler, kurucu kararları ve bekleyen onaylar olduğu gibi kalır.
  Taşımadan önce dört eski / eksik ifade düzeltilmeli (yedi canlı bayrak "Canlı durum" tablosunda yok; "E2 = migration 56" ve
  "AÇMA KARARI KURUCUDA" eskimiş; Railway notu — madde 12).
- **Öneri:** Onaylarsanız tek commit'te taşıma + önce / sonra sayım kontrolü (siren, "ONAY BEKLEYEN", bayrak adları düşmemeli).
- **Müşteriye etkisi:** Yok (yalnız belge).
- **Beklerken yapılmayan:** taşıma.

## 12. Railway — "ayın 1'ine kadar aktif" (09-24 notu) — bugün 10-01
- **Durum:** Kurucu (10-01 sabah): "Railway daha kapanmadı ama birkaç saate kapanacak." RC50 (K7 migration 58 dahil) 05:15'te
  itildi; CI yeşilse Railway kapanmadan yayınlanır. Kapandıktan sonraki push'lar dalda bekler, açılınca son sürüm yayınlanır;
  geliştirme ve ölçüm bu ortamda sürer (Railway'e bağlı değil). Yerel çalıştırma komutları ve kapatmadan önceki yedek adımları
  kurucuya iletildi (`docs/OPS-2026-09-19-DURAKLATMA-VE-LOCAL-GELISTIRME.md` §1–§2, §6).
- **Öneri:** RC50 yayınlandıktan SONRA taze yedek + prova (30 Eylül yedeği migration 58'den önce). Dış müşteri / yaklaşan QR
  kullanımı yoksa kapatmak uygun (kurucu org'un Hospitable aboneliği zaten 402); varsa en düşük ücretli planla açık tutmak.
- **Müşteriye etkisi:** Railway kapanırsa QR sohbeti / oto-yanıt / senkron durur (09-19 duraklatma belgesi).
- **Beklerken yapılmayan:** —
- **Gelişme (10-01 sabah):** RC50 canlıda (08:37). Kurucu yedeği aldı (05:18Z, SHA `E8FE9786…3333`; satır sayıları 09-19 ile aynı —
  veritabanında o günden beri yeni mesaj yok, bu yedek son hâl), Masaüstündeki 22 şifresiz yedeği tek AES arşivine koydu
  (`C:\LixusYedek`, test "Everything is Ok"), şifresizleri sildi, OneDrive geri dönüşüm kutusu boş. Prova bilerek atlandı (kurucu
  kararı; aynı araç zinciriyle alınan 09-19 yedeği prova edilmişti). Araç notu: prova betiği dosyayı yalnız Masaüstünde arıyor —
  `-DumpDir` seçeneği eklenmeli (OneDrive dışı klasörle prova için).

## 13. Çok sorulu mesajda konaklama isteği — güvenli kısım cevaplansın mı? (`AI_HOST_DECISION_HOLD_ENABLED` açıkken)
- **Durum (ölçüldü, R1 5.1 + aday bayraklar):** "13:00'te çıkabilir miyiz, anahtarları nereye bırakalım?" → cevap modeli geç çıkış için
  erteleme cümlesi yazıyor → cümle misafire gitmeyeceği için cevabın TAMAMI tutuluyor; anahtar sorusu da cevapsız kalıyor; ev
  sahibine 1 e-posta.
- **Öneri:** Anahtar açıkken konaklama isteği (erken giriş / geç çıkış / uzatma / tarih değişikliği) "sessizce ev sahibinde" öğe olsun
  (öğe bazlı risk kuralınız: güvenli kısım cevaplanır, hassas istek ev sahibinde açık iş). Cevap modeli o isteğe değinmez.
  - *Önce:* hiçbir şey gitmez.
  - *Sonra:* "Anahtarları mutfak tezgâhına bırakabilirsiniz." gider; panelde "13:00 geç çıkış — açık iş", ev sahibine tek e-posta.
  - Tek istekli mesajda ("13:00'te çıkabilir miyiz?") bugünkü gibi hiçbir şey gitmez. Koddan kurulan doğrulanmış erken giriş onayı
    değişmez.
- **Müşteriye etkisi:** Misafir güvenli sorusunun cevabını alır; karar gerektiren istek hakkında ondan hiçbir şey duymaz.
- **Beklerken yapılmayan:** plan / kapı değişikliği.

## 14. Wi-Fi arızası + sinirli misafir ("Şifre çalışmıyor, iki saattir internet yok, çok sinir bozucu!")
- **Durum (ölçüldü):** Bugün canlıda (5.1, aday bayraklar kapalı) şifre + modem yeniden başlatma tarifi GİDER, ev sahibine haber
  GİTMEZ (Wi-Fi arızası kelime ağında bilerek "Wi-Fi sorusu"). Aday bayraklarla (5.1 ve Luna) cevap TUTULUR + ev sahibine e-posta.
- **Öneri:** İkisinin ortası — sorun giderme tarifi gitsin VE ev sahibine "Wi-Fi arızası bildirildi" haberi gitsin (arıza gerçekse
  teknik müdahale gerekir).
- **Müşteriye etkisi:** Misafir beklemeden tarifi alır; ev sahibi arızadan haberdar olur.
- **Beklerken yapılmayan:** kural değişikliği.

## 15. Şikâyetli turda güvenli soru da cevapsız kalıyor (model-bağımsız) — örnek devir cümleleri
- **Durum (ölçüldü, 5.1 ve Luna):** "Çöpü nereye atıyoruz? Bu arada klima çalışmıyor." → cevap modeli çöp sorusunu cevaplayıp sonuna
  "mesajınız kaydedildi, ev sahibiniz görebilir" ekliyor; K10 kararıyla bu cümle misafire gitmediği için cevabın tamamı tutuluyor.
  Ayrıca bu gecenin şikâyete bağlı istek kuralı (madde 3) çöpü bağımsız tür saymıyor.
- **Öneri:** (a) istemdeki örnek devir cümlelerini K10 kararına uydurmak (misafire "kaydedildi" denmez; ücretli cevap kıyası gerekir,
  ~$1–2) · (b) madde 3'teki bağımsız türlere `trash` (konum bilgisi) eklemek.
  - *Önce:* hiçbir şey gitmez.
  - *Sonra:* "Çöp konteyneri binanın arka kapısının yanında." gider; klima arızası ev sahibinde açık iş + e-posta.
- **Müşteriye etkisi:** Şikâyetli turda bağımsız bilgi sorusu cevaplanır.
- **Beklerken yapılmayan:** istem ve liste değişikliği.

## 16. "Bilgim yok" kuralı yedi dile genişletildi (uygulandı — bilgi için)
- **Durum:** Kuralınız ("müşteriye hiçbir zaman 'bilgim yok' gitmez") yalnız Türkçe / İngilizce uygulanıyordu. Gece ölçümünde Luna'nın
  iki itirafı (tr "kuaför bilgisi elimde olmadığı için…", fr "…ne sont pas précisées ici") ve kıvrık kesme işaretli İngilizce
  "I don’t have information…" kapıdan geçti; 5.1'in 30 Eylül kabul koşusundaki Almanca itirafı da. Hepsi artık tutuluyor (FR / DE / ES / RU
  / AR + Türkçe ek biçimler); 3.726 kayıtlı model cevabında yeni tutulan 8'in hepsi gerçek itiraf, meşru cevap tutulmadı.
- **Müşteriye etkisi:** Diğer dillerdeki misafire de "bilgim yok" gitmez; o cevaplar ev sahibine kalır.
