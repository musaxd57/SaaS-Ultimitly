# OpenAI yeniden sıralayıcı (#186) — tasarım + ölçüm planı (2026-09-26)

> Kurucu kararları (09-26): yeniden sıralayıcı **"OpenAI ile"** (yeni alt-işleyen yok — cevap modeli zaten OpenAI);
> sıra **"Önce ücretli ölçüm, sonra siz"** (tam hat: anlama katmanı + embedding + yeniden sıralama, **< 1 $**).
> Ölçüm TAMAM (↓§3b). Üretime bağlama ve açma kurucu kararı (embedding anahtarı E5 ile birlikte; bayrak arkasında,
> varsayılan KAPALI).

## 1. Neden

Bugünkü seçim (`retrieval/select.ts`): sözcüksel BM25 + n-gram (+ anlamsal aday kaynağı, anahtar `KB_SEMANTIC_RETRIEVAL`
KAPALI) → birleşim → kural tabanlı yeniden sıralama (`retrieval/rerank.ts`: kavram ipucu / başlık / bigram bonusu) →
6k karakter / 12 parça bütçesi. E4 (09-26) anlamsal kaynağın parafraz cevabını isteme sokma oranını %38 → %66'ya
çıkardığını gösterdi (100 kalem) ama hâlâ üç parafrazdan biri kaçıyor. Kalan kaybın büyük kısmı SIRALAMA: cevap parçası
aday listesinde ama bütçe kesiminin altında kalıyor. Sektörün bilinen yolu (Airbnb destek sistemi: embedding ile ilk 30
+ LLM ile yeniden sıralama) budur.

## 2. Önerilen hat (ölçülecek olan)

1. **Aday geçişi:** bugünkü seçici, GENİŞ bütçeyle (ilk ~20–30 parça) — tüm güvenlik/sürüm/sır süzgeçleri AYNEN.
2. **LLM yeniden sıralama:** misafirin cevapsız mesajları + anlama katmanının sorguları + aday parçalar (kimlik + başlık +
   kısaltılmış metin) tek Structured Outputs çağrısıyla puanlanır: her aday için alaka 0–3 (3 = soruyu doğrudan cevaplar,
   2 = kısmen, 1 = zayıf ilişkili, 0 = ilgisiz). Ağ kapısı tek kaynak `semantic/structured-call.ts` (alarm, zaman aşımı,
   kalıcı arıza sınıfı hazır).
3. **Son seçim:** bugünkü seçici YENİDEN koşar, bu kez LLM puanı sıralama sinyali olarak girer (anlamsal puanın girdiği
   gibi) — bütçe, çelişki koruması (`time-fields.ts`), sürüm kuralı, parça tavanları AYNEN seçicide kalır. LLM bir parçayı
   ÇIKARAMAZ, yalnız SIRASINI değiştirir; aday listesine kalem EKLEYEMEZ.
4. **Arıza:** zaman aşımı / hata / şema ihlali → bugünkü sıralama (misafir beklemez, cevap düşmez). Kanıtta yalnız sayı /
   kapalı küme (`rr: ok|timeout|error|skipped`, süre, aday sayısı).

**Güvenlik notları:** aday metni ve misafir mesajı istemde "VERİ" ayracıyla (enjeksiyon talimatı uygulanmaz); talimat
ele geçirme süzgeci (`detectKbInstructionHijack`) zaten seçiciden ÖNCE; en kötü durumda saldırgan yalnız mevcut adaylar
ARASINDA sıra değiştirebilir (içerik ekleyemez, sır süzgecini aşamaz). Küçük KB'de (≤30 kalem ve ≤24k) seçim yok → yeniden
sıralama da yok (tam küme gider).

## 3. Ölçüm (E4 düzeneğinin genişletmesi, sentetik veri)

- Kollar: `lex` (bugün) · `sem@0.3` (embedding, E4 kazananı) · `sem@0.3+rr` (embedding + LLM yeniden sıralama).
- Ölçüler (E4 ile aynı): parafraz inPrompt · ölçek inPrompt/hit@1 (gerileme olmamalı) · iki sorulu mesajda iki cevap
  birden · negatif sorguda blok · **ek:** yeniden sıralama gecikmesi p50/p95 ve token.
