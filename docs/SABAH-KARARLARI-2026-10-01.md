# Sabah Kararları — 2026-10-01 (gece modu)

> Gece modunda (kurucu: "soru sorma, ben gelene kadar") onay gerektiren her nokta burada birikir. Hiçbir madde silinmez;
> yanıtlanan madde "KARAR: …" satırıyla kapanır. Her maddede: **durum** · **öneri** · **müşteriye etkisi** · **beklerken yapılmayan**.
> Önceki listeler: `docs/SABAH-KARARLARI-2026-09-28.md` (K1–K10 a–t) ve `docs/INCELEME-2026-09-30-codex-ve-ajanlar.md` (K1–K18).

## Öncelik sırası (okuma kılavuzu — maddeler aşağıda, hiçbiri silinmedi)

1. **12 Railway** — bugün kapanıyor; yedek alındı ve şifreli. Kapatma / açık tutma kararı sizde.
2. **6 Luna geçişi** — kör kabulde Luna `none` cevap modeli 5.1'den geri düşmedi; anlama / bekçi / sıralayıcı / çeviri 5.1'de kalmalı, üslup
   Luna olabilir. Adımlar ve değişkenler: `docs/SABAH-RAPORU-2026-10-01.md` §6–§7.
3. **1, 7, 8 bayrakları** — ev sahibi kararı tutulur (1), ücret kuralı (7), şikâyet takibi (8) — 8, madde 14'teki istisnayla birlikte.
4. **13, 17, 18 misafire giden davranış** — çok sorulu mesajda konaklama isteği; şikâyet + bağımsız soru (anlam ilişkisi, 3 ve 15'in
   yerini alır); arıza tarifi tehlike sınırıyla (14'ün yerini alır). Önce / sonra örnekli. Son kör kabul bunlar kodlandıktan SONRA,
   canlı geçişten ÖNCE (rapor §6 adım 6).
5. **3, 2, 1b, 1c** — şikâyete bağlı istek kapsamı, politika metni, fotoğraf şartı, kanıtları taslağa verme.
6. **11 arşiv**, **4–5 (K6 / K5)**, **9 (Aşama 2)**, **10 (devreden)**; **16** yalnız bilgi.

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
- **GÜNCELLEME 10-01 sabah (ilettiğiniz inceleme, kodla doğrulandı):** sabit liste iki yönde yanlış karar veriyor → öneri (a) GERİ
  ÇEKİLDİ, yerine **madde 17** (anlam ilişkisi önce, liste tek başına karar vermez). (b) iade / görüşme genişletmesi 17'nin içinde ayrıca
  sorulur.

## 4. K6 — Meslek / rutin bakım anılması acil sayılmıyor (canlı davranış değişikliği)
- **Durum:** Codex K6'ya göre düzeltildi (RC49): "Doktor olan arkadaşım…", "Avukat arkadaşımızla…", "hastanedeki rutin kontrol
  randevum" artık nötrlenmiş acil sözcüğünü geri açmıyor. "mutfak yanıyor", "kapı kilitli, duman var", "doktor lazım, arkadaşım
  bayıldı", "hastaneye kaldırıldı" acil kalır. Bilgi için: onaylı K kapsamı.
- **Müşteriye etkisi:** Bu tür mesajlara artık otomatik cevap gidebilir (eskiden acil e-posta + cevap yok).

## 5. K5 — Sağlık ("Çocuğun ateşi var") — 09-30'dan devreden
- **Durum:** Değişmedi; karar modelde. **Öneri:** "sağlık" sınıfı: otomatik gönderim yok, ev sahibine bildirim (acil e-posta değil).

## 6. Luna (gpt-6-luna) katman bazında geçiş — ölçüm SONUÇLANDI (`docs/SABAH-RAPORU-2026-10-01.md` §3, §6, §7)
- **Durum:** Gece ölçümü bitti (≈$11 / $25). Kör kabul (88 senaryo, son kod): Luna `none` cevap modeli, 5.1 + aynı bayraklara göre geri
  düşmüyor (gitmemesi gerekirken giden 0 ↔ 1, doğru olgu 44 ↔ 43/48, maliyet $0,34 ↔ $0,94, p95 8,0 ↔ 8,9 sn). Düşünme low / medium / high
  hatayı düzeltmiyor (yalnız daha çok tutuyor + yavaşlatıyor). Anlama + bekçi Luna'da güvenlik açısından zayıf (bekçi Türkçe izin cevabını
  kaçırıyor; `low`da 3 tehlikeli kaçak). Çeviride Luna fazladan belirteç kaybediyor; üslupta Luna daha iyi.
