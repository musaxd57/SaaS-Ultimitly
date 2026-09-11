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

1. **Değer ölçümü:** prod'da (ya da Nuve verisinde) host'un elle cevapladığı mesajların kaçı
   TEKRAR EDEN sorudur? Tekrar oranı düşükse özelliğin değeri de düşüktür — "olsa iyi olur" ile
   "ölçülen kazanç" ayrı şeyler.
2. **Bayatlık ölçümü:** geçmiş cevapların kaçı bugünkü mülk ayarlarıyla ÇELİŞİYOR? Bu sayı, 1.
   kuralın ne kadar sert olması gerektiğini söyler.
3. **Sözcüksel yeterlilik:** aynı ölçek harness'ıyla (`kb-retrieval-scale`) geçmiş-cevap havuzunda
   hit@1 / inPrompt ölç. Sözcüksel yeterliyse embedding hiç gündeme gelmez.

## Sıra (öneri)

Bu özellik **hibrit retrieval bayrağından SONRA** gelir. Gerekçe: aynı seçiciyi kullanıyor ve o
seçici henüz canlıda ölçülmedi. Önce `KB_RETRIEVAL_MODE=hybrid` gerçek eval + tek mülk pilotu,
sonra bu.

## Karar

- [ ] Ölçüm planı koşulsun (1–3), sonra karar
- [ ] Doğrudan sözcüksel sürüm (embedding'siz) yazılsın
- [ ] Ertelensin
