# EŞLEŞTİRİLMİŞ RETRIEVAL EVAL — kb-retrieval-paired v1 (2026-09-11)

> Bu dosya `tests/eval/kb-retrieval-paired.eval.test.ts` tarafından ÜRETİLİR; elle yazılmaz. LLM grader YOK.
> Aynı soru + aynı bilgi tabanı, iki mod: **legacy** (en yeni 30 + 24k) · **hybrid** (en yeni 200 + soruya göre parça).
> "gold" = cevabı taşıyan cümle(ler); istemde olup olmadığı KODDAN ölçülür. Kaynak istemde DEĞİLKEN "doğru" cevap DESTEKSİZ sayılır.
> 🚨 Sentetik retrieval ölçümü (kaynak bloğa girdi mi) ile bu ölçüm (cevap doğru mu) AYRIDIR; biri ötekinin yerine geçmez.
> Koşu tam: beklenen 16 satırın (senaryo × mod) hepsi tamamlandı.

## Kanıt zinciri

| Alan | Değer |
|---|---|
| İstenen model (`OPENAI_MODEL`) | **env verilmedi** → kod içi varsayılan |
| Sağlayıcının bildirdiği model | **KAYDEDİLMEDİ** — `suggestReply` yanıtın model kimliğini çağırana döndürmüyor |
| Commit | 77b986d |
| İstem parmak izi (`prompts.ts` sha256/12) | f8265e3231b8 |
| Bilgi tabanı parmak izi (tüm senaryolar) | 6562b7c6ace0 |
| Koşu kimliği | 115520-wwk5 |

| Beklenen (senaryo×mod) | Tamamlanan | Geçti | Doğrulama düştü | GEÇERSİZ (model yok) | KAYIT YOK |
|---|---|---|---|---|---|
| 16 | 16 | 9 | 7 | 0 | 0 |

## Mod özeti

| Mod | satır | geçti | düştü | geçersiz | ort. bilgi bloğu (karakter) |
|---|---|---|---|---|---|
| legacy | 8 | 2 | 6 | 0 | 3578 |
| hybrid | 8 | 7 | 1 | 0 | 740 |

Eşleştirme farkı (iki modu da geçerli senaryolar): **yalnız hibrit geçti 5** · yalnız legacy geçti 0 · ikisi geçti 2 · ikisi düştü 1

## Senaryo × mod

| # | Mod | gold istemde? | blok kr. | seçilen/çekilen | geri çekilme | Sonuç | intent | risk | Güven | Beyan/Doğr. | makbuzsuz | kesin değer |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R1-uzun-rehber-ortasi | legacy | İSTEMDE DEĞİL | 3941 | 30/30 | — | ❌ | parking | none | 0.3 | 0/0 | — | yok |
| R1-uzun-rehber-ortasi | hybrid | istemde | 879 | 2/35 | none | ✅ | parking | none | 0.95 | 1/0 | — | yok |
| R2-yazim-hatasi | legacy | İSTEMDE DEĞİL | 3985 | 30/30 | — | ❌ | parking | none | 0.3 | 0/0 | — | yok |
| R2-yazim-hatasi | hybrid | istemde | 261 | 1/35 | none | ✅ | parking | none | 0.9 | 1/1 | — | yok |
| R3-ingilizce-soru | legacy | İSTEMDE DEĞİL | 3985 | 30/30 | — | ❌ | parking | none | 0.3 | 0/0 | — | yok |
| R3-ingilizce-soru | hybrid | istemde | 410 | 2/35 | none | ✅ | parking | none | 0.95 | 1/1 | — | yok |
| R4-cok-soru | legacy | istemde | 2941 | 22/22 | — | ✅ | general | none | 0.96 | 2/2 | — | yok |
| R4-cok-soru | hybrid | istemde | 289 | 2/22 | none | ✅ | general | none | 0.95 | 2/2 | — | yok |
| R5-celiskili-kaynak | legacy | istemde | 2975 | 22/22 | — | ✅ | checkout | low | 0.7 | 2/1 | — | yok |
| R5-celiskili-kaynak | hybrid | istemde | 323 | 2/22 | none | ✅ | checkout | low | 0.7 | 2/2 | — | yok |
| R6-bilgi-yok | legacy | gold yok | 2825 | 20/20 | — | ❌ | amenity | none | 0.35 | 0/0 | — | yok |
| R6-bilgi-yok | hybrid | gold yok | 2825 | 20/20 | no_lexical_hits | ❌ | general | none | 0.35 | 0/0 | — | yok |
| R7-turkce-esanlam | legacy | İSTEMDE DEĞİL | 3985 | 30/30 | — | ❌ | parking | none | 0.3 | 0/0 | — | yok |
| R7-turkce-esanlam | hybrid | istemde | 408 | 2/35 | none | ✅ | parking | none | 0.95 | 1/1 | — | yok |
| R8-konusma-baglami | legacy | İSTEMDE DEĞİL | 3985 | 30/30 | — | ❌ | refund | medium | 0.8 | 1/1 | — | yok |
| R8-konusma-baglami | hybrid | istemde | 526 | 3/35 | none | ✅ | parking | none | 0.9 | 2/2 | — | yok |

