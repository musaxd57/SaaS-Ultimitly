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

---

## 8. Kurucu kararları 10-23 (A–E + kaynak sorusu + SSS önbelleği fikri)

| # | karar (kurucu + Codex notu) | uygulama ilkesi |
|---|---|---|
| A | Soru bazlı cevap: EVET. Değer konuya bağlanmalı (havuz sorusu → havuzun kapanış bilgisi → 20:00); saunanın 22:00'ı havuza dayanak olamaz; yer / kural / koşul doğrulanır; farklı dil, olumsuz ve koşullu cümleyle sınanır | parça doğrulaması KODDA: değer alıntıda geçmeli, alıntının o değeri taşıyan YAN CÜMLESİ ihtiyacın kendi sözcüğünü taşımalı, alıntıdaki koşul ("hafta sonu", "yalnız", "except") ve olumsuzluk ("değil", "closed") parçada korunmalı |
| B | İlgisiz ev sahibi mesajı açık işi kapatmaz: EVET (kesin). Şikâyete cevap = arıza çözüldü DEĞİL; bir ihtiyacı cevaplamak diğerlerini kapatmaz; kutucuk seçtirmeden; ilişki belirsizse otomatik KAPATMAZ; paneldeki yeni durumlar ÖNCE örnekle gösterilir | uygulamadan önce panel örnekleri (§11) sorulacak |
| C | Kısa konu etiketi: EVET, kimlik DEĞİL (iki sauna sorusu iki ihtiyaç). Şartlar: kısa + sınırlı, ham kopya değil; ad / telefon / şifre / saldırı talimatı taşımaz (kontrol edilir); modele geri verilirse misafirden türemiş VERİ olarak kalır; kaynak mesaj silinir / anonimleşirse etiket de | "24 ay": YENİ öneri değil — canlıdaki mevcut saklama politikası (`DATA_RETENTION_MONTHS=24`, `docs/claude/canli-durum.md`); etiket aynı silme / anonimleştirme yollarına (`anonymizeOldGuestData`, `maskReservationRows`, açık silme) eklenir — parite pini zaten zorluyor |
| D | Migration 84: EVET, kanıtıyla: eski açık işler, bildirim kayıtları, cevap bağlantıları korunur; geçiş mesaj göndermez, iş kapatmaz; aynı mesaj yeniden işlenince kayıt çoğalmaz; yedek + geri yükleme doğrulaması ayrı | §12 kanıt listesi |
| E | Ücretli ölçüm: YAP. İki kol = ONAYLI Luna yapılandırması (10-10, `KURUCU-YOKKEN-KARARLAR-2026-10-09.md` #7: cevap + bekçi `gpt-6-luna` `low`; anlama, sıralayıcı, karar metni 5.1; çeviri Luna `medium`; üslup Luna `none`) ile eski akış / yeni akış. Yalnız cevap değil: hangi soru cevaplandı, hangisi açık kaldı, hangi kaynak kullanıldı. Okuyucu açık / kapalı / hata verdiğinde ayrı | §13 |
| KS | "Bunu nereden biliyorsun?" gibi kaynak / asistan sorularında otomatik cevap GİTMEZ; kaynak, bilgi tabanı, istem, sistem açıklanmaz; soru panelde AÇIK kalır, cevaplandı sayılmaz; aynı mesajdaki bağımsız, güvenle cevaplanabilen sorular bundan dolayı TUTULMAZ | §9 — ilk uygulanan |
| O | Okuyucunun "güvenli" demesi TEK BAŞINA gönderim izni değildir; yetki, sır, kaynak kapsamı ve kayıt tutarlılığı kontrolleri KODDA kalır | bugün böyle (§14); yeni parça doğrulaması da kodda |
| SSS | Kurucu fikri: daire başına sık sorulan sorular embedding ile tutulsun; benzer soru gelince bilgi tabanı değişmemişse cevap doğrudan gitsin — para + zaman tasarrufu, RAG / embedding gelişir | §10 — tasarım + sorular; parça yapısına (F3) dayanır |

## 9. Kaynak / asistan sorusu (KS) — ilk dilim

- Anlama katmanına yeni kapalı niyet `about_assistant` ("bunu nereden biliyorsun", "hangi sistemi / modeli kullanıyorsun", "bot musun",
  "bu bilgiyi nereden aldın"). Öğe: hassas (cevaplanmaz, panelde açık), **e-posta YOK** (acil değil; panelde "asistan / kaynak sorusu").
- Cevap modeline "EV SAHİBİNE BIRAKILAN" olarak gider → model ona değinmez; aynı mesajdaki Wi-Fi sorusu cevaplanır.
- Model yine de kaynak anlatırsa bugünkü iç kaynak kapısı tutar (bir kez yeniden yazar) — kemer aynen.
- Anahtar `AI_ASSISTANT_QUESTION_ITEM_ENABLED` (kapalıyken şema / istem bayt bayt eski). QR'da öğe sistemi olmadığı için QR bugünkü gibi
  (bütün cevap tutulur) — QR, F3'le aynı hatta geçince düzelir.

## 10. SSS önbelleği (kurucu fikri) — tasarım

**Ne kazandırır:** aynı dairede "Wi-Fi şifresi ne?", "çöpler nereye?", "otopark var mı?" gibi sorular tekrar tekrar geliyor. Her seferinde
cevap modeli (en pahalı çağrı, 3–8 sn) yeniden yazıyor. Önbellek isabetinde cevap modeli HİÇ çağrılmaz.

**Doğru birim = doğrulanmış CEVAP PARÇASI (F3), bütün mesaj değil.** Mesaj "Wi-Fi + otopark" diye iki soru taşıyabilir; parça tek ihtiyacın
cevabıdır ve hangi bilgi tabanı kaleminin hangi SÜRÜMÜNE dayandığını taşır. Önbellek satırı:

```
mülk · dil · niyet türü · ihtiyacın embedding'i · cevap parçası metni · dayanak kalemleri (kimlik + updatedAt) · mülk alanları (giriş/çıkış saati) · ilk gönderim · isabet sayısı
```

**Akış:** anlama katmanı ihtiyaçları ayırır (bugünkü çağrı) → her cevaplanabilir ihtiyacın sorgusu embedding'e çevrilir (çok ucuz) → aynı mülk +
aynı dil + aynı tür içinde benzerlik ≥ eşik ve **dayanak kalemlerin hepsi hâlâ aynı sürümde, aktif ve onaylı** → parça hazır. Turun BÜTÜN
cevaplanabilir ihtiyaçları isabetliyse cevap modeli çağrılmaz; kodun selamı + parçalar birleştirilir ve **bugünkü bütün kod kapılarından**
geçer (okuyucu açıksa o da okur — ucuz model). Biri bile kaçarsa bugünkü akış (ilk sürümde karışık mod yok).

**Asla önbelleğe girmeyenler:** konaklama değişikliği (erken giriş / geç çıkış / uzatma / müsaitlik), giriş / kapı / anahtar kodu, ödeme,
şikâyet / arıza, acil, insan talebi, kaynak sorusu; rezervasyona ya da zamana bağlı her şey ("bugün", "yarın", misafirin adı); misafire
özel saat. QR'da Wi-Fi şifresi bugünkü cihaz kuralına (K7) tabi — önbellek kapıyı atlatmaz.

**Kim yazar:** yalnız GERÇEKTEN teslim edilmiş ve bütün kapılardan geçmiş parça; ev sahibi sonradan "yanlış" derse satır silinir.
Bilgi tabanında dayanak kalemi değişince satır kendiliğinden geçersiz (sürüm karşılaştırması — "değişip değişmediğine bakarak").

**Ev sahibine görünür değer:** mülk sayfasında "Sık sorulanlar" listesi (soru · cevap · kaç kez · son kullanım) + "bilgi tabanında olmayan,
en çok sorulanlar" (F2 defterinin "dayanak yok" satırlarından). Bu RAG'ı her daire için zamanla güçlendirir.

**Ölçülecek:** geçmiş ölçüm setlerinde isabet oranı, yanlış isabet (yanlış soruya hazır cevap) = 0 hedefi, tasarruf (çağrı + saniye).

**Sorular (§15):** S1 hangi türler (Wi-Fi şifresi dahil mi?) · S2 benzerlik eşiği / ilk sürümde yalnız birebir yakın sorular · S3 "Sık sorulanlar"
ekranı · S4 migration (yeni tablo).

## 11. B — panel örnekleri (uygulamadan ÖNCE onay)

**Kurucu B (10-23, aynen özet):** ilgisiz ev sahibi mesajı açık işleri kapatmasın · şikâyete cevap vermek arızanın çözüldüğü demek değil · bir
ihtiyacı cevaplamak diğerlerini kapatmasın · ev sahibine işaretleme kutusu olmasın · ilişki belirsizse otomatik kapatma.

**Bugün (ölçüldü, kodda):** ev sahibi konuşmaya herhangi bir mesaj yazınca, o mesajdan ÖNCEKİ bütün açık işler "Yanıtladınız" görünür
(`effectiveStatus` — mesajın içeriğine bakılmaz). Yani beş şartın üçünü bugünkü kural çiğniyor.

**Öneri (ilk sürüm — model çağrısı YOK, yalnız kod):** ev sahibinin mesajı açık işleri KAPATMAZ; iş "Ev sahibi yazdı" (sarı) olur ve açık
listede KALIR. Kapanış üç yoldan: (1) yapay zekânın doğrulanmış parçası o isteği cevapladı (bugün var), (2) misafir "tamam / düzeldi /
teşekkürler" dedi ve anlama katmanı o işi geri çekti / tamamladı (bugün var — `withdrawn`), (3) ev sahibi isterse "Bitti" der (bugünkü
düğme; zorunlu değil). **İkinci sürüm (ayrı onay):** ev sahibinin mesajını anlama katmanı okur → hangi işe değindiğini ve "çözüldü" mü
"ilgileniyorum" mu dediğini işaretler; yalnız açık ve tek anlamlıysa o iş kapanır, belirsizse açık kalır (model çağrısı, mesaj başına ~1 sn).

