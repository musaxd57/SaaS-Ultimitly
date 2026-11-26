# TASARIM — Hassas gönderimden hemen önce ortak yetki kontrolü + kaynak-sürüm kaydı + gölge ölçüm (25 Kasım)

> Kaynak: `docs/KURUCU-TALIMATI-2026-11-25-codex-raporu-ve-opus-dalgasi.md` §3 (Codex: "AI'ya anlama esnekliği ver, yetkiyi kodda tut").
> YENİ sistem: kurucu onayı olmadan kurulmaz. Misafire gideni değiştiren her adım §6'da önce / sonra örnekli sorudur. Kod YOK.
> Kurucu kuralı (11-18 akşam): anlam / niyet kararı kelime listesiyle VERİLMEZ. Bu tasarımda "hassas" bir NİYET kararı değildir; cevabın
> dayandığı KAYNAĞIN türüdür (kodda zaten var olan kategori: `wifi`, `checkin`). Yazan: Opus (OB), taban `07f679c5`.

## 1. Kısa sonuç

- **Teyit (sonda):** kanal otomatik cevabının satır içi yolunda (üretimde etkin yol) model düşünürken olan on değişiklikten yalnız ikisi
  yakalanıyor (iptal — 11-20 son kontrolü; konuşmanın "Sorunlu" yapılması). Bilgi tabanındaki kapı kodu / Wi-Fi şifresi değişse, kalem pasife
  alınsa ya da silinse, rezervasyon başka daireye taşınsa, ev sahibi otomatik cevabı kapatsa ya da AI'yı durdursa, ev sahibi o arada elle cevap
  yazsa — **eski cevap gidiyor** (§2.2).
- Pencere küçük (model süresi, tipik 2–10 sn) ve bu değişiklikler nadir; yani bugünkü risk düşük ama sınıf gerçek ve kapı kodu değişimi gibi
  "eski kod misafire gitti" sonucu ağır.
- **Codex 44 / 60 iddiası teyitli ama bağlamıyla:** 4.000 karakterlik denetim özeti 60 sentetik kalemden parça numaralı biçimde 44'ünü saklar,
  kırpılanı `omitted: 16` diye AÇIKÇA yazar (sessiz değil). Üretimde isteme giren kalem en çok 30 (tam liste) ya da 12 parça (hibrit) olduğu için
  pratikte kırpma nadirdir (§2.4). Codex'in asıl noktası doğru: bu kayıt teşhis içindir, "bu cevap şu sürüme dayanarak gitti" kanıtı değildir.
- **Öneri (ilk aşama yalnız gölge):** isteme giren kalemlerin `(kimlik, updatedAt, etkin mi, kategori)` anlık görüntüsü bellekte tutulur; gönderim
  talebinden HEMEN önce aynı kalemler tek sorguyla yeniden okunur, rezervasyon / daire / durdurma alanları talebin kendisinde kıyaslanır. İlk
  aşamada hiçbir şey engellenmez; yalnız "engellenseydi hangi sebeple" kapalı küme kodla kaydedilir (`AI_SEND_RECHECK_SHADOW_ENABLED`, varsayılan
  KAPALI). Ham misafir mesajı ya da kod değeri SAKLANMAZ; migration gerekmez.

## 2. Envanter

### 2.1 Bugün gönderimden hemen önce ne yeniden okunuyor — TEYİTLİ (kod)

