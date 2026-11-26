# Parça okuyucusu: maskesiz notlar, iki ek soru, dar olumluluk kuralı (26 Kasım akşamüstü)

Durum: KODDA, anahtarlar KAPALI (`AI_ANSWER_PARTS_ENABLED`, `AI_SENIOR_READER_ENABLED`). Yeni ortam anahtarı, şema, migration YOK.
Kurucu kararı (26 Kasım, aynen): "model koddan belirgin biçimde daha iyi. bu ne demek tabiki modeli kullanmak demek aq ama herşeyi modele
bırakmamlıyız gibide anlama katmanı önemli modeller orda gelişmiş bağlam anlam amaç anlam konusunda tekrar test S-1 MASKesiz olsun o zaman /
okuyucuya 2 soru koyabilirsin testte et".
Önceki ölçüm ve öneri: `docs/olcum/olumluluk-ve-model-gucu-2026-11-26.md` · `docs/TASARIM-2026-11-26-olumluluk-karari-modele.md`.

## 1. Ne değişti

| # | değişiklik | dosya | kural |
|---|---|---|---|
| S-1 | Parça okuyucusuna giden PARÇA ve NOTLAR değer maskesinden GEÇMEZ ("password: olive2026", telefon, uzun sayı olduğu gibi) | `ai/semantic/part-reader.ts` | Misafirin mesajı ve önceki konuşma AYNEN maskeli (kimlik + değer). Misafir adı bizim metnimizde de kimlik konumunda maskeli (selam satırı). Çit (`fenceSafe`) ve uzunluk tavanları aynen; not tavanı okuyucuya GİDEN (maskesiz) metinle ölçülür. Öteki anlam katmanları (anlama, bekçi, yokluk hakemi, yeniden sıralayıcı, söz okuyucusu) DEĞİŞMEDİ. |
| 2a | Okuyucuya soru: parça misafirin dilinde mi (`in_guest_language`) | aynı | "hayır" → parça tutulur, sebep `reader_wrong_language`. Soru yalnız parçayı misafirin bu turki mesajıyla kıyaslar; notların / konu / istek satırlarının dili sayılmaz; yalnız doğal dil, söz ve içerik değil. |
| 2b | Okuyucuya soru: notlar parçanın konusunda kendi aralarında çelişiyor mu (`notes_conflict`) | aynı | "evet" → parça tutulur, sebep `reader_notes_conflict`. Örnek cümle YOK (eski ölçüm cümlesi çöp vakasını anlatıyordu, sonuç iyimserdi); genel kural + istisna, kural + ücret, başka şeyin ayrıntısı çelişki değildir. |
| 2c | İki alan şemada zorunlu; eksik / yanlış tipte → `unread` (tutulur) | aynı | Bugünkü belirsizlikte-tut kuralı. Eski şemanın cevabı da tutulur. |
| 2d | Neden defteri okuyucu sebep envanteri (`OKUYUCU_SEBEPLERI`, ürün listesiyle pinli) + ham hükümde iki alan | `scripts/neden-defteri-core.mjs` | Sebep kodu `sebep` alanında aynen; ayrıntıda okunur ad. |
| 3 | "Var / yok" (olumluluk): okuyucu OKURKEN değersiz parçanın üç dalı (kimlik başına · bütün kalem · yan cümle başına) yalnız DAR ve KESİN durumda tutar | `ai/answer-binding.ts` (`polarityFromValueless`, `polarityReversalCertain`), `ai/answer-parts.ts` | Kesin = iki taraf da yan cümle (virgül dahil) düzeyinde tek yönlü ve yönler ters (ölçümdeki aday A2). Kesin değilse bulgu `advisory` olarak izde, karar okuyucunun `supported_by_notes` sorusunda. Okuyucu "destekliyor" dese de kod kesinse TUTULUR. Ücret kutbu (ücretsiz ↔ ücretli) ve değer başına olumluluk HER ZAMAN kodda. |

