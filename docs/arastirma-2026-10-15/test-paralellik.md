# Test kapısı paralelleştirme ölçümü (10-15)

Kurucu 10-15: "Önce sürenin test çalıştırma, veritabanı bekleme ve kurulum arasında nasıl dağıldığını ölç. Veritabanına dokunmayan testlerin
ayrı paralel çalışmasını değerlendir. PostgreSQL testlerinde işçi başına yalıtılmış veritabanı / şema olmadan paralelliği artırma. Önce süre
kazancı, kaynak tüketimi ve tekrarlı koşulardaki kararlılığı raporla. Ana test yapılandırmasını değiştirmeden önerini getir."

**Ana yapılandırma (`vitest.config.ts`) DEĞİŞMEDİ.** Ölçüm yapılandırmaları geçici dizinde, ayrı dosyalar.

## Ortam
- Kapılar benim bulut kabımda koşuyor (Claude Code uzak ortam, Linux, 4 CPU, 16 GB). CI ayrıca GitHub Actions'ta. Kurucunun bilgisayarında hiçbir
  şey koşmuyor.
- Örnekleyici 2 sn'de bir `/proc/stat` (makine CPU), `MemAvailable`, node / postgres süreçlerinin RSS'i.

## Sınıflandırma (hangi dosya veritabanı ister)
Bütün test dosyaları ULAŞILAMAZ bir `DATABASE_URL` ile (127.0.0.1:1) paralel koşuldu; geçen dosya = veritabanısız.
- **Veritabanısız: 559 dosya** — 458 `tests/unit`, 65 `tests/ui`, 9 `tests/integration`, 27 eval (anahtarsız atlanan).
- **Veritabanlı: 397 dosya** — 396 `tests/integration` + `tests/unit/rate-limit.test.ts`.

## Sonuçlar
| Koşu | Ne | Duvar süresi | Makine CPU ort. | Tepe node RSS | Sonuç |
|---|---|---|---|---|---|
| M0 | Resmî kapı (`npm test` + build), tek sıra | 2.499 sn (test 2.371 sn + build) | %30 | 2,8 GB | yeşil |
| M1 | Yalnız veritabanısız, tek sıra | 668 sn | %32 | 0,75 GB | yeşil |
| M2 ×3 | Yalnız veritabanısız, 4 işçi | 220 / 217 / 213 sn | %95 | 1,2–1,3 GB | 1. koşuda 1 kırmızı (↓ kararlılık), 2. ve 3. yeşil |
| M4 ×2 | Veritabanlı tek sıra + veritabanısız 3 işçi AYNI ANDA | _(ölçüm sürüyor)_ | | | |

**Sürenin dağılımı (M0, vitest'in kendi dökümü):** dosya toplama / modül yükleme 762 sn · test gövdeleri 1.258 sn · ortam kurulumu 51 sn ·
hazırlık 70 sn. Veritabanısız tek sıra koşuda (M1) test gövdeleri yalnız 225 sn; kalan ~440 sn dosya başına modül yükleme. Yani
veritabanısız kısmın darboğazı test değil, 559 dosyanın tek tek yüklenmesi — paralellik tam bunu böler (668 → ~215 sn, ×3,1). Toplam CPU işi
aynı kalıyor (M1 ≈ 850, M2 ≈ 820 çekirdek-saniye): kazanç boşta duran çekirdeklerden.

**Kararlılık:** M2'nin 1. koşusunda `tests/unit/claim-support-cost.test.ts` (süre pini: 50.000 karakterlik saldırgan metin 150 ms altında)
4 işçi + %95 CPU altında 173 ms ölçtü → kırmızı. 2. ve 3. koşu yeşil. Süre pinleri (`*-cost.test.ts`, 11 dosya; ayrıca süre ölçen ~54 dosya)
paralel koşuda CPU paylaştığı için kararsız → **tek sırada kalmalı.**

## Öneri (ana yapılandırma değişmeden; uygulama kararı ayrıca)
_(M4 sonuçlarıyla tamamlanacak)_
