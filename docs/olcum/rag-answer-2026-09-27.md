# RAG cevap düzeyi (2026-09-27)

- commit: f263f92 · küme: dev · grup başına en çok 80 soru · bilgi tabanı: soru başına 60 kalem
- geçerli cevap: 552 · üretilemeyen (yeniden denemeden sonra): 0 · eşleştirilmiş soru: 276

Ölçü: blokta = cevap cümlesi bilgi bloğunda · sayılı = cevap cümlesi sayı taşıyan soru · sayı cevapta = sayılı soruda
cevabın sayılardan en az birini söylemesi · bilgim-yok = cevabın kendi yokluk itirafı · devir = cevap modelinin devir
niyeti · desteksiz iddia = üretimin iddia denetiminde verisiz somut iddia taşıyan cevap (yanıtsız soruda uydurma) · yabancı
sayı = cevap cümlelerinde / mülk alanlarında / misafirin yazdığında olmayan sayıyı söyleyen cevap (yalnız eşleştirilmiş fark).

| yapılandırma | grup | n | blokta | sayılı | sayı cevapta | bilgim-yok | devir | desteksiz iddia | yabancı sayı |
|---|---|---|---|---|---|---|---|---|---|
| s0.25+und+e3l | single_tr | 80 | 75 | 36 | 30 | 0 | 0 | 5 | 23 |
| s0.25+und+e3l | single_xx | 80 | 77 | 36 | 32 | 0 | 0 | 5 | 19 |
| s0.25+und+e3l | multi | 80 | 60 | 46 | 34 | 3 | 0 | 2 | 20 |
| s0.25+und+e3l | neg | 36 | — | 0 | 0 | 0 | 0 | 0 | 1 |
| s0.25+und+e3l+wide | single_tr | 80 | 80 | 36 | 34 | 0 | 0 | 1 | 19 |
| s0.25+und+e3l+wide | single_xx | 80 | 80 | 36 | 33 | 0 | 0 | 4 | 17 |
| s0.25+und+e3l+wide | multi | 80 | 77 | 46 | 36 | 3 | 0 | 4 | 19 |
| s0.25+und+e3l+wide | neg | 36 | — | 0 | 0 | 0 | 0 | 0 | 2 |