Kalıcı kural uygulandı: dil ve çelişki kararı kelime / yapı listesiyle verilmiyor (kodda dil tanıyıcı ya da çelişki sözlüğü EKLENMEDİ). A2'nin
olumsuzluk okuması bu modülün var olan okumasıdır (`negative`); yeni sözcük listesi yok.

## 2. Anahtarlar kapalıyken / okuyucu koşmuyorken neden AYNI

- **Okuyucu anahtarı kapalı** (`AI_SENIOR_READER_ENABLED` boş): `ai/index.ts` `meaningJudge: "code"` → `composeVerifiedReply` her denetimi
  tutar; yeni kural yalnız `byReader` iken devreye girer. Okuyucu çağrılmaz. Pin: `answer-parts-polarity-narrow.test.ts` "okuyucu anahtarı
  KAPALIYKEN" (okuyucu çağrısı 0, parça `polarity_mismatch` ile tutulur).
- **Parça kipi kapalı** (`AI_ANSWER_PARTS_ENABLED` boş): okuyucu ve `composeVerifiedReply` hiç çağrılmaz — değişiklik o yolda değil.
- **Okuyucu düştü / zaman aşımı / cevabında yok / alan eksik / tavan aşıldı**: ürün o parçayı `unread` ile tutar. `composeVerifiedReply`
  `unread` tutulan parçada olumluluk bulgusunu KODA geri verir → hüküm eskisiyle birebir (`polarity_mismatch`). Pinler: tablo testi (99 satır,
  kayıtlı ölçümle satır satır aynı sorun + danışma listesi) ve uçtan uca "okuyucu DÜŞERSE (500)", "eski şema" testleri.
- **Okuyucunun her parçayı okuduğu doğrulandı**: `ai/index.ts` okuyucuya `composed.verified`ın TAMAMINI gönderir; okumadığı tek yollar 8
  parça tavanı ve not tavanı — ikisi de `unread` döner, yani kodun kuralı orada aynen kalır. Yeniden yazma yolunda yeni parça okuyucuya
  yeniden gider; okuyucu düşerse aynı `unread` kuralı.

## 3. Ölçüm — önce / sonra

### 3.1 Ücretsiz tablo (`evals/olumluluk-tablosu.json`, 99 satır, model yok; `tests/eval/polarity-table-replay.ts` → `docs/olcum/olumluluk-tablosu-2026-11-26-b.json`)

| hüküm | doğru tutma | haksız tutma | kaçırma (kod geçirir) | doğru geçirme |
|---|---|---|---|---|
| bugün (= okuyucu OKUMADIĞINDA, yeni kodda) | 40 | 28 | 6 | 25 |
| aday A2 (eski ölçüm, sarmalayıcı) | 12 | 0 | 34 | 53 |
| **yeni ürün, okuyucu okurken** | **15** | **0** | **31** | **53** |

Fark A2 ↔ ürün: 3 satır (b-04, c-23, c-49) — ücret kutbu. Ölçümün sarmalayıcısı her `polarity_mismatch`i kaldırıyordu; ürün ücret kutbunu
KODDA bırakır. 27 gerçek reddin yeniden üretimi 27/27.

### 3.2 Ücretli okuyucu ölçümü (ürünün istemi, `gpt-5.1`, çaba gönderilmez, her vaka 3 koşu; `tests/eval/part-reader-strength.ts`)

Doğru karar = koşu ortalaması · yanlış geçir = beklenen "tut", okuyucu geçirdi (vaka / çağrı) · haksız = beklenen "geçir", en az bir koşuda tuttu.

