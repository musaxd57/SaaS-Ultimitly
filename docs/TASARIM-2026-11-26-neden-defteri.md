# Neden defteri (26 Kasım 2026)

Kurucunun isteği (AYNEN): "test niye burda hata oluyor onları öğren en ufak gitmeme nedeni hatanın sebeplerini tut bir dosyada biriksin datalar"

## 1. Amaç

Her canlı hat ölçüm koşusundan, misafire cevabın **neden gitmediğini** ya da **neden yanlış gittiğini** ihtiyaç ihtiyaç kalıcı bir dosyada
biriktirmek. Bugüne kadar sebep yalnız elle yazılan neden analizlerinde vardı (ör. `docs/INCELEME-2026-11-26-kor-set-neden-analizi.md`);
ayrıntı dosyaları depoya girmiyor ve ölçüm veritabanı sonraki koşuda siliniyordu. Defter, koşular arasında "hangi sebep kaç kez, hangi
kolda" sorusunu sayıyla cevaplar.

- Defter: `docs/olcum/neden-defteri.jsonl` — satır başına bir JSON, yalnız EKLENİR (var olan satır değişmez), ekleme sırası korunur.
- Özet: `docs/olcum/neden-defteri-ozet.md` — her `ozet` çalıştırmasında defterin tamamından YENİDEN üretilir (elle düzenlenmez).
- Araç: `scripts/neden-defteri.mjs` (komut satırı) + `scripts/neden-defteri-core.mjs` (saf çekirdek, `tests/unit/neden-defteri.test.ts`).
  Node, bağımlılıksız; ağ / model / veritabanı yok.

## 2. Nasıl çalıştırılır

```
node scripts/neden-defteri.mjs ekle docs/olcum/<koşu>-ayrinti.json [başka dosyalar …]
node scripts/neden-defteri.mjs ozet
```

- Girdi: canlı hat ölçerinin (`tests/eval/live-pipeline.eval.test.ts`) ayrıntı dosyası (`…-ayrinti.json`, mühürlü / yanmış koşu: senaryo +
  tam satır) ya da mühürsüz koşunun yan dosyası (`….json`, tam satırlar; senaryo deseni YOK — bkz. §6). Mühürlü koşunun TOPLU yan
  dosyası (satırda yalnız kimlik) reddedilir.
- Koşu etiketi dosya adından okunur (`live-pipeline-<tarih>-<model>-<etiket>`); dosya yeniden adlandırıldıysa `--etiket` ile verilir.
- Aynı koşu + senaryo + ihtiyaç ikinci kez eklenmez (kararlı anahtar `koşu|senaryo|ihtiyaç sırası|ihtiyaç türü`).
- Ölçer koşu sonunda bu komutu raporuna ÖNERİ olarak yazar ("Neden defteri (öneri, ölçer kendisi yazmaz)"); deftere kendisi yazmaz —
  mühürlü koşuda ne yazılacağı kurucu kararıdır.

## 3. Satır alanları

Üç satır türü (`birim`):

| birim | ne zaman | alanlar |
|---|---|---|
| `kosu` | koşu başına bir kez | tarih · kosu · commit · model · durum · setTuru · bayraklar (açık olanlar; "1" ise yalnız ad) |
| `ihtiyac` | senaryonun insan yazdığı her ihtiyacı | aşağıda |
| `senaryo` | ihtiyaç tanımı olmayan senaryo (autoSend beklentisi) | ihtiyaç alanları yerine `beklenen` gitmeli / gitmemeli / farketmez; ihtiyaç toplamlarına GİRMEZ |

İhtiyaç satırı: `tarih · kosu · commit · model · setTuru · senaryo · sinif · dil · ihtiyacSira · ihtiyacTuru · istek {ref, tur, parca} ·
beklenen (cevaplanmali / acik_kalmali) · sonuc · katman · sebep · ayrinti · kanit · olcerSuphesi[]`.

- **Set türü** etiketle yazılır (`dayanak-kabul`, `gec-mesaj-kabul`, `evcil-hayvan-kabul`, `ihtiyac-kabul`, `ihtiyac-kor`; mühürsüz koşuda
  `gelistirme`). Setin DOSYA ADI defterde ve özette geçmez (erişim pini `tests/unit/sealed-eval-access.test.ts`).
