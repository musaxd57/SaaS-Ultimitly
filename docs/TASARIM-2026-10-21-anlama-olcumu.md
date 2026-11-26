# Anlama ölçümü — istek bazlı, gerçek modelle, uçtan uca (kurucu 10-21)

> Kurucu (10-21 akşam): "Önceliği gerçek modelin bağlamı, amacı ve sorular arasındaki ilişkiyi anlamasını ölçmeye çevirelim. %75 sözcük
> örtüşmesini yükseltmek veya düşürmek bu hedefin yerine geçmesin." Bu belge ölçümün tasarımıdır; ürün davranışını DEĞİŞTİRMEZ.
> Müşteriye gideni değiştirecek her düzeltme ölçümden sonra önce/sonra örnekli kurucuya sorulur.

## 1. Neden yeni ölçer

| Eski ölçer | Eksik |
|---|---|
| `claude-t1.eval.test.ts` | Anlama modeli çağrılmaz; ilişki işareti en gevşek değere (`own_topic`) SABİTLENİR (`pairDecision`). Modelin ilişkiyi çıkarıp çıkarmadığı ölçülmez. |
| `conversation-items.eval.test.ts` | Öğe adımları elle yazılmış eşdeğer; veritabanı / gönderim yok; senaryo başına tek "güvenli olgu". |
| `live-pipeline.eval.test.ts` | Gerçek akış (iyi temel) ama senaryo düzeyinde puan: "gitti mi + değer cevapta geçti mi". İstek bazlı karar, ilişki, dayanak parçası, bağlı sorunun serbest kalması, cevaplanmayan konunun ev sahibinde açık kalması ölçülmez. Olgu kontrolü değeri arar; "havuz 22:00" gibi BAŞKA tesisin değerini yanlış yere bağlayan cevap "eksik" sayılır, "yanlış" sayılmaz. |
| Dayanak kontrolü (`sentenceGroundedInKb`) | Sözcük gövdesi + sayı örtüşmesi. Bilginin hangi yere / işleme / koşula ait olduğunu, ilişki türünü (zorunluluk ↔ izin, ücret ↔ ücretsiz, süre ↔ önceden haber) taşımaz. |

## 2. Ne ölçülür (kurucunun beş maddesi → ölçü)

1. **Gerçek model ve ayar.** Ürünün kanal akışı `applyChannelAutoReply` olduğu gibi koşar (gerçek veritabanı ayrı portta, gerçek getirme + gömme +
   sıralayıcı + anlama + bekçi + cevap + kapılar). Model ayarı `PROD_MODEL_PROFILE` (cevap `gpt-6-luna` low, anlama / sıralayıcı `gpt-5.1`),
   bayraklar Railway açılış listesi §1. İlişki işareti VARSAYILMAZ: modelin kendisi çıkarır, ölçer yalnız okur (`understandGuestMessages`
   sonucunun sarmalı — davranışı değiştirmez).
2. **İstek bazlı karar + iz.** Her senaryo beklenen istekleri listeler: misafirin mesajındaki DAYANAK PARÇASI (`span`, metinden birebir), kabul
   edilen niyetler, beklenen ilişki (bağımsız / bağlı / belirsiz) ve beklenen son sonuç (cevap / tut / acil). Ölçer modelin çıkardığı her isteği
   (niyet, `query_original`, mesaj numarası, ilişki) beklenene eşler; eşleşmeyen fazla istek ve kaçırılan istek ayrı sayılır.
3. **Aynı sözcük, farklı anlam.** Senaryolar ÇİFT olarak yazılır (`pair`): sözcükleri büyük ölçüde aynı, anlamı ve doğru kararı farklı
   ("Yangın söndürücü nerede?" ↔ "Mutfak yanıyor, söndürücü nerede?"). Çiftin ikisi de doğruysa çift doğrudur. Çok turlu senaryolarda önceki
   mesaj son mesajın anlamını değiştirir.
4. **Cevabın anlamı.** İki bağımsız kontrol, ikisi de sözcük örtüşmesine dayanmaz:
   - *Yazılmış bağlar (deterministik):* her beklenen bilgi `{about: [varlık adları], value}`; cevapta değer, varlığıyla AYNI cümlecikte ve olumlu
     geçmeli. `wrong` listesi komşu varlığın değerini bu varlığa bağlayan cümleciği YANLIŞ sayar ("Havuz 22:00'de kapanır").
   - *İddia denetçisi (model, ölçüm aracı):* cevaptaki her somut iddiayı `{konu, özellik, ilişki türü, değer, koşul, kapsam}` olarak çıkarır ve
     bilgi tabanında AYNI konu + AYNI ilişki türü + AYNI koşulla destekleyen cümleyi BİREBİR alıntılar. Kod alıntının o kalemde gerçekten
     geçtiğini doğrular; alıntı yoksa destek sayılmaz. İlişki türleri: saat · ücret · ücretsiz · izin · yasak · zorunluluk · süre · önceden
     haber · konum · yöntem/adım · iletişim · diğer. Denetçi modeli cevap modelinden FARKLI (`gpt-5.1`, düşünme yüksek; cevap `gpt-6-luna`).
