# Ham model kolu — fable-5.2

Aynı misafir mesajı + aynı notlarla, ürünün kapıları olmadan modelin kendi kararı; ürün ölçerinin ihtiyaç cetveliyle (`tests/eval/need-scoring.ts`) puanlandı.
Kollar: ham (hiçbir denetim) · yalnız kodun sınayabildiği denetim · ek olarak modelin varlık / koşul beyanı. Sözcük / kök sözlüğü yok.
Ürün kolundan farkı: ham kolda öğe defteri yoktur — yalnız GİDEN METİN puanlanır; ürün kolunda ek olarak "öğe cevaplandı sayıldı ama değer gitmedi" yanlışı da sayılır.

## grounding-dev

Senaryo 43 · ham çıktısı olmayan 0 · biçimi bozuk 0 · modelin çıkardığı istek 63

| Kol | Doğru cevap | Gereksiz tutma | Açık kaldı | 🚨 Yanlış gönderim |
|---|---|---|---|---|
| ham model (kapısız) | 34 / 34 | 0 | 28 / 28 | **0** |
| ham + yalnız mekanik denetim (alıntı notta · sayı alıntıda) | 34 / 34 | 0 | 28 / 28 | **0** |
| ham + mekanik + modelin varlık / koşul beyanı | 34 / 34 | 0 | 28 / 28 | **0** |

Denetimin düşürdüğü cümleler (sebep → sayı): yok

## turn-messages-dev

Senaryo 16 · ham çıktısı olmayan 0 · biçimi bozuk 0 · modelin çıkardığı istek 29

| Kol | Doğru cevap | Gereksiz tutma | Açık kaldı | 🚨 Yanlış gönderim |
|---|---|---|---|---|
| ham model (kapısız) | 24 / 24 | 0 | 4 / 4 | **0** |
| ham + yalnız mekanik denetim (alıntı notta · sayı alıntıda) | 23 / 24 | 1 | 4 / 4 | **0** |
| ham + mekanik + modelin varlık / koşul beyanı | 23 / 24 | 1 | 4 / 4 | **0** |

Denetimin düşürdüğü cümleler (sebep → sayı): quote_too_short 1