- **Sonuç** ölçerin KENDİ işaretlerinden okunur (yeniden puanlama yok), `need-scoring.ts` `needMetrics` ile birebir aynı sayım:

| sonuç | ölçer işareti | rapordaki satır |
|---|---|---|
| `dogru_gitti` | answered · textOk · !wrong | doğru değerle giden |
| `gereksiz_tutuldu` | answered · !textOk · !wrong · metin gitmedi | gereksiz tutma |
| `metin_gitti_deger_yok` | answered · sentMissing | gereksiz tutma ↳ metin gitti, değer yok |
| `yanlis_gitti` | answered · wrong | yanlış gönderim |
| `dogru_acik_kaldi` | open · textOk · !wrong | açık kaldı |
| `acik_kalmaliyken_cevaplandi` | open · wrong | yanlış gönderim |
| `olculmedi` | satır düştü (`ok: false`) | toplamlara girmez |

- **Kanıt**: misafir mesajından ve giden metinden (gitmediyse doğrulanan / reddedilen parçanın metni, yoksa taslak) kısa alıntı, ≤ 200
  karakter. Veri sentetiktir (fikstür adları kurgusal).

## 4. Katman ve sebep kodu envanteri (kaynakları)

Bir ihtiyaca TEK sebep yazılır: değere en yakın katmanın kararı. Sıra:

1. Tur hiç açılmadıysa / insana devredildiyse → turun sebebi (`tur_kapisi`, `anlama`, `kelime_agi`).
2. Parça kipinde (`AI_ANSWER_PARTS_ENABLED`) ihtiyacın parçasının hükmü: reddedildiyse parçanın kodu; parça doğrulanıp tur tutulduysa
   turu tutan kapı. Parça reddedildi VE tur da tutulduysa ayrıntıya "tur da tutuldu: …" eklenir (parça düzelse de gitmezdi).
3. Parça kipi kapalıysa turu tutan kapı; tur gittiyse ve ihtiyaç metinde yoksa `ihtiyac_atlandi` / `oge_ev_sahibinde`.
4. Yanlış gönderimde ölçerin hangi dalı "yanlış" saydığı (kaynak katman `cevap_modeli`; ayrıntıda hangi denetimin geçirdiği).

| katman | sebep kodları | kaynak (ürün) | ayrıntı dosyasındaki alan |
|---|---|---|---|
| `tur_kapisi` | `already_answered` · `closing_ack(_open)` · `escalated_to_human` · `gec_tur_acildi_gonderildi` | `automation.ts` `skippedReason` | `result.skippedReason`, `result.late` |
| `anlama` | `understanding_risk:<tür>` · `istek_eslesmedi` | `semantic/intent-risk.ts` | `trace.evidence.ir`, `requestsRaw` |
| `kelime_agi` | `lexical:<etiket>` · `lexical_*` | `gate-evidence.ts` `LEXICAL_ALERTS` | `trace.evidence.g.lx`, `gateDetail` |
| `cevap_modeli` | `model_intent` · `model_risk_label` · `model_risk_level` · `low_confidence` · `confidence_invalid` · `not_model` · `parca_no_info` · `parca_eksik` · `parca_hukmu_yok` · `ihtiyac_atlandi` | `gate-evidence.ts` `GATE_BLOCK_DETAILS`; `answer-parts.ts` (`no_info`, `missing`) | `gateDetail`, `model`, `parts[].status` |
| `parca_dogrulama` | `polarity_mismatch` · `value_not_in_evidence` · `evidence_*` · `source_not_found` · `text_missing` · `too_long` · `aspect_missing` · `subject_partial` … | `answer-binding.ts` `BINDING_ISSUES`, `answer-parts.ts` | `parts[].issues` (+ `advisory`) |
| `okuyucu` | `reader_binding` · `reader_not_answered` · `reader_partial` · `reader_unsupported` · `reader_unsure` · `reader_unread` · `reader_exception_only` | `semantic/part-reader.ts` `PART_READER_HOLDS` | `parts[].issues`; 11-26'dan sonra `readerRaw` |
| `oge_kapisi` | `items_*` · `oge_ev_sahibinde` · `items_held` | `gate-evidence.ts`, `conversation-items/plan.ts` | `gateDetail`, `itemStates`, `riskReason` |
| `cikti_kapisi` | `reply_absence` · `reply_output_veto` · `reply_pet_policy` · `reply_host_voice` · `reply_internal_source` · `handoff_notice` · … | `gate-evidence.ts`, `output-veto.ts`, `risk-events.ts` | `gateDetail`, `riskReason` |
| `konaklama_bekcisi` | `availability_unconfirmed` · `price_claim` · `kb_time_conflict` | `availability-claims.ts`, `grounding.ts` | `riskReason`, `trace.evidence.sc` |
| `dil` | `reply_language_mismatch` | `language-signal.ts` | `riskReason` |
| `olcer` | `dogrulanan_parca_deger_eslesmedi` · satır düştü | ölçer | `parts`, `needs` |