## Tam cevaplar (KIRPILMAZ)
### R1-uzun-rehber-ortasi · legacy (gold İSTEMDE DEĞİL)
**Soru:** Otopark var mı?

```
Otopark hakkında net bilgiyi ev sahibiniz paylaşabilir.
```
**Not:** bilgi yokluğunu SÖYLEMİYOR (kaynak istemde yokken tek dürüst seçenek; NOT: bu metin misafire gitmez, devir olur)

### R1-uzun-rehber-ortasi · hybrid (gold istemde)
**Soru:** Otopark var mı?

```
Merhaba, aracınızı binanın arkasındaki açık otoparka ücretsiz olarak bırakabilirsiniz.
```

### R2-yazim-hatasi · legacy (gold İSTEMDE DEĞİL)
**Soru:** otopakr var mı

```
Otopark durumu için ev sahibiniz size net bilgi verebilir.
```
**Not:** bilgi yokluğunu SÖYLEMİYOR (kaynak istemde yokken tek dürüst seçenek; NOT: bu metin misafire gitmez, devir olur)

### R2-yazim-hatasi · hybrid (gold istemde)
**Soru:** otopakr var mı

```
Merhaba, bina altındaki otoparkı misafirler ücretsiz olarak kullanabiliyor, girişi yan sokaktan.
```

### R3-ingilizce-soru · legacy (gold İSTEMDE DEĞİL)
**Soru:** Is there parking for my car?

```
Otopark imkânı hakkında net bilgiyi ev sahibiniz paylaşabilir.
```
**Not:** bilgi yokluğunu SÖYLEMİYOR (kaynak istemde yokken tek dürüst seçenek; NOT: bu metin misafire gitmez, devir olur)

### R3-ingilizce-soru · hybrid (gold istemde)
**Soru:** Is there parking for my car?

```
Hello, yes, there is a parking garage under the building and it is free for guests. The entrance is from the side street.
```

### R4-cok-soru · legacy (gold istemde)
**Soru:** Otopark var mı, çöpü nereye bırakayım?

```
Merhaba, bina altındaki otoparkı ücretsiz olarak kullanabilirsiniz. Çöpleri de yan sokaktaki yeşil konteynere bırakabilirsiniz.
```

### R4-cok-soru · hybrid (gold istemde)
**Soru:** Otopark var mı, çöpü nereye bırakayım?

```
Merhaba, bina altındaki otoparkı ücretsiz olarak kullanabilirsiniz. Çöpleri ise yan sokaktaki yeşil konteynere bırakabilirsiniz.
```

### R5-celiskili-kaynak · legacy (gold istemde)
**Soru:** Çıkış saati kaçta?

```
Merhaba, çıkış saatiyle ilgili kayıtlarım tutarsız; mesajınız kaydedildi, ev sahibiniz görebilir.
```

### R5-celiskili-kaynak · hybrid (gold istemde)
**Soru:** Çıkış saati kaçta?

```
Merhaba, çıkış saatiyle ilgili kayıtlarım tutarsız; mesajınız kaydedildi, ev sahibiniz görebilir.
```

### R6-bilgi-yok · legacy (gold gold yok)
**Soru:** Jakuzi var mı?

```
Jakuziyle ilgili net bilgi için ev sahibiniz size yardımcı olabilir.
```
**Not:** bilgi yokluğunu SÖYLEMİYOR (kaynak istemde yokken tek dürüst seçenek; NOT: bu metin misafire gitmez, devir olur)

### R6-bilgi-yok · hybrid (gold gold yok)
**Soru:** Jakuzi var mı?

