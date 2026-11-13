# TASARIM 2026-11-13 gece — Taslak ↔ ev sahibinin gönderdiği metin bağı (embedding + gerçek metin farkı + öğrenme)

> Kurucu 11-13 gece: "Taslakla hostun gönderdiği metin arasındaki bağ kesinlikle en iyi şekilde embedding yapılarak asıl metin farkı incelenerek
> dahi tutulsun, buraya ML ekle. Migration onayın var." Bu bağ özerklik akışının (`docs/TASARIM-2026-11-13-ozerklik-akisi-ve-deger-satiri.md`
> Ö1) temelidir: "değiştirmeden onayladı" ölçülmeden yerinde devir teklifi, geri çekilme ve düzeltmeden öğrenme kurulamaz.
> **Gölge kayıt:** ev sahibine ve misafire hiçbir şey göstermez / göndermez; gönderimi ASLA engellemez ya da geciktirmez.

## 1. Bugün ne var (kodda doğrulandı)
- Ev sahibinin gördüğü taslak **misafir mesajının satırında** durur: `Message.aiSuggestedReply` (ev sahibinin ağzına çevrilmiş metin). "AI öner"
  (`api/conversations/[id]/ai-suggest/route.ts`, yalnız model cevap verdiyse yazar) ve otomasyonun hazır taslağı (`automation.ts`) aynı alana
  yazar; sayfa açılınca `preparedDraftOf` (`conversation-items/prepared-draft.ts`) yalnız EN SON gerçek mesaj misafirinse onu gösterir.
- Gönderim `api/conversations/[id]/reply` → `host-send.ts`. Gövde: `body · requestId · anchorMessageId? · aiAssisted`. **Taslak kimliği yok.**
- `aiAssisted` istemci beyanıdır ve yalnız "Onayla ve gönder"de `true`; **"Taslağı kullan" → düzenle → Gönder** yolu `aiAssisted: false` gider
  (`conversation-thread.tsx` `sendReply(composer)`) → "taslağı düzeltip gönderdi" ile "baştan yazdı" bugün ayırt EDİLEMİYOR.
- `AiGeneration.draftText` ham model metni (ev sahibinin gördüğü değil), anahtarı varsayılan kapalı, "AI öner" yolu hiç yazmıyor.
- Embedding altyapısı: `embedTexts` (önbellek, kalıcı arızada geçiş tabanlı alarm, anahtarsızken sessiz `null`), `cosineOfUnit`, vektör bayt
  kodlaması `encodeVector/decodeVector` (pgvector yok, `KbChunkVector` deseni). OpenAI kredisi bugün yok → embedding adımı ERTELENEBİLİR olmalı.

## 2. Karar: bağ SUNUCUDA, taslağın durduğu mesajla gönderilen metin karşılaştırılarak kurulur
Ev sahibi bir cevap gönderdiğinde (yalnız teslim / kuyruk kaydı başarılıysa) sunucu, gönderimden ÖNCEKİ son gerçek mesaja bakar: misafirinse ve
üzerinde taslak varsa ("hazır taslak" kuralının aynısı) bağ kurulur. İstemci yalnız İPUCU verir (`draftUse: "approved" | "seeded"`):
| Bağ türü | Ne zaman | Anlamı |
|---|---|---|
| `approved` | "Onayla ve gönder" | taslak olduğu gibi onaylandı (metin eşitliği yine ÖLÇÜLÜR — istemciye güvenilmez) |
| `seeded` | "Taslağı kullan" ile alan dolduruldu, sonra gönderildi | taslaktan başlandı; ne kadar değiştiği ölçülür |
| `implicit` | ipucu yok ama taslak vardı | ev sahibi taslağı kullanmadan yazdı (çoğu zaman "baştan yazdı"; benzerlik yine ölçülür — elle aynısını yazan da görülür) |
Taslak başına TEK bağ (`anchorMessageId` tekil): turdaki ilk gönderim taslağa bağlanır; aynı turda ikinci mesaj bağlanmaz (bilinen sınır, §8).
Gönderilen mesaj başına tek bağ (`sentMessageId` tekil) → aynı `requestId` ile yeniden deneme ikinci satır yazmaz.

## 3. Ölçümler (ham sayılar saklanır; sınıf onlardan türetilir ve sürümlenir)
**A. Gerçek metin farkı (anında, kodla, deterministik, ağsız):**
- Normalleştirme: Unicode NFKC, görünmez karakterler atılır, Türkçe küçük harf, boşluklar teke iner. Belirteçler `\p{L}\p{N}` dizileri + değer
  belirteçleri (saat `14:00`, sayı, tutar, telefon, bağlantı) — doğrusal tarama; misafir metninde karesel kalıp YOK (CLAUDE.md ReDoS kuralı).
- Belirteç düzeyinde en uzun ortak alt dizi (LCS) → `lexicalSim = 2·LCS / (|taslak| + |gönderilen|)`, `tokensAdded`, `tokensRemoved`, eklenen ve
  çıkarılan **parçalar** (ardışık belirteç dizileri). Girdi tavanı (belirteç başına 600) → iş sınırlı; süre pini.