Yanlış gönderim dalları (`need-scoring.ts` `scoreNeeds` ile aynı; test iki tarafı kıyaslar): `yasak_desen_gitti` · `oge_yanlis_kapandi`
(metin konuya değinmedi ama öğe "cevaplandı" kapandı) · `eksik_deger_kapandi` · `kismi_deger` · `konu_var_deger_yok` · `desen_yok`.

**İhtiyaç ↔ istek ↔ parça eşlemesi.** İhtiyaç türü insanın, istek türü anlama katmanının sözcüğüdür; önce aynı tür sırayla, sonra kalan TEK
ihtiyaç ↔ kalan TEK istek (`eslesme_tahmini`). Parça kimliği (R1, R2 …) ürünün `composeItemsPlan`ında yalnız cevaplanabilir öğelere verilir;
ayrıntı dosyası bunu yazmadığı için: parça sayısı = istek sayısıysa sırayla, değilse türünün tek öğesi `pending_host` olan istek numara almaz;
yine tutmazsa satır `parca_kimligi_belirsiz` taşır (26 Kasım koşularında 0).

## 5. Ölçer şüphesi işaretleri (sonucu değiştirmez)

| işaret | anlam |
|---|---|
| `atlandi_mi_yanlis_mi_ayirt_edilemez` | metin gitti, değer yok: ihtiyaç atlandı mı, ölçerin göremediği yanlış değer mi gitti — satır elle incelenir |
| `dil_olcusu_uyusmuyor` | giden metin ölçerin dil ölçüsünde misafirin dilinde değil (yanlış gönderim "doğru" ya da "tutma" sayılmış olabilir) |
| `bilgi_yok_anlatimi_olasi` | giden metinde "bilgi yok / listede yok" anlatımına benzeyen ifade; ölçerin `absenceLeak` sayacı saymadı |
| `metin_sessiz_is_kapandi` | yanlışlık metinde değil, öğenin yanlış kapanmasında (ev sahibi açık soruyu görmez) |
| `eslesme_tahmini` · `eslesme_tur_adina_dayali` · `parca_kimligi_belirsiz` | ihtiyacın parçaya eşlenmesi tahmine dayalı |
| `olcer_deseni_eslesmedi` | parça doğrulanıp gitti ama ölçerin değer deseni giden metinde yok |
| `yanlis_dali_okunamadi` | yanlış sayıldı ama dal yeniden üretilemedi |

26 Kasım koşularında `dil_olcusu_uyusmuyor` 5 satırda: dördü İspanyolca soruya giden TÜRKÇE cevap ve ölçer bunları "doğru gitti" saydı
(geç mesaj seti, plaj mesafesi) — ölçerin dil ölçüsü yanlış gönderime eklenmiyor (bkz. kör set analizi §7.2).

## 6. "Bilinmiyor" kalanlar ve ölçere eklenmesi gereken alanlar

