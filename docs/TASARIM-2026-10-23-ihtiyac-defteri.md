# Tasarım 10-23 — Misafir İhtiyaç Defteri (soru → dayanak → cevap → teslim → kapanış)

> Kurucu 10-22 gece: "kendi önerilerin üzerine eklenebilecek en iyi, en uzun vadeli yöntem ne olabilir … koddan önce uzun düşün" +
> Soru 1 onayı ("önerin çok mantıklı") + Codex'in 8 maddesi ("mantıklıysa uygula"; "önce güncel kodda olanı ve eksikleri göster; müşteriye
> giden metin, bildirim ve iş kapatma davranışını önce / sonra örnekleriyle sor; ücretli ölçüm ve canlıya açma ayrıca onaylı").
> Bu belge: ① bugün kodda ne var (ölçülmüş envanter, dosya:satır) ② neyin eksik olduğu ③ hedef mimari ve neden ④ fazlar ⑤ sorular.

## 1. Tek cümlede

Bugün bir misafir mesajı **tek bir cevap metni** olarak üretilip **bütün hâlinde** kontrol ediliyor. İçinde bir soru bile
cevaplanamıyorsa hepsi tutuluyor, değerin hangi konuya ait olduğu kontrol edilmiyor, açık işler de yanlış zamanda kapanabiliyor.

Hedef: misafirin **her ihtiyacı** kendi kimliği, kendi dayanağı (bilgi tabanı kalemi + sürüm), kendi cevap parçası ve kendi durumu olan bir
**defter satırı** olsun. Misafire yalnız **doğrulanmış parçalar** gitsin; cevaplanamayan ihtiyaç ev sahibinde açık kalsın; satır ancak cevap
**gerçekten teslim edildiğinde** kapansın.

## 2. Bugün kodda olan — ölçülmüş envanter (yeniden yapılmayacak)

| parça | durum | kanıt |
|---|---|---|
| Mesajı isteklere bölme (anlama katmanı, tek model çağrısı): niyet + Türkçe / özgün dil sorgu + mesaj numarası + ilişki işareti | ✅ var | `ai/semantic/understanding-schema.ts` |
| İstek → kalıcı öğe (`ConversationItem`), hassas öğe ev sahibinde, güvenli öğe cevaplanır | ✅ var (canlı, `AI_CONVERSATION_ITEMS_ENABLED=1`) | `conversation-items/core.ts`, `flow.ts` |
| İstekler arası bağımlılık anlamdan ("Otopark kapısı açılmıyor; nasıl çıkacağız?" → bağlı) | ✅ var (ilişki kipi, canlı) | `conversation-items/relation.ts` `requestDependency` |
| Cevap modelinin "hangi isteği cevapladım" beyanı (`answeredRequests`); beyansız / bozuk → tut | ✅ var | `conversation-items/reply-block.ts` |
| "Bilgim yok" cümlesini ayıklayıp bağımsız kısmı gönderme | ⚠️ var ama **sabit konu sözlüğüne** bağlı (sözlükte olmayan konu → hepsi tutulur) | `conversation-items/topic-absence.ts` (anahtar KAPALI) |
| Soru başına arama sorgusu + soru başına yeniden sıralama penceresi | ⚠️ var ama sonuç **tek listeye** birleşiyor; hangi kalem hangi soru için bulundu kaydedilmiyor | `ai/retrieval/select.ts:1084`, `ai/semantic/rerank.ts:354` |
| Arama öncesi kiracı / mülk / aktif / onay süzgeci | ✅ var (veritabanı sorgusunda, puanlamadan ÖNCE) | `ai/kb-fetch.ts:90-110` |
| Kaynak beyanı (`usedSources`) | ⚠️ var ama **kategori düzeyinde** (`kb:wifi`), kalem / parça / sürüm yok, soru başına değil | `ai/index.ts:593`, `kb-line.ts:45` |
| Kanıt kaydı: bulunan kalem kimliği + sürüm (`updatedAt`) + parça no | ✅ var (yalnız kayıt; karar vermiyor) | `ai/grounding.ts:427-437` |
| Değer kontrolü (saat / tutar / sayı) | ⚠️ yalnız "bilgi tabanında **herhangi bir yerde** geçiyor mu" — konuya bağlamıyor; gölge ölçüm | `ai/claim-support.ts:662-718` |
| Kıdemli okuyucu (itiraf / ödeme / iletişim / özür / iç kaynak) + bir kez yeniden yazma | ✅ var (anahtar KAPALI) | `ai/semantic/absence-judge.ts`, `senior-rewrite.ts` |
| QR misafir sohbeti | ❌ **öğe sistemi yok**: iki sorudan biri cevaplanamıyorsa ikisi de gitmez | `api/chat/[token]/route.ts` (Haiku envanteri) |