| Yol | Gönderim anı kontrolü (dosya:satır) | Tur başında var, gönderim anında YOK |
|---|---|---|
| Kanal otomatik cevap, satır içi (kuyruk kapalı — üretim varsayılanı) | Talep tek `updateMany`: durum `new/waiting` · modelin görmediği misafir mesajı yok · bağlı rezervasyon iptal değil (`src/lib/automation.ts:4569-4579`). Erken giriş onayında ev sahibinin kartı sahiplenilir (`:4605-4639`). | AI durdurma (`autoReplyHoldUntil`, tur başı `:2210`), konaklama bitti (`:2222`), işletme otomatik cevap anahtarı (`:2233`), çalışma saatleri (`:2238`), daire / rezervasyon eşleşmesi, KB sürümü, ev sahibinin elle cevabı. |
| Kanal otomatik cevap, kuyruk (`outbox/worker.ts replyVeto`) | Hedef var + aynı kiracı · AI satırıysa: Sorunlu / Kapalı · AI durdurma · rezervasyon iptal / konaklama bitti · daha yeni misafir mesajı · tetikten sonra ev sahibinin elle cevabı (`src/lib/outbox/worker.ts:553-652`); genel anahtar, abonelik, kanal 402 (`:948-971`). | KB sürümü, daire / rezervasyon taşınması. |
| QR sohbet (`api/chat/[token]`) | Kayıt işleminde: silinmiş konaklama, iptal (Ö-1), AI ev sahibine devredilmiş mi (`src/app/api/chat/[token]/route.ts:928-942`). | KB sürümü. (QR'da kapı kodu kategorisi zaten isteme girmez — `guest-chat.ts:57` `QR_SECRET_CATEGORIES`.) |
| Otomatik karşılama / giriş / çıkış, doğrudan | Talep koşulu rezervasyon durumu + `*SentAt` boş (`automation.ts` giriş göndericisi `~6540-6556`); gövde gönderimden hemen önce GÜNCEL şablondan kurulur. | — (model yok; pencere milisaniye). |
| Otomatik mesaj, kuyruk | Gövde POST'tan hemen önce dairenin GÜNCEL şablonundan yeniden kurulur, farklıysa aynı satıra yazılır (`worker.ts:886-940` `refreshLifecycleBody`) + yaşam döngüsü vetosu (`:691-…`). | — . **Bu, "değeri son kontrolden sonra sunucu yerleştirsin" ilkesinin depodaki çalışan emsalidir.** |
| Karar mesajı (`HOST_DECISIONS_ENABLED` kapalı) | Kilitten sonra rezervasyon taze okunur, iptalse gönderim yok; kuyruk açıkken de doğrudan yol, operatör freni geçerli (`docs/claude/durum.md` 11-18 (5); `src/lib/host-send.ts:132`). | — (insan kararı; model metni değil). |
| Elle cevap | İnsan yazdığı için durum vetosu bilinçli yok (`worker.ts:550` yorumu). | Kapsam dışı. |

### 2.2 Model düşünürken değişiklik — kanal satır içi yol — TEYİTLİ (sonda)

Sonda: `auto-reply-cancelled-mid-turn.test.ts` iskeleti; model sahte, değişiklik model çağrısının İÇİNDE yapılır; daire KB'sinde onaylı bir
Wi-Fi kalemi ("şifre deniz2024"). Gerçek PostgreSQL (`lixus_o3`). Dosya commit edilmedi (scratchpad `ob-probe/zz-probe-ob-t2.test.ts`).
"İstemde eski değer" = sahte modele giden girdide eski şifre vardı (gerçek model onu yazardı).

| Model düşünürken olan | İstemde eski değer | Sonuç | Gidende eski şifre |
|---|---|---|---|
| KB kalemi içeriği değişti (yeni şifre) | evet | **gönderildi** | evet |
| KB kalemi pasife alındı | evet | **gönderildi** | evet |
| KB kalemi silindi | evet | **gönderildi** | evet |
| Rezervasyon başka daireye taşındı | evet | **gönderildi** | evet |
| Konuşma başka daireye bağlandı | evet | **gönderildi** | evet |
| Çıkış düne çekildi (konaklama bitti) | evet | **gönderildi** | evet |
| Rezervasyon "pending"e döndü | evet | **gönderildi** | evet (emin değilim: bu yolun onaysız rezervasyona ne yapması gerektiği; tur başı da aynı) |
| İşletme otomatik cevabı kapattı | evet | **gönderildi** | evet |
| Ev sahibi AI'yı durdurdu (`autoReplyHoldUntil`) | evet | **gönderildi** | evet |
| Konuşma "Sorunlu" yapıldı | evet | gönderilmedi (`already_claimed`) | — |
| Ev sahibi o arada elle cevap yazdı | evet | **gönderildi** (misafire iki cevap) | evet |
| Kontrol: değişiklik yok | evet | gönderildi | evet |

Notlar (hata olmayanı hata gibi göstermemek için):
- **Ana oturum düzeltmesi (11-25, kodda doğrulandı):** "ev sahibi o arada elle cevap yazdı → iki cevap" satırı sondada çıplak bir mesaj
  satırı eklenerek üretildi. Gerçek yollarda: Lixus panelinden yazılan cevap konuşmayı aynı anda "Cevaplandı" yapar (`src/lib/host-send.ts:311`)
  → talep durum şartından düşer, iki cevap OLUŞMAZ. Açık yalnız ev sahibinin KANALIN kendi uygulamasından yazdığı cevabın eşzamanlı bir
  senkronla içeri alındığı (durum henüz güncellenmemiş) dar pencerededir. "AI durduruldu" (`autoReplyHoldUntil`) alanını satır içi kipte
  eşzamanlı yazan bir yol yok (ev sahibinin durdurma eylemi konuşmayı "Sorunlu" yapmaktır — o yakalanıyor) → pratikte açık değil.
- **Aynı gün kapatılanlar (`6f33a939`):** otomatik cevabın model düşünürken kapatılması ve kanaldan yazılıp eşzamanlı içeri alınan ev sahibi
  cevabı artık gönderim talebinin kendisinde (tek UPDATE). S1'in bu iki bacağı soru olmaktan çıktı; konaklamanın model düşünürken bitmesi
  (saniyelik pencere, tarih değişimi) ve aşağıdaki KB / daire maddeleri soruda kalır.
- Rezervasyon iptali bu tabloda yok çünkü 11-20 düzeltmesiyle yakalanıyor (aynı dosyanın var olan testi yeşil).
- Kuyruk yolu (`replyVeto`) AI durdurma, konaklama bitişi ve ev sahibinin elle cevabını ZATEN yakalar; satır içi yol yakalamaz. Yani "ev sahibi
  elle yazdı → iki cevap" ve "AI durduruldu → yine gitti" iki yol arasında ayrışma; düzeltmesi yeni sistem değil, kuyruktaki kuralın satır içi eşi
  (yine de misafire gideni değiştirdiği için soru S1).
- KB sürümü ve daire taşınması iki yolda da kontrol edilmiyor.
- İşletme anahtarının kapatılması acil durdurma konusudur (bkz. `TASARIM-2026-11-25-acil-durdurma-kapsami.md`).

### 2.3 Depoda var olan, üstüne kurulacak parçalar — TEYİTLİ (kod)

- **Son kontrol deseni:** şart talebin kendisinde (ilişki süzgeci, tek UPDATE; `automation.ts:4569-4579`) — kontrol ile talep arasına değişiklik giremez.
- **Sır kapsamı:** `kbForStayScope` / `kbForStayScopeRawAndFilled` (`src/lib/guest-chat.ts:884-903`), kategori kümesi
  `PREBOOKING_SECRET_CATEGORIES = ["wifi","checkin"]` (`:60`), QR'da `QR_SECRET_CATEGORIES = ["checkin"]` (`:57`). Hassasiyetin kod tarafı tanımı
  burada hazır: **kategori**.
- **Kaynak beyanı:** model `usedSources` olarak `kb:<kategori>` yazar, kod isteme gerçekten girmiş kategoriye indirger (`src/lib/ai/index.ts:105-113`).
  Beyan kategori düzeyindedir, kalem düzeyinde değil.
- **Kanıt kaydı:** `buildKbEvidence` (`src/lib/ai/grounding.ts:428-526`) kalem kimliği + `updatedAt` (`v`) + parça numarası yazar; kayıt
  `RiskEvent.kbEvidenceJson` (`prisma/schema.prisma:1265`) ve `AiGeneration.kbEvidenceJson` (`:1929`). Yani "sürüm" kavramı (`updatedAt`) zaten
  kullanılıyor.
- **Sunucunun yerleştirdiği metin:** otomatik mesaj gövdesi gönderim anında yeniden kurulur (`worker.ts:886-940`); yer tutucu ikamesi tek geçiş
  (`src/lib/kb-placeholders.ts`, yalnız ad / daire); "D" kodla selam (`ai/code-greeting.ts`, anahtar kapalı); doğrulanmış müsaitlik kod metni
  (`ai/verified-availability.ts`, anahtar kapalı).
- **Gölge kayıt desenleri:** `recordShadowVerdict` (`src/lib/shadow-ai.ts:207`), `shadowCompareAutoSend` (`src/lib/conversation-control/shadow.ts:32`),
  ev kuralı gölgesi (`automation.ts:3530-3536`).
- **Kapı kodu yapısal bir alan DEĞİL:** `KnowledgeBaseItem` (`schema.prisma:930-960`) yalnız `category / title / content`; kod serbest metnin içinde.

### 2.4 Codex'in 44 / 60 ölçümü — TEYİTLİ (sonda, `npx tsx`)

`EVIDENCE_CHAR_CAP = 4_000` (`grounding.ts:196`). Aynı uzunlukta kimliklerle:

| Kalem sayısı | Parça numarası yok | Parça numarası var |
|---|---|---|
| 44 | 44 saklı | 44 saklı |
| 45 | 45 saklı | 44 saklı, `omitted: 1` |
| 60 | 47 saklı, `omitted: 13` | **44 saklı, `omitted: 16`** |
| 100 | 47 saklı | 44 saklı |

Bağlam: isteme giren kalem en çok `KB_ITEM_CAP = 30` (`src/lib/ai/limits.ts:23`) ya da `KB_RETRIEVAL_MAX_CHUNKS = 12` (`:42`). Kanıt kaydındaki
öteki alanlar (kapı kanıtı, iddia denetimi, model kullanımı …) aynı 4.000 karaktere sayıldığı için çok dolu bir kayıtta 30'un altında da kırpma
olabilir — bunu ölçmedim, emin değilim. Kırpma her durumda `omitted` ile açık yazılır.

## 3. Tasarım

### 3.1 Hassas küme (kod tarafı, niyet değil)

Bir cevap **hassas** sayılır ⇔ isteme giren kalemlerden en az biri sır kategorisindeyse (`wifi`, `checkin`) VE şu iki yapısal koşuldan biri:
(a) model o kategoriyi `usedSources`ta beyan etti ve kod doğruladı; (b) cevap metni o kalemin içeriğindeki bir değeri birebir içeriyor.
(b) bir anlam kararı değil, değer sızıntısı kontrolüdür (aynı karakter dizisi gidiyor mu); misafir metnine kalıp uygulanmaz.
Otopark / havuz / çöp sorusu bu kümeye girmez → yeni onay, yeni gecikme yok. (Bunu bir soru olarak da soruyorum — S2: (b) gerekli mi, yoksa yalnız
"sır kategorisi isteme girdi" yeterli mi.)

### 3.2 Kaynak-sürüm anlık görüntüsü (kayıt değil, bellek)

İstem kurulurken bellekte: `Snapshot = { reservationId, reservationPropertyId, conversationPropertyId, items: [{id, v: updatedAt, cat, active}] }`.
Tam küme bellekte; tavan yok, kırpma yok (Codex'in "eksiksiz" şartı burada karşılanır: kıyas eksiksiz kümede yapılır, yalnız SONUÇ kaydedilir).

### 3.3 Gönderim anı kıyası

Satır içi yolda talep (`automation.ts:4573`) iki parçaya ayrılır:
1. **Talebin kendisine eklenen şartlar** (atomik; mevcut `reservationLive` deseni): `propertyId = snapshot.conversationPropertyId`; rezervasyon
   `propertyId = snapshot.reservationPropertyId` ve konaklama bitmemiş; `autoReplyHoldUntil` boş ya da geçmiş; tetikten sonra ev sahibi giden mesajı
   yok (kuyruğun `newerHost` kuralının eşi).
2. **KB sürüm kıyası** (talep işleminin içinde, aynı bağlantıda tek `SELECT id, "updatedAt", "isActive", category FROM "KnowledgeBaseItem" WHERE id IN
   (...)`): hassas kalemlerden biri değişti / pasif / silindiyse sonuç `kb_changed_sensitive`; yalnız hassas olmayan kalem değiştiyse
   `kb_changed_other` (engel sebebi değil, yalnız sayılır).
Kuyruk yolunda aynı kıyas `replyVeto`ya eklenir; anlık görüntü kuyruk satırına girmek zorunda olduğu için orada küçük bir kayıt gerekir (§3.5).

Sonuç kodları (kapalı küme): `same` · `kb_changed_sensitive` · `kb_changed_other` · `property_moved` · `stay_ended` · `ai_paused` · `host_replied`.

### 3.4 Yeniden üretim kuralı (gölge sonrası, onaylanırsa)

- `kb_changed_sensitive` / `property_moved`: talep bırakılır (durum `new`), cevap gitmez; sonraki geçiş güncel bilgiyle modeli yeniden çağırır —
  bugünkü `SUPERSEDED_BY_NEWER_MESSAGE` davranışının aynısı (damgasız geçici atlama). Döngü olmasın diye aynı tetik mesajı için en çok **bir** yeniden
  üretim; ikinci kez değişirse konuşma ev sahibine kalır (`skippedReason` + panel metni).
- `stay_ended` / `ai_paused` / `host_replied`: tur başındaki kararla aynı (gönderim yok, aynı sebep kodu) — yeniden üretim yok.
- Hâlâ yetkili mi sorusu yeniden üretimde zaten tur başı kontrolleriyle cevaplanır (iptal, konaklama, sır kapsamı `kbForStayScope`).

### 3.5 Kaynak-sürüm kaydı (kanıt; kısa ve eksiksiz)

Yalnız hassas cevapta ve yalnız hassas kalemler için: `sv: [{id, v}]` (+ `rc` sonuç kodu). Hassas kalem sayısı küçüktür (bir dairede birkaç Wi-Fi /
giriş kalemi); 4.000 karakterlik kanıttan AYRI alan olarak tutulursa kırpılmaz. Yer seçenekleri:
- (A) migration'sız: `RiskEvent.kbEvidenceJson` içine `sv` + `rc`; kırpma sırasında `sv` korunur (kırpma yalnız `retrieved` listesinden düşer —
  bugünkü kod da öyle). Gölge için yeterli.
- (B) migration'lı: `RiskEvent` / kuyruk satırına ayrı nullable kolon `sourceVersionsJson`. Uygulama (engelleme) aşamasında kuyruk yolu için gerekli
  (işçi gönderim anında anlık görüntüyü satırdan okumalı). Kurucu onayı + manifest.
Ham misafir mesajı, kod değeri, kalem metni SAKLANMAZ (yalnız kimlik + zaman damgası + kod).

### 3.6 Sunucunun yerleştirdiği değerler (sonraki faz, öneri)

Bugün kapı kodu serbest metinde olduğundan model onu kopyalar. Uzun vadeli doğru yol:
1. KB kaleminde ev sahibinin işaretlediği **değer alanı** (ör. "Kapı kodu: `____`" kutusu; şifreli saklanır — `crypto-core` deseni).
2. İsteme değer yerine yer tutucu girer (`{kapi_kodu}`); model "Kapı kodumuz {kapi_kodu}" yazar.
3. Son kontrolden SONRA sunucu yer tutucuyu o anki değerle doldurur (otomatik mesajın `refreshLifecycleBody` emsali). Değer yoksa / kapsam dışıysa
   cevap gitmez, ev sahibine kalır.
Kazanç: eski kod hiç gidemez; değer modele hiç gitmez (sızma yüzeyi daralır). Bedel: KB ekranı değişir, istem + ölçüm (GOLDEN SET) değişir, migration.
Gölge sonuçları görülmeden önerilmez.

### 3.7 Gölge ölçüm dilimi

- Anahtar: `AI_SEND_RECHECK_SHADOW_ENABLED` (yalnız "1"; `AI_*` olduğu için `tests/eval/run-meta.ts` listesine; açılış belgesi).
- Ne yapar: §3.2 anlık görüntü + §3.3 kıyas; karar değiştirmez (gönderim aynen sürer). Arıza kaydı atlar, asla fırlatmaz (ev kuralı gölgesi deseni).
- Ne kaydeder: `RiskEvent.kbEvidenceJson` içinde `rc` (kod) + hassas cevapta `sv`. Ayrıca yalnız `rc ≠ same` iken `reportError` YOK (gürültü olmasın);
  sayım sorguyla okunur.
- Okuma sorgusu (örnek):
  ```sql
  SELECT "kbEvidenceJson"::jsonb->>'rc' AS rc, count(*)
  FROM "RiskEvent"
  WHERE "createdAt" > now() - interval '30 days' AND "kbEvidenceJson"::jsonb ? 'rc'
  GROUP BY 1 ORDER BY 2 DESC;
  ```
- Süre: 30 gün (ya da en az 1.000 otomatik cevap). Rapor: sebep başına sayı + "engellenseydi kaç cevap gecikirdi" + yeniden üretim tahmini maliyet.
- Kuyruk yolunda gölge yalnız (A) ile sınırlıdır: işçi anlık görüntüyü göremez → ilk gölge yalnız satır içi yol (üretim varsayılanı).

## 4. Riskler / emin olunmayanlar

- R1: `updatedAt` her düzenlemede değişir (yazım düzeltmesi dahil) → `kb_changed_sensitive` yanlış pozitif üretebilir; bedeli bir yeniden üretim.
  Gölge bunun sıklığını ölçer.
- R2: Ek SELECT talep işlemine bir sorgu ekler (kalem sayısı ≤ 30, birincil anahtarla). Ölçmedim; 11-20 ölçümüne göre selamlaşma 32 SQL —
  bir sorgu ihmal edilebilir sanıyorum, emin değilim.
- R3: Hassas tanımının (b) bacağı kısa değerlerde (ör. "1234") rastlantısal eşleşebilir; yalnız sır kategorisi isteme girdiyse bakıldığı için etki
  sınırlı. Kurucu S2.
- R4: Yeniden üretim sınırı (bir kez) aşılırsa konuşma ev sahibine kalır — misafir cevapsız bekleyebilir. Panel metni gerekli.
- R5: "Rezervasyon pending'e döndü" vakasında doğru davranışı bilmiyorum (tur başı da gönderiyor); bu tasarımın kapsamına almadım.
- R6: Konuşmanın başka daireye taşınması gerçekte hangi yolla olur (senkron mu, elle mi) incelemedim; sondada doğrudan veritabanı güncellemesiyle kurdum.

## 5. Dilim sırası

1. Saf çekirdek: `compareSnapshot(snapshot, current) → rc` + birim testleri (kırmızı-önce; her sebep için kaldırma mutasyonu; aşırı uygulama:
   hassas olmayan kalem değişince `kb_changed_other`, engel yok).
2. Gölge bağlantısı (satır içi yol, anahtar kapalı) + entegrasyon testi (bu belgedeki sonda tablosunun her satırı `rc` ile pinlenir; gönderim
   DEĞİŞMEZ — "misafire giden küme aynı" yayındaki kodla aynı testte ölçülür).
3. 30 gün gölge → rapor → kurucuya sonuç + önce / sonra.
4. (Onaylanırsa) Talebe atomik şartlar: önce kuyruktaki kuralların eşleri (AI durdurma, ev sahibi cevabı, konaklama bitti — S1), sonra
   `property_moved`, en son `kb_changed_sensitive` + bir kez yeniden üretim (S3).
5. (Ayrı faz, migration) Kuyruk yolu için `sourceVersionsJson` + işçide kıyas.
6. (Ayrı faz) Sunucunun yerleştirdiği değer alanı (§3.6) — S4.

## 6. Kurucuya sorular (önce / sonra örnekli)

**S1 — (11-25 güncellendi) Konaklama model düşünürken biterse satır içi yol da cevabı tutsun mu?** Bu sorunun ilk hâli üç kuralı soruyordu;
ikisi aynı gün kapandı ve soru olmaktan çıktı (`6f33a939`): model düşünürken otomatik cevabı kapatırsanız cevap gitmez; kanalın kendi
uygulamasından yazdığınız cevap o sırada içeri alınırsa AI'nın cevabı gitmez. (Lixus panelinden yazdığınız cevapta iki mesaj ZATEN oluşmuyordu —
ilk taslaktaki örnek yanlıştı, yukarıdaki "Ana oturum düzeltmesi" notu.) Kalan tek bacak:
- Önce: misafirin çıkışı bugün 11:00; 10:59:58'de "Çöpü nereye bırakayım?" yazar, model 5 saniye düşünür → cevap 11:00:03'te gider (bugün).
- Sonra (kuyruktaki kuralın eşi): konaklama o anda bitmiş sayılır, cevap gönderilmez, konuşma size kalır.
Saniyelik bir pencere; önerim DOKUNMAMAK (çıkış anındaki misafire cevap vermek zarar değil). Kuyrukla birebir eşitlik isterseniz eklenir.