- **Değer değişimi** (`valueChanged`): taslaktaki saat / tarih / sayı / tutar / telefon / bağlantı kümesi gönderilende yoksa ya da farklıysa →
  "ev sahibi bir OLGUYU düzeltti" (modelin en tehlikeli hatası; geri çekilmenin en güçlü sinyali).
- **Cümle silme**: taslağın bir cümlesinin belirteçleri gönderilende %30'dan az geçiyorsa → `removed_sentence` (ör. ev sahibi bir sözü sildi).
- **Bilgi ekleme**: gönderilende ≥3 içerik belirteçli yeni ardışık parça → `added_info`.
**B. Anlam benzerliği (embedding, ERTELENEBİLİR):** taslak ve gönderilen metnin vektörleri → kosinüs `semanticSim`. Zamanlanmış senkronun
sonunda bütçeli bir geçiş (anahtar `REPLY_DRAFT_EMBEDDING_ENABLED`); anahtar / kredi yoksa satır `pending` kalır, gönderim etkilenmez; kalıcı
arıza 5 denemeden sonra `failed`. `NULL` = ölçülmedi (0 DEĞİL — A2 kuralı).
**C. Sınıf (`classifierVersion` 1):**
| Sonuç | Kural (özet) |
|---|---|
| `unchanged` | normalleştirilmiş metinler eşit |
| `minor_edit` | `lexicalSim ≥ 0,85`, değer değişmedi, cümle silinmedi, ≥6 belirteçlik ekleme yok; anlam ölçüldüyse `semanticSim ≥ 0,90` |
| `rewritten` | `lexicalSim < 0,35` ve (anlam ölçüldüyse) `semanticSim < 0,80` — ev sahibi başka bir şey yazdı |
| `major_edit` | geri kalan her şey (değer değişimi her zaman en az `major_edit`) |
"Temiz onay" (özerklik teklifi için) = `unchanged` ya da (`minor_edit` ve düzeltme türleri yalnız üslup). Eşikler ilk gerçek veriyle kalibre
edilir; ham sayılar saklandığı için eşik değişince geçmiş YENİDEN SINIFLANDIRILIR (sürüm artar), yeniden ölçüm gerekmez.

## 4. Öğrenme (ML) katmanları
1. **Anlam farkı ölçümü** (B): kelimesi değişip anlamı aynı kalan düzeltmeyi ("Wifi şifremiz" → "Kablosuz ağ şifremiz") üslup sayar; kelimesi
   çok benzeyip anlamı değişeni ("girişe uygun" → "girişe uygun değil") büyük düzeltme sayar — ikisini birlikte okumak tek başına ikisinden
   de doğru.
2. **Tekrar eden ekleme madenciliği** (düzeltmeden öğrenme, özerklik belgesi An 4): eklenen parçalar (`ReplyDraftSpan`) vektörleriyle saklanır;
   aynı dairede son 30 günde, en az 3 farklı konuşmada anlamca aynı ekleme (kosinüs ≥ 0,86; vektör yoksa belirteç Jaccard ≥ 0,6) → "bilgi tabanı
   adayı". Saf, deterministik açgözlü kümeleme; ilk sürümde YALNIZ hesaplanır (ekran yok); gizli değer (kapı kodu, Wi-Fi şifresi, telefon) aday
   OLMAZ (sır süzgeci).
3. **Konu başına kabul istatistiği**: niyet (`Message.aiIntent`) başına son 14 günde karar sayısı ve temiz onay oranı — eylem önerilerinin
   `promotionReadiness` ölçütüyle AYNI eşik (14 gün · ≥10 · ≥%90). Yerinde devir teklifinin (Ö5) tek veri kaynağı.
4. **Platform sayıları**: niyet × sonuç sayımı, işletmeler arası yalnız SAYI; en az N işletme (varsayılan 5) yoksa hiçbir şey dönmez. Metin,
   vektör, kişi işletme dışına çıkmaz.
5. **İleride (veri birikince):** temiz onayı önceden kestiren hafif bir sınıflandırıcı (özellikler: niyet, kapı kanıtı, getirme puanları, taslak
   uzunluğu…). Yalnız TEKLİF SIRASI / önceliği için; kapı DEĞİL (CLAUDE.md: modelin "eminim"i kanıt değildir). Bugün veri yok → yazılmaz.

## 5. Veri modeli (migration — kurucu onayı 11-13)
- `ReplyDraftLink`: işletme · konuşma (FK, Cascade) · `anchorMessageId` (TEKİL; düz kimlik) · `sentMessageId` (TEKİL; düz kimlik) · `linkKind` ·
  `intent` · `draftEnc` (AAD'li şifreli taslak — ev sahibinin gördüğü metin; gönderilen metin zaten `Message.body`'de) · `draftHash` · ölçümler
  (`lexicalSim`, `tokensAdded`, `tokensRemoved`, `valueChanged`, `editKindsJson`, `diffEnc` — şifreli eklenen / çıkarılan parçalar, `semanticSim`,
  `embeddingModel`, `embeddingState`, `embeddingAttempts`) · `outcome` · `classifierVersion` · zaman damgaları.
