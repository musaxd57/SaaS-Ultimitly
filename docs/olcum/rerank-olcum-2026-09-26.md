# #186 OpenAI yeniden sıralayıcı — ölçüm (2026-09-26)

Durum: **GEÇERLİ** · yeniden sıralama modeli `gpt-5.1` · gömme `text-embedding-3-small` · commit `47e9381`
Aday: ilk 20 (alt sorgular arası sırayla) · eşik 0.3 · veri SENTETİK (E4 kümesi). Çağrı 288, düşen 0.
Tahmini girdi token (karakter/4): 276.697 · gecikme p50 857 ms · p95 1321 ms.

| boyut | grup | n | embedding (bugün) | + yeniden sıralama | kazanç | kayıp |
|---|---|---|---|---|---|---|
| 100 | scale | 30 | 100% | 100% | 0 | 0 |
| 100 | para | 82 | 67% | 78% | 9 | 0 |
| 100 | multi | 39 | 62% | 74% | 5 | 0 |
| 300 | scale | 30 | 100% | 100% | 0 | 0 |
| 300 | para | 82 | 50% | 57% | 6 | 0 |
| 300 | multi | 39 | 31% | 41% | 4 | 0 |

Ölçü: cevap cümlesi istem bloğunda (çok sorulu mesajda İKİ cevap da). Kayıp = yeniden sıralama sonrası düşen.