## 3. Eksikler (Codex'in 8 maddesiyle eşleşmiş, kodda doğrulanmış)

| # | eksik | bugünkü davranış (örnek) | kanıt |
|---|---|---|---|
| 1 | Aynı türden iki istek **tek öğeye** düşüyor | "Sauna var mı, hamam kaçta kapanıyor?" → ikisi de "olanaklar" → tek öğe; hamam cevaplanınca sauna da "cevaplandı" kapanabilir | `core.ts:179`, tablo tekilliği `@@unique([conversationId, messageId, kind])` |
| 2 | Arama kanıtı soru başına izlenmiyor | çıkış sorusunun kalemi bulununca sauna araması da "başarılı" görünür | `select.ts:1084` |
| 3 | Cevap soru başına yapılandırılmış değil | model tek metin yazıyor; "bilgim yok" cümlesini sonradan cümle cümle ayıklamaya çalışıyoruz | `topic-absence.ts` |
| 4 | Değer ↔ konu bağı yok | bilgi tabanı "Havuz 20:00, sauna 22:00 kapanır"; cevap "Havuz 22:00'de kapanır" → 22:00 bilgi tabanında geçtiği için kontrol geçer | `claim-support.ts:718` |
| 5 | Bağımlılık | ✅ büyük ölçüde var (ilişki kipi); yalnız şikâyet / iade / ev sahibi talebi çapası için | `relation.ts` |
| 6 | Son metin doğrulanmış parçalardan kurulmuyor | sona eklenen otomatik not / imza son kontrolden sonra ekleniyor (sabit metin + ev sahibinin kendi imzası — risk düşük) | `automation.ts:3146-3149` |
| 7 | Açık iş yanlış zamanda kapanabiliyor | (a) kalıcı kuyrukta cevap **kuyruğa girince** "cevaplandı", teslim kalıcı düşerse geri açılmıyor · (b) ev sahibinin **ilgisiz** mesajı ("Hoş geldiniz!") bekleyen şikâyeti yapay zekânın "tutulanlar" listesinden çıkarıyor · (c) "TV düzeldi" vazgeçmesi aynı türdeki başka cihazın işini kapatabiliyor (eşleme yalnız türle) | `automation.ts:3670`, `store.ts:361-365`, `flow.ts:135`, `store.ts:195-201` |
| 8 | Ölçüm: anlama hatası ile arama hatası ayrılmıyor | tek kol uçtan uca ölçüyoruz | `tests/eval/live-pipeline.eval.test.ts` |

## 4. Hedef mimari — "İhtiyaç Defteri"

