# TASARIM — CI testlerini paralel gruplara bölmek (kurucu 10-31)

> Kurucu (aynen, özet): "484 veritabanlı dosya üç gruba bölünür; her grup kendi geçici PostgreSQL'i, kendi testleri tek sırada; son kontrol
> üç grubun da eksiksiz ve başarılı olduğunu doğrular. … Aynı commit üzerinde eski ve yeni düzen karşılaştırılsın; hiçbir dosya kaybolmasın,
> atlanan test sayısı artmasın; bir grup başarısız ya da raporu eksikse son kapı kesinlikle kırmızı olsun. Birkaç kez tekrarlansın; süre,
> kararsız test, kaynak raporlansın. Test atlayarak / hata yutarak / sınır gevşeterek hız kazanılmasın. Eski tek sıralı düzen geri dönüş
> yolu olarak korunsun."

## 1. Bugün (ölçüldü)

- CI `verify` işi: typecheck (~40 sn) + lint (~30 sn) + `npm test` (≈ 29 dk). `npm test` = `scripts/test-gate.mjs`: veritabanlı kol (476 dosya,
  tek sıra, PostgreSQL 5433 `tests/global-setup.ts` her koşuda sıfırdan kurar) + veritabanısız kol (paralel) aynı anda, sonra süre ölçen kol.
- Darboğaz veritabanlı kol (tek sıra). Öteki işler (build, e2e, güvenlik, migration zinciri) 3 dk içinde bitiyor.

## 2. Yeni düzen

| CI işi | Ne koşar | Veritabanı |
|---|---|---|
| `test-db (1/3)`, `(2/3)`, `(3/3)` — matris | veritabanlı kolun kendi payı, TEK SIRA | işin KENDİ konteynerinde kendi PostgreSQL'i (bugünkü `global-setup`, değişmeden) |
| `test-nodb` | typecheck + lint + veritabanısız kol + süre ölçen kol | yok (ulaşılamaz adres — bugünkü kural) |
| `verify` (son kapı) | yalnız denetler, test KOŞMAZ | — |

- **Yalıtım:** her matris işi ayrı GitHub çalıştırıcısında ayrı konteyner → ayrı PostgreSQL. Bir grubun `resetDb`'si ötekine ulaşamaz (aynı
  makinede değiller). Railway'de veritabanı açılmaz.
- **Aynı kurulum:** üç grup TEK matris tanımından üretilir (aynı imaj `node:22-bookworm`, aynı PostgreSQL kurulum adımı, aynı `global-setup`,
  aynı `prisma generate`). Kopyala-yapıştır adım yok.
- **Dağıtım (`tests/ci-shards.mjs`, saf):** veritabanlı dosya listesi bugünkü TEK kaynaktan (`partitionTestFiles().db`). Ölçülmüş dosya
  süreleri (`tests/ci-shard-weights.json`) ile "en uzun önce" dengeleme (LPT, eşitlikte dosya adı — belirlenimci). Süresi bilinmeyen yeni
  dosya ortanca ağırlık alır (yine bir gruba DÜŞER — kayıp olamaz). Ağırlık dosyası yalnız dengeyi etkiler, kapsamı ASLA.
- **Grup raporu:** her iş vitest JSON raporu (`--reporter=json`) + kendi beklenen dosya listesi yükler (artifact).

## 3. Son kapı `verify` (`scripts/ci-verify.mjs` + `scripts/ci-verify-core.mjs`, saf karar fonksiyonu + ince sarmalayıcı)

`if: !cancelled()` — öteki işler kırmızı / iptal olsa da koşar ve **onları kırmızı sayar**:

1. `needs` içindeki her iş `success` değilse → KIRMIZI (iptal / atlandı / başarısız fark etmez).
2. Her grubun raporu VAR ve okunabilir olmalı; yoksa → KIRMIZI ("rapor eksik").
3. Raporlardaki dosya kümesi = depodaki bütün test dosyaları (`listTestFiles()`, ana yapılandırmayla aynı küme) — eksik dosya, fazla dosya,
   iki grupta birden koşan dosya → KIRMIZI (adıyla).
4. Her dosya `passed`; başarısız test 0 → değilse KIRMIZI.
5. Atlanan + yapılacak (`skip` / `todo`) toplamı `tests/ci-skip-baseline.json` tavanını aşamaz → aşarsa KIRMIZI. Tavan bugünkü sayıdır;
   artırmak bilinçli bir commit ister (gerekçe satırıyla).
6. Bir dosyanın raporundaki test sayısı 0 ise (yüklenip hiç koşmadıysa) → KIRMIZI.

Karar fonksiyonu birim testli: eksik rapor, iptal edilmiş iş, kayıp dosya, çift dosya, artan atlama, boş dosya, başarısız test — her biri
kırmızı; hepsi tamamken yeşil.

## 4. Geri dönüş ve karşılaştırma

- `npm test` (yerel) ve `npm run test:serial` DEĞİŞMEZ.
- `workflow_dispatch` girişi `layout: serial` → tek iş eski düzeni (`npm test`) koşar, gruplar koşmaz. Yeni düzen bozulursa tek satırla
  varsayılan `serial` yapılır.
- **Karşılaştırma (aynı commit):** iki düzenin JSON raporları `scripts/ci-compare-layouts.mjs` ile: dosya kümesi aynı, dosya başına
  geçen / atlanan test sayısı aynı. Sonuç `docs/arastirma-2026-10-31/ci-paralel.md`.
- **Tekrar:** yeni düzen aynı commit'te 3 kez (workflow_dispatch); süre (iş başına), kararsız test (bir koşuda kırmızı ötekinde yeşil),
  kaynak (iş başına çalıştırıcı dakikası) raporlanır.

## 5. Bilerek YAPILMAYAN

- Test atlamak, `retry`, süre sınırı artırmak, `continue-on-error`: YOK.
- `vitest --shard` (dosya sayısına göre böler, süreye göre değil; bölme kuralı vitest sürümüne bağlı) yerine kendi saf dağıtıcımız.
- Grupların ortak bir PostgreSQL servisi paylaşması: YOK (kurucunun asıl riski).

## 6. Beklenen kazanç

Veritabanlı kol ≈ 3'e bölünür: ≈ 29 dk → grup başına ≈ 10 dk + kurulum (~2 dk) ⇒ CI ≈ 12–13 dk. Ölçüm §4 sonrası buraya yazılır.