| durum | bugün | öneri (ilk sürüm) |
|---|---|---|
| Misafir "Klima çalışmıyor" (tutuldu) → siz "Hoş geldiniz!" | iş "Yanıtladınız", listeden düşer | iş AÇIK kalır ("Ev sahibi yazdı" sarı); yapay zekâ şikâyeti tutulan saymaya devam eder |
| Siz "Teknisyen yarın 10'da geliyor" | "Yanıtladınız" | "Ev sahibi yazdı" — açık; misafir "düzeldi, teşekkürler" yazınca kapanır (2. yol) |
| Misafir "TV + mikrodalga nasıl?" → siz yalnız TV'yi cevapladınız | ikisi de "Yanıtladınız" | ikisi de "Ev sahibi yazdı" (açık); 2. sürümde TV kapanır, mikrodalga açık kalır |
| Misafir "Havuz kaçta kapanıyor? Sauna var mı?" → yapay zekâ yalnız havuzu doğruladı | — | havuz "AI yanıtladı", sauna açık (bugün parça kipinde var — D ile ayrı satır) |
| Siz "Tamamdır" (neye dair belli değil) | hepsi "Yanıtladınız" | hepsi açık kalır (belirsiz → kapatma yok) |

Soru: ilk sürüm bu mu olsun (kapanış yalnız yapay zekâ / misafir / sizin "Bitti"nizle; "Bitti" düğmesi kalsın mı)? İkinci sürüm (ev sahibi
mesajını okuyan model) ayrıca istenir mi?