26 Kasım'ın sekiz koşusunda kusurlu (tutma / yanlış) 193 satırın sebebi "bilinmiyor" 0. Ama sebep kodu bazı satırlarda yalnız "hangi
katman" der, "neden"i söylemez; ayrıntı dosyasında olmayan bilgiler:

1. **Okuyucunun hangi soruya "hayır" dediği** (`reader_binding` 26 satır — kör set analizinde Wi-Fi redaksiyonu şüphesi): üretim kararı yalnız
   tutma kodunu taşır. → EKLENDİ (bu iş): ölçer okuyucunun ham hükmünü `readerRaw` alanına yazar (`partReaderVerdictsOf`, yalnız yanıt
   okunur), defter ayrıntıya `cevaplıyor=… · notlarla_destekli=… · bag_dogru=… · alıntı` yazar. 26 Kasım dosyalarında bu alan yok.
2. **Parçanın bir kez yeniden yazılıp yazılmadığı** (`part-rewrite.ts`, `rewritten`): ölçer parça hükmünü kopyalarken bu alanı atlıyordu.
   → EKLENDİ: `parts[].rewritten`.
3. **Getirme (retrieval) katmanı**: doğru bilgi tabanı kalemi getirildi mi? İz `evidence.retrieved[].id` veritabanı kimliğini taşır; ayrıntı
   dosyasındaki `kbSets` kalemlerinin kimliği yok → "getirme kaçırdı" sebebi hiçbir satıra yazılamıyor (`getirme` katmanı bugün boş).
   ÖNERİ (yapılmadı): ölçer satıra getirilen kalemlerin başlığını (ya da `kbSets` içindeki sırasını) yazsın — ölçüm veritabanından bir okuma,
   ürün yolu değil.
4. **Parça kimliği ↔ istek eşlemesi**: ürünün cevaplanabilir öğe listesi (ref → tür) yazılmıyor; §4'teki çıkarım kullanılıyor. ÖNERİ: ölçer
   `answerParts` hükmüyle birlikte planın `ref → kind` listesini yazsın.
5. **Ürünün dil kararı**: yalnız tutma kodu (`reply_language_mismatch`) var; geçirilen kısa metinde misafir / cevap dili okunamıyor. ÖNERİ:
   kanıt izine dil sinyali (misafir dili · cevap dili · emin mi) — ürün kodu değişikliği olduğu için kurucu sorusu.
6. **Birden çok kapı**: iz yalnız İLK tutan kapıyı yazar (`g.d`); arkadaki kapılar görünmez. Sınır olarak kalır.

## 7. Sınırlar

- Sonuç ölçerin desen cetvelidir; ölçerin kör noktaları (kısa yabancı dilli gövde, geniş "bilgi yok" anlatımı) defterde de kör kalır —
  yalnız şüphe işareti olarak görünür.
- Tek satır tek sebep: turu tutan ikinci kapı yalnız ayrıntıda.
- Mühürsüz yan dosyada senaryo deseni yok: yanlış dalı `desen_yok`, sınıf / dil satırın kendisinden.
- Koşu etiketi dosya adından gelir; aynı koşu farklı adla iki kez eklenirse iki koşu sayılır (`--etiket` ile önlenir).
- Defterin büyüklüğü: 26 Kasım'ın sekiz koşusu 769 satır, ~550 KB.

## 8. 26 Kasım'ın sekiz koşusu — doğrulama

Defterden hesaplanan dört sayı ölçer raporlarıyla birebir (özet dosyasının ilk tablosu):

| koşu | doğru | tutma | yanlış | açık kaldı |
|---|---|---|---|---|
| dayanak g1 | 41 | 22 | 21 | 34/54 |
| dayanak g2 | 45 | 19 | 11 | 43/54 |
| dayanak g3 | 34 | 30 | 1 | 53/54 |
| dayanak g4 | 36 | 27 | 2 | 53/54 |
| dayanak g4-2 | 37 | 27 | 1 | 53/54 |
| geç mesaj kapalı | 7 | 13 | 1 | 18/18 |
| geç mesaj açık | 18 | 2 | 3 | 16/18 |
| geç mesaj açık + parça + katman | 14 | 6 | 1 | 18/18 |
