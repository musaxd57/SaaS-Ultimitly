# #186 yeniden sıralayıcı — tavan teşhisi (2026-09-26)

Gömme `text-embedding-3-small` · commit `47e9381` · eşik 0.3 · veri SENTETİK (E4 kümesi). Ücretli LLM çağrısı YOK.
Soru: kaçan soruda cevap parçası aday listesinde mi? Listede ve ilk 20 içinde = yeniden sıralayıcının kurtarabileceği pay (TAVAN); listede yok = aday üretimi sorunu.

| boyut | kol | grup | n | isteme girdi | kaçan | kaçan: ilk 20 adayda | kaçan: daha aşağıda | kaçan: listede YOK | tavan (girdi + ilk 20) |
|---|---|---|---|---|---|---|---|---|---|
| 100 | lex | scale | 193 | 99% | 1 | 0 | 0 | 1 | 99% |
| 100 | lex | para | 82 | 40% | 49 | 0 | 0 | 49 | 40% |
| 100 | lex | multi | 39 | 23% | 30 | 2 | 0 | 28 | 28% |
| 100 | sem | scale | 193 | 99% | 1 | 1 | 0 | 0 | 100% |
| 100 | sem | para | 82 | 67% | 27 | 11 | 4 | 12 | 80% |
| 100 | sem | multi | 39 | 62% | 15 | 12 | 2 | 1 | 92% |
| 300 | lex | scale | 193 | 100% | 0 | 0 | 0 | 0 | 100% |
| 300 | lex | para | 82 | 37% | 52 | 2 | 1 | 49 | 39% |
| 300 | lex | multi | 39 | 13% | 34 | 6 | 0 | 28 | 28% |
| 300 | sem | scale | 193 | 99% | 1 | 1 | 0 | 0 | 100% |
| 300 | sem | para | 82 | 50% | 41 | 12 | 11 | 18 | 65% |
| 300 | sem | multi | 39 | 31% | 27 | 18 | 6 | 3 | 77% |

Not: çok sorulu satırda "kaçan" = iki cevaptan en az biri blokta değil; her kaçan cevap KENDİ altın kalemiyle ölçülür.