## 12. D — migration 84 kanıt listesi

1. Yalnız EKLER: `ordinal Int @default(0)` + `topic String?`; benzersizlik `(conversationId, messageId, kind)` → `(…, ordinal)` (dar anahtar
   zaten benzersiz → mevcut satırlar yeni anahtarda da benzersiz; dolu tabloda güvenli).
2. Taze PostgreSQL'de: önce 83'e kadar göç + gerçekçi satırlar (açık / bekleyen / bildirilmiş / cevaplanmış öğe), sonra 84 → satır sayısı,
   durum, `notifiedAt`, `answeredByMessageId` BİREBİR; hiçbir giden mesaj / e-posta satırı oluşmaz.
3. Aynı mesaj iki kez işlenir → öğe sayısı değişmez (tekrar güvenliği testi).
4. Sıfır sapma (`migrate diff` boş), geri dönüş SQL'i yazılı; yayından önce taze yedek + geri yükleme provası (kural aynen).

## 13. E — ücretli ölçüm planı

- Kollar: (1) eski akış (bugünkü kod, onaylı Luna yapılandırması) (2) yeni akış (parça modu + kaynak sorusu + soru bazlı "bilgim yok").
  Her kol: okuyucu açık / kapalı / hata verdiğinde (sahte 503) — 2 × 3.