| küme (vaka) | ÖNCE: ürün istemi (11-26 öğle) | ÖNCE: betikteki ek soru / maskesiz kol | SONRA: yeni ürün istemi (son hâl, `-d`) |
|---|---|---|---|
| var / yok (99) | 97,0% · yanlış geçir 0 · haksız 3 (maske) | maskesiz 6 satır 100% | **100% · yanlış geçir 0 · haksız 0** |
| çelişki (31) | 86,0% · **5 / 13** · haksız 0 | ek soru 94,6% · 2 / 5 (örnek sızıntılı) | **95,7% · 2 / 4** · haksız 0 |
| dil (22) | 27,3% · **16 / 48** | ek soru 100% · 0 | **97,0% · 0 / 0** · haksız 1 (dil-k-6, 2/3) |
| maske (12) | 50,0% · haksız 6 | maskesiz 100% | **100%** · yanlış şifreli 5 parçanın 5'i tutuldu (3/3; maskesi düşen İngilizce "password:" notlu 4'ü dahil) |
| eksik (23) | 95,7% · 1 / 3 (eks-13) | — | **98,6% · 1 / 1** (eks-13) |

Birleşik hat (var / yok; kod tutarsa tutulur, geçirirse okuyucu): **yeni ürün 100% doğru, yanlış geçir 0, haksız tutma 0** (99 × 3); ters
cevapları kod 15'ini, yalnız okuyucu 31'ini tuttu. Bugünkü kural aynı okuyucuyla 71,7% / haksız 28.

İstem iki kez düzeltildi (her biri ayrı commit, her koşu ayrı dosya — eski dosyalar duruyor):
- `-b` (ilk istem): dil sorusu notların / konu etiketinin Türkçe olduğu İngilizce ↔ İngilizce vakalarda "yanlış dil" dedi → var / yok kümesinde
  8 haksız tutma. Düzeltme: "yalnız PARÇA ile MİSAFİR MESAJINI kıyasla".
- `-c`: hâlâ 3 İngilizce ↔ İngilizce vakada "yanlış dil" (soruyla aynı sözleri kullanmayan cevap). Düzeltme: "yalnız doğal dil, söz ve içerik değil".
- `-d`: son hâl (tablo yukarıda).

Maliyet: 3 × 561 çağrı = **$2,10** (b $0,695 · c $0,694 · d $0,710; liste fiyatı, `reply-scoring.ts`). Tavan $3.

### 3.3 Kalan hatalar (son koşu, birebir)
- **cf-cop-1 / cf-cop-2** (çöp: "salı ve cuma" ↔ "her akşam kapıya bırakın"): 3 koşunun 2'sinde geçti. Bu sınıf ÇÖZÜLMEDİ. Model iki notu
  uzlaştırıyor olabilir (bina görevlisi her akşam alır, belediye salı / cuma); çelişki mi — kurucu sorusu (öğle belgesi §3 örnek 4).
- **eks-13** ("Записи о кофемашине у меня нет." — "kayıtlarımda kahve makinesi yok"): 3 koşunun 1'inde geçti. "Bilgim yok" anlatımı
  okuyucunun sorusu değil; parça kipinde bu parçanın "bilgim yok" kapısından geçip geçmediği ayrı ölçülmeli (öğle belgesi §4.5).
- **dil-k-6** (Almanca misafire Almanca parça, notlar Türkçe): 3 koşunun 2'sinde haksız "yanlış dil". Gitmesi gereken doğru cevap tutuluyor.

## 4. Kalan riskler
1. **Vakaları geliştirme tarafı yazdı** (tablonun b / c satırları ve okuyucu kümelerinin çoğu). İstem bu setle İKİ KEZ düzeltildi → bu set
   artık görülmüş settir; sonuç görülmemiş sette doğrulanmadan açılmaz.
2. **Tek bir model hükmü:** var / yok kümesindeki 46 ters cevabın 31'ini artık YALNIZ okuyucu tutuyor (10-23 B1 gerilimi; kurucu 11-26 kararıyla
   güncellendi). Okuyucu düşerse kod geri gelir; okuyucu yanılırsa ikinci kemer yok — yalnız kodun kesin olduğu 15 vakada var.
3. **Dil sorusu haksız tutma üretebilir** (dil-k-6). Etkisi: doğru cevap gitmez, istek ev sahibinde açık kalır (güvenli yön).
4. **Maskesiz notlar:** okuyucu (aynı sağlayıcı) bilgi tabanındaki şifreyi / telefonu görür. Cevabı yazan model bunları zaten görüyor; yeni
   bir alıcı yok. Misafirin kişisel verisi (mesajındaki telefon, rezervasyon numarası) eskisi gibi maskeli.