```
Jakuzi olup olmadığı konusunda ev sahibiniz size net bilgi verebilir.
```
**Not:** bilgi yokluğunu SÖYLEMİYOR (kaynak istemde yokken tek dürüst seçenek; NOT: bu metin misafire gitmez, devir olur)

### R7-turkce-esanlam · legacy (gold İSTEMDE DEĞİL)
**Soru:** Arabayı nereye koyabilirim?

```
Otoparkla ilgili net bilgiyi ev sahibiniz size iletebilir.
```
**Not:** bilgi yokluğunu SÖYLEMİYOR (kaynak istemde yokken tek dürüst seçenek; NOT: bu metin misafire gitmez, devir olur)

### R7-turkce-esanlam · hybrid (gold istemde)
**Soru:** Arabayı nereye koyabilirim?

```
Merhaba, arabanızı binanın arkasındaki misafirler için ücretsiz olan park alanına koyabilirsiniz.
```

### R8-konusma-baglami · legacy (gold İSTEMDE DEĞİL)
**Soru:** Ücretli mi?

```
Otopark ücreti konusu ev sahibinizin kararıdır; mesajınız kaydedildi, ev sahibiniz görebilir.
```
**Not:** bilgi yokluğunu SÖYLEMİYOR (kaynak istemde yokken tek dürüst seçenek; NOT: bu metin misafire gitmez, devir olur)

### R8-konusma-baglami · hybrid (gold istemde)
**Soru:** Ücretli mi?

```
Merhaba, otopark misafirler için ücretsizdir.
```


## Düşen doğrulamaların gerekçeleri
- **R1-uzun-rehber-ortasi · legacy** — 7k rehberin ORTASINDAKİ otopark cümlesi; kalem en eski → legacy'de rehber en-yeni-30 dışında kalır, hibrit parçayı seçer. Kıyas: legacy dürüst 'bilgim yok' demeli, hibrit doğru cevaplamalı.
  - bilgi yokluğunu SÖYLEMİYOR (kaynak istemde yokken tek dürüst seçenek; NOT: bu metin misafire gitmez, devir olur)
- **R2-yazim-hatasi · legacy** — Yazım hatalı soru; kalem eski. Legacy kalemi göremez; hibrit fuzzy ile bulur.
  - bilgi yokluğunu SÖYLEMİYOR (kaynak istemde yokken tek dürüst seçenek; NOT: bu metin misafire gitmez, devir olur)
- **R3-ingilizce-soru · legacy** — İngilizce soru / Türkçe kalem (sözlük köprüsü); kalem eski. n-gram 'auto' İngilizce sorguya dokunmaz — sözcüksel köprü tek başına yeterli mi ölçülür.
  - bilgi yokluğunu SÖYLEMİYOR (kaynak istemde yokken tek dürüst seçenek; NOT: bu metin misafire gitmez, devir olur)
- **R6-bilgi-yok · legacy** — Konu bilgi tabanında YOK. Hibrit geri çekilir (no_lexical_hits → tam küme = legacy ile aynı blok); iki modda da dürüst 'bilgim yok' + makbuzsuz söz yok (E1 sözleşmesi).
  - bilgi yokluğunu SÖYLEMİYOR (kaynak istemde yokken tek dürüst seçenek; NOT: bu metin misafire gitmez, devir olur)
- **R6-bilgi-yok · hybrid** — Konu bilgi tabanında YOK. Hibrit geri çekilir (no_lexical_hits → tam küme = legacy ile aynı blok); iki modda da dürüst 'bilgim yok' + makbuzsuz söz yok (E1 sözleşmesi).
  - bilgi yokluğunu SÖYLEMİYOR (kaynak istemde yokken tek dürüst seçenek; NOT: bu metin misafire gitmez, devir olur)
- **R7-turkce-esanlam · legacy** — Soru 'araba', kalem 'araç park yeri' (sözlük genişletmesi); kalem eski → legacy göremez.
  - bilgi yokluğunu SÖYLEMİYOR (kaynak istemde yokken tek dürüst seçenek; NOT: bu metin misafire gitmez, devir olur)
- **R8-konusma-baglami · legacy** — İnce soru; konu önceki misafir mesajından taşınır. Kalem eski → legacy göremez; hibrit bağlamla bulur.
  - bilgi yokluğunu SÖYLEMİYOR (kaynak istemde yokken tek dürüst seçenek; NOT: bu metin misafire gitmez, devir olur)