- Boyut: 100 ve 300 kalem; parafraz 82 + iki sorulu 40 + negatif 20 + ölçek örneklemi ~40. Önce 20 sorguluk DENEME
  (maliyet ve gecikme ölçülür), sonra ana koşu. Tahmin: aday 20 × ~120 token ≈ 2,5k token/çağrı, ~360 çağrı → ~1M token.
  Model: bugünkü cevap modeli (gpt-5.1) deneme ile başlar; maliyet 1 $ sınırını aşacaksa daha ucuz model deneme kolunda
  kıyaslanır (seçim ölçümle, rapora yazılır).
- Karar ölçütü (kurucuya): parafraz inPrompt belirgin artmalı · ölçek %99 altına inmemeli · p95 gecikme cevap süresine
  eklenebilir düzeyde (hedef ≤ 1,5 sn) · maliyet mesaj başına.

## 3b. SONUÇLAR (09-26) — tavan teşhisi + gerçek ölçüm

**Tavan teşhisi** (`docs/olcum/rerank-tavan-2026-09-26.md`, ücretsiz — yalnız gömme): kaçan soruda cevap parçası aday
listesinde mi? Embedding KAPALIYKEN kaçakların hemen hepsi aday listesinde HİÇ yok → yeniden sıralayıcı işe YARAMAZ.
Embedding AÇIKKEN kaçakların çoğu ilk 20 adayda: tavan parafraz 100 kalemde %67→%80, 300 kalemde %50→%65; iki sorulu
mesajda %62→%92 ve %31→%77. **Sonuç: yeniden sıralayıcı yalnız embedding ile birlikte anlamlı.**

**Gerçek ölçüm** (`docs/olcum/rerank-olcum-2026-09-26.md`, gpt-5.1, 288 çağrı, 0 hata, ~0,45 $):

| KB | soru türü | yalnız embedding | + yeniden sıralama | kazanç / kayıp |
|---|---|---|---|---|
| 100 | parafraz | %67 | **%78** | 9 / 0 |
| 100 | iki soru birden | %62 | **%74** | 5 / 0 |
| 300 | parafraz | %50 | **%57** | 6 / 0 |
| 300 | iki soru birden | %31 | **%41** | 4 / 0 |
| 100 / 300 | doğrudan soru (örneklem 30) | %100 | %100 | 0 / 0 |

Gecikme p50 **0,86 sn**, p95 **1,32 sn** (hedef ≤ 1,5 sn). Mesaj başına maliyet ~0,0015 $ (yalnız seçim yapılan mesajlarda,
KB > 30 kalem). **Hiçbir soruda gerileme yok.** Şema dersi (deneme): aday başına puan yazdırmak çıktıyı ve gecikmeyi büyütüyordu
(p50 1,7 sn) → model yalnız "cevaplayan" ve "ilgili" kimlikleri listeler; listede olmayan aday bugünkü sırasını korur.
İki sorulu mesaj tavanın altında kaldı (100'de %74 / tavan %92) — sonraki iyileştirme adayı (alt soru başına ayrı liste).

**Kod (bağlanmadı):** `semantic/rerank.ts` (istem, şema, katı ayrıştırıcı, `llmRerank`; ASLA fırlatmaz) · seçicide
`rerankScores` (yalnız sıra; aday eklemez/çıkarmaz) + ölçüm kancası `onCandidates` · ölçüm düzenekleri
`tests/eval/rerank-ceiling.eval.test.ts`, `tests/eval/rerank-llm.eval.test.ts` (ortak küme `e4-shared.ts`).

## 4. Bilinen sınırlar / açık sorular

- Canlıda embedding anahtarı hâlâ KAPALI (E5 açma kararı kurucuda) — yeniden sıralayıcı onsuz da çalışır (sözcüksel
  adaylar üzerinde) ama asıl kazanç ikisi birlikteyken beklenir; ölçüm iki kombinasyonu da gösterir.
- Ek model çağrısı = ek gecikme + maliyet: yalnız seçim GERÇEKTEN yapılan mesajlarda (KB > 30 kalem) koşar.