5. **Önceki konuşmadaki BİZİM satırlarımız** hâlâ değer maskeli (kapsam dışı bırakıldı: içinde misafire daha önce verilmiş kişisel veri olabilir).
   Bir önceki cevaptaki şifreye atıf yapan parçada ("aynı şifre geçerli") okuyucu önceki satırdaki değeri göremez → tutabilir (güvenli yön).
6. **Neden defteri** artık okuyucu sebebinin okunur adını yazar; ölçer ham hükmü (`readerRaw`) yazmayan eski koşularda iki yeni alan görünmez.
7. Yeniden yazma (`AI_PART_REWRITE_ENABLED`, kapalı) iki yeni sebebi YENİDEN YAZMAZ (listede yok) — "Türkçe yazılmış parçayı misafirin dilinde
   yeniden yaz" doğal bir iş ama müşteriye gideni değiştirir → ayrı soru.

## 5. Kurucuya önce / sonra örnekleri (misafire giden metin ev sahibinin ağzından)

1. *"Is there an iron I could use? And where can we park the car?"* (otopark bilgisi: "Binanın önünde ücretsiz sokak parkı var. Kapalı otopark yok.")
   - Önce: otopark parçası gitmiyor (kod doğru cevabı "ters" sanıyordu; g3 koşusundaki gerçek ret).
   - Sonra: *"You can park your car on the free street parking in front of the building; there is no covered parking garage."* gider (okuyucu 3/3 onayladı).
   - Ters cevap (*"Street parking in front of the building is not available."*): önce de sonra da GİTMİYOR — önce kod tutuyordu, şimdi okuyucu tutuyor.
2. *"Wi-Fi şifresini alabilir miyim?"* (bilgi: "Wi-Fi: Network: Lale_Terrace, password: olive2026")
   - Önce: doğru cevap (*"Wi-Fi ağımızın adı "Lale_Terrace", şifresi ise "olive2026"."*) tutuluyordu — okuyucu şifreyi maskeli görüp "notlarda yok" diyordu.
   - Sonra: doğru cevap gider; yanlış şifreli cevap (*"Wi-Fi ağımız "Lale_Terrace", şifresi olive2062."*) tutulur (yanlış şifreli 5 parçanın 5'i, üç koşuda).
3. *"Où se trouve la télécommande de la climatisation ?"*
   - Önce: *"Klima kumandası TV ünitesinin çekmecesinde bulunuyor."* (Türkçe) Fransız misafire gidebiliyordu.
   - Sonra: Türkçe parça tutulur; Fransızca yazıldığında gider: *"La télécommande de la climatisation se trouve dans le tiroir de notre meuble TV."*
4. *"Où récupère-t-on la clé ?"* (bir not "Anahtar resepsiyondan alınır", öbürü "Anahtar kapının yanındaki kutuda, kod 4821")
   - Önce: *"La clé est à récupérer à la réception."* 3 koşunun 2'sinde gidiyordu.
   - Sonra: tutulur (okuyucu 3/3 "notlar çelişiyor"); istek ev sahibinde açık kalır.

## 6. Açmadan önce gereken
1. **Başka birinin yazdığı, görülmemiş set** (var / yok + çelişki + dil + eksik; diller arası ağırlıklı, Almanca / Rusça notlu da), kol başına en az
   2 koşu, parça kipi + okuyucu UÇTAN UCA hatta (okuyucu aynı turun bütün parçalarını birlikte görürken). Bu belgenin seti istem düzeltmesinde
   kullanıldı.
2. Çöp türü çelişkinin kurucu kararı (çelişki mi, bilgi tabanı uyarısı mı).
3. "Kayıtlarımda yok" türü parçanın parça kipinde "bilgim yok" kapısından geçip geçmediği (eks-13).
4. Dil sorusunun haksız tutma oranı görülmemiş sette (dil-k-6 sınıfı: misafir ve parça aynı dilde, notlar başka dilde).
