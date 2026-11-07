# Haiku 5.5 ↔ gpt-5.1 — anlama katmanı + karar metni yazıcısı (kurucu 10-31 akşam)

Kurucu: "5.1'in kullandığı yerlere Haiku 5.5 gelince durum nasıl oluyor; reasoning içinde ekstra testler yap; Luna işimizi görüyorsa
bakma." Açılış planında (`docs/RAILWAY-ACILIS-2026-10-15.md` §2) 5.1'de kalan katmanlar: **anlama + yeniden sıralayıcı**
(`AI_SEMANTIC_MODEL`) ve **karar metni yazıcısı** (`AI_DECISION_TEXT_MODEL`). Çeviri / üslup / cevap / bekçi planda Luna → ölçülmedi.
Sıralayıcı bu koşuda YOK (OpenAI gömmesi ister; Claude koşusu GitHub Actions'ta, orada OpenAI anahtarı yok).

Kod: `c1a2c487` (5.1 tabanı yerelde `2863249d`, aynı ürün kodu). Köprü `tests/eval/anthropic-reply-shim.ts`: ürün fonksiyonu OLDUĞU
GİBİ koşar, OpenAI sohbet çağrısı aynı istemle Claude'a gider; anlama katmanının Structured Outputs şeması `output_config.format`a
taşınır. Bütün kollarda şema reddi 0, çitli JSON 0, model reddi 0, cevap dışı çağrı 0. Ham raporlar: `ariza-kullanim-2026-10-31-*`,
`karar-mesaji-2026-10-31-*` (Haiku kollarının .md'leri Actions günlüğünde, iş 124583751675).

## 1. Anlama katmanı — arıza bildirimi ↔ kullanım sorusu (20 vaka × 2 tur, iki kip)

"Canlı kip" = bugün açık olan öğe + ilişki kipi (asıl ölçü). "Temel kip" = eski / yedek istem.

| kol | canlı kip toplam | arıza bildirimi | kullanım sorusu | temel kip toplam | maliyet (80 çağrı) |
|---|---|---|---|---|---|
| **gpt-5.1** (taban) | **38/40** | **22/22** | 16/18 | 32/40 | — (ölçülmedi; ≈ 7× Haiku) |
| Haiku düşünme KAPALI | 33/40 | 15/22 | 18/18 | 26/40 | $0,010 |
| Haiku adaptive low | 36/40 | 18/22 | 18/18 | 25/40 | $0,010 |
| Haiku adaptive medium | 34/40 | 16/22 | 18/18 | 25/40 | $0,010 |
| Haiku adaptive high | **39/40** | 21/22 | 18/18 | 22/40 | $0,016 |

Okuma: Haiku kullanım sorusunu hiç şikâyet sanmıyor (18/18; 5.1 "kumandayı bulamadık"ı iki turda şikâyet saydı). Ama ARIZA
bildirimini kaçırıyor ("Tost makinesi ısınmıyor, Wi-Fi şifresi neydi?", "Wasserkocher geht nicht") — bu, ev sahibinde tutulması gereken
şikâyetin oluşmaması demek (güvenlik yönünde KÖTÜ taraf). Yalnız `high` 5.1'e yetişiyor (21/22), o da tek koşu; temel kipte hepsi zayıf
(4–8/22). Düşünme açıldıkça canlı kip düzenli iyileşmiyor (low 36 → medium 34 → high 39): tekrar varyansı büyük, tek koşuyla karar verilmez.

## 2. Karar metni yazıcısı (geliştirme seti, 40 senaryo, 7 dil)

5.1 tabanında bekçi planlı modelde (Luna); Haiku kollarında köprü yazıcıyı VE bekçiyi Claude'a çevirir.

| kol | YZ metni kullanıldı | bağımsız denetim | iç bilgi sızıntısı | gerekçe anıldı (sezgisel) | p50 / p95 | maliyet |
|---|---|---|---|---|---|---|
| **gpt-5.1** (taban) | 39/40 | 39/39 | 0 | **10/13** | 3,5 / 4,5 sn | $0,070 |
| Haiku düşünme KAPALI | 38/40 | 38/38 | 0 | 9/14 | 2,1 / 3,3 sn | $0,007 |
| Haiku adaptive low | 39/40 | 39/39 | 0 | 7/14 | 2,1 / 5,1 sn | $0,007 |
| Haiku adaptive medium | 37/40 | 37/37 | 0 | 8/14 | 2,8 / 6,3 sn | $0,011 |
| Haiku adaptive high | **40/40** | 40/40 | 0 | 6/14 | 4,2 / 5,5 sn | $0,017 |

Okuma: güvenlik ölçülerinde fark yok (denetim %100, sızıntı 0, gerekçe uydurma 0, saat ve dil %100). Haiku ~10× ucuz, düşük çabada
daha hızlı. Şablona düşüşlerin çoğu Haiku'nun Türkçe geç çıkış onayına bekleme / devir cümlesi eklemesi (`promise_or_handoff` — kod
yakaladı, misafire şablon gitti). Reddin gerekçesini (temizlik / önceki misafir) daha az anıyor (%43–64 ↔ 5.1 %77).

## 3. Öneri (karar kurucunun)

- **Anlama katmanı:** 5.1'de kalsın. Haiku'nun arıza kaçırması güvenlik yönünde; `high` tek koşuda yetişti ama varyans büyük. Geçiş
  istenirse önce: aynı sette 3 tekrar × (low, high) + uçtan uca anlama ölçeri (`understanding-e2e`, OpenAI + Anthropic anahtarı aynı
  koşuda gerekir) + kör set.
- **Karar metni yazıcısı:** Haiku (düşünme kapalı ya da low) aday — güvenlik eşit, 10× ucuz, daha hızlı. Açık ödünler: gerekçe daha az
  anılıyor, ara sıra bekleme cümlesi (kod tutuyor → şablon). Geçiş için ürün kodunda Anthropic bağdaştırıcısı + model profili gerekir
  (`docs/PLAN-2026-10-31-codex-hiz-acil-ve-model-gecisi.md` §F); bugün yalnız ölçer köprüsü var. Kör set (`decision-text-acc1.json`)
  koşulmadan geçilmez.
