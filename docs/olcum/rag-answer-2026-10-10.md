# RAG cevap düzeyi (2026-10-10)

- commit: f42d32c · küme: dev · grup başına en çok 40 soru · bilgi tabanı: soru başına 60 kalem
- geçerli cevap: 308 · üretilemeyen (yeniden denemeden sonra): 0 · eşleştirilmiş soru: 154
- cevap kaynağı: ham kayıt (bugünkü işleme) 27 · taze çağrı 281 · ESKİ İŞLENMİŞ kayıt 0
- yapılandırma `live+phist` (çözülmüş): gömme text-embedding-3-small @ eşik 0.4 · anlama AÇIK · geçmiş ÜRETİM biçimi · sıralayıcı ilk 60 TEK çağrı · kırpma 600 · tavan 2500 ms · okuma 400 · blok varsayılan kr / varsayılan parça
- yapılandırma `live+wide+phist` (çözülmüş): gömme text-embedding-3-small @ eşik 0.4 · anlama AÇIK · geçmiş ÜRETİM biçimi · sıralayıcı ilk 60 TEK çağrı · kırpma 600 · tavan 2500 ms · okuma 400 · blok 23000 kr / 80 parça

Ölçü: blokta = cevap cümlesi bilgi bloğunda · sayılı = cevap cümlesi sayı taşıyan soru · sayı cevapta = sayı taşıyan HER
cevabın kendi sayısı yanıtta (iki sorulu mesajda İKİSİ de; 09-27'ye kadar herhangi biri yetiyordu) · cevap düzeyi = sayı taşıyan
cevaplardan yanıtta sayısı geçenler / hepsi · bilgim-yok = cevabın kendi yokluk itirafı · devir = cevap modelinin devir
niyeti · desteksiz iddia = üretimin iddia denetiminde verisiz somut iddia taşıyan cevap (yanıtsız soruda uydurma) · yabancı
sayı = cevap cümlelerinde / mülk alanlarında / misafirin yazdığında olmayan sayıyı söyleyen cevap (yalnız eşleştirilmiş fark).

Desteksiz iddia BUGÜNKÜ iddia denetimiyle yeniden hesaplanır (önbellekteki değer ücretli çağrı anındaki kodla; parantezde).
cevap kaçırıldı = cevap blokta VARKEN verilmedi (başarı değil, kırmızı değil; kurucu 09-27) · getirme kaçırdı = cevap bloğa girmedi
(dürüst devir o durumda doğru davranış).

katı cevap düzeyi (U20, 10-07; ayrı sütun, KAPI DEĞİL) = cevabın kendi sayılarının HEPSİ (aralıkta iki uç) yanıtta ve olumsuzlanmamış
cümlede — gevşek ölçü "Havuz 09:00–11:00" / "09:00'da açık değil" yanıtını da isabet sayıyordu; 10-07 öncesi raporlarda bu sütun yok.

| yapılandırma | grup | n | blokta | sayılı | sayı cevapta | cevap düzeyi | katı cevap düzeyi | bilgim-yok | devir | desteksiz iddia | yabancı sayı | KIRMIZI aday | cevap kaçırıldı | getirme kaçırdı |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| live+phist | single_tr | 40 | 39 | 13 | 10 | 10/13 | 10/13 | 1 | 0 | 0 (0) | 9 | 0 | 3 | 0 |
| live+phist | single_xx | 40 | 39 | 13 | 12 | 12/13 | 11/13 | 0 | 0 | 1 (1) | 6 | 1 | 1 | 0 |
| live+phist | multi | 40 | 39 | 19 | 16 | 22/25 | 21/25 | 2 | 0 | 0 (0) | 7 | 0 | 3 | 0 |
| live+phist | neg | 34 | — | 0 | 0 | 0/0 | 0/0 | 4 | 0 | 0 (0) | 0 | 0 | 0 | 0 |
| live+wide+phist | single_tr | 40 | 39 | 13 | 11 | 11/13 | 10/13 | 1 | 0 | 0 (0) | 10 | 0 | 2 | 0 |
| live+wide+phist | single_xx | 40 | 39 | 13 | 12 | 12/13 | 11/13 | 0 | 0 | 1 (1) | 8 | 1 | 1 | 0 |
| live+wide+phist | multi | 40 | 39 | 19 | 15 | 21/25 | 20/25 | 2 | 0 | 0 (0) | 6 | 0 | 4 | 0 |
| live+wide+phist | neg | 34 | — | 0 | 0 | 0/0 | 0/0 | 4 | 0 | 0 (0) | 0 | 0 | 0 | 0 |

KIRMIZI ADAY vakalar (2; kurucu kararı 09-27 — müşteriye giden cevap: kanıtsız iddia / yanlış sayı / başka olgu / uydurma /
çelişkide kesin saat / sızıntı). ⚠️ ADAY: son hüküm bağımsız KÖR inceleyicinin (kurucu 09-27; yardımcı model yalnız ön eleme); `baska_olgu`
= yalnız bloktaki BAŞKA kalemin sayısı (yanlış yere verilmiş bilgi ya da doğru ek bilgi — kodla ayrılamaz).
- live+phist · d_sights_7_f0_q1 · kanitsiz_iddia
- live+wide+phist · d_sights_7_f0_q1 · kanitsiz_iddia

## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `f42d32c`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Anlama katmanı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Konaklama bekçisi | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Yeniden sıralayıcı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Çeviri | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Üslup özeti | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Karar metni yazıcısı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=1` · `KB_RERANK_ENABLED=1` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=1` · `AI_STAY_GUARD_ENABLED=(boş)` · `AI_CONVERSATION_ITEMS_ENABLED=1` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=1` · `AI_HOUSE_RULES_SHADOW=(boş)` · `AI_KB_FEE_RULE_ENABLED=1` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=1` · `AI_HOST_DECISION_HOLD_ENABLED=1` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=1` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)` · `AI_DATE_RESOLUTION_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `1a875b31d233` (öğe + yabancı dil örneği `6772725db6f1`) · anlama `069db86596e0` (kip: items+cfu)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.