```
misafir mesajı
  └─► ANLAMA (tek çağrı, bugünkü) ─► ihtiyaçlar: N1 "çıkış saati" · N2 "sauna var mı" · N3 "hamam kaçta kapanıyor"
        (aynı tür olsa da ayrı satır; kimlik = mesaj + tür + sıra; kod yönetir)
  └─► ARAMA (bugünkü, soru başına sorgu) ─► her ihtiyacın KENDİ aday kalemleri (kalem kimliği + sürüm + parça) — kanıta yazılır
  └─► CEVAP (tek çağrı, bugünkü) ─► ihtiyaç başına parça:
        N1: durum=cevaplandı · metin="Çıkış saati 11:00." · dayanak=[K3] · alıntı="Çıkış 11:00"
        N2: durum=dayanak_yok   · metin yok
        N3: durum=cevaplandı · metin="Hamam 22:00'de kapanıyor." · dayanak=[K7] · alıntı="Hamam 22:00'de kapanır"
  └─► KOD DOĞRULAMASI (model çağrısı YOK) her parça için:
        · dayanak gerçekten bu ihtiyaç için bulunan kalemlerden mi?
        · alıntı o kalemde birebir geçiyor mu? (okuyucunun kanıt kuralının aynısı: NFKC + görünmez + benzer harf)
        · parçadaki her kritik değer (saat / tutar / sayı / kod) alıntıda var mı?  ← "havuz 22:00" burada düşer
        · alıntı ihtiyacın kendi sözcüğünü taşıyor mu? (sauna sorusuna sauna satırı)
  └─► BİRLEŞTİRME (kod): kodun selamı + doğrulanan parçalar, misafirin sorduğu sırayla. "Daha güzel yaz" diye serbest yeniden yazma YOK.
  └─► BÜTÜN KAPILAR (bugünkü) birleşik metinde + kıdemli okuyucu (anahtarlıysa) → gönder
  └─► DEFTER: N1, N3 "cevaplandı" YALNIZ teslim doğrulanınca; N2 ev sahibinde açık ("sauna — bilgi tabanında yok")
```

### Neden bu (alternatiflere göre)

- **Cümle ayıklama (bugünkü H9) yerine parça:** "bilgim yok" cümlesi hiç yazılmaz → ayıklama sezgisi, konu sözlüğü, yarım cümle riski ortadan
  kalkar. Codex madde 3'ün kendisi.
- **Ek model çağrısı yok:** anlama ve cevap zaten ayrı iki çağrı; parça yapısı cevap çağrısının JSON'una eklenir (çıktı ~%20–30 uzar).
  Değer bağlama doğrulaması koddadır (ücretsiz, deterministik). Okuyucu açıksa bugünkü gibi bir çağrı.
- **Kalem kimliğiyle atıf:** bugün `kb:wifi` kategori atfı "hangi kalem?" sorusunu cevaplamıyor; parça başına kalem + sürüm, ev sahibi bilgi tabanını
  değiştirdiğinde eski cevabın neye dayandığını gösterir (denetim izi).
- **Defter bir veri varlığıdır (asıl uzun vadeli değer):** "sauna 14 kez soruldu, bilgi tabanında yok" → ev sahibine bilgi tabanı önerisi
  (`modules/intelligence/recommendations/kb-gaps.ts` zaten var; defterin "dayanak_yok" satırları onu besler). Cevaplanamayan her ihtiyaç bilgi tabanını
  büyütür; bir sonraki misafir otomatik cevap alır. Hospitable'dan bağımsızdır (Airbnb Direct / Booking / QR aynı defter).
- **Büyük destek yapay zekâları da böyle çalışır:** soru başına kaynak gösterir, çözülemeyen konuyu insana açık bırakır ve çözülme oranını konu
  bazında ölçer. Bunu bilgi olarak yazıyorum; tek tek ürün iddiası değildir.

## 5. Fazlar

| faz | ne | müşteriye etkisi | onay |
|---|---|---|---|
| **F0 (bu tur — YAPILDI)** | Soru 1: "bilgim yok" cümlesi sabit sözlük yerine **isteğin kendi sözcükleriyle** eşlenir ("sauna"). Anahtar `AI_TOPIC_ABSENCE_ENABLED` (KAPALI) | "What time is checkout, and is there a sauna?" → önce hiçbir şey gitmiyordu; sonra "Checkout time is at 11:00." gider, sauna sizde açık | ✅ kurucu 10-22 ("önerin çok mantıklı") |
| F1 (sonraki — kod, ücretsiz) | Soru başına arama kanıtını sona kadar taşı + kanıta yaz · değer ↔ konu bağı **gölge** ölçümü (yalnız kayıt, karar vermez) · iki kollu ölçer (doğru kalem elle verilince / gerçek arama) | yok (yalnız kayıt) | gerek yok (müşteriye dokunmaz) |
| F2 (migration 84) | Aynı türden ikinci istek ayrı satır (`ordinal`) · teslimde kapanış + kalıcı teslim hatasında yeniden açılış · isteğe bağlı kısa konu etiketi ("sauna", KVKK silme kapsamında) | ev sahibi ekranı: iki ayrı açık iş görünür | **Soru B + C + D** |
| F3 | Cevap parçaları + kod birleştirmesi + parça doğrulaması (kanal) · sonra QR aynı hatta | misafire giden metin parça parça kurulur | **Soru A + E** (ücretli ölçüm) |
| F4 | Ev sahibinin ilgisiz mesajı açık işi kapatmasın | ev sahibi ekranı + yapay zekânın tuttuğu konular | **Soru B** |