- **Öneri:** cevap modeli Luna `none` + üslup Luna; anlama / bekçi / sıralayıcı / çeviri 5.1'e SABİT (`AI_SEMANTIC_MODEL=gpt-5.1`,
  `OPENAI_TRANSLATE_MODEL=gpt-5.1`). Geçiş sırası raporun §6'sında; önce 13–15 davranış kararları.
- **Müşteriye etkisi:** Kabul ölçümünde cevap kalitesi aynı; "ev sahibinizin kararıdır" ertelemeleri (bayrakla) gitmez; maliyet ~⅓.
- **Beklerken yapılmayan:** canlı model / bayrak değişikliği. "Yalnız modeli değiştirmek kaldı" DEĞİL — sabitleme değişkenleri + bayrak
  kararları + 13–15 gerekir.

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

## 14. Arıza şikâyeti + bilgi tabanında çözüm tarifi var ("Şifre çalışmıyor, iki saattir internet yok, çok sinir bozucu!")
- **Durum (ölçüldü — İLK yazdığım "ev sahibine haber gitmiyor" YANLIŞTI, kayıtlarla düzeltildi):**
  - *Bugün canlıda (5.1, aday bayraklar kapalı):* mesaj iki öğeye bölünüyor → şifre + modem yeniden başlatma tarifi GİDER, şikâyet ev
    sahibinde açık iş + **e-posta GİDER** (luna-dev-2 R0 ve kör kabul A2'de aynı: "The wifi hasn't worked at all since last night…" →
    tarif gitti + 1 e-posta). Öğe tasarımınızla uyumlu ("güvenli kısım cevaplanır, hassas kısım ev sahibinde").
  - *Aday bayraklarla (`AI_COMPLAINT_FOLLOWUP_RULE_ENABLED`, 5.1 ve Luna):* anlama katmanı yardım isteğini şikâyetin parçası sayıyor →
    misafire HİÇBİR ŞEY gitmez, ev sahibine e-posta gider.
  - Aynı kural "Gürültüden uyuyamadık, yine olursa ne yapacağız?" vakasında doğru çalışıyor (orada güvenli bir cevap yok, model kural
    hatırlatması + 112 yazıyordu).
- **Öneri:** Şikâyet takibi kuralı kalsın ama istisnası olsun: bilgi tabanında o arızanın ÇÖZÜM TARİFİ varsa (modem yeniden başlatma,
  sigorta, sıcak su düğmesi) tarif gitsin + ev sahibine e-posta (bugünkü canlı davranış). Tarif yoksa bugünkü aday davranış (hiçbir şey
  gitmez). Anlama istemine eklenecek bir cümle + ücretli ölçüm (~$1).
  - *Örnek:* "Wi-Fi çalışmıyor" → tarif gider + e-posta · "Gürültüden uyuyamadık, yine olursa?" → hiçbir şey gitmez + e-posta.
