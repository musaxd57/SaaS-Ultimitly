# EŞLEŞTİRİLMİŞ RETRIEVAL EVAL — kb-retrieval-paired v1 (2026-09-09)

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
| Commit | f33fc53 |
| İstem parmak izi (`prompts.ts` sha256/12) | efcfa0fd2d28 |
| Bilgi tabanı parmak izi (tüm senaryolar) | 6562b7c6ace0 |
| Koşu kimliği | 172231-fgzt |

| Beklenen (senaryo×mod) | Tamamlanan | Geçti | Doğrulama düştü | GEÇERSİZ (model yok) | KAYIT YOK |
|---|---|---|---|---|---|
| 16 | 16 | 16 | 0 | 0 | 0 |

## Mod özeti

| Mod | satır | geçti | düştü | geçersiz | ort. bilgi bloğu (karakter) |
|---|---|---|---|---|---|
| legacy | 8 | 8 | 0 | 0 | 3578 |
| hybrid | 8 | 8 | 0 | 0 | 777 |

Eşleştirme farkı (iki modu da geçerli senaryolar): **yalnız hibrit geçti 0** · yalnız legacy geçti 0 · ikisi geçti 8 · ikisi düştü 0

## Senaryo × mod

| # | Mod | gold istemde? | blok kr. | seçilen/çekilen | geri çekilme | Sonuç | intent | risk | Güven | Beyan/Doğr. | makbuzsuz | kesin değer |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R1-uzun-rehber-ortasi | legacy | İSTEMDE DEĞİL | 3941 | 30/30 | — | ✅ | parking | none | 0.6 | 0/0 | — | yok |
| R1-uzun-rehber-ortasi | hybrid | istemde | 879 | 2/35 | none | ✅ | parking | none | 0.95 | 1/0 | — | yok |
| R2-yazim-hatasi | legacy | İSTEMDE DEĞİL | 3985 | 30/30 | — | ✅ | parking | none | 0.6 | 0/0 | — | yok |
| R2-yazim-hatasi | hybrid | istemde | 261 | 1/35 | none | ✅ | parking | none | 0.9 | 1/1 | — | yok |
| R3-ingilizce-soru | legacy | İSTEMDE DEĞİL | 3985 | 30/30 | — | ✅ | parking | none | 0.8 | 0/0 | — | yok |
| R3-ingilizce-soru | hybrid | istemde | 410 | 2/35 | none | ✅ | parking | none | 0.95 | 1/1 | — | yok |
| R4-cok-soru | legacy | istemde | 2941 | 22/22 | — | ✅ | general | none | 0.95 | 2/2 | — | yok |
| R4-cok-soru | hybrid | istemde | 438 | 3/22 | none | ✅ | general | none | 0.96 | 2/2 | — | yok |
| R5-celiskili-kaynak | legacy | istemde | 2975 | 22/22 | — | ✅ | checkout | low | 0.7 | 2/1 | — | yok |
| R5-celiskili-kaynak | hybrid | istemde | 323 | 2/22 | none | ✅ | checkout | low | 0.7 | 2/1 | — | yok |
| R6-bilgi-yok | legacy | gold yok | 2825 | 20/20 | — | ✅ | general | none | 0.78 | 0/0 | — | yok |
| R6-bilgi-yok | hybrid | gold yok | 2825 | 20/20 | no_lexical_hits | ✅ | amenity | none | 0.8 | 0/0 | — | yok |
| R7-turkce-esanlam | legacy | İSTEMDE DEĞİL | 3985 | 30/30 | — | ✅ | parking | none | 0.78 | 0/0 | — | yok |
| R7-turkce-esanlam | hybrid | istemde | 557 | 3/35 | none | ✅ | parking | none | 0.95 | 1/1 | — | yok |
| R8-konusma-baglami | legacy | İSTEMDE DEĞİL | 3985 | 30/30 | — | ✅ | refund | medium | 0.85 | 1/1 | — | yok |
| R8-konusma-baglami | hybrid | istemde | 526 | 3/35 | none | ✅ | parking | none | 0.9 | 2/2 | — | yok |

## Tam cevaplar (KIRPILMAZ)
### R1-uzun-rehber-ortasi · legacy (gold İSTEMDE DEĞİL)
**Soru:** Otopark var mı?

```
Otopark konusunda kayıtlı bilgim yok; mesajınız kaydedildi, ev sahibiniz görebilir.
```

### R1-uzun-rehber-ortasi · hybrid (gold istemde)
**Soru:** Otopark var mı?

```
Merhaba, binanın arkasında ücretsiz açık otopark bulunuyor ve giriş yan sokaktan sağlanıyor. Aracınızı oraya bırakabilirsiniz.
```

### R2-yazim-hatasi · legacy (gold İSTEMDE DEĞİL)
**Soru:** otopakr var mı

```
Otopark hakkında kayıtlı bilgim yok; mesajınız kaydedildi, ev sahibiniz görebilir.
```

### R2-yazim-hatasi · hybrid (gold istemde)
**Soru:** otopakr var mı

```
Merhaba, bina altındaki otoparkı misafirler ücretsiz olarak kullanabiliyor, girişi yan sokaktan.
```

### R3-ingilizce-soru · legacy (gold İSTEMDE DEĞİL)
**Soru:** Is there parking for my car?

```
Merhaba, otoparkla ilgili kayıtlı bir bilgim yok. Mesajınız kaydedildi; ev sahibiniz görebilir.
```

### R3-ingilizce-soru · hybrid (gold istemde)
**Soru:** Is there parking for my car?

```
Hello, yes, there is a parking area for guests. The building has a free underground parking garage for guests, with the entrance from the side street.
```

### R4-cok-soru · legacy (gold istemde)
**Soru:** Otopark var mı, çöpü nereye bırakayım?

```
Merhaba, bina altındaki otoparkı ücretsiz olarak kullanabilirsiniz. Çöpleri ise yan sokaktaki yeşil konteynere bırakabilirsiniz.
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
Merhaba, jakuzili banyo ile ilgili kayıtlı bir bilgim yok. Bu konuda net bilgi için rezervasyon sayfasındaki açıklamalara bakabilir veya ev sahibinize yazabilirsiniz.
```

### R6-bilgi-yok · hybrid (gold gold yok)
**Soru:** Jakuzi var mı?

```
Merhaba, jakuziyle ilgili kayıtlı bir bilgim yok; mesajınız kaydedildi, ev sahibiniz görebilir.
```

### R7-turkce-esanlam · legacy (gold İSTEMDE DEĞİL)
**Soru:** Arabayı nereye koyabilirim?

```
Otoparkla ilgili kayıtlı özel bir bilgim yok. Arabayı nereye koyabileceğiniz konusunda net bilgi için mesajınız kaydedildi, ev sahibiniz görebilir.
```

### R7-turkce-esanlam · hybrid (gold istemde)
**Soru:** Arabayı nereye koyabilirim?

```
Merhaba, arabanızı binanın arkasındaki misafirler için ücretsiz park alanına bırakabilirsiniz.
```

### R8-konusma-baglami · legacy (gold İSTEMDE DEĞİL)
**Soru:** Ücretli mi?

```
Otopark ücreti konusunda kayıtlı bir bilgim yok; bu konu ev sahibinizin kararıdır, mesajınız kaydedildi, ev sahibiniz görebilir.
```

### R8-konusma-baglami · hybrid (gold istemde)
**Soru:** Ücretli mi?

```
Merhaba, otopark bina altında misafirler için ücretsizdir.
```


## Düşen doğrulamaların gerekçeleri
Yok.