## 6. Kurucuya sorular (önce / sonra örnekli)

**A. Cevap parça parça kurulsun mu? (F3, misafire giden metin)**
- Misafir: "Çıkış saat kaçta, sauna var mı, hamam kaçta kapanıyor?" (bilgi tabanı: çıkış 11:00; hamam 22:00; saunadan söz yok)
- Bugün: model tek metin yazar; "sauna hakkında bilgim yok" cümlesi yüzünden (F0 anahtarı kapalıyken) hiçbir şey gitmez.
- Sonra: "Merhaba Ayşe Hanım,\n\nÇıkış saati 11:00.\n\nHamam 22:00'de kapanıyor." gider; sauna sizde "bilgi tabanında yok" diye açık iş.
- Ek güvence: cevap "Havuz 22:00'de kapanıyor" derse (22:00 aslında saunanın) o parça **gitmez**, havuz sorusu sizde açık kalır.

**B. Ev sahibinin konuyla ilgisiz mesajı açık işi kapatmasın mı? (F4)**
- Misafir: "Klima çalışmıyor." (tutuldu, size bildirildi). Siz: "Hoş geldiniz, iyi tatiller!" yazdınız.
- Bugün: klima işi "Yanıtladınız" olur, açık işler listesinden düşer; yapay zekâ da artık o şikâyeti "tutulan" saymaz.
- Önerim: iş, siz "Tamamlandı" deyene ya da cevabınız o konuya değinene kadar açık kalsın.

**C. İhtiyaç başına kısa konu etiketi saklansın mı? (F2)** Örnek "sauna", "klima", "otopark ücreti" (en fazla 3 sözcük, ad / numara yok).
Ekranda "Olanaklar: açık" yerine "Sauna: açık" görürsünüz; "en çok sorulan ama bilgi tabanında olmayan" listesi bundan çıkar. Misafirden türeyen
metindir → saklama süresi (24 ay) ve silme talebi kapsamına girer.

**D. Migration 84 (F2) tasarımı:** `ConversationItem`'a `ordinal Int @default(0)` + isteğe bağlı `topic String?`; benzersizlik
`(conversationId, messageId, kind)` → `(conversationId, messageId, kind, ordinal)`. Mevcut satırlar `ordinal=0` ile yeni anahtarda da benzersizdir
(dar anahtar zaten benzersiz) → dolu tabloda güvenli. Push öncesi taze yedek (kural aynen).

**E. Ücretli ölçüm (F3):** iki kol × ~60 senaryo (doğru kalem elle verilince / gerçek arama), gpt-5.1; tahmini ~$3–5. Onay?

## 7. Ölçüm ilkeleri (Codex 8)

- Başarı, modelin bulduğu soru sayısına değil, **insanın yazdığı gerçek ihtiyaç listesine** göre hesaplanır (senaryoda `needs: [...]`).
- Set: aynı türden iki ihtiyaç · sözlükte olmayan konu (sauna, jakuzi, bebek yatağı) · olumsuzluk ("havuz değil sauna") · farklı diller ·
  önceki mesaja gönderme ("peki o kaçta kapanıyor?") · değer takası (havuz / sauna saatleri) · sıra değişimi.
- İki kol: (1) doğru kalem isteme ELLE konur → anlama + yazma hatası; (2) gerçek arama → arama hatası farkı.
- Kanal ve QR ayrı ayrı.
