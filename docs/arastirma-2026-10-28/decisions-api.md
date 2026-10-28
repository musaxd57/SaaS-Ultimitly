# OpenAI Decisions API — işimize yarar mı? (2026-10-28 gece, ölçüm)

Kurucu: "OpenAI'ın Luna 6.0'da Decisions API'ı var, işimize yarar mı, bazı konularda 10 kat daha hızlıymış."

## Ne bu

`POST /v1/decisions` (gpt-6-luna; public beta 2026-10-06). Serbest metin üretmez: bir girdi metni + en çok 400 soru alır, her soruya
OLASILIK döner — evet/hayır (`predicate`), seçenek (`choice`), derece (`score`). Çıktı belirteci ücreti yok; girdi ucuz (ikincil kaynaklar
$0,10 / 1M girdi belirteci diyor — OpenAI'ın kendi fiyat sayfası bu ortamdan açılamadı, doğrulanmadı). Bizim anahtarımızla ÇALIŞIYOR
(10-28 gece deneme: 3 soru, 1,4 sn, 447 girdi belirteci).

## Ölçüm 1 — 7-D gönderim kontrolü (onaylanan cevap şimdi gitsin mi)

Kol: `7d-decisions-kolu.mjs` — model koluyla AYNI bağlam metni, 8 odaklı evet/hayır sorusu (hâlâ gerekli mi · açık konu · çelişki · yanlış
kişi/daire/rezervasyon · göreli zaman kayması · metnin içerik sorunu · kendi başına anlaşılır mı · soru hâlâ son mesaj mı). Eşik yalnız
geliştirme setlerinde (40'lık + kör 1) seçildi (`7d-decisions-esik.mjs`, risk ≤ 0,5 · gereklilik ≥ 0,3); kör 2 / kör 3 yalnız raporlandı.
⚠️ Dürüstlük: içerik sorusundaki "resmî tatil, yaz / kış saati" ifadesi kör 3'ün hata analizinden geldi → kör 3 bu kol için de tam kör DEĞİL.
İlk "çelişki" ifadesi TERS işledi (gönderilmesi gereken vakalarda ortanca 0,94) — yeniden yazıldı, geliştirme setlerinde düzeldi (0,01).

| Set | Decisions + kod kuralları: yanlış gönderim / gereksiz tutma | Luna sohbet çift onay (§11): yanlış / gereksiz |
|---|---|---|
| geliştirme 40 | 0 / 10 | 0 / 9 |
| kör 1 (93) | 0 / 17 | 0 / 13 |
| kör 2 (80; 26 gitmeli) | 2 / **25** | 1 / 11 |
| kör 3 (70; 28 gitmeli) | 0 / **24** | 5 / 12 |

Okuma: tek başına gönderim kararı olarak AŞIRI TEMKİNLİ — taze setlerde gitmesi gereken mesajların ~%90'ını tutuyor (pratikte "her onay
düzenleyicide" seçeneğine yakın). Sebep: "hâlâ gerekli mi" sorusu gece onaylarında "an geçti" diye yanlış hayır diyor. Hız: p50 ≈ 0,3 sn,
p95 0,5–1,2 sn (sohbet kolu ~1–3 sn). 283 vaka toplam ≈ 480 bin girdi belirteci (birkaç sent).

## Ölçüm 2 — yeniden sıralayıcı (sıcak yol; Luna'nın asıl sorunu gecikmeydi)

Deney `rrm:decisions` (`tests/eval/rag-lab/core.ts labRerankDecisions`): sohbet sıralayıcısıyla BİREBİR aynı aday metni; aday başına bir
evet/hayır ("bu aday misafirin sorusunu cevaplıyor mu"), olasılık ≥ 0,5 → "cevaplıyor", ≥ 0,2 → "ilgili".

| Set | 5.1 sıralayıcı | Decisions sıralayıcı | Gecikme p50 / p95 |
|---|---|---|---|
| perq iki sorulu 120 mesaj | 118 · 114 (2 tekrar) | 114 | 5.1: 1,09 / 1,63 sn · Decisions: **0,41 / 0,86 sn** |
| uzun belge geliştirme (113), tablo başlığı kapalı | 106 · 103 · 100 | 102 | — |
| uzun belge geliştirme, tablo başlığı açık | 110 · 107 | 105 | — |

Okuma: kalite 5.1'in koşudan koşuya oynama aralığının alt ucunda (−1 / −3,5); hız 2,5 kat, maliyet çok düşük. Kurucunun "eşitse ucuz
olan" kuralına göre ADAY ama henüz eşit değil — tek koşu, tekrar ve kör set gerekli.

## Öneri

1. Gönderim kontrolünün ANA kararı olarak kullanma (aşırı temkinli; ölçüldü). Odaklı tek sorular (ör. "yanlış kişi / daire mi", "göreli
   zaman kayıyor mu") koda EK durdurma sinyali olarak denenebilir — her biri ayrı ölçülerek.
2. Sıralayıcıda gerçek aday: hız + maliyet avantajı büyük. Sıradaki ölçüm: aynı setlerde 3 tekrar + uzun belge kör seti + soru ifadesi /
   eşik varyantları (yalnız geliştirme setinde ayar). Eşitse kurucu kararıyla `KB_RERANK_MODEL` yerine ayrı bir anahtarla.
3. Ürüne bağlanmadı (sormadan sistem kurulmaz). Yalnız ölçer ve araştırma betikleri.

Kaynaklar (ikincil; OpenAI'ın kendi API başvuru sayfası bu ortamdan açılamadı — istek şeması bizim anahtarımızla yapılan denemeyle doğrulandı):
- [OpenAI Opens Decisions API Public Beta — letsdatascience.com](https://letsdatascience.com/news/openai-opens-decisions-api-public-beta-b69a1e40)
- [OpenAI launches Decisions API with up to 10x faster responses — propakistani.pk, 2026-10-07](https://propakistani.pk/2026/10/07/openai-launches-decisions-api-with-up-to-10x-faster-responses/)
- [OpenAI launches Decisions API public beta on GPT-6 Luna — aiweekly.co](https://aiweekly.co/alerts/openai-launches-decisions-api-public-beta-on-gpt-6-luna)
- [What Is the OpenAI Decisions API? — apidog.com](https://apidog.com/blog/openai-decisions-api/)
- [Decisions API use, pricing, public beta (October 2026) — smartscope.blog](https://smartscope.blog/en/blog/openai-decisions-api-use-pricing-public-beta-october-2026/) (fiyatın "doğrulanmamış" olduğunu ve resmî kılavuzun "bütün geliştiriciler" demediğini not eder)
- [LiteLLM — Decisions, OpenAI format](https://docs.litellm.ai/docs/decisions/openai_format) · [TrueFoundry AI Gateway — Decisions](https://www.truefoundry.com/docs/ai-gateway/decisions)
