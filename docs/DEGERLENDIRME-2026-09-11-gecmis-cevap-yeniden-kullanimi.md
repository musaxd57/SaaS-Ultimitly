# DEĞERLENDİRME — geçmiş cevapların yeniden kullanımı (kurucu fikri, 09-11) — UYGULANMADI

> Durum: **fikir + tasarım notu**, kod DEĞİŞİKLİĞİ YOK. Kaynak: kurucu 09-11 —
> *"soru geldi, o hostun hesabından önceki gelen sorulara verilen yanıtlara ve uyuştuğu şeye göre
> anlaşılıp hem çok vakit kaybetmeden hem de en iyi cevabı vermesini sağlamaz mı?"*

## Fikir DOĞRU ve bugün tasarımda YOK

Bugün modele giden bilgi **yalnız** şunlardır: onaylı KB kalemleri (`selectKbForPrompt`), mülk kimlik
alanları, rezervasyon, ve konuşma geçmişi penceresi. **Host'un daha önce verdiği cevaplar hiçbir
yerde bilgi kaynağı DEĞİL.** Yani host aynı soruyu 40 kez elle cevapladıysa ürün bundan hiçbir şey
öğrenmiyor.

🚨 **Bu, "embedding" ile AYNI ŞEY DEĞİL.** İki ayrı özellik sürekli karıştırılıyor:

| | Ne yapar | Bugün | Gerektirdiği |
|---|---|---|---|
| **(a) Anlamsal KB araması** | KB kalemlerini vektöre çevirip soruyla eşler | YOK (`SemanticScorer` sözleşme + no-op, pinli) | ücretli servis + KVKK |
| **(b) Geçmiş cevap yeniden kullanımı** | Host'un ONAYLADIĞI geçmiş cevabı aday kaynak yapar | YOK (tasarımda bile yok) | ↓ üç kural |

## 🚨 (b) için EMBEDDING ŞART DEĞİL

`src/lib/ai/retrieval/` zaten **sağlayıcısız, DB'siz, deterministik** bir seçici: Türkçe-öncelikli
BM25 (kök sökücü + ünsüz yumuşaması + ~45 kavramlık sözlük + yazım toleransı) + karakter 3-gram +
CombSUM birleşim + rerank. Girdisi `{id, title, content, updatedAt, category}` şeklinde bir listedir.

