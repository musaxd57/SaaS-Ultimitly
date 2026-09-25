# Model kıyası — gpt-5.1 ↔ gpt-6-luna (2026-09-25)

**Karar: ŞİMDİ DEĞİŞTİRME.** Misafir cevap modeli (`OPENAI_MODEL`) ve anlam katmanları `gpt-5.1`de kalır.
Kurucu isteği: "Luna 6'yı dene, 5.1'den iyiyse misafire o cevap versin; son kararı sen ver."

## Nasıl ölçüldü
- **Cevap kıyası** (`evals/model-reply-compare.json`, 135 sentetik senaryo, 10 sınıf, 7 dil; iki modelden
  bağımsız yazıldı): ürünle aynı yol — bilgi tabanı seçicisi → `suggestReply` → gerçek kapı. Raporlar:
  `docs/olcum/model-reply-compare-2026-09-25-gpt-5.1.md`, `…-gpt-6-luna.md`. Ölçü düzeltmeleri (insan talebi
  devri tasarım gereği gider, dil yüklemi, şifre ünlem belirsizliği) Luna koşusundan ÖNCE yapıldı ve iki modele
  aynı uygulandı (5.1 ham cevapları yeniden puanlandı, ücretli koşu tekrarlanmadı).
- **Konaklama anlam katmanı** (`evals/stay-change.json`, 599 istek + 747 cevap): 5.1 = 09-24 koşusu, Luna = 09-25
  tek başına koşu (ilk Luna koşusu paralel çalışmada 75 çağrı düşürdü → GEÇERSİZ, tekrarlandı).
- Mühürlü kör set 09-25'te yandı; bu kıyas GÖRÜLMÜŞ setlerle yapıldı → "değiştir" kararı için yeterli olmazdı,
  "değiştirme" kararı için yeterli (Luna görülmüş sette bile geride).

## Sonuçlar

| ölçü | gpt-5.1 | gpt-6-luna |
|---|---|---|
| Sızıntı (gitmemesi gereken cevap kapıdan geçti) | 0/52 | 0/52 |
| Cevabı bilgi tabanında olan soruda **doğru olgu** | **54/55 (%98)** | 46/55 (%84) |
| Doğru olgu + otomatik gider | 49/55 (%89) | 42/55 (%76) |
| Otomatik cevap oranı (bilgi sorusu) | 50/55 | 51/55 |
| Uydurma somut iddia (bilgi soruları) | 0/82 ¹ | 0/82 |
| Misafirin dilinde cevap (Türkçe dışı) | 52/59 (%88) | **58/59 (%98)** |
| Konaklama katmanı tehlikeli kaçak (dev / holdout) | 0/125 · 0/170 | 2/125 · 0/170 |
| Konaklama katmanı gereksiz inceleme (dev / holdout) | 11 · 28 | 9 · 27 |
| Gecikme p50 / p95 | **2,3 / 3,4 sn** | 4,3 / 8,3 sn |
| Maliyet (liste fiyatı, 1.000 misafir mesajı, istem önbelleğiyle) | ≈ $5,17 | **≈ $0,62** |
| Hesabın token/dk sınırı (09-25 ölçüldü) | 500k | 200k (≈ 11 cevap/dk) |

¹ Ölçüm 5.1'de 1 satır işaretledi; incelendi: "net bir **gecelik** rakam paylaşamıyorum" cümlesindeki "gecelik"
süre sanılmış — cevapta uydurulmuş sayı YOK (iddia ölçümünün yanlış alarmı; iki modelde de gerçek uydurma 0).

## Neden değiştirmiyoruz
1. **Luna bilgi tabanındaki ücretleri söylemiyor ve bu cevaplar OTOMATİK gidiyor.** "Otopark ücreti ne kadar?" →
   "Ücret ev sahibinizin kararıdır" (bilgi tabanında "günlük 150 TL" yazıyor). 9 cevap, 5 dilde; hepsi kapıdan
   geçiyordu. Sebep istemdeki KURAL-4: "Fiyat, iade tutarı, indirim, tazminat rakamı ASLA yazma" — 5.1 bunu dar
   okuyor (konaklama fiyatı/iade), Luna harfiyen (her fiyat). Luna'ya geçmek istem değişikliği + iki modelde
   yeniden ölçüm ister.
2. **Luna iki kat yavaş** (varsayılan düşünme çabasıyla): misafir tipik 4 sn, en kötü 8 sn bekler.
3. **Konaklama katmanında 2 kaçak** (ikisi de "ilanda 16:00 yazıyor, 15:00'te girebilir miyiz?" — istenen saat
   mülkün resmi saati, tehlikeli izin değil ama ölçüde kaçak); 5.1 ikisini de yakaladı.
4. **Tasarruf bugün küçük:** mevcut hacimde cevap maliyeti ayda birkaç dolar; risk buna değmez. Ölçek büyüyünce
   (çok host) fark anlamlı olur → yol aşağıda.

## Luna'nın gerçekten daha iyi olduğu yerler (5.1 için de iş)
- Türkçe dışı misafire kendi dilinde cevap: 5.1 7/59 cevapta İngilizce misafire Türkçe yazdı (bilgi yok /
  enjeksiyon / kapanış cevaplarında) → **5.1'de düzeltilecek iş** (istem).
- Uydurma: iki modelde de 0 (bu sette); Luna'nın genel benchmark'taki yüksek halüsinasyon oranı (Artificial
  Analysis) bu kapalı, bilgi tabanlı işte görünmedi — ama ücret sorusunda bilgi VERMEMEYİ seçti (↑1).

## Luna'ya geçiş yolu (ileride, ölçek maliyeti önemli olunca)
1. KURAL-4'ü netleştir: bilgi tabanında yazan SABİT hizmet ücretleri (otopark, ara temizlik…) aynen aktarılır;
   konaklama fiyatı/iade/indirim/tazminat rakamı yazılmaz → golden set + iki modelde cevap kıyası.
2. `OPENAI_REASONING_EFFORT=low` ile Luna gecikmesini ölç (ayar kodda hazır, varsayılan kapalı).
3. Yeni kör set (mühürlü A yandı) + gölge (`SHADOW_AI_MODEL=gpt-6-luna`) → sonra geçiş.

## Kodda bu turda yapılanlar
- 🚨 `gpt-6-*` artık reasoning modeli sayılıyor (`497af45`). ÖNCESİNDE Railway'de `OPENAI_MODEL=gpt-6-luna`
  yazılsaydı her misafir cevabı 400 ile düşerdi (canlı sonda: `temperature` ve `max_tokens` reddedildi).
  Bu düzeltme canlıya çıkmadan Railway'de gpt-6 modeli YAZILMAZ.
- `OPENAI_REASONING_EFFORT` (kapalı küme, ayarsız = davranış aynı).
- Cevap kıyası eval'i + veri seti (`npm run eval -- tests/eval/model-reply-compare.eval.test.ts`,
  `OPENAI_MODEL=<model>`; `EVAL_COMPARE_RESCORE=<yan-dosya>` ücretsiz yeniden puanlama).
- Yan bulgu düzeltildi: "bavullarınızı 14:00'e kadar giriş holünde bırakın" giriş saati sanılıp sahte saat
  çelişkisi üretiyordu (`024479e`).
