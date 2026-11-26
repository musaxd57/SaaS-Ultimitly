# Ev kuralları — anlama katmanı konu + tutum eval'i (2026-09-26)

Durum: **GEÇERLİ** · commit `a5f2d5c` · veri sürümü 1 · 82 satır
Model: `gpt-5.1` · reasoning_effort: model varsayılanı · anlama kipi: öğe + kural (canlının kipi)

`dev` bölümü kural istemi ekini yazan geliştiricinin yazdığı settir (GÖRÜLDÜ, iyimser). Karara bağlama onayı YALNIZ kör
yazılmış `holdout` bölümüyle. Sınıflar etiket ile modelin çıktısının AYNI karar tablosundan geçmesiyle bulunur
(`tests/eval/house-rules-metrics.ts`): "konu yok" ile "misafirin eylemi değil" aynı sonuçtur.

## dev

| ölçü | değer |
|---|---|
| Konu bulundu (etiketteki olumlu kayıtlar) | 58/59 (%98) |
| — tutum da birebir | 55/58 (%95) |
| Konu olmayan mesajda olumlu konu üretti | 1/25 (%4) |
| **Yasak kuralda: "misafir değil" diye ATLANDI (tehlikeli sınıf)** | 0 |
| Yasak kuralda: yanlış / gereksiz kural cümlesi | 1 — d-hr020 |
| Yasak kuralda: ev sahibine haber eksik ("yapacağız" → "soruyor") | 2 — d-hr038, d-hr079 |
| Yasak kuralda: konu kaçtı (bugünkü kelime listesi sürer) | 1 — d-hr079 |
| Kural yokken: gereksiz tutma | 2 — d-hr014, d-hr039 |
| Bilinmiyor (model düştü; satır sayılmadı) | 0 |
| Kelime listesi (bugün): gerçek kural konusunu tuttu | 10/57 (%18) |
| Kelime listesi (bugün): kural konusu olmayanı tuttu | 8/25 (%32) |

| dil | konu bulundu | konu olmayanda olumlu konu |
|---|---|---|
| ar | 3/3 | 0/0 |
| de | 4/4 | 0/1 |
| en | 20/21 | 0/9 |
| es | 2/2 | 0/1 |
| fr | 4/4 | 0/1 |
| ru | 4/4 | 0/0 |
| tr | 21/21 | 1/13 |

## Satır başına

