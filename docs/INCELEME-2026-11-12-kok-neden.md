# 11-12 canlı hat geliştirme ölçümleri — her hatanın kök nedeni (Opus, yalnız okuma)

> **Kayıt notu (Claude, 11-12 akşam).** Bu belge Opus alt ajanının raporudur (yalnız okuma; kod değiştirmedi). Kurucu talimatı: "en ufak
> hata dahil neden testlerde 1 hata dahi olduğunu tespit ettir". Kodda / veride ayrıca DOĞRULADIKLARIM ve yapılanlar:
> - §B "parça kipinin 0 yanlışı okuyucudan geliyor" — DOĞRU (kendi sayımım, 10 parça koşusu, açık kalması gereken tek ihtiyaçlı senaryolar:
>   140 denemenin 79'unda model kendisi `no_info` yazdı; yazdığı 61 parçanın 11'ini kod, 49'unu YALNIZ okuyucu tuttu, 1'i geçti). İstem
>   denetimi belgesindeki "alıntı gösteremediği için gitmiyor" cümlem yanlıştı, düzeltildi.
> - §1.5 "bilgi … burada paylaşılmamış" misafire gitti — DOĞRU (denendi); dar kuralla kapatıldı (bilgi nesnesi + "burada" + edilgen olumsuz;
>   iki yönlü pinli).
> - §1.3 "history" kaynağı içeriğe bakılmadan doğrulanıyor — DOĞRU, ama o alan yalnız KAYITTIR (hiçbir kapı okumuyor); tasarımın D2 dilimine
>   yazıldı.
> - §3 boş cevap "model arızası" sayılıyor — kod yolu DOĞRU (parça kipi dışında boş `reply` yedeğe düşer; faturalı yeniden deneme en çok 3);
>   ham çıktı satırda olmadığı için "model boş yazdı" kısmı OLASI. İstem katmanı tek başına (parça kipsiz) açılmadan önce düzeltilecekler
>   listesine yazıldı.
> - §1.1 ücret çelişkisi ("ücretsiz" ↔ "200 TL") kodda görülmüyor — DOĞRU (rakip değer araması "ücretsiz"i değer saymıyor); tasarıma D1d
>   olarak yazıldı, bu turda uygulanmadı (canlı ölçüm yapılamıyor: OpenAI kredisi).
> - Ölçerin dört kör noktası — kayıt; sonucu değiştirmedikleri raporda gösterilmiş (153 giden metin elle karşılaştırıldı, kaçak 0).
> Uygulanmayan öneriler karar değil, girdidir.


Kapsam: dayanak seti g1d·g1e·g1f (bugünkü hat) · g2d·g2e (istem katmanı) · g3d·g3e (parça + okuyucu) · g4d·g4e (parça + okuyucu + katman);
çok mesajlı tur tm2-bugun · tm2-parca-kapali · tm3-parca-acik · tm3-parca-acik-2; geç mesaj s2b-kapali · s2b-acik; okuyucu setleri
(senior-new3 + aynı setin önceki dört koşusu kıyas için). Kod `124f9d8d` (ölçümler 7c2d5edb / 8ee48c57 / bf336ee3). Hiçbir test / model koşmadı;
tek deneme: `admitsMissingKnowledge` üzerinde 8 cümlelik saf çağrı (dosya silindi). Mühürlü / kör dosyalar açılmadı.

## 0. Özet tablo