- Set: ~40 senaryo, her birinde İNSANIN yazdığı ihtiyaç listesi (`needs`) + beklenen durum (cevaplandı / açık) + beklenen dayanak + değer.
  Aynı türden iki ihtiyaç, sözlükte olmayan konu, olumsuz ("sauna bulunmuyor" → cevaplanabilir), koşullu (hafta sonu), değer takası
  (havuz / sauna), kaynak sorusu, farklı diller, önceki mesaja gönderme.
- Ölçü: ihtiyaç başına doğru durum, yanlış "cevaplandı" (hedef 0), yanlış değer (hedef 0), kaynak / iç ad / "bilgim yok" sızıntısı (0),
  giden metin sayısı, maliyet, süre. Tahmini maliyet ≈ $6–10.

## 14. O — okuyucu neyi tek başına AÇAMAZ (bugün)

Okuyucu yalnız TUTAR ya da bir kez yeniden YAZDIRIR; şu kod kapılarını hiçbir hükmü açamaz: sır / kapı kodu / Wi-Fi cihaz kuralı, kiracı ve
yetki, çıktı vetosu (söz / yer tutucu), acil yönergesi, müsaitlik / fiyat iddiası, iç kaynak yedeği. Okuyucunun "hayır" hükmünün bir KELİME
kuralını geçersiz kıldığı iki yer var, ikisi de sizin kararınız: "bilgim yok" kelime adayı (bağlam hakemi, 10-21) ve üçüncü tarafa ödeme
bilgisi (T-d, 10-22).

## 15. Yol haritası (sıra = bağımlılık)

1. **KS** kaynak sorusu ayrı ihtiyaç (anahtarlı) — kod + test.
2. **F1** parça doğrulayıcısı (değer ↔ konu ↔ koşul ↔ olumsuzluk) saf modül + testler; soru başına arama kanıtını kanıt kaydına taşı.
3. **F3** parça modu (anahtarlı): istemde kalem kimlikleri [K1…], cevap modelinden ihtiyaç başına parça, kod doğrulaması, kod birleştirmesi;
   öğe yalnız doğrulanan parçayla "cevaplandı".
4. **E** ücretli ölçüm (onaylı) → sonuç + önce / sonra örnekleri size.
5. **D** migration 84 + kanıt testleri (push sizin onayınızla verildi; yayından önce yedek).
6. **B** panel örneklerinize göre (onaydan sonra).
7. **SSS önbelleği** (S1–S4 cevaplarından sonra; F3'e dayanır).
8. QR aynı hatta (öğe + parça).

## 16. Uygulama notları (10-23, F1 + F3 kodda — anahtar KAPALI)

- **F1 doğrulayıcı** (`ai/answer-binding.ts`): değer ↔ konu ↔ koşul ↔ olumsuzluk ↔ yön. Haiku incelemesinin 11 yanlış geçiş sınıfı kapandı
  (çift olumsuz, açılır ↔ kapanır, karışık cümle, niteleyen konum "havuzun yanındaki bar", nitelik sözcüğü "havuz temizliği", konusuz koşul
  "…, pazar hariç", alıntının gizlediği hafta sonu değişkesi, sözlük, belirsiz "saat 9"). Mutasyon 21/21 + 28/31 → yaşayanlar düzeltildi.
  Bilinen sınır (tutma yönünde): "ücretsizdir" ↔ "ücretli değil"; konu değerden SONRA ("09:00-20:00 arası havuz açık"); parantezli değişke.
- **F3 parça kipi** (`ai/answer-parts.ts`): §4'teki `[K1]` kalem kimliği YERİNE alıntının kendisi kaynağı belirler (kalem satırı seçicinin
  bütçe ölçüsüyle pinli; kimlik eklemek o pini ve istem önbelleğini bozardı; alıntı zaten birebir aranıyor). Mülk bilgisi (giriş / çıkış
  saati, adres) de kaynak. Birleşik metin: doğrulanan parçalar satır satır, selamsız — selam `AI_CODE_GREETING_ENABLED` ile kodun selamı.
