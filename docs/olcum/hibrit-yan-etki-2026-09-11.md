# ÖLÇÜM — `KB_RETRIEVAL_MODE=hybrid` yan etkileri (kurucu isteği, 2026-09-11)

> Kurucu: *"hibritin gelmesinin yan etkilerini ölç ve embeddingde yapalım iyi olucaksa."*
>
> Ortam: **model YOK** (`OPENAI_API_KEY` yok), **DB YOK**, **vitest YOK** — retrieval katmanı saf
> olduğu için `npx tsx` ile doğrudan ölçüldü. Gerçek modüller: `packKnowledgeBase` ·
> `selectKbForPrompt` · `index-cache` · `kb-fetch` aynası. Korpus: mevcut sentetik harness (seed 42)
> + 13 sınıflık baseline.

## ÖZET KARAR

**Ürünün izin verdiği KB boyutlarında (plan tavanı 60 kalem/mülk) açmak GÜVENLİ ve maliyet küçük.**
Ama ölçülen İKİ yan etki var ve ikincisi bir POLİTİKA kararıdır, sonradan keşfedilmemeli.

## 1) İstem bloğu boyutu — bilgi sorularında hibrit çok daha ucuz

| kalem | legacy (soru-bağımsız) | hibrit ort. | oran |
|---|---|---|---|
| 30 | 4.371 | **398** | %9 |
| 100 | 4.513 | **685** | %15 |
| 300 | 2.925 | **941** | %32 |

Legacy'nin bloğu **soruya bakmaz** (ort.=medyan=p95=maks, tek değer). Gerçek ürün ölçeğinde
(60 kalem tavanı): legacy 4.508 · hibrit bilgi sorusu ort. **493**.

## 2) Gecikme — ihmal edilebilir

| kalem | soğuk önbellek | sıcak | legacy |
|---|---|---|---|
| 30 | 9,3 ms | 1,4 ms | ~0 |
| 60 (ürün tavanı) | **15,0 ms** (p95 18,0) | **1,8 ms** (p95 4,1) | ~0 |
| 300 | 41,0 ms | 2,6 ms | ~0 |

Önbellek süreç başına, LRU 64, TTL 10 dk, anahtar **içerik parmak izi** → her deploy'da, her
replikada, her KB düzenlemesinde soğur. Saniyelerle ölçülen bir OpenAI çağrısının yanında +15 ms
gürültüdür.

## 3) 🚨 Hibrit legacy'den AZ bilgi taşıyor mu? — HAYIR (ölçüldü)

Dört geri çekilme dalının **dördü de çalışıyor** (`small_kb` · `empty_query` · `no_lexical_hits` ·
`error`; `error` dalına ulaşmak için imkânsız bir satır enjekte etmek gerekti — Prisma'da `content`
NOT NULL).

**Gerileme taraması** (ölçüt: cevap için gereken CÜMLE blokta mı):

| kalem | soru | legacy isabet | hibrit isabet | **GERİLEME** | kazanç |
|---|---|---|---|---|---|
| 30 | 153 | 138 | 153 | **0** | 15 |
| 100 | 193 | 98 | 192 | **0** | 94 |
| 300 | 193 | 115 | 193 | **0** | 78 |

Baseline korpusu (13 sınıf): **0 gerileme**, üstelik legacy'nin kaçırdığı `long_middle_oldest`
hibritte geliyor. Tam süpürme n=5…120, **19.583 soru×boyut çifti → 21 gerileme (%0,11)** ve
**hepsi AYNI soru**: `doorman_syn` — CLAUDE.md'de zaten "etiketi tartışmalı" diye kayıtlı
(hibritin seçtiği kargo kalemi soruyu ZATEN cevaplıyor). **Hibritin gereken cümleyi düşürüp yerine
eşdeğer bir şey koymadığı TEK bir vaka bulunamadı.**

## 4) 🚨 YAN ETKİ-1: geri çekilme dalı TÜM kümeyi gönderiyor

Bu, hibritin legacy'den **DAHA ÇOK** gönderdiği ölçülen TEK yer:

| kalem | legacy blok | hibrit geri çekilme bloğu ("Merhaba") | **oran** |
|---|---|---|---|
| 30 | 4.371 (30 kalem) | 4.551 (34) | 1,04× |
| 60 (ürün tavanı) | 4.508 (30) | 7.610 (67) | **1,69×** |
| 100 | 4.513 (30) | 13.531 (112) | **3,00×** |
| 300 | 2.925 (30) | 22.148 (200) | **7,57×** |