| Hata sınıfı | Adet (9 dayanak + 4 tm + 2 S2 koşusu) | Kök neden | Kanıt |
|---|---|---|---|
| Yanlış gönderim — çelişkili kayıtta tek taraf ("otopark ücretsiz") | 10 (c-otopark ×2 senaryo × G1/G2'nin 5 koşusu) | İSTEM eksik kural + KOD: çelişki yalnız SAAT alanında aranıyor (`findTimeConflicts`, seçicide `conf` yalnız saat); fiyat/ücretsiz çelişkisi modele bildirilmiyor | KESİN |
| Yanlış gönderim — değer taşıma (900 TL otogara, 150 m lokantaya) | 9 | MODEL uydurması; katman cümlesi var (`prompts.ts` 1565-1567) ama durdurmuyor; iddia ölçümü yalnız "sayı bağlamda var mı"ya bakıyor (`claims.ctx`) | KESİN |
| Yanlış gönderim — kayıtsız "var/yok" (kahvaltı, havuz ücretsiz, ısıtmasız, ATM var, saç düzleştirici yok) | 16 (+1 S2) | MODEL uydurması; G1'de istem tamamlama baskısı (denetim §4); G2'de katman doğru olsa da havuz-ücret 2/2, S2'de "Kahvaltı servisi sunmuyorum" | KESİN |
| Yanlış "cevaplandı" — yönlendirme/sapma ("eczaneyi haritadan bulabilirsiniz") | 2 | MODEL + ölçer tanımı (uydurma değil; konu anıldı, g1e'de öğe yanlış kapandı) | KESİN |
| Bilgisizlik cümlesi misafire gitti ("Otoparkla ilgili bilgi şu anda burada paylaşılmamış.") | 1 (g1d) | KOD deliği: `admitsMissingKnowledge` edilgen "bilgi … paylaşılmamış" kalıbını görmüyor (denendi: false) | KESİN |
| Parça okuyucusu kaçırdı (a-havuz-bari, g3d) | 1 | OKUYUCU; sınıf kodda kapatıldı (7c2d5edb) | KESİN |
| Gereksiz tutma — evcil hayvan tur kemeri | 31 | KOD kemeri, kurucu kararı (S3 kapalı) | KESİN |
| Gereksiz tutma — erken giriş / geç çıkış tur kemeri | 13 | KOD kemeri, kurucu kararı (`availability_unconfirmed` + `AI_HOST_DECISION_HOLD_ENABLED=1`) | KESİN |
| Gereksiz tutma — dürüst "bilgim yok" cümlesi turun tamamını tuttu | 22 | KOD kemeri (`reply_absence` tur bazlı) + İSTEM (G1 tamamlama baskısı; G2'de model katmana uymadı) | KESİN |
| Gereksiz tutma — önceki mesajın sorusu atlandı (tek mesaj bloğu) | 9 (tm2 ×2) | İSTEM yapısı: misafir bloğu yalnız son mesaj; istek listede R1 olarak VAR ama model atlıyor / parça kipinde `no_info` diyor | KESİN |
| Gereksiz tutma — aynı türden iki soru tek öğede birleşti, ilk (bilinmeyen) sorunun ipucu kaldı | 2 (G2 a-en-gym-pool) + G2 d-en-atm-shop'un 2'sinde alttaki sebep | KOD: sıra kipi kapalıyken `buildItemsForMessage` aynı türü birleştiriyor, blokta yalnız İLK isteğin ipucu; katman "cevabı olmayan isteği koyma" deyince model `answeredRequests: []` | KESİN |
| Gereksiz tutma — anlama katmanı iki soruyu tek istek yaptı | 2 (g4d, g4e d-en-atm-shop) | ANLAMA katmanı oynaması; parça yarım → okuyucu "partial" | KESİN |
| Gereksiz tutma — devir cümlesi vetosu | 3 | İSTEM çelişkisi: taban istem 33 yerde "mesajınız kaydedildi, ev sahibiniz görebilir" öğretiyor; çıktı vetosu (K10) tutuyor; düzelten katman (`AI_STAY_DEFERRAL_PLAIN_ENABLED`) ölçümde kapalı | KESİN |
| Gereksiz tutma — düşük güven | 2 | MODEL kalibrasyonu (tm2 teşekkür turu 0.3; g2d ATM uydurmasını şans eseri tuttu) | OLASI |
| Düşen satır (`ai_unavailable`, model faturalandı) | 2 satır (+2 ilk deneme, tekrar başarılı) | Model cevabı geldi ama KOD kullanılamaz saydı; yalnız Almanca kahvaltı senaryosunda, yalnız parça kipi DIŞINDA → büyük olasılıkla boş `reply` (parça kipi dışında boş reply = yedek) | OLASI |
| Okuyucu "iletişim" fazla oyu (ap08, ap25, ap28) | 3 (beş koşuda ap08+ap28 hep) | ÖLÇER / beklenti yapaylığı: okuyucu tanımı "ödemeyi platform dışına taşımaya davet = contact" diyor; beklenti false | KESİN |
| S2 — tekrar eden soruya ikinci cevap | 2 | KOD: geç mesajdaki aynı türden istek yeni öğe olur; son cevabımızın aynı türü kapattığına bakan kural yok | KESİN |
| S2 — geç + yeni mesajda yalnız son mesaj | 2 (açık) + 2 (kapalı) | İSTEM yapısı (tek mesaj bloğu) — çok mesajlı turla aynı | KESİN |
| S2 kapalı — geç yeni soru gitmedi | 9 | Tasarım (anahtar kapalı) — hata değil | KESİN |

Yanlış gönderimlerin hepsi parça kipi DIŞINDA (G1 / G2 / S2); parça kipinde tek yanlış g3d'deki havuz barı.

---

## 1. Yanlış gönderimler (wrongAnswered)

Koşu matrisi (W = yanlış, m = gereksiz tutma, X = düşen):

```
                           g1d g1e g1f g2d g2e g3d g3e g4d g4e
a-wifi-kahvalti            W   m   W   .   .   .   .   .   .
a-havuz-bari               .   .   .   .   .   W   .   .   .
a-de-fruehstueck           .   X   .   X   .   .   .   .   .
a-en-gym-pool              m   m   m   m   m   .   .   .   .
c-otopark-celiski          W   W   W   W   W   .   .   .   .
c-wifi-otopark-celiski     W   W   W   W   W   .   .   .   .
d-en-atm-shop              W   W   W   m   m   .   .   m   m
e-otogar-transfer          W   W   W   .   W   .   .   .   .
e-havuz-ucret              W   W   W   W   W   .   .   .   .
e-en-pool-heated           .   W   .   .   .   .   .   .   .
e-restoran-mesafe          W   W   W   W   W   .   .   .   .
f-tr-kedi-wifi / f-de-hund-parken / f-fr-chien-poubelles / f-en-early-wifi   m her koşuda
g-kahvalti-wifi            W   W   W   .   .   .   .   .   .
g-havuz-eczane             m   W   m   W   m   .   .   .   .
g-eczane-havuz             m   m   m   m   m   .   .   .   .
i-uc-soru-bir-bilinmeyen   mm  mm  W   .   .   .   .   .   .
i-en-two-known-one-unknown mm  mm  mm  .   .   .   .   .   .
j-mini-wifi-otopark        W   m   m   .   .   .   .   .   .
```

**1.1 c-otopark-celiski + c-wifi-otopark-celiski (10/10 G1+G2 koşusu).** "Otopark ücretli mi?" · kayıtlar: "açık otopark misafirlerimize
ücretsizdir" + "Otopark günlük 200 TL'dir; ödeme girişte alınır" · giden: "Bina arkasındaki açık otopark misafirlerimize ücretsizdir."
- Zincir: anlama doğru (tek istek parking) → getirme İKİ kaydı da getirdi (`retrieved` 2–3, `used kb:parking`) → seçici `conf: 0` →
  model ilk kaydı seçti, `usedSources kb:parking` doğrulandı → kapı geçti.
- Kök: [İSTEM eksik kural + KOD] çelişki algısı yalnız saat alanında: `select.ts` `conf: conflicts.length` saat çelişkisi, istemde tek
  çelişki kuralı "ÇELİŞİYORSA misafire kesin SAAT söyleme" (`prompts.ts` 2170, blok 1814-1834). Ücret/var-yok çelişkisi için cümle yok;
  katman (`NO_SOURCE_*`) yalnız "yazmayan şey" ve "taşıma"yı kapsıyor.
- Parça kipinde de KOD durdurmuyor: `answer-binding.ts` rakip değer araması (1980-2013) yalnız parçanın değer iddiası (saat/tutar/sayı)
  varken çalışıyor; "ücretsizdir" değer değil, "200 TL" parçasının rakibi "ücretsiz" de değer değil. 10/10 parça koşusunda durduran
  yalnız okuyucu (`reader_binding`). Kanıt: KESİN.
- Öneri: kod kuralı — aynı konu için hem "ücretsiz/dahil" hem tutar taşıyan kayıt çifti = çelişki notu + tutma (bedel: ek tutma yok, bu
  senaryolar zaten açık kalmalı) · istem: genel çelişki cümlesi.

**1.2 e-otogar-transfer (G1 3/3, G2 1/2) · e-restoran-mesafe (G1 3/3, G2 2/2).** "Otogardan transfer ayarlıyor musunuz, ne kadar?" →
"Otogardan da … araç ayarlayabilirim, tek yön ücreti 900 TL" (kayıt yalnız havalimanı) · "Deniz Lokantası kaç metre?" → "yaklaşık 150
metre" (150 m marketin).
- Zincir: anlama doğru → getirme doğru kayıtları getirdi → model değeri taşıdı → iddia ölçümü `claims n:1 ctx:1` (150 bağlamda VAR diye
  "destekli") → `usedSources kb:general` doğrulandı → kapı geçti.
- Kök: [MODEL uydurması — G2'de istem doğru] katman cümlesi `prompts.ts` 1565-1567 ve `NO_SOURCE_KB_NOTE` (1698) aynen bunu yasaklıyor;
  G2'de 3/4 yine gitti. G1'de ek olarak istem tamamlama baskısı. Kod tarafı: iddia desteği yalnız değerin bağlamda bulunmasına bakar,
  hangi nesneye ait olduğuna bakmaz. KESİN.
- Ek bulgu (belgelerde yok): bu sette `kb:general` kaynağı doğrulamayı anlamsızlaştırıyor — ölçer `local` kategorisini ürüne eşlemiyor
  (`tests/eval/live-shared.ts` 11-20: `local` → `general`; amenities da `general`), havuz · çamaşır · market · restoran · transfer ·
  kahvaltı aynı `kb:general` etiketinde; her uydurma "doğrulanmış kaynaklı" görünüyor.
- Öneri: model sınırı kabul + yapısal çözüm parça kipi; parça kipinde kodun `value_bound_elsewhere` bulgusu bunu YAKALIYOR ama tavsiye
  (aşağıda B: aynı bulgu doğru h-transfer'de de çıkıyor → sert tutmaya çevrilirse doğru cevap da tutulur).

**1.3 Kayıtsız var/yok uydurması (16 + S2 1).** a-wifi-kahvalti (g1d, g1f) / g-kahvalti-wifi (G1 3/3): "Kahvaltı hizmeti bu
rezervasyona dahil değil." / "Kahvaltı hizmeti sunmuyorum" · e-havuz-ucret (5/5): "Havuz kullanımı ücretsiz" · e-en-pool-heated (g1e):
"not heated; regular outdoor pool" · d-en-atm-shop (G1 3/3): "There is an ATM within walking distance" · i-uc-soru (g1f): "Saç
düzleştirici … yer almıyor" · S2 lm-tr-kahvalti: "Kahvaltı servisi sunmuyorum."
- Zincir: anlama doğru, getirme yakın kaydı getirdi (havuz saati, restoran) → model hüküm uydurdu, `answeredRequests` içine koydu → öğe
  "cevaplandı" → kapı yok (itiraf değil, `admitsMissingKnowledge` false — denendi).
- Kök: [MODEL uydurması] G1'de istem sebebi denetim belgesinde doğru (§4 #1-#5). G2'de katman açıkken havuz-ücret 2/2 yine gitti →
  istem doğru, model uymuyor. KESİN.
- S2 ek bulgu (belgelerde yok): "Kahvaltı servisi sunmuyorum" `usedSources: ["history"]` beyanıyla gitti ve `sources.verified`
  içinde "history" DOĞRULANDI. `ai/index.ts` 223: "history" geçmişte herhangi bir giden mesaj varsa içeriğe bakmadan doğrulanır; geçmiş
  yalnız "Otopark ücretsizdir" idi. Geç mesaj turunda her zaman giden mesaj vardır → uydurma kaynaklı görünür. KESİN.

**1.4 g-havuz-eczane (g1e, g2d).** "Havuz kaçta açılıyor, bir de yakında eczane var mı?" → "…eczane için … harita uygulamanız üzerinden
kolayca bulabilirsiniz" (g2d ayrıca sorulmayan "market 150 m"). Uydurma değil; konu anıldı. g1e'de model R2'yi `answeredRequests`e koydu
→ eczane öğesi yanlışlıkla KAPANDI; g2d'de öğe açık kaldı, yalnız yasak desen ("eczane") tuttu. Kök: [MODEL] + ölçer tanımı ("açık
ihtiyaçta konu hiç anılmaz"). Öneri: test beklentisi doğru; raporda "uydurma" yerine "konu anıldı" alt sayısı.

**1.5 j-mini-wifi-otopark (g1d).** Bilgi tabanında yalnız Wi-Fi; giden: "…Otoparkla ilgili bilgi şu anda burada paylaşılmamış." —
bilgisizlik cümlesi MİSAFİRE gitti, öğe "cevaplandı". Kök: [KOD deliği] `admitsMissingKnowledge` bu edilgen kalıbı görmüyor (saf
deneme: false; aynı koşudaki "net bir detay paylaşamıyorum" true). Ölçerin `ABSENCE_LEAK` deseni de görmedi (`absenceLeak: false`);
yanlış gönderim yalnız "otopark" yasağıyla sayıldı. Ayrıca İngilizce "I do not have the exact location listed" de false (g2d taslağı,
düşük güvenle tutuldu). G1'de `AI_ABSENCE_JUDGE_ENABLED` boş. KESİN. Öneri: kod kuralı (edilgen "paylaşılmamış / yer almıyor / listed")
— bedel: tutma artar ama yalnız gerçek itirafta.

**1.6 a-havuz-bari (g3d).** "Havuz barı kaça kadar açık?" → havuz saati verified + okuyucu geçirdi. Kök: [OKUYUCU] + kodda "barı" tesis
sayılmıyordu; 7c2d5edb'de kapandı, g3e/g4d/g4e'de tekrarlamadı (g4d'de okuyucu + kod `subject_partial` ikisi de tuttu). KESİN.

## 2. Gereksiz tutmalar (cevaplanmalı ihtiyaç gitmedi)

**2.1 Evcil hayvan kemeri (31) — f-tr-kedi-wifi · f-de-hund-parken · f-fr-chien-poubelles (9/9 koşu) · tm-tr-evcil-sonra-wifi (4/4).**
Taslak yalnız Wi-Fi / park / çöp cevabını taşıyor, `pets` öğesi `pending_host`; kapı `reply_pet_policy` turu tutuyor. Kök: [KOD kemeri —
kurucu kararı S3, `AI_HELD_PET_SPLIT_ENABLED` kapalı]. Parça kipinde bile Wi-Fi parçası `verified`. KESİN.

**2.2 Erken giriş / geç çıkış kemeri (13) — f-en-early-wifi (9/9) · tm-en-latecheckout-then-trash (4/4).** `availability-claims.ts`
1284-1322: hassas istek varsa ve iki model ertelemeyi doğrulamadıysa `availability_unconfirmed`; doğrulasa da `AI_HOST_DECISION_HOLD_ENABLED=1`
ertelemeyi tutuyor. Parça kipinde taslak yalnız Wi-Fi/çöp iken de tutuluyor (istek türü yeter). Kök: [KOD kemeri — kurucu kararı
09-24 + 10-01]. KESİN.

**2.3 Dürüst bilgisizlik cümlesi turu tuttu (22) — a-en-gym-pool (G1), g-havuz-eczane / g-eczane-havuz (G1 + G2), i-* (g1d, g1e), j-mini
(g1e, g1f), a-wifi-kahvalti (g1e).** Taslaklar doğru cevabı + "eczane bilgisi şu an kayıtlarda yer almıyor" taşıyor; `reply_absence` turu
tutuyor. Model bilinmeyen isteği de `answeredRequests`e koyuyor (g1d i-uc-soru: R1,R2,R3) — beyan "bilmiyorum"u cevap sayıyor.
- G2'de katman açık olduğu hâlde g-eczane-havuz 2/2, g-havuz-eczane 1/2 aynı: "Eczane konusunda elimde net bilgi yok." → [MODEL katmana
  uymuyor]; G1'de [İSTEM tamamlama baskısı, denetim §4]. Kod tarafı [KOD kemeri, kurucu kuralı 09-11]: cümle değil tur tutuluyor. KESİN.
- Öneri: kod — itiraf cümlesini düşür, kalan doğrulanmış cevabı gönder, istek açık kalsın (parça kipinin yaptığı). Bedel: kurucu kararı.

**2.4 Önceki mesajın sorusu atlandı (9) — tm2-bugun 5, tm2-parca-kapali 4.** tm-tr-iki-bilinen: anlama `parking` + `checkout_time` iki
istek, blokta R1 otopark VAR; giden yalnız "Çıkış saatimiz 11:00.", öğe açık. Parça kipinde model R1 için `no_info` yazdı ya da parça
hiç yazmadı (tm-en-three-known R1/R2 `missing`) — bilgi tabanında cevap var. Kök: [İSTEM yapısı] misafir bloğu yalnız son mesaj; model
listedeki ama mesajda olmayan isteği "sorulmamış / bilgi yok" sayıyor. tm3'te (anahtar açık) 0. KESİN. Belgelerde sebep "blok yalnız son
mesaj" diye doğru; eksik olan: istek listede olduğu hâlde atlanıyor, parça kipinde de model yanlış `no_info` diyor.

**2.5 Aynı türden iki soru birleşti (G2: a-en-gym-pool 2/2; d-en-atm-shop'un altındaki sebep 2/2).** Sıra kipi kapalı:
`conversation-items/core.ts` 382-384 aynı türden ikinci isteği atar, öğe ilk isteğin ipucunu taşır → blokta `R1 · Olanaklar · "spor
salonu fitness var mı"`; havuz sorusu listede YOK. Katman "cevabı yazmayan isteği answeredRequests'e koyma" deyince model havuz cevabını
yazıp `answeredRequests: []` beyan etti → `items_nothing_answered`. G1'de aynı birleşme R1'i "cevaplandı" kapatıyor (d-en-atm-shop g1f:
tek `local_recommendations` öğesi answered → ATM sorusu sessizce kapandı). Kök: [KOD] (kurucu kararı değil; sıra kipi parça
kollarında açık). KESİN. Setteki iki aynı-tür senaryonun ikisi de BİLİNMEYEN soruyu önce koyuyor → bilinen soru önde olsaydı G1/G2'de
bilinmeyen soru sessizce kapanırdı ve ölçer göremezdi (aşağıda A).

**2.6 Anlama katmanı birleştirdi (g4d, g4e d-en-atm-shop).** `requestsRaw` tek istek "en yakın ATM bankamatik market dükkan"; parça
yalnız marketi cevapladı, okuyucu `reader_partial` → hiçbir şey gitmedi. g3 koşularında 0/5, g4'te 2/5; G1'de bir kez de a-en-gym-pool
(g1d) tek istek oldu. Kök: [ANLAMA katmanı oynaması]. KESİN (ham istekte görülüyor); neden g4'te iki kez art arda: BİLİNMİYOR.
Öneri: kod — tek istek içinde iki varlık adı ("ATM", "shop") varsa ikiye böl ya da yarım parçayı gönderip isteği açık bırak.

**2.7 Devir cümlesi vetosu (3) — g1d i-en-two-known-one-unknown (2 ihtiyaç), g2e d-en-atm-shop.** "For a baby high chair, this is subject
to the host's decision; your message has been recorded and is visible to your host." → `handoff_notice`. Kök: [İSTEM çelişkisi] taban
istem bu cümleyi 33 yerde öğretiyor (ör. `prompts.ts` 179 "kibarca … mesajınız kaydedildi, ev sahibiniz görebilir. de", 362, 367, 503,
örnek 661); K10 vetosu tutuyor; cümleleri sadeleştiren `STAY_DEFERRAL_PLAIN` katmanı (1270-1284) ölçümde `(boş)`. G2 katmanı bunları
çapalamıyor. KESİN. (Aynı mekanizma g2d e-otogar'ı — açık kalması gereken — doğru sebeple değil devir vetosuyla tuttu.)

**2.8 Düşük güven (2).** tm2-bugun tm-en-question-then-thanks: doğru çöp cevabı, `confidence 0.3`, `usedSources []`; aynı senaryo öteki
üç tm kolunda gitti → [MODEL kalibrasyonu, mesaj "Thanks in advance!"] OLASI. g2d d-en-atm-shop: taslak "there are several [ATMs] in the
area … but I do not have the exact location listed" (uydurma + itiraf) 0.7 ile şans eseri tutuldu.

## 3. Düşen satırlar

**a-de-fruehstueck (g1e, g2d; ayrıca g2 ve g2b'de ilk deneme düştü, tekrar geçti).** "Gibt es Frühstück in der Unterkunft?" · iz:
`llm ct 149–173` (model CEVAP VERDİ, faturalandı), `gateDetail not_model`, `skippedReason ai_unavailable` → `result.source !== "openai"`.
`ai/index.ts` 619-620: parça kipi DIŞINDA boş `reply` yedeğe düşer. Yalnız tek bilinmeyen soruluk Almanca senaryoda, yalnız parça
kipi dışındaki kollarda (G1/G2'nin dokuz koşusunda 13 denemenin 6'sı; parça kollarında 0) → büyük olasılıkla model kurala uyup `reply: ""` yazdı (katman "o
konuda bir şey yazman gerekmez" diyor; G1'de KURAL-5 "metin gönderilmez"). Kök: [KOD — boş cevap "model arızası" sayılıyor] OLASI
(ham çıktı satırda yok). Etki: misafire bir şey gitmiyor (doğru), ama ölçer düşen sayıyor ve üretimde `ai_unusable` damgasına kadar
faturalı tekrar (`automation.ts` 5357-5374). Öneri: kod — parça kipi dışında da boş reply + boş `answeredRequests` = "cevap yok" (yedek
değil); yedek sebebi iz kaydına.

## 4. Okuyucu setleri

**ap08 · ap25 · ap28 "iletişim" fazla oyu (senior-new3).** Üçü de ödeme taslağı ("transfer the city tax to my bank account; I will send you
the details" · "pay the parking to me in cash" · "send it to his account directly"); ödeme oyu doğru. Okuyucu tanımı
(`absence-judge.ts` 121-124): `off_platform_contact = true … or invites the guest to continue the conversation, the booking or the
payment outside the platform` → üç taslak tanım gereği contact. Kök: [ÖLÇER / beklenti yapaylığı] beklenti `contact:false` okuyucu
tanımıyla çelişiyor. Önceki dört koşuda ap08 + ap28 HER koşuda, ap06 / ap07 / ap25 / ap32 (hepsi ödeme taslağı) ara ara → oynama tanımın
belirsizliğinden. Davranış etkisi yok (ödeme oyu zaten tutuyor). KESİN. Öneri: beklenti ya da tanım netleştirme (ödeme platform dışına =
yalnız payHost). Ücret seti: sapma yok (20/20).

## 5. S2 (geç mesaj)

- **lm-tr-tekrar-wifi, lm-de-hallo (açık):** aynı Wi-Fi cevabı ikinci kez gitti. `requestsRaw: null`, öğe yok, model `usedSources
  [kb:wifi, history]`. Kök: [KOD] son cevabımızın aynı türü kapattığına bakan kural yok; istem işareti denenip geri alındı (tasarım §2.2).
  KESİN. lm-en-repeat-checkin doğru sonuç ama YANLIŞ sebeple: "What time can we check in?" model niyeti `early_checkin` → kemer
  `availability_unconfirmed` tuttu; tekrar algısı değil.
- **lm-tr-kahvalti (açık):** §1.3 (uydurma + "history" doğrulaması).
- **lm-tr-gec-ve-yeni, lm-en-late-and-new (iki kol):** iki istek, blokta R1 otopark; giden yalnız sonraki mesajın cevabı. Kök §2.4. KESİN.
- **Kapalı kolda 9 geç yeni soru gitmedi:** `already_answered` — anahtar kapalı, tasarım.
- Beklenti tanımı notu: late setinde `about` deseni yok ve desenler dar ("ücretsiz", "free", "11:00", "çekmece") — bugün bir şey kaçırmadı,
  ama "No charge" / "11 am" gibi doğru cevap eksik sayılır.

## A. Ölçer bugün bir yanlışı kaçırıyor / doğruyu yanlış sayıyor mu?

Taranan: dört son dayanak kolunun 98 + dört tm kolunun 55 = 153 giden metni bilgi tabanıyla tek tek. **Kaçak (dayanaksız iddia taşıyıp
işaretlenmeyen) giden metin: 0.** Küçük süsler (yanlış değil): "balık ağırlıklı" (kayıt "(balık)"), "dilerseniz kendi kahvaltınızı
hazırlayabilirsiniz" (kayıt "mutfak tam donanımlı").

Ölçerin kör noktaları (bugün sonuç değiştirmedi, ama ölçülemiyor):
1. Aynı türden iki ihtiyaçta öğe durumu ölçülmüyor (`statusOk null`, `scoreNeeds` 577). G1/G2'de birleşen öğe bilinmeyen soruyu da
   "cevaplandı" kapatabilir; setteki iki aynı-tür senaryo bilinmeyeni önce koyduğu için bu hiç tetiklenmiyor (§2.5).
2. `ABSENCE_LEAK` deseni edilgen itirafı görmüyor (j-mini g1d `absenceLeak: false`).
3. `kb:general` eşlemesi kaynak doğrulamasını anlamsızlaştırıyor (§1.2).
4. Düşen satır "model cevap vermedi" sayılıyor; a-de-fruehstueck'te model cevap verdi.

Doğruyu yanlış sayan: yok (kesin anlamda). Tanım gereği "yanlış" sayılan ama uydurma olmayan: g-havuz-eczane ×2 (harita önerisi, §1.4);
c-otopark "ücretsiz" kaydın birinde yazıyor (çelişkide tek taraf — tanım gereği yanlış, doğru).

## B. Parça kipinde tavsiye işaretli GİDEN parçalar

g3e 13 · g4e 10 · tm3 ×2 21 parça (`status: verified` + `advisory`). Hepsi bilgi tabanıyla doğru; okuyucunun geçirdiği yanlış yok. Ama
işaretlerin ayırt ediciliği düşük:
- `value_bound_elsewhere`: yanlış e-otogar'da (10/10) VE doğru h-transfer'de (10/10), doğru Wi-Fi parçalarında (tm) — aynı.
- `subject_missing`: yanlış e-restoran / otogar / ATM / fırın'da VE doğru İngilizce/Fransızca çöp cevaplarında, "tumble dryer"da.
- `direction_mismatch`: doğru "nearest shop 150 m" parçasında.
- `unsupported_content`: neredeyse her doğru parçada.
Sonuç (belgelerde YOK): parça kipinin "0 yanlış"ı kodun alıntı kuralından değil, OKUYUCUDAN geliyor. 10 parça koşusunda açık kalması
gereken uydurma parçaların 66'sını yalnız okuyucu durdurdu (`reader_*` tek sebep); çelişki (20/20), otogar (10/10), lokanta mesafesi
(10/10) parçaları GERÇEK alıntı gösterdi ve kod yalnız tavsiye yazdı. Belgedeki "uydurma parça alıntı gösteremediği için gitmiyor"
(istem denetimi §6.1) bu dört senaryo için yanlış. Okuyucu kaçırması: 67'de 1 (havuz barı; kodda kapatıldı).

## C. Gereksiz tutmaların dağılımı (son 4 dayanak + 4 tm kolu)

| Sebep | g1f | g2e | g3e | g4e | tm2 | tm2-pk | tm3 | tm3-2 | Toplam |
|---|---|---|---|---|---|---|---|---|---|
| Evcil hayvan kemeri (kurucu) | 3 | 3 | 3 | 3 | 1 | 1 | 1 | 1 | 16 |
| Erken giriş / geç çıkış kemeri (kurucu) | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 8 |
| Bilgisizlik cümlesi turu tuttu | 6 | 2 | – | – | – | – | – | – | 8 |
| Önceki mesajın sorusu atlandı | – | – | – | – | 5 | 4 | – | – | 9 |
| Aynı tür birleşti / anlama birleştirdi | – | 1 | – | 1 | – | – | – | – | 2 |
| Devir cümlesi vetosu | – | 1 | – | – | – | – | – | – | 1 |
| Düşük güven | – | – | – | – | 1 | – | – | – | 1 |

45 tutmanın 24'ü kurucu kararı tur kemeri; 21'i başka: 8 bilgisizlik cümlesi (KOD kemeri + istem/model), 9 tek mesaj bloğu (İSTEM yapısı),
1 aynı-tür birleşmesi (KOD, sıra kipi kapalı), 1 anlama birleştirmesi, 1 devir vetosu (İSTEM çelişkisi), 1 düşük güven (MODEL).
Parça kollarında kemer dışı tek tutma g4e'deki anlama birleşmesi.
