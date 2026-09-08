# ÖLÇÜM — bilgi tabanı boşken / A5 akışıyla doldurulduktan sonra

> Bu dosya `tests/integration/kb-coverage-before-after.test.ts` tarafından ÜRETİLİR; elle yazılmaz.
> 🚨 **Bu bir model kalite eval'i DEĞİLDİR.** Model bu ölçümde mock'lu. Ölçülen şey: modele giden
> BAĞLAM, ürünün KARARI ve İZLENEBİLİRLİK. Modelin kendi cümlesinin kalitesi gerçek anahtarla
> `evals/` koşusunda ölçülür (`docs/EVAL-CALISTIRMA.md`).

## Host'un yaptığı iş
Tek adım: aşağıdaki metni yapıştır → "Önizle" → "Seçilenleri ekle".
Elle doldurulan form sayısı: **0** (önceden 2 ayrı kayıt için 2 kez form doldurmak gerekiyordu).

```
Merhaba {isim}, dairemize hoş geldiniz!
Otopark bina altındadır ve misafirlerimiz için ücretsizdir.
Çöpleri binanın yan sokağındaki konteynere bırakabilirsiniz.
Çıkış saati 11:00'dir.
```

Çıkarım sonucu: **2 bilgi önerisi** (parking, trash) ·
**1 mülk ayarı önerisi** (checkOutTime=11:00) ·
**1 satır atlandı** (placeholder).

## Misafirin sorusu
> Otopark var mı?

| | ÖNCE (boş KB) | SONRA (A5 ile dolu) |
|---|---|---|
| Modele giden bilgi tabanı | `(bilgi tabanı boş — bu mülk için kayıtlı bilgi yok)` | `- [TRASH] Çöp ve geri dönüşüm: Çöpleri binanın yan sokağındaki konteynere bırakabilirsiniz` |
| İsteme giren kalem | 0 | 2 |
| Modelin beyanı / doğrulanan | 0 / 0 | 1 / 1 |
| Temellendirme sınıfı | `absent` | `grounded` |
| Ürünün kararı | **DEVİR** (ev sahibine) | **CEVAP** (misafire) |
| Misafirin gördüğü | "Mesajınız kaydedildi; ev sahibiniz sohbet ekranından görüntüleyebilir." | "Otopark bina altındadır ve ücretsizdir." |
| Host ekranındaki "eksik" satırı | 1 var | 0 (düştü) |

## Okuma
Boş bilgi tabanında ürün **doğru olanı yapıyor** (uydurmuyor, devrediyor) — ama misafir cevap almıyor
ve host'un telefonu çalıyor. Dolu bilgi tabanında aynı soru **misafire anında** cevaplanıyor ve karar
kaydı bunun neye dayandığını (`kbEvidenceJson`) taşıyor. Yani asıl kazanç modelde değil, **modele ne
verildiğinde**; A5 o girdiyi doldurmanın maliyetini form doldurmaktan metin yapıştırmaya indiriyor.