- **Kalan (sonraki dilim):** soru başına ARAMA kanıtı (hangi isteğe hangi kalem getirildi) kanıt kaydına; doğrulanmış müsaitlik / erken giriş
  kod metni parça kipinde istek beyanıyla birleşmeli (ikisi de anahtar kapalı); QR aynı hatta.


## 17. D — migration 84 tasarımı (kurucu: "evet, kanıtıyla")

**Şema (yalnız ekleme + tekillik genişletme):**
```sql
ALTER TABLE "ConversationItem" ADD COLUMN "ordinal" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ConversationItem" ADD COLUMN "topic" TEXT;
DROP INDEX "ConversationItem_conversationId_messageId_kind_key";
CREATE UNIQUE INDEX "ConversationItem_conversationId_messageId_kind_ordinal_key"
  ON "ConversationItem"("conversationId", "messageId", "kind", "ordinal");
```
- Dolu tabloda güvenli: yeni kolon varsayılanlı (her eski satır `ordinal = 0`), yeni tekillik eskisinin ÜST KÜMESİ (eski üçlü zaten tekildi →
  dörtlü de tekil; çakışma imkânsız). Satır silinmez, durum / bildirim (`notifiedAt`) / cevap bağı (`answeredByMessageId`) dokunulmaz;
  migration hiçbir mesaj göndermez, hiçbir öğeyi kapatmaz (yalnız DDL). Tablo küçük (mesaj başına birkaç satır) → düz indeks.