Geçmiş bir host cevabı **tam olarak o biçime sokulabilir** (`title` = misafirin sorusu, `content` =
host'un cevabı). Yani (b)'nin ilk sürümü **ücretsiz, KVKK'sız ve mevcut kodla** yapılabilir.
Embedding ancak sözcüksel eşleşmenin kaçırdığı ölçülmüş vakalarda gündeme gelir.

## Üç ZORUNLU kural (bunlarsız açılmaz)

### 1. BAYATLIK — geçmiş cevap bir GERÇEK DEĞİL, bir GÖZLEMDİR

Host Mart'ta "çıkış 11:00" yazdı, Mayıs'ta mülk ayarını 12:00 yaptı. Geçmiş cevap hâlâ 11:00 diyor.
KB kalemleri için sürüm (`supersededById`) ve alan-bazlı çelişki koruması VAR; geçmiş cevaplar için
**yok**. Kural: geçmiş cevap, **canlı bir alanla (giriş/çıkış saati, fiyat, müsaitlik) çelişiyorsa
DÜŞER** — `extractFieldTimes` makinesi bunun için zaten yazılı.

🚨 Daha sert bir kural gerekebilir: geçmiş cevap **canlı gerçek iddia edemez** (saat/fiyat/kod),
yalnız operasyonel/yönlendirici bilgi taşır ("çöp konteyneri yan sokakta"). Karar kurucunun.

### 2. YANLIŞ CEVABIN ÇOĞALMASI — kaynak KALİTESİ filtresi şart

Bir kez yanlış cevap verildiyse, benzer her soruda tekrarlanır ve hata **sistematik** hâle gelir.
Aday havuzuna yalnız şunlar girebilir:
- host'un KENDİ yazdığı ya da **açıkça onayladığı** cevaplar (AI taslağı otomatik girmez),
- `RiskEvent`te devir/şikâyet ile sonuçlanmamış konuşmalardan gelenler,
- misafirin ardından ŞİKÂYET etmediği cevaplar.

Bu, A1'in KB onay sözleşmesinin (`reviewState`) aynısıdır: **kaynağını beyan etmeyen satır kaynak
değildir.**

### 3. KVKK — geçmiş misafir mesajı MİSAFİR VERİSİDİR

- Aday havuzuna giren metin host'un CEVABIDIR, misafirin sorusu DEĞİL — soru yalnız eşleştirme
  anahtarı olarak kullanılacaksa **PII'siz normalize edilmiş** biçimi saklanmalı.
- Cevap metni başka bir misafirin adını/kodunu taşıyorsa **mevcut sır kapısı** (`withoutSecretKbItems`)
  ve ad redaksiyonu bu yola da uygulanmalı — aynı kapı, yeni yüzey.
- `DATA_RETENTION_MONTHS` purge'ü bu havuzu da kapsamalı; erasure tombstone'u burayı da silmeli.
- Embedding'e geçilirse: misafir metni dış API'ye gider → alt-işleyen listesi + gizlilik metni
  güncellemesi ŞART (bugünkü gölge katmanının aynı gerekçesi).

## Ölçüm planı (uygulanmadan ÖNCE)

1. **Değer ölçümü:** prod'da (ya da Lale verisinde) host'un elle cevapladığı mesajların kaçı
   TEKRAR EDEN sorudur? Tekrar oranı düşükse özelliğin değeri de düşüktür — "olsa iyi olur" ile
   "ölçülen kazanç" ayrı şeyler.
2. **Bayatlık ölçümü:** geçmiş cevapların kaçı bugünkü mülk ayarlarıyla ÇELİŞİYOR? Bu sayı, 1.
   kuralın ne kadar sert olması gerektiğini söyler.
3. **Sözcüksel yeterlilik:** aynı ölçek harness'ıyla (`kb-retrieval-scale`) geçmiş-cevap havuzunda
   hit@1 / inPrompt ölç. Sözcüksel yeterliyse embedding hiç gündeme gelmez.

## 🚨 KURUCU FİKRİ NETLEŞTİ (09-11, ikinci mesaj) — ÇOK DAHA İYİ BİR ÇERÇEVE

Kurucunun tam tarifi: *"AI'mız Airbnb/Vrbo/Booking'e bağlandığında hostların mesajlarını okusun,
konuşma tarzını, soruları, cevapları kendine kaydetsin; gerekirse buradan kendine KB çıkarsın,
**fazla emin olmadan**. Böylece adamların KB yazmasıyla çok uğraştırmayız. Bayatlık olmasın diye
çok emin olmasın — ama mesela otomatik şablon önerirken onları kullanabilir."*

Bu, "cevabı doğrudan tekrar kullan"dan **ÇOK DAHA İYİ** bir çerçevedir, çünkü çıktı doğrudan
misafire gitmez; **KB'ye ÖNERİ olarak** girer ve host onayından geçer. Üç riskin üçü de
kendiliğinden çözülür.

### Mimari ZATEN HAZIR — eksik olan tek şey KAYNAK

| Parça | Durum | Yer |
|---|---|---|
| `KnowledgeBaseItem.source` = `extracted_draft` | **ŞEMADA VAR** (migration 53 canlı) | A1 |
| `reviewState` = `draft` / `approved` | **VAR** | A1 |
| Erişim ALLOWLIST'i: yalnız `legacy` + `approved` | **VAR, TEK KAPI** | `src/lib/kb-review.ts` |
| Saf / LLM'siz çıkarım + kaydetmeden önizleme | **VAR** | `src/lib/kb-extract.ts` (A5) |
| "Şablonla doldur" önerisi | **VAR** | A4, `kb-manager.tsx` |
| Eksik bilgi analizi (üç sınıf) | **VAR** | `modules/intelligence/recommendations/kb-gaps.ts` (A3) |

🚨 **"Fazla emin olmasın" şartı KODDA UYGULANIYOR:** `draft` bir kalem modele ULAŞAMAZ —
`kb-fetch` filtresi `AND`'lenir ve çağıran EZEMEZ; `count` bile aynı filtreyi kullanır, yani
taslak "yer sınırından düştü" diye bile SAYILMAZ. Host onaylayana kadar yalnız öneridir.

**Eksik olan TEK ŞEY:** `kb-extract` çıkarıcısını *yapıştırılan belge* yerine *mesaj geçmişinden*
beslemek. Dar, additive ve mevcut onay sözleşmesinin İÇİNDE kalan bir dilim.

### Bu çerçevede üç risk ne oluyor

| Risk (↑ yukarıda) | Doğrudan cevap kullanımında | KB ÖNERİSİ çerçevesinde |
|---|---|---|
| Bayatlık | Ciddi (eski saat misafire gider) | **Host onay anında görür ve düzeltir** |
| Yanlış cevabın çoğalması | Ciddi (sistematik hata) | **Onaysız kalem modele ulaşmaz** |
| KVKK | Misafir metni dış API'ye | Çıkarım LLM'siz ve TARAYICIDA yapılabilir (A5 emsali) → **dış API YOK** |

### Kalan gerçek işler (dar)

1. **Kaynak bacağı:** kanal mesajlarından host'un KENDİ cevaplarını toplama (misafir metni değil).
   Provenance zaten var (`Message.connectionId`), `senderName`/`direction` ayrımı zaten var.
2. **Tekrar eden soru tespiti:** aynı hostta benzer sorular. Sözcüksel seçici bunu YAPAR
   (embedding şart değil); ölçüm planı ↑.
3. **Stil profili:** zaten var (`scrubStyleProfileForPublic`, 4 yüzeyde süzülüyor) — mesaj
   geçmişinden beslemek ayrı, küçük bir iş.
4. **PII:** çıkarılan taslak başka misafirin adını/kodunu taşıyabilir → mevcut sır kapısı +
   ad redaksiyonu bu yola da uygulanır (aynı kapı, yeni yüzey).

## EMBEDDING — itirazlardan biri DÜŞTÜ (09-11)

| Gerekçe | Durum |
|---|---|
| Ücretli servis → kurucu onayı | ✅ anahtar verildi |
| 🚨 KVKK: YENİ alt-işleyen | ❌ **GEÇERSİZ** — varsayılan endpoint zaten OpenAI (yanıt üretimi ve gölge katmanı da orada), yani embedding YENİ bir işleyen AÇMAZ; gizlilik metnine satır gerekmez |
| Ölçüm: gerçekten gerekli mi | ⏳ AÇIK — sözcüksel zaten %99–100; kalan **beş somut vaka** var |

Yani embedding tek bir soruya indi: **o beş vakayı çözüyor mu?** (rehber parçasının uzunluk
normunda kısa kaleme yenilmesi · `fire→fır` diller arası kök çarpışması · TV/kumanda sözcüksel
beraberliği · taksi↔araç · doorman etiketi). Cevap evetse eklenir — "genel olarak daha iyi olur"
gerekçesiyle DEĞİL.

## Sıra (öneri)

1. **Hibrit eval** (ücretsiz kazanç, ölçülen %51 → %99) — koşuyu kurucu yapar
2. **Model kıyası** `gpt-5.1` vs `gpt-5.6-luna` (6 kat maliyet farkı)
3. **Embedding'i KALAN BEŞ VAKADA ölç** (yeni alt-işleyen yok, yalnız ölçüm kapısı)
4. **Mesaj geçmişinden `extracted_draft` KB çıkarımı** (bu belge)

Bu özellik hibrit bayrağından SONRA gelir: aynı seçiciyi kullanıyor ve o seçici henüz canlıda
ölçülmedi.

## Karar

- [ ] Ölçüm planı koşulsun (1–3), sonra karar
- [ ] Doğrudan sözcüksel sürüm (embedding'siz) yazılsın
- [ ] Ertelensin
