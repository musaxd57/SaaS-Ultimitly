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
| M4 ×2 | Veritabanlı tek sıra + veritabanısız 3 işçi AYNI ANDA | 1.659 / 1.642 sn (veritabanısız kol 281 / 275 sn'de bitti) | %40 | 1,6 GB | iki tekrar da yeşil (veritabanlı 3.817 test, veritabanısız 12.413 test) |

**Sürenin dağılımı (M0, vitest'in kendi dökümü):** dosya toplama / modül yükleme 762 sn · test gövdeleri 1.258 sn · ortam kurulumu 51 sn ·
hazırlık 70 sn. Veritabanısız tek sıra koşuda (M1) test gövdeleri yalnız 225 sn; kalan ~440 sn dosya başına modül yükleme. Yani
veritabanısız kısmın darboğazı test değil, 559 dosyanın tek tek yüklenmesi — paralellik tam bunu böler (668 → ~215 sn, ×3,1). Toplam CPU işi
aynı kalıyor (M1 ≈ 850, M2 ≈ 820 çekirdek-saniye): kazanç boşta duran çekirdeklerden.

**Kararlılık:** M2'nin 1. koşusunda `tests/unit/claim-support-cost.test.ts` (süre pini: 50.000 karakterlik saldırgan metin 150 ms altında)
4 işçi + %95 CPU altında 173 ms ölçtü → kırmızı. 2. ve 3. koşu yeşil. Süre pinleri (`*-cost.test.ts`, 11 dosya; ayrıca süre ölçen ~54 dosya)
paralel koşuda CPU paylaştığı için kararsız → **tek sırada kalmalı.**

**Veritabanlı kol (M4 dökümü):** 397 dosya, 1.650 sn duvar; test gövdeleri 1.033 sn, kalan ~600 sn dosya başına modül yükleme + kurulum.
PostgreSQL'in kendisi darboğaz DEĞİL (koşu boyunca toplam ~7–9 sn CPU). En uzunlar: `login-route` 117 sn (parola özeti — bilinçli bcrypt
maliyeti), `channel-thread-window-oracle` 72 sn, `password-reset-challenge` 29 sn. Veritabanı bekleme payı ayrıca ölçülemedi (Node tarafı
bekleme ile işlemciyi ayırmıyor); ama PostgreSQL CPU'sunun ~%0,5 olması beklemenin baskın olmadığını gösteriyor — süre tek sıranın kendisi.

**Kazanç:** resmî kapının test kısmı 2.371 sn → iki kol aynı anda 1.642–1.659 sn = **~%30 kısa (~12 dk)**. Build (~2–2,5 dk) ayrı.

## Öneri (ana yapılandırma DEĞİŞMEDİ; uygulama kararı ayrıca — Codex 10-15 notuyla aynı)
1. **Veritabanısız testler: 4 işçi**, ayrı yapılandırma dosyası, `globalSetup` YOK, `DATABASE_URL` ulaşılamaz adres (yanlış sınıflanan
   veritabanlı test sessiz geçmez, bağlantı hatasıyla KIRMIZI olur). Sınıflama dosya listesiyle değil dizinle: `tests/unit/**` + `tests/ui/**` +
   veritabanısız 9 `integration` dosyası, istisna `tests/unit/rate-limit.test.ts` (veritabanlı).
2. **Süre ölçen testler** (`*-cost.test.ts` 11 dosya + süre ölçen diğerleri): veritabanısız kol bittikten SONRA, ayrı ve TEK SIRA — paralel
   koşuda CPU paylaşımı yüzünden bir koşuda 150 ms sınırı 173 ms ölçüldü (M2_1). Veritabanlı kol o sırada tek çekirdek kullandığı için
   (makine %40) bu adım ölçümü bozmaz; yine de ilk uygulamada iki kez tekrarlanıp ölçülecek.
3. **Veritabanlı testler: bugünkü güvenli düzen** (tek sıra, `fileParallelism: false`). İşçi başına yalıtılmış veritabanı / şema olmadan
   paralellik ARTIRILMAZ (bir testin `resetDb` temizliği diğerinin verisini siler). Yalıtım ayrı bir iş: işçi başına şema + kanıt testi.
4. Beklenen kapı: ~1.650 sn (veritabanlı kol) + süre testleri (ölçülecek) + build. Kararlılık: veritabanısız kol 4 işçide 3 koşudan 1'inde
   tek süre pini kırmızı → 2. madde bunu kaldırır.