- `ReplyDraftSpan`: bağ (FK, Cascade) · işletme · daire · konuşma · `textEnc` (şifreli, sır maskeli) · `contentTokens` · `hasSecret` · vektör (`Bytes`, Float32) · `dims` ·
  `embeddingModel` · oluşturma zamanı.
- Yeni tablo + index; dolu tabloya `@unique` / zorunlu alan EKLENMEZ (boot güvenliği).

## 6. Güvenlik / KVKK
- Metinler şifreli (`encryptSecretBound`, AAD = tablo + satır kimliği + işletme); düz metin taşıyan kolon yok.
- **Saklama ve silme kapsamında:** `anonymizeOldGuestData` / misafir silmesi `draftEnc`, `diffEnc` boşaltır ve parçaları (metin + vektör) SİLER;
  vektör de metinden türediği için kişisel veri sayılır. Kapsam pini (`scrub-scope-parity`) ve konuşma tekilleştirme envanteri
  (`HANDLED_REFERENCES`) yeni modeli bilerek listeler.
- Sır süzgeci: değer gibi görünen gizli bilgi (kapı kodu / şifre) tekrar eden ekleme adayı olamaz; ölçüm satırı dışarı (log, alarm) metin taşımaz.
- Gönderimle yarışmaz: bağ yazımı gönderim BAŞARILI olduktan sonra, kendi try/catch'iyle; hatası yalnız raporlanır.

## 7. Anahtarlar
- `REPLY_DRAFT_LINK_ENABLED` (kayıt) · `REPLY_DRAFT_EMBEDDING_ENABLED` (anlam ölçümü + parça vektörleri). İkisi de varsayılan KAPALI doğar; Railway
  açılış belgesinde "açılışta AÇ (kurucu 11-13 istedi)" diye listelenir. Kapalıyken hiçbir satır yazılmaz, hiçbir ağ çağrısı yapılmaz.

## 8. Bilinen sınırlar (ilk sürüm)
- Aynı turda ikinci mesaj bağlanmaz (taslak başına tek bağ). · Taslak gösterilip hiç cevap yazılmayan konuşma ("gönderilmedi") ilk sürümde
  sayılmaz. · Karar kartı (erken giriş / geç çıkış) ve WhatsApp ev sahibi cevabı kapsam dışı. · "Taslağı kullan"dan sonra taslak yeniden
  üretildiyse karşılaştırma son taslakla yapılır.

## 9. Uygulama + Haiku incelemesi (11-13 gece)
Kod: `src/lib/reply-draft/{core,service,flag}.ts`, migration 96, gönderim rotası (`api/conversations/[id]/reply`), istemci ipucu
(`conversation-thread.tsx` `composerSource`), saatlik ertelenmiş ölçüm (`scheduled-sync.ts`), saklama / misafir silmesi / iki konuşma birleştirme
yolu, okuyucu kapalı listesi (`tests/unit/reply-draft-readers.test.ts`). Haiku dar incelemesi 7 bulgu + 6 "emin değilim"; hepsi kodda doğrulandı:
| # | Bulgu | Hüküm | Ne yapıldı |
|---|---|---|---|
| B1 | Harf + rakam karışık değer ("lale2024" → "lale2025": Wi-Fi şifresi / kapı kodu) değer sayılmıyor → "temiz onay" | doğru | rakam taşıyan her belirteç değer (kırmızı-önce) |
| B2 | Kuyruğa girip misafire ulaşmayan gönderimin bağı taslağı kilitliyor; ev sahibinin sonraki gerçek cevabı bağlanamıyordu | doğru | önceki bağ ulaşmamış gönderime aitse silinir, yeni gönderim yerini alır; ulaşmış olan korunur (iki test) |
| B3 | Kesilmiş fark (600+ belirteç) "küçük düzeltme" olabiliyordu | doğru | kesilmiş fark asla `minor_edit` değil |
| B4 | Madencilik pencerenin EN ESKİ 2000 parçasını okuyordu | doğru | en yeni 2000 |
| B5 | Saklama yaşı bağın yazıldığı andan (gönderim) sayılıyor, misafir mesajından değil | doğru, etkisi cevap gecikmesi kadar | yorum gerçeğe uyduruldu (bilinen sınır) |
| B6 | "code" ipucu o gönderimin bağını atlar; ipucu istemci beyanı | doğru | doğrulayıcı yorumu düzeltildi (işletme yalnız kendi ölçüsünü etkiler) |
| B7 | "Taslağı kullan"dan sonra metin baştan yazılırsa ipucu "seeded" kalabilir | doğru, yalnız etiket | bilinen sınır — benzerlik sunucuda ölçüldüğü için sınıf doğru kalır |
| E5 | Kümenin temsilcisi tüm üyeler arasında ikili kıyasla seçiliyordu (küme boyunun karesi) | doğru | en yeni 50 üye arasından |
| E3 | Saatlik iş hatayı yutuyor mu | doğru bulundu (alarmlı, geçişi düşürmez) | — |