Ve bu dal NADİR DEĞİL: 25 mesajlık gerçekçi kısa-mesaj bataryasında **18'i (%72)** geri çekilmeye
düşüyor (`empty_query` 10 · `no_lexical_hits` 8). Dört üretim yüzeyi de ham misafir mesajını
geçiriyor, yani "Merhaba" yazan misafir doğrudan bu yola giriyor.

Karışım varsayımıyla maliyet (gerçek trafik karışımı ÖLÇÜLEMEZ):

| kalem | %0 sosyal | %10 | %25 | %40 |
|---|---|---|---|---|
| 30 | 0,09× | 0,19× | 0,33× | 0,47× |
| 100 | 0,15× | 0,44× | 0,86× | **1,29×** |
| 300 | 0,32× | 1,05× | **2,13×** | **3,22×** |

→ **≤60 kalemde hibrit her karışımda ucuz. ~100 kalemin üstünde, sosyal trafik %25'i geçince
pahalıya dönüyor.**

## 5) 🚨 YAN ETKİ-2: erişim deltası KISMİ DEĞİL, TAM

| kalem | legacy erişilebilir | hibrit havuzu | **yeni erişilebilir** | **ölçülen: bloğa giren** |
|---|---|---|---|---|
| 30 | 30 | 34 | 4 | **4** |
| 60 | 30 | 67 | 37 | **37** |
| 100 | 30 | 112 | 82 | **82** |
| 300 | 30 | 200 | 170 | **170** |

Teorik = ölçülen: **hibritin çekebildiği her kalem, bir soruda gerçekten modele ulaşıyor.** Yani
legacy'nin "en yeni 30" penceresinin kalıcı olarak ERİŞİLMEZ tuttuğu bayat/kötü niyetli bir kalem,
bayrak açılır açılmaz erişilebilir hâle geliyor — ve herhangi bir selamlaşmada **hepsi birden** tek
blokta gidiyor.

⚠️ Bu bir BUG DEĞİL, politika kararıdır (`select.ts` zaten "retrieval politika DEĞİLDİR" diyor) —
ama "hibritin yan etkisi nedir" sorusunun somut cevabı budur.

## 6) DB maliyeti — AYNI sorgu sayısı, büyük `take`

`kb-fetch.ts` iki modda da **AYNI iki sorguyu** atıyor (tek `Promise.all` içinde bir `findMany` +
bir `groupBy`); `groupBy` bacağı bayt bayt aynı. Tek fark `take: 30 → 200`. Ek maliyet **satır
yükü**, gidiş-dönüş değil. Ürün tavanında (60 kalem × 20k karakter) gerçek üst sınır ≈ 1,2 MB.

## 7) Çelişki koruması

Sentetik korpusta (539 soru) **hiç tetiklenmedi** (`conf=0`) — korpusta aynı alanda çelişen saat
yok. Hedefli kurulumda (20 farklı çıkış saati) tetikleniyor ve fark çarpıcı:
- **hibrit:** 20'nin 11'ini taşıyor **ama modele "kesin saat SÖYLEME, insana devret" notunu veriyor**
- **legacy:** 20'nin 20'sini **sessizce** bloğa koyuyor, seçimi modele bırakıyor

→ Çelişkide hibrit **daha az metin, daha çok güvenlik** gönderiyor.

## 8) BU ORTAMDA ÖLÇÜLEMEYENLER (dürüstçe)

Model yok → **cevap KALİTESİ ölçülemedi**, yalnız kaynak metnin isteme girip girmediği.
Gerçek eval koşusuna kadar açık kalanlar:
- Küçük blok gerçekten daha iyi cevap mı üretiyor, yoksa model sessizce kullandığı çevresel bağlamı
  mı kaybediyor?
- `[NOT]` çelişki notu modeli gerçekten durduruyor mu?
- 3,00×–7,57× geri çekilme bloğu cevabı bozuyor mu (lost-in-the-middle)?
- Gerçek token/gecikme maliyeti (karakter ≠ token; Türkçe kötü tokenleşir).
- **Gerçek trafik karışımı** — %72 sosyal oranı 25 mesajlık EL YAPIMI bataryadan, üretimden değil.
  Bunu yalnız tek mülk pilotundaki `retrieval.fb` dağılımı yanıtlar.

## KARAR ve SIRA

1. ✅ **Geri çekilme dalını legacy tavanına indir** — hibritin legacy'den ÇOK gönderdiği tek yeri
   kapatır, "selamlaşmada 170 kalem birden" maruziyetini bitirir, bilgi sorusu kazanımlarına
   dokunmaz. (Ayrı dilim, bu belgeden sonra.)
2. Tek mülk pilotu → `retrieval.fb` dağılımı → gerçek sosyal oranı ölç.
3. Gerçek eval (`evals/kb-retrieval-paired.json` R1–R8) → cevap kalitesi.
4. Ondan sonra genel açılış.