- **Davranış anahtarı `AI_ITEM_ORDINAL_ENABLED` (varsayılan KAPALI):** kapalıyken her şey bugünkü gibi (aynı türden ikinci istek birleşir,
  `ordinal` hep 0, `topic` yazılmaz — anahtar dizgesi `hintKey(mesaj, tür)` sıra 0'da bayt bayt aynı). Açıkken aynı mesajdaki aynı türden
  ikinci istek AYRI satır (`ordinal` 1, 2 …; tavan 4) ve kendi R kimliği → parça kipinde ("havuz kaçta, sauna kaçta") her biri ayrı
  doğrulanır, biri cevaplanıp öteki açık kalabilir.
- **Kısa konu etiketi `topic` (kurucu C, şartlarıyla):** misafir metni kopyalanmaz; anlama katmanının sorgu sözcüklerinden (`needTerms`)
  KODLA kurulan en çok 3 sözcük / 40 karakter; rakam taşıyan, `@` / bağlantı benzeri, misafir adıyla eşleşen ve sır sözcüğü (şifre, kod, pin…)
  içeren belirteç atılır; enjeksiyon kalıbı varsa etiket hiç yazılmaz. Modele GİTMEZ (yalnız panel ve "en çok sorulan, bilgi tabanında
  olmayan" listesi). Misafir kaynaklı veri sayılır: süre bazlı temizlik (`DATA_RETENTION_MONTHS`, bugünkü politika — yeni bir süre
  DEĞİL; satırın kendisi zaten aynı kesimde siliniyor) ve misafir silme talebi etiketi de siler; dışa aktarma kapsamı öğeyle aynı.
- **Kanıt testleri (push şartı):** (1) dolu tabloya migration: satırlar, durum, `notifiedAt`, `answeredByMessageId` aynen, `ordinal = 0`;
  (2) migration sonrası aynı turun yeniden işlenmesi satır çoğaltmaz (anahtar kapalı ve açık); (3) taze PG'de sıfır sapma
  (`prisma migrate diff`); (4) anahtar kapalıyken mevcut öğe testlerinin tamamı değişmeden yeşil; (5) etiket temizleyicisi (ad / telefon /
  şifre / enjeksiyon) + silme / temizlik paritesi. Yedek / geri yükleme doğrulaması ayrı (Railway açılışında, kurucu D).

## 18. Opus derin incelemesi (10-23 akşam) → doğrulayıcı sertleştirme planı

Opus 3 kritik + 7 yüksek yanlış-kabul sınıfı buldu (rapor `scratchpad/opus-review-1023.md`, özet aşağıda); hepsi anahtar KAPALI kodda.
Kod kuralı olarak YAPILACAKLAR (deterministik, tutma yönünde):

| # | sınıf | kural |
|---|---|---|
| K1 | ihtiyaç iki konu taşıyorsa ("havuz + sauna") herhangi biri bağ sayılıyor | parça tarafı konu: değerin parçadaki konusu ile kalemdeki bağlayan konusu aynı kimlik (terim ya da sözlük konusu; diller arası sözlük konusu) olmalı; çok konulu ihtiyaçta konusuz parça tutulur |
| K2 | baş ad / fiil / kaba sözlük konusu bağ sayılıyor ("bulaşık makinesi" ↔ "çamaşır makinesi", "restoran" ↔ "kahvaltı") | konu terimlerinden genel baş adlar ve fiiller çıkar; terim varken sözlük konusuna düşülmez |
| K3 | alıntı cümle parçası olabiliyor, koşul dışarıda kalıyor | doğrulama alıntıyı değil kalemin TAMAMINI okur (alıntı yalnız dayanak şartı); değer kalemin herhangi bir yerinde konuya bağlı ve o yerin bütün kontrollerinden geçiyorsa olur |
| Y1 | yön parça düzeyinde | değer başına; aralığın ilk ucu açılış, son ucu kapanış; aralığın tek ucu yönsüz verilirse tutulur |
| Y2 | koşul düşmesi parça düzeyinde | gün / mevsim değer başına; parçada değerden SONRAKİ değersiz yan cümle değere gün bağışlamaz |
| Y3 | değersiz koşullu değişke görünmez ("Hafta sonu kapalıdır") | değişke taraması değersiz, konuya bağlı gün / mevsim yan cümlelerini de okur |
| Y5 | ücret tabanı (günlük / gecelik / kişi başı / konaklama boyunca) | koşul sınıfı: kalemde varsa parçada da olmalı, parça uyduramaz |
| Y6 | sözcükle yazılmış sayı ("eight pm", "acht Uhr") değer kontrolünü atlıyor | parçada sayı / saat sözcüğü varken rakamlı değer yoksa tutulur |
| Y7 | aynı cümledeki istisna / karşıtlık ("…, köpek hariç", "ama …") | parça da istisna taşımalı (ya da istisnanın gün / mevsim koşulunu anmalı); yoksa tutulur |
| Y4 (kısmen) | diller arası ücretsiz ↔ ücretli | ücret kutbu: parça "ücretsiz" diyorsa kalem de demeli; kalem ücretli / tutar veriyorsa "ücretsiz" tutulur |
| O6 | değişke yalnız alıntının kalemi | değişke taraması istemdeki bütün kaynaklarda |
| — | dili kestirilemeyen kısa parça içerik kontrolünü atlıyor | kalem dili biliniyorsa ve iki taraf aynı yazı sistemindeyse içerik kontrolü koşar |

Kodla ÇÖZÜLEMEYEN kalan sınıf: diller arası içerik ("heated", "served in your room" gibi kalemde olmayan nitelik). Endüstride bu katman
bir doğrulama modeliyle yapılır (dayanak / "groundedness" denetimi: parça + kalem cümlesi → "tam destekleniyor mu?"). Bu yeni bir model
çağrısıdır (maliyet + gecikme) → kurucu kararı: parça kipi açılmadan önce kıdemli okuyucuya parça başına "kalem bunu tam destekliyor mu"
sorusu eklensin mi? (soru, rapor §5).

Orta: kaynak sorusu e-postası yalnız mesajın bütün açık işleri sessiz türdeyse susar; parça beyanı eksikse tur sessiz kalmaz (ev sahibine
e-posta); sıra kipinde etiketi boş öğe "aynı konu" sayılmaz (belirsiz → kapatma yok); etiket adı önek eşleşmesi + unvan komşusu + büyük
harfle başlayan özel ad + sır sözcüğünün ardındaki sözcük; "kullanım talimatı" saldırı izi sayılmaz; süre bazlı temizlik seçim bacağı;
parça kaynakları yalnız isteme giren kalemler.
