# CI paralel test — ölçüm ve karşılaştırma (10-31)

Tasarım: `docs/TASARIM-2026-10-31-ci-paralel-test.md`. Kurucu şartları: aynı commit'te eski / yeni düzen karşılaştırması · bütün dosyalar dağıtımda,
kayıp yok, atlanan test artmıyor · grup başarısız / rapor eksikse son kapı KESİN kırmızı · birkaç tekrar (süre, kararsız test, kaynak) · test
atlama / hata yutma / sınır gevşetme yok · eski tek sıralı düzen geri dönüş.

## 1. Süre

| koşu | commit | toplam (push → son iş) | test işi |
|---|---|---|---|
| eski düzen (CI, tek iş) | 668b755d | ~20 dk | `verify` 20 dk 8 sn |
| yeni düzen (CI, 3 grup) | 1d4314b9 | **~10,5 dk** | grup 1: 8 dk 16 sn (test 496 sn) · grup 2: 7 dk 34 sn (454 sn) · grup 3: 7 dk 58 sn (478 sn) · veritabanısız: 10 dk 17 sn (typecheck 45 + lint 31 + test 313 + süre ölçen 150 sn) · son kapı 15 sn |

Darboğaz artık veritabanısız iş (typecheck + lint + iki test kolu sırayla). Grup dengesi ölçülmüş dosya sürelerinden (`tests/ci-shard-weights.json`):
3 × ~329 sn hesap → CI'da 454–496 sn (konteyner + PostgreSQL yükü), ±%5.

## 2. Aynı commit'te eski ↔ yeni (1d4314b9)

GitHub `workflow_dispatch` / yeniden koşturma bu oturumun iznine KAPALI (403 "Resource not accessible by integration") → eski düzen aynı commit'te
YEREL koşuldu (`TEST_REPORT_DIR` ile `npm test`, 2 073 sn, makine başka işle paylaşımlıydı):

| | eski düzen (yerel) | yeni düzen (CI son kapısı) |
|---|---|---|
| dosya | 1 194 (db 476 + nodb 638 + süre 80) | 1 194 |
| test | 21 202 | 21 202 |
| atlanan (skipped + todo) | 66 | 66 |
| başarısız | 0 | 0 |
| dosya başına atlanan haritası | işlenmiş tabanla (`tests/ci-skip-baseline.json`) BİREBİR | son kapı aynı tabana karşı denetledi (aşan dosya yok) |

## 3. Son kapının kırmızı olduğu sınandı (yerel, gerçek raporlarla benzetim + birim testler)

Tam set → YEŞİL. Bir iş `failure` → KIRMIZI · grup raporu eksik → KIRMIZI (o grubun 160 dosyası "kayıp") · başka commit'in raporu → KIRMIZI · bir dosyada
atlanan test tabanı aşıldı → KIRMIZI · taban dosyası yok → KIRMIZI · iş sonucu hiç gelmedi (boş `NEEDS_JSON`) → KIRMIZI · yeni test dosyası raporda
yok → KIRMIZI (benzetimde kendiliğinden yakalandı). Birim pinleri `tests/unit/ci-verify-core.test.ts` + iş akışı ↔ kod uyumu
`tests/unit/ci-workflow-shards.test.ts`; mutasyon 17/17.

## 4. Tekrarlar / kararsız test / kaynak

Tekrar koşuları için `workflow_dispatch` gerekir (bu oturumda 403). **Kurucu adımı:** GitHub → Actions → CI → "Run workflow" → `layout: sharded`
(3 kez) ve bir kez `serial`; ya da oturuma Actions yazma izni. O zamana kadar her push bir tekrar sayılır; sonraki push'ların süreleri buraya eklenir.
Kaynak: yeni düzen 5 çalıştırıcı × ~8–10 dk ≈ 45 çalıştırıcı-dk / push (eski ~25) — repo PUBLIC iken ücretsiz; private olursa ayda 2000 dk kotası
~44 push'a yeter (eskisi ~80).

## 5. Geri dönüş

`workflow_dispatch` → `layout: serial` eski tek işi (`verify-serial`, `npm test`) koşar; push'ta varsayılan `sharded`. Ayrı eşzamanlılık grubu:
el ile koşu push koşusunu iptal etmez.
