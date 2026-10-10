# RAG ayrıştırma — Luna'da çok sorulu mesajlarda getirme neden düştü? (2026-10-10)

> Kurucu (10-09): "RAG sistemimizi, model anlamasını, soru anlamasını bol bol test et." Cevap düzeyi koşusunda (`rag-answer-2026-10-10-2/-3`)
> Luna yapılandırması çok sorulu mesajlarda cevabı istem bloğuna 34/40 getirdi, 5.1 39/40. Bu belge kaybın hangi katmandan geldiğini
> getirme düzeyi ölçerle (`rag-lab`, `EVAL_RAG_KB=perq`: soru başına 60 kalemlik gerçekçi bilgi tabanı, yalnız GELİŞTİRME seti) ayırır.
> Kabul seti (holdout) koşulmadı. Ürün davranışı değişmedi; yeni şey yalnız KAPALI anahtar arkasında (aşağıda §5).

## 1. Katman katman (çok sorulu 120 mesaj = 240 cevap; "blokta" = iki cevap da istem bloğunda)

Sabit: gömme `text-embedding-3-small` @ 0,4 · canlı yapılandırma (`live+phist`: anlama açık, öğe kipi, sıralayıcı tek çağrı ilk 60, 2,5 sn tavan).

| Anlama | Yeniden sıralayıcı | Blokta (koşu 1 · koşu 2) | Eşik altı kaçak | Sıralayıcı tavan aşımı | Sıralayıcı p50 / p95 |
|---|---|---|---|---|---|
| 5.1 | 5.1 | **110 · 109** | 6 · 6 | 2 · 1 | 0,8–1,0 / 1,1–1,9 sn |
| Luna `none` | 5.1 | 107 · 105 | 9 · 8 | 2 · 0 | 0,8 / 1,1–1,2 sn |
| Luna `low` | 5.1 | 105 · 106 | 10 · 9 | 0 · 0 | 0,8 / 1,1 sn |
| 5.1 | Luna `none` | 106 | 6 | **14** | 1,2 / 2,9 sn |
| 5.1 | Luna `low` | 103 | 6 | **38** | 1,6 / 3,3 sn |
| Luna `low` | Luna `none` | 101 | 10 | 11 | 1,3 / 2,7 sn |

Koşu 2 = taze model önbelleğiyle tekrar (gömmeler aynı) — koşudan koşuya oynama 1–2 mesaj; farklar tekrar ediyor.

**Okuma — kayıp iki ayrı yerden geliyor:**
1. **Yeniden sıralayıcı (Luna):** kalite değil GECİKME. Üretimin sıcak yol tavanı 2,5 sn (`RERANK_HOT_PATH_DEADLINE_MS`, 5.1'in p95'inin
   ~2 katı olarak ayarlanmıştı). Luna `none`un p95'i 2,7–2,9 sn → çağrıların ~%10'u tavanı aşıyor, o mesajda sıra BUGÜNKÜ (sıralayıcısız)
   kalıyor. Dalga 3'teki "kalite eşdeğer" ölçümü tavansızdı (etiket kalitesi) — o sonuç doğru ama üretimde tavan var. Gecikme bu
   konteynerden ölçüldü (yeniden deneme beklemesi süreye girmez); oran ortama göre değişebilir, fark tutarlı.
2. **Anlama katmanı (Luna):** ~4 mesaj (%3) kayıp, eşik altı kaçak 6 → 9–10. Örnekler (geliştirme seti):
   - "Kalça ameliyatı geçiren annem var, oturup kalkarken destek alabileceği sabit bir kol desteği mevcut mu?" — 5.1 sorguyu
     "banyo tuvalet sabit kol desteği" diye yazıyor (cevap: tuvaletin yanındaki tutunma barı), Luna "sabit kol desteği oturup kalkma
     desteği" → kosinüs 0,62 → 0,36.
   - Geçmişte İngilizce soru + şimdi Türkçe soru: 5.1 dili çoğu zaman "en" sayıp İngilizce ikinci sorgu da üretiyor; Luna yalnız Türkçe
     yazıyor → İngilizce yazılmış kalem kaçıyor ("Pervaneleri çalışır bırakıp çıksak?" → cevap İngilizce kalemde, kosinüs 0,47 → 0,25).

## 2. Dil yönü (modelden BAĞIMSIZ bir açık)

| Soru → cevabın yazıldığı dil | 5.1 | Luna `low` | Luna `none` |
|---|---|---|---|
| Türkçe → Türkçe | 177/181 | 173/181 | 173/181 |
| İngilizce → Türkçe | 23/23 | 23/23 | 23/23 |
| **Türkçe → İngilizce** | **26/33 (%79)** | 25/33 | 28/33 |
| İngilizce → İngilizce | 3/3 | 3/3 | 3/3 |

Anlama katmanı yalnız Türkçe (`query_tr`) + misafirin dilinde (`query_original`) sorgu yazıyor. Yabancı misafir → Türkçe kalem köprüsü
var (`query_tr`), ama Türkçe misafir → İngilizce yazılmış kalem köprüsü YOK. Ev sahibi bilgi tabanının bir kısmını yabancı misafirler için
İngilizce yazdığında bu gerçek bir boşluk.

## 3. Öneri değişikliği (Luna geçişi, `LUNA-GECIS-2026-10-10.md` tablosu güncellendi)

- **`KB_RERANK_MODEL` → `gpt-5.1`** (önceki öneri Luna `none` idi): üretimdeki 2,5 sn tavanında Luna çağrılarının ~%10'u düşüyor.
- Anlama katmanı: §5 köprü ölçümüne göre (aşağıda).

## 4. Cevap düzeyi kırmızı adayı

(doldurulacak — `d_accessibility_5_f0_q1`, kanıtsız iddia, dört yapılandırmada tekrar)

## 5. İngilizce köprü sorgusu (anahtar `AI_UNDERSTANDING_EN_QUERY_ENABLED`, KAPALI)

(ölçüm sürüyor)