5. **Son misafir sonucu.** İstek başına tek sonuç:
   - cevap beklenen istek: `doğru` · `yanlış bilgi` (yanlış bağ / desteksiz / çelişen iddia) · `gereksiz tutuldu` (gitmedi ya da cevapta yok) —
     tutulduysa ev sahibinde açık mı (`açık` / `sessiz düştü`);
   - tutulması beklenen istek: `doğru tutuldu (ev sahibinde açık)` · `serbest kaldı` (cevapta içerik olarak karşılandı = sızıntı) ·
     `tutuldu ama sessiz düştü` (ne cevap ne açık öğe);
   - acil: konuşma "sorunlu" + ev sahibine e-posta + misafire adım verilmedi.
   Modelin kendi güven puanı (`confidence`) hiçbir ölçüye girmez; yalnız raporda bilgi olarak durur.

Ev sahibinde "açık": o mesajdan, o niyetten (kabul edilen niyetlerden biri) bir konuşma öğesi `open` / `pending_host`; ya da hiçbir şey gitmediyse
konuşma "yeni / sorunlu" (gelen kutusunda cevap bekliyor). Cevap gitti ve isteğin öğesi yoksa ya da kapandıysa → **sessiz düştü**.

## 3. Setler

- **Geliştirme seti** `evals/understanding-e2e-dev.json` — ayarlama ve hata analizi için; içeriği açık.
- **Kör set** `evals/sealed/understanding-e2e-blind.json` — mühürlü (`SEALS.json` SHA-256), kör ajan yazar: depodaki kodu, istemleri, eval
  setlerini OKUMAZ; yalnız bu belgenin §4 biçimini ve §5 karar kurallarını alır. Geliştiriciye yalnız sayı + SHA döner. Ölçer onu yalnız
  `EVAL_SEALED_FINAL=1` ile okur; raporda yalnız toplu sayılar + senaryo kimlikleri. Bir kez koşulur, sonra "yandı".
- Kapsam (her iki set): komşu tesis tuzakları (aynı özellik, farklı değer: havuz / spor salonu / sauna saatleri, otopark / bisiklet ücreti),
  ilişki türü tuzakları ("iki saat önce haber verin" ↔ "iki saat kullanabilirsiniz", ücretli ↔ ücretsiz, koşullu izin), misafire / koşula özel
  kurallar, şikâyet + bağımsız / bağlı / belirsiz soru, arıza + çözüm sorusu (tarifli / tarifsiz, tehlikeli / tehlikesiz), acil ↔ acil olmayan
  aynı sözcükler, çok turlu anlam değişimi (vazgeçme, önceki mesajın konuyu belirlemesi, "peki ya …?"), bilgi tabanında olmayan konu, yedi dil.

## 4. Senaryo biçimi

```jsonc
{
  "version": 1,
  "property": { "name": "…", "checkInTime": "15:00", "checkOutTime": "11:00", "city": "…" },
  "kbSets": { "villa": [ { "id": "pool", "category": "general", "title": "Havuz", "content": "Havuz 09:00–20:00 arası açıktır…" } ] },
  "scenarios": [
    {
      "id": "pool-hours-tr",
      "lang": "tr",                    // tr · en · de · fr · es · ru · ar
      "tags": ["neighbor_entity"],
      "pair": "P01",                   // isteğe bağlı: aynı sözcük / farklı anlam çifti
      "kb": "villa",                   // kbSets anahtarı
      "kbExtra": [],                   // isteğe bağlı: bu senaryoya özel ek kalemler
      "kbOmit": [],                    // isteğe bağlı: bu senaryoda bulunmayan kalem kimlikleri
      "history": [ { "direction": "inbound" | "outbound", "body": "…" } ],   // eskiden yeniye; giden = ev sahibi / AI cevabı
      "message": "Havuz akşam kaça kadar açık?",                              // son (cevapsız) misafir mesajı
      "requests": [
        {
          "id": "r1",
          "span": "Havuz akşam kaça kadar açık",   // message ya da cevapsız bir history misafir mesajından BİREBİR parça
          "intents": ["amenities", "house_rules", "other"],
          "relation": "none",              // none (turda şikâyet/iade/ev sahibi talebi yok) · independent · dependent · ambiguous
          "expect": "answer",              // answer · hold · emergency · none (selam/teşekkür)
          "facts": [ { "about": ["havuz", "pool"], "value": "20:00" } ],
          "wrong": [ { "about": ["havuz", "pool"], "value": "22:00" } ],
          "why": "Havuz kalemi 20:00; 22:00 spor salonunun saati."
        }
      ],
      "forbidden": []                    // misafire giden metinde asla geçmemesi gereken dizeler
    }
  ]
}
```