| kimlik | dil | etiket | model | kelime listesi |
|---|---|---|---|---|
| d-hr001 | tr | party_event/asks_permission | party_event/asks_permission | — |
| d-hr002 | tr | party_event/announces | party_event/announces | tuttu |
| d-hr003 | tr | party_event/asks_info | party_event/asks_info | tuttu |
| d-hr004 | tr | party_event/not_about_guest | party_event/not_about_guest | tuttu |
| d-hr005 | tr | party_event/not_about_guest | party_event/not_about_guest | tuttu |
| d-hr006 | tr | party_event/not_about_guest | party_event/not_about_guest | tuttu |
| d-hr007 | en | party_event/asks_permission | party_event/asks_permission | tuttu |
| d-hr008 | en | party_event/announces | party_event/announces | tuttu |
| d-hr009 | en | party_event/asks_info | party_event/asks_info | tuttu |
| d-hr010 | en | party_event/not_about_guest | party_event/not_about_guest | tuttu |
| d-hr011 | en | — | — | tuttu |
| d-hr012 | de | party_event/announces | party_event/announces | — |
| d-hr013 | fr | party_event/asks_permission | party_event/asks_permission | — |
| d-hr014 | es | party_event/asks_info | party_event/asks_permission | — |
| d-hr015 | ru | party_event/asks_permission | party_event/asks_permission | — |
| d-hr016 | ar | party_event/asks_permission | party_event/asks_permission | — |
| d-hr017 | tr | smoking/asks_permission | smoking/asks_permission | tuttu |
| d-hr018 | tr | smoking/announces | smoking/announces | — |
| d-hr019 | tr | smoking/asks_info | smoking/asks_info | — |
| d-hr020 | tr | smoking/not_about_guest | smoking/asks_info | — |
| d-hr021 | tr | smoking/not_about_guest | smoking/not_about_guest | — |
| d-hr022 | en | smoking/asks_permission | smoking/asks_permission | — |
| d-hr023 | en | smoking/announces | smoking/announces | — |
| d-hr024 | en | smoking/asks_info | smoking/asks_info | — |
| d-hr025 | en | smoking/not_about_guest | smoking/not_about_guest | — |
| d-hr026 | de | smoking/asks_permission | smoking/asks_permission | — |
| d-hr027 | fr | smoking/announces | smoking/announces | — |
| d-hr028 | ru | smoking/asks_info | smoking/asks_info | — |
| d-hr029 | tr | pets/asks_permission | pets/asks_permission | tuttu |
| d-hr030 | tr | pets/announces | pets/announces | — |
| d-hr031 | tr | pets/asks_info | pets/asks_info | tuttu |
| d-hr032 | tr | pets/not_about_guest | pets/not_about_guest | — |
| d-hr033 | en | pets/asks_permission | pets/asks_permission | — |
| d-hr034 | en | pets/announces | pets/announces | — |
| d-hr035 | en | pets/asks_info | pets/asks_info | — |
| d-hr036 | en | pets/not_about_guest | — | tuttu |
| d-hr037 | de | pets/asks_permission | pets/asks_permission | — |
| d-hr038 | es | pets/announces | pets/asks_permission | — |
| d-hr039 | ar | pets/asks_info | pets/asks_permission | — |
| d-hr040 | tr | extra_guests/asks_permission | extra_guests/asks_permission | — |
| d-hr041 | tr | extra_guests/announces | extra_guests/announces | — |
| d-hr042 | tr | extra_guests/asks_info | extra_guests/asks_info | — |
| d-hr043 | tr | extra_guests/not_about_guest | — | tuttu |
| d-hr044 | en | extra_guests/asks_permission | extra_guests/asks_permission | — |
| d-hr045 | en | extra_guests/announces | extra_guests/announces | — |
| d-hr046 | en | extra_guests/asks_info | extra_guests/asks_info | — |
| d-hr047 | en | extra_guests/not_about_guest | — | — |
| d-hr048 | fr | extra_guests/asks_permission | extra_guests/asks_permission | — |
| d-hr049 | ru | extra_guests/announces | extra_guests/announces | — |
| d-hr050 | tr | quiet_hours/asks_permission | quiet_hours/asks_permission | — |
| d-hr051 | tr | quiet_hours/asks_info | quiet_hours/asks_info | — |
| d-hr052 | tr | quiet_hours/not_about_guest | quiet_hours/not_about_guest | — |
| d-hr053 | en | quiet_hours/asks_permission | quiet_hours/asks_permission | — |
| d-hr054 | en | quiet_hours/asks_info | quiet_hours/asks_info | — |
| d-hr055 | en | quiet_hours/not_about_guest | quiet_hours/not_about_guest | — |
| d-hr056 | de | quiet_hours/asks_info | quiet_hours/asks_info | — |
| d-hr057 | es | quiet_hours/not_about_guest | quiet_hours/not_about_guest | — |
| d-hr058 | tr | visitors/asks_permission | visitors/asks_permission | — |
| d-hr059 | tr | visitors/announces | visitors/announces | — |
| d-hr060 | tr | visitors/asks_info | visitors/asks_info | — |
| d-hr061 | tr | — | — | — |
| d-hr062 | en | visitors/asks_permission | visitors/asks_permission | — |
| d-hr063 | en | visitors/announces | visitors/announces | — |
| d-hr064 | en | visitors/asks_info | visitors/asks_info | — |
| d-hr065 | en | — | — | — |
| d-hr066 | fr | visitors/asks_permission | visitors/asks_permission | — |
| d-hr067 | ru | visitors/asks_info | visitors/asks_info | — |
| d-hr068 | ar | visitors/announces | visitors/announces | — |
| d-hr069 | tr | — | — | — |
| d-hr070 | tr | — | — | — |
| d-hr071 | tr | — | — | — |
| d-hr072 | en | — | — | — |
| d-hr073 | fr | — | — | tuttu |
| d-hr074 | de | — | — | — |
| d-hr075 | tr | pets/asks_permission | pets/asks_permission | tuttu |
| d-hr076 | en | smoking/asks_permission | smoking/asks_permission | — |
| d-hr077 | tr | visitors/asks_permission smoking/asks_permission | visitors/asks_permission smoking/asks_permission | tuttu |
| d-hr078 | en | pets/announces | pets/announces | — |
| d-hr079 | en | quiet_hours/announces party_event/announces | party_event/announces | — |
| d-hr080 | tr | extra_guests/announces | extra_guests/announces | — |
| d-hr081 | en | visitors/not_about_guest | — | — |
| d-hr082 | tr | quiet_hours/not_about_guest | quiet_hours/not_about_guest | — |