- **Müşteriye etkisi:** Arızada misafir beklemeden çözüm adımını alır; ev sahibi her durumda haberdar.
- **Beklerken yapılmayan:** istem değişikliği. Not: kör kabulde 5.1'e "sızıntı 1/12" yazan satır budur (tarif + e-posta), gerçek sızıntı değil.
- **GÜNCELLEME 10-01 sabah:** buradaki ilk önerim "sigorta, sıcak su düğmesi"ni de istisnaya katıyordu — FAZLA GENİŞ (ilettiğiniz
  inceleme haklı: bilgi tabanında bulunmak tek başına güvenli demek değil). Yerini **madde 18** aldı.

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
- **GÜNCELLEME 10-01 sabah:** (b) listeye `trash` eklemek GERİ ÇEKİLDİ (liste yamasıdır; aynı liste otopark kapısı arızasında yanlış
  yönde karar veriyor) → **madde 17**. (a) örnek devir cümleleri ayrı iş olarak duruyor.

## 16. "Bilgim yok" kuralı yedi dile genişletildi (uygulandı — bilgi için)
- **Durum:** Kuralınız ("müşteriye hiçbir zaman 'bilgim yok' gitmez") yalnız Türkçe / İngilizce uygulanıyordu. Gece ölçümünde Luna'nın
  iki itirafı (tr "kuaför bilgisi elimde olmadığı için…", fr "…ne sont pas précisées ici") ve kıvrık kesme işaretli İngilizce
  "I don’t have information…" kapıdan geçti; 5.1'in 30 Eylül kabul koşusundaki Almanca itirafı da. Hepsi artık tutuluyor (FR / DE / ES / RU
  / AR + Türkçe ek biçimler); son hâliyle 4.526 kayıtlı metinde gece öncesi kurala göre yeni tutulan 11 (10'u gerçek itiraf, 1'i rapor notu), eskiden
  tutulup artık tutulmayan 0; "gerek yok" anlamındaki olumsuz cümleler tutulmuyor; mutasyon 41/41. RC51 ile canlıda (CI #1275 yeşil).
- **Müşteriye etkisi:** Diğer dillerdeki misafire de "bilgim yok" gitmez; o cevaplar ev sahibine kalır.

## 17. Şikâyet + başka soru aynı mesajda: önce ANLAM İLİŞKİSİ, sabit liste tek başına karar vermez (ilettiğiniz inceleme; Soru 2 → A)
- **Doğrulama (kodla, ücretsiz — bugünkü kural madde 3'teki liste):**
  - "Klima çalışmıyor; çöp konteyneri nerede?" → çöp sorusu TUTULUYOR: liste çöpü bağımsız saymıyor; anlama katmanı klimayı "cihaz
    kullanımı" diye etiketlerse kelime ağının şikâyet etiketi hiçbir isteğe atfedilemiyor ve mesajın tamamı tutuluyor. Gece ölçümünde
    üç yapılandırmada da (C1 5.1 · C2 · C3 Luna) çöp sorusu cevapsız kaldı.
  - "Otopark kapısı açılmıyor, nasıl çıkacağız?" → anlama katmanı "nasıl çıkacağız"ı otopark ya da ulaşım isteği olarak ayırırsa
    CEVAPLANABİLİR sayılıyor (liste otoparkı bağımsız sayıyor) — oysa soru arızaya bağlı.
  - Doğru çalışanlar: "Gürültüden uyuyamadık, yine olursa ne yapacağız?" (hiçbir şey gitmez) · "İnternet yok, modemi nasıl
    resetleriz?" (tarif gider + e-posta) · "Sıcak su yok…", "Sigorta attı…" (gitmez — ama tasarım gereği değil, liste yüzünden).
- **Öneri (A + anlam ilişkisi):**
  1. *Anlam (model):* anlama katmanı her isteği "şikâyetin devamı / sonucu" ya da "kendi konusu olan bağımsız soru" diye işaretler
     (`AI_COMPLAINT_FOLLOWUP_RULE_ENABLED` katmanına bir alan). İşaret yoksa / tanınmıyorsa → bağlı (belirsizlik güvenli değildir).
  2. *Kod koruması (yalnız sıkılaştırır):* model "bağımsız" dese de istek şikâyetle AYNI nesneyi konu alıyorsa (otopark kapısı ↔
     otopark sorusu) ya da kendi konusu yoksa ("ne yapacağız", "nasıl çıkacağız") → bağlı. Model aynı hatayı yaparsa kod tutar.
  3. *Güvenli cevap kanıtı:* bağımsız soru yalnız bilgi tabanına / mülk alanına dayanan cevapla gider; bugünkü kapıların hepsi aynen
     (bilgim yok, şikâyetçiye kural hatırlatması yok, 112 yalnız gerçek can güvenliği, "kaydedildi" yok). Şikâyet açık iş + ev sahibine
     mesaj başına tek e-posta.
  4. *Sabit liste kalkar* (anlama katmanı yoksa tur zaten öğeye bölünmüyor — bugünkü konuşma düzeyi kapı).
- **Önce → sonra:**

  | Mesaj | Bugün | Öneri |
  |---|---|---|
  | "Klima çalışmıyor; çöp konteyneri nerede?" | hiçbir şey gitmez | çöp yeri gider (bilgi tabanında varsa); klima şikâyeti açık iş + 1 e-posta |
  | "Otopark kapısı açılmıyor, nasıl çıkacağız?" | bölünürse "çıkış" sorusu cevaplanabilir | şikâyete bağlı → madde 18 (tarif yoksa hiçbir şey) + 1 e-posta |
  | "Gürültüden uyuyamadık, yine olursa ne yapacağız?" | hiçbir şey (doğru) | aynı |
  | "Gürültüden uyuyamadık. Wi-Fi ağı hangisi?" | Wi-Fi gider | aynı |
- **Ek soru (madde 3b):** aynı kural iade / iptal ve ev sahibiyle görüşme isteğinin yanındaki soruya da uygulansın mı? Öneri: evet
  (aynı "anlam ilişkisi" sorusu: "İade istiyorum, şimdi ne yapacağız?" → bağlı, hiçbir şey gitmez).
- **Müşteriye etkisi:** bağımsız soru cevapsız kalmaz; şikâyete bağlı soruya genel bilgiyle "cevap" gitmez.
- **Beklerken yapılmayan:** anlama alanı + kod koruması (ücretli ölçüm ister: konaklama eval'i 5.1 ≈ $1,5 + konuşma öğeleri ≈ $0,2).
- **KARAR (kurucu, 10-01 sabah):** "Evet, bu kapsamda kodla; iade ve ev sahibiyle görüşme taleplerine de aynı ilişki kuralını uygula.
  Bağımsızlık etiketi tek başına gönderim izni olmasın … İlişki belirsizse ilgili soruyu tut. Güvenli sorunun cevaplanması hassas öğeyi
  kapatmasın; host bildirimi korunsun ve yinelenmesin. Hatalı 'bağımsız' etiketi doğrudan kapıya verildiğinde de bağlı isteğin tutulduğunu
  test et." → **KODLANDI** (`54b8260` + `d4674b4`; `conversation-items/relation.ts`; anahtar `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED` arkasında,
  kapalıyken bugünkü liste birebir). Kırmızı-önce (eski kodda 4 davranış kırmızı) + 6 entegrasyon testi (tek e-posta, yineleme yok, hassas
  talep açık) + mutasyon. Canlıya açılış = son kör kabulden (madde 19) sonra.

## 18. Arıza + çözüm tarifi: yalnız ONAYLI TARİF KADAR, tehlike sınıfında otomatik değil (madde 14'ün yerine)
- **Durum:** madde 14'teki ilk önerim sigorta / sıcak su düğmesini de istisnaya katıyordu (fazla geniş). Bugün canlıda Wi-Fi tarifi
  gidiyor; sıcak su / sigorta sorusu gitmiyor — kural tasarımıyla değil, madde 3'teki liste yüzünden.
- **Öneri:**
  1. *Tarif istisnası:* şikâyete bağlı "nasıl düzeltirim" sorusu, bilgi tabanında O ARIZANIN onaylı tarifi varsa ve konu tehlike sınıfında
     değilse gider. Cevap yalnız tarifin adımlarını taşır, ekleme yapmaz ("KB olduğu derece" — notunuz). Şikâyet açık kalır, ev sahibine
     tek e-posta.
  2. *Tehlike sınıfı* (elektrik panosu / sigorta, gaz / kombi / şofben, sıcak su cihazı, yangın / duman, cihazı açma / tamir): otomatik
     GİTMEZ; bilgi tabanındaki tarif ev sahibinin hazır taslağına konur, tek tıkla gönderir.
- **Önce → sonra:**

  | Mesaj (bilgi tabanında ilgili tarif var) | Bugün | Öneri |
  |---|---|---|
  | "İnternet yok, modemi nasıl resetleriz?" | tarif gider + e-posta | aynı (yalnız tarifin adımları) |
  | "Otopark kapısı açılmıyor" + tarif "kumandanın 2. tuşuna basın" | bölünmeye bağlı | tarif gider + e-posta |
  | "Sıcak su yok, kombiyi nasıl resetleriz?" | hiçbir şey | hiçbir şey; ev sahibine hazır taslak (tarif içinde) + e-posta |
  | "Sigorta attı, ne yapalım?" | hiçbir şey | aynı + hazır taslak |
- **Sorulacak:** tehlike sınıfında (a) her zaman ev sahibinin onayı (öneri) mı, (b) ev sahibi bilgi tabanı kalemini "misafir yapabilir"
  diye işaretlerse otomatik mi? (b) kalem başına yeni bir alan ister.
- **Müşteriye etkisi:** güvenli arızada misafir beklemeden çözüm adımını alır; tehlikeli cihaza müdahale adımı ev sahibi görmeden gitmez.
- **Beklerken yapılmayan:** istisna kodu + anlama istemi cümlesi.
- **KARAR (kurucu, 10-01 sabah):** "2.a olsun önerin iyi" + "Elektrik/gaz/sıcak su cihazına müdahaleyi çözüm istisnasına alma." →
  **KODLANDI** (madde 17 ile aynı commit): tehlike sınıfı yedi dilli sözlük + sıcak su / ısıtma kavramı; tehlikede tur tutulur, tarif ev
  sahibinin hazır taslağında; tehlikesiz çözüm `kb:` kaynağı olmadan gitmez.

## 19. Son kör kabul canlı geçişten ÖNCE (ilettiğiniz inceleme — DOĞRU, rapor düzeltildi)
- **Durum:** rapor §6'da "geçişten sonra yeni kör set" yazıyordu; yanlış sıraydı. Düzeltildi (§6 adım 6): 13 / 17 / 18 kodlandıktan sonra
  son kod + seçilen bayraklar + seçilen modeller BİRLİKTE yeni kör sette (set 3) ölçülür, geçiş ancak ondan sonra. Önceki kabul bu
  kararlardan önceki davranışı ölçtü.
- **Tutar:** aday ≈ $0,35 + aynı bayraklarla 5.1 ≈ $0,95 → ≈ $1,3 (+ 17 için ≈ $1,7). Gece onayından kalan ≈ $14.

## 20. "Bu kasa misafir kullanımına açık değildir" — dayanağı VAR (bilgi için)
- **Doğrulama:** kabul setinin bilgi tabanında kalem (başlık "SADECE EV SAHİBİ VE EKİP İÇİN — misafirle paylaşılmaz"): "Yatak odası
  dolabındaki ev sahibi kasası misafir kullanımına kapalıdır; kasa kodu … Bu kodlar misafirlere hiçbir koşulda verilmez." Küçük bilgi
  tabanı (27 kalem) olduğu için kalem modele tam gidiyor; giden Türkçe cevap bu cümlenin yeniden ifadesi, kod gitmedi. 5.1'in taslağı da
  aynı ("misafir kullanımına açık değil, bu nedenle şifresini paylaşamıyorum").
- **Uydurma gerekçe tek yerde:** Luna'nın İngilizce taslağı "For security, the safe is not available for guest use." — "For security"
  bilgi tabanında yok. Misafire GİTMEDİ (kapı tuttu), ev sahibinin taslağında duruyor. Bilinen sınır: sözel gerekçe uydurmasını yakalayan
  kapı yok (iddia ölçümü yalnız saat / tarih / tutar / kod görür).

## 21. "For security" gibi KAYNAKSIZ GEREKÇE — ayrı bulgu (kurucu: veto eklemeden önce kapsam + meşru cevaplara etkisi)
- **Ölçüm (ücretsiz, kayıtlı 19 canlı hat raporu, 1.456 satır, 718 giden cevap):** gerekçe kalıbı ("for security / safety reasons",
  "güvenlik nedeniyle", "güvenliğiniz için", "aus Sicherheitsgründen", "only after a confirmed reservation"…) 24 cevapta geçiyor:
  - **misafire giden: 1** — 5.1, 30 Eylül canlı ayar koşusu: "güvenlik nedeniyle telefon numaramı platform üzerinden paylaşmıyorum" (bilgi
    tabanında böyle bir gerekçe yok; ev sahibinin numarası sorulmuştu);
  - **23'ü taslak** — zaten başka kapılar tutmuştu (sır / enjeksiyon / acil); bunların bir kısmı MEŞRU güvenlik uyarısı ("for your safety,
    turn off the electricity" — su baskını taslağı).
- **Değerlendirme:** genel bir kelime yasağı bütün kayıtlarda yalnız 1 gönderimi değiştirirdi; meşru güvenlik uyarılarını da tutardı (acil
  durumlar zaten otomatik gitmiyor). Kasa cevabındaki "misafir kullanımına kapalıdır" ise bilgi tabanına DAYANIYOR (madde 20).
- **Öneri:** şimdilik veto YOK. Seçenekler: (a) cevap istemine "bilgi tabanında olmayan gerekçe yazma" kuralı (ücretli cevap kıyası ister);
  (b) yalnız RET cümlesinde ("paylaşamıyorum / can't share … because / for … reasons") ve bilgi tabanında karşılığı olmayan gerekçe için dar
  bir kontrol — önce kayıtlarda yanlış tutma ölçümü. Sıklık düşük (1/718) → acil değil.
- **Müşteriye etkisi:** bugün nadiren uydurma bir gerekçe gidebilir; cevabın kendisi (kod / numara vermeme) doğru.
- **Beklerken yapılmayan:** veto / istem değişikliği.

## 22. Bilgi tabanının KENDİ İÇİNDEKİ çelişki kesin cevapla gidiyor (son kör kabul bulgusu — üç yapılandırmada da aynı)
- **Durum (ölçüldü, set 3):** "Havuz 09:00–19:00" ↔ "Ortak havuz 08:00–21:30" → "Pool bis 19:00 / 21:30 geöffnet" GİTTİ; "Sessiz saatler
  22:00–08:00" ↔ "23:30'dan sonra müzik yasak" → 5.1'de "22:00'ye kadar" GİTTİ; sigara "balkonda içilebilir" ↔ "balkon dahil yasak" → üç
  yapılandırmada da "Oui, vous pouvez fumer sur le balcon" GİTTİ; evcil hayvan "kabul edilmez" ↔ "250 TL ile kabul" → "not allowed" GİTTİ.
  Saat çelişkisi kapısı (P4-b, kararınız 09-09) yalnız MÜLK AYARI ↔ bilgi tabanı giriş / çıkış çelişkisini tutuyor; bilgi tabanı içi çelişki
  yalnız isteme not olarak gidiyor, karar modelde.
- **Öneri:** (a) P4-b'yi bilgi tabanı içindeki SAAT çelişkisine genişlet (havuz, sessiz saat, spor salonu, temizlik… — aynı alan, farklı saat →
  o alana değen cevap tutulur; ev sahibine "Uyuşmayan saatler" zaten listeliyor). (b) Kural çelişkisi (izinli ↔ yasak, aynı konu): kalem
  kaydedilirken ev sahibine "Çelişen kurallar" uyarısı + o konudaki cevap tutulur (anlam katmanıyla tespit — daha büyük iş, ölçüm ister).
  - *Önce:* "Havuz kaçta kapanıyor?" → "19:00" (ya da "21:30") gider. *Sonra:* hiçbir şey gitmez; ev sahibine e-posta + "Uyuşmayan saatler".
- **Müşteriye etkisi:** çelişkili bilgide misafire yanlış olabilecek kesin cevap gitmez; ev sahibi bilgi tabanını düzeltene kadar o konu ona kalır.
- **Beklerken yapılmayan:** kapı genişletmesi (canlı davranış değişikliği). Luna geçişini ENGELLEMEZ (5.1'de de aynı).

## 23. Soru sormadan arıza bildirimi → onaylı tarif (18. maddenin eksik kalan kısmı)
- **Durum (set 3):** "Die Klimaanlage bläst nur warme Luft", "The internet stopped working about an hour ago" → anlama katmanı yalnız
  şikâyet çıkarıyor, ayrı "çözüm" isteği yok → tarif GİTMİYOR (taslakta doğru tarif var: MODE / COOL, ON/OFF + 30 sn). Soruyla gelen arızada
  ("Что делать?", TV "ماذا نفعل؟") tarif gidiyor. Onayladığınız 18. madde tablosu bu durumu kapsıyordu ("Otopark kapısı açılmıyor" + tarif →
  tarif gider); uygulamam yalnız açık "nasıl düzeltirim" sorusunu kapsadı.
- **Yapılacak (onaylı kapsam):** anlama katmanı arıza bildiriminde soru olmasa da ayrı bir "çözüm" isteği ekler (cihaz / tesis türü) → mevcut
  kurallar aynen: yalnız bilgi tabanı tarifi, tehlike sınıfı hariç, şikâyet açık + tek e-posta. Kod + ölçüm (konaklama eval'i + yeni küçük kör
  set, ≈ $2) — CANLIYA ancak ayrı kör doğrulamadan sonra ve size haber vererek.
- **Müşteriye etkisi:** "İnternet yok" diyen misafir, bilgi tabanında tarif varsa beklemeden modem adımlarını alır.
- **DURUM (10-01 öğlen):** kodlandı (`641a726`); konaklama eval'i kaçak 0/125 · 0/170. Kör set 4 (36 senaryo) dört hata buldu — hepsi tarifsiz
  arızada ya da kaynak biçiminde: Luna boş cevap (2), Luna "adımlar bilgide yok" cümlesi GİTTİ (1), 5.1 şifre kalemine dayanıp uydurma adım
  GÖNDERDİ (1), doğru tarifler "kb:klima" gibi başlıklı atıf yüzünden tutuldu (5.1'de 4/4). Düzeltildi (`59f6789` + `f225b2e`, 18. maddenin
  kendi şartı "bilgi tabanında O ARIZANIN tarifi varsa" koda geçti; ayrıntı ve önce/sonra örnekleri rapor §3.7). Yeni karar YOK — onaylı
  kapsamın uygulaması. Yeni kör set 5 ile doğrulanmadan itilmez; RC54 / RC55 itilmedi.

## 24. Eskiden beri süren iki yanlış tutuş (bilgi için — set 3'te üç yapılandırmada da)
- Sauna "16:00–21:00" cevabı tutuldu: bilgi tabanında giriş saati çelişkisi var ve cevaptaki 16:00 o çelişkili saatlerden birine denk geldi
  (P4-b "cevap çelişen saati söylüyor" kuralı; saatin hangi alana ait olduğuna bakmıyor).
- Otopark "dairenize ayrılmış B2-17 numaralı yer var" tutuldu: donmuş müsaitlik kelime ağı "yer var"ı müsaitlik iddiası saydı (5.1 bugünkü
  ayarda aynı bilgiyi başka cümleyle verince gitti).
- **Öneri:** ikisi de ayrı, ölçümlü düzeltme (P4-b'de saatin alanına bakmak; müsaitlik ağında otopark yeri ifadesi). Acil değil.