Niyet kümesi (anlama katmanının kapalı kümesi): checkin_time · checkout_time · early_checkin · late_checkout · extend_stay · date_change ·
availability · luggage · access_keys · wifi · parking · directions_transport · amenities · appliance_help · house_rules · pets ·
cleaning_linen · trash · local_recommendations · payment_invoice · cancellation_refund · complaint_issue · emergency · human_request ·
greeting_thanks · other. Yazar emin değilse birden çok niyeti kabul eder.

## 5. Beklenen davranış kuralları (kurucu kararları — beklenti bunlardan yazılır)

- Şikâyet / arıza bildirimi, iade / iptal, ödeme, ev sahibiyle görüşme isteği → ev sahibine kalır (`hold`).
- Aynı turda şikâyete / iadeye / ev sahibi talebine BAĞLI soru ("tekrar olursa ne yapalım", "biri gelebilir mi", "bu normal mi", şikâyet
  edilen şeyin kendisiyle ilgili soru) → `hold`. KONUSU AYRI soru ("klima bozuk; çöp nerede?") → `answer`. İlişki belirsizse → `hold`.
- Arızalı şeyi düzeltme sorusu ("modemi nasıl resetleriz?") → bilgi tabanında o cihazın tarifi VARSA ve cihaz tehlike sınıfında DEĞİLSE
  (elektrik / sigorta, gaz, sıcak su / kombi, yangın) `answer`; aksi hâlde `hold`.
- Konaklama değişikliği (erken giriş, geç çıkış, uzatma, tarih değişikliği, bavul bırakma saat dışı) → ev sahibinin kararı → `hold`.
  Standart saati sormak (`checkin_time`) → `answer`.
- Acil (yangın, gaz kokusu, karbonmonoksit alarmı, su baskını, yaralanma, kilit içinde mahsur kalma) → `emergency`. Aynı nesne acil
  olmadan sorulursa ("yangın söndürücü nerede?") → bilgi tabanında varsa `answer`.
- Bilgi tabanında OLMAYAN bilgi → `hold` ("bilgim yok" misafire gitmez; konu ev sahibinde açık kalır).
- Bilgi tabanındaki koşul / kapsam korunur: koşulu sağlamayan misafire koşullu izin "var" denmez; bir tesisin bilgisi başka tesise taşınmaz.
- Selam / teşekkür → `none`.

## 6. Dayanak kontrolü bağ bataryası (deterministik, model yok)

`tests/unit/grounding-binding-battery.test.ts`: bugünkü `sentenceGroundedInKb` kararını belgelenmiş vakalarda ÖLÇER (pin değil, rapor): komşu
tesis değeri, ilişki türü değişimi, koşulun düşmesi, kapsamın genişlemesi. Amaç "gövdeyi 4'e indir / iki kaydı birleştir" gibi örtüşme
ayarlarının hangi yanlış bağları geçireceğini ÖNCEDEN göstermek; düzeltme sözcük listesi değil, iddia bağı (konu + ilişki + koşul) üzerinden
tasarlanır (§7).

## 7. Ölçümden sonra (karar değil, yön)

- Anlama şemasına isteğin dayandığı BİREBİR parçayı (`evidence_span`) eklemek — kararın hangi mesaj parçasına dayandığı üründe de izlenir
  (misafire gideni değiştirmez; anlama çağrısını değiştirdiği için ölçülüp sorulur).
- Dayanak kontrolünü iddia bağına taşımak: sözcük örtüşmesi yerine cümlenin konusu + ilişki türü + değer + koşulu, tek bilgi kaleminin TEK
  cümlesinden desteklenmeli; iki kalemi birleştirmek yalnız konu ve ilişki aynıysa. Müşteriye gideni değiştirir → kurucuya sorulur.
- Tutucu kuralların gevşetilmesi yalnız ölçümde "gereksiz tutma" sayısı yüksek VE kör sette sızıntı 0 kalıyorsa önerilir.

## 8. Koşturma

```
TEST_DATABASE_URL=postgresql://postgres@localhost:5441/ux_eval RUN_REAL_EVAL=1 EVAL_LIVE_PIPELINE=1 NODE_USE_ENV_PROXY=1 \
  EVAL_UX_SET=understanding-e2e-dev.json npx vitest run --config vitest.eval-live.config.ts tests/eval/understanding-e2e.eval.test.ts
```
Kollar: `EVAL_UX_ARM=live` (açılış listesi §1, varsayılan) · `EVAL_UX_ARM=topic_absence` (+ `AI_TOPIC_ABSENCE_ENABLED`, kurucu 10-21 T1 "B
onaylı"). Bütçe `EVAL_BUDGET_USD`. Rapor `docs/olcum/anlama-e2e-<set>-<kol>-<tarih>.md` + yan dosya.