**S2 — "Hassas" yalnız kaynağın türüyle mi belirlensin?** Öneri: Wi-Fi / giriş kategorisi isteme girdiyse VE (model o kategoriyi kaynak gösterdi YA DA
cevapta o kalemdeki değer birebir geçiyor).
- Örnek 1: "Otopark var mı?" → cevap otopark kaleminden → hassas değil → bugünkü gibi, ek kontrol yok.
- Örnek 2: "Kapı kodu ne?" → cevap giriş kaleminden "4590" → hassas → gönderim anında kalemin sürümü kıyaslanır.
"Değer birebir geçiyor" bacağı da olsun mu, yoksa yalnız model beyanı yeterli mi?

**S3 — Model düşünürken kapı kodu değişirse ne olsun?** (gölge sonucundan SONRA uygulanır)
- Önce: misafir "Kapı kodu ne?" yazar; tam o sırada kodu 4590'dan 7731'e değiştirirsiniz → misafire "Kapı kodumuz 4590" gider.
- Sonra: o cevap gönderilmez; birkaç saniye içinde yeni kodla yeniden yazılır → misafire "Kapı kodumuz 7731" gider. Kod ikinci kez de değişirse
  konuşma size kalır, panelde "Bilgi cevap yazılırken değişti — lütfen kontrol edip yanıtlayın" görünür.
Böyle yapalım mı?

**S4 — Uzun vadede kapı kodu / Wi-Fi şifresi ayrı bir alanda dursun ve cevaba sunucu yerleştirsin mi?** (ayrı faz, migration)
- Önce: bilgi tabanında "Giriş: anahtar kutusu kodu 4590" serbest metin; model kodu kopyalar.
- Sonra: kalemde "Kod" kutusu; model "Anahtar kutusu kodumuz {kod}" yazar, gönderimden hemen önce sistem o anki kodu koyar.
Bunun için bilgi tabanı ekranı değişir. Önce gölge sonuçlarını görmek ister misiniz?

**S5 — Gölge ölçüm 30 gün mü?** Canlı kapalı olduğu için (Railway) ölçüm ancak açılıştan sonra başlar; öneri: açılışla birlikte anahtar açılsın, 30 gün
sonra rapor.
