# Luna 6.0 geçişi — katman bazında ölçüm (2026-10-09 gece → 10-10)

> Kurucu (10-09 gece): "Anlama yolunda Luna 6.0'a geçsek, yani direkt neredeyse her yerde Luna 6.0 — reasoning'li olabilir. Reasoning
> ekleyincedeki farkları da dene, kredimiz bol, derinliğini artırabilirsin." Önceki çalışma: `docs/SABAH-RAPORU-2026-10-01.md` §0a (Luna
> `low` cevap + anlama + bekçi, `medium` çeviri, `none` üslup; yeniden sıralayıcı 5.1'de). Bu belge bir hafta sonraki KODLA tekrar ölçer ve
> düşünme seviyesini (`none` / `low` / `medium` / `high`) karşılaştırır. Ham raporlar aynı klasörde (adlarda model; düşünme seviyesi her
> raporun "Koşu kimliği" bölümünde).

## Dalga 1 — cevap + anlama katmanı, kör konuşma durumu seti (46 senaryo × 2 kol) + kurucu 8 seti (8 × 2), commit `311da14`

| Yapılandırma (cevap / anlama) | Sızıntı | Yanlış susturma | Bekleme sözü | Genel netleştirme | Selam tekrarı | Beyan doğru (kapalı → açık) | Anlama doğru | Çıkış saati doğru | Belirsizde hedefli soru | p50 / p95 |
|---|---|---|---|---|---|---|---|---|---|---|
| 5.1 / 5.1 | 0 | 0 | 0 | 0 | 0 | 30/33 → 30/33 | 33/33 | 3/5 | 0/6 → 0/6 | 2,2 / 3,7 sn |
| Luna `low` / Luna `low` | 0 | 0 | 0 | 0 | 0 | 32/33 → 32/33 | 32/33 → 33/33 | 4/5 | 1/6 → 2/6 | 4,1 / 5,9 sn |
| Luna `medium` / Luna `low` | 0 | 0 | 0 | 0 | 0 | 32/33 → 33/33 | 33/33 | 4/5 | 0/6 → 1/6 | 5,6 / 11,0 sn |
| Kurucu 8 — Luna `none` / `none` | 0 | 0 | 0 | 0 | 0 | — | — | — | 0/1 | 2,2 / 3,2 sn |
| Kurucu 8 — Luna `low` / `low` | 0 | 0 | 0 | 0 | 0 | — | — | — | 1/1 → 0/1 | 4,2 / 5,8 sn |
| Kurucu 8 — Luna `medium` / `low` | 0 | 0 | 0 | 0 | 0 | — | — | — | 1/1 → 0/1 | 5,1 / 7,5 sn |

"Kapalı → açık" = konuşma durumu satırı (`AI_CONVERSATION_STATE_ENABLED`) kapalı / açık kol. Okuma:
- **Güvenlik ölçüleri her yapılandırmada 0** (sızıntı, yanlış susturma, misafire giden bekleme sözü, genel netleştirme, selam tekrarı).
- **Luna `low`, 5.1'den daha doğru:** cevap modelinin konaklama türü beyanı 32/33 ↔ 30/33, yolculuk / çıkış saati ayrımı 4/5 ↔ 3/5, belirsiz
  mesajda tek hedefli soru 1–2/6 ↔ 0/6. Bedel gecikme: p50 4,1 sn ↔ 2,2 sn (kanal oto-yanıtında hissedilmez; QR'de bekleme artar).
- **`medium` ek kazanç getirmiyor** (beyan 33/33 yalnız açık kolda, hedefli soru düşük), p95 11 sn — QR için fazla.
- **`none` en hızlısı (5.1 kadar)** ama belirsiz mesajda hedefli soru 0/1 — kurucu 8 setinde tek belirsiz senaryoyu kaçırdı.
- **Konuşma durumu satırı (açık kol) hiçbir yapılandırmada zarar vermedi**; Luna `low`da anlama 32/33 → 33/33, belirsizde hedefli soru 1 → 2.

## Dalga 2 — karar metni (kör kabul `decision-text-acc1`, 30 satır; bekçi Luna `low`)

| Yazıcı | YZ metni kullanıldı | Bağımsız yeniden denetim | Onayda karar saati | Dil | İç bilgi sızıntısı | Gerekçeli ret: beklenen gerekçe | Gerekçesiz ret: uydurma | p50 / p95 | Maliyet |
|---|---|---|---|---|---|---|---|---|---|
| Luna `low` | 30/30 | 30/30 | 15/15 | 28/28 | 0/30 | 5/10 | 0/5 | 3,4 / 5,4 sn | $0.0058 |
| Luna `medium` | 30/30 | 30/30 | 15/15 | 28/28 | 0/30 | 4/10 | 0/5 | 3,5 / 5,1 sn | $0.0066 |
| Luna `high` | 30/30 | 30/30 | 15/15 | 28/28 | 0/30 | **7/10** | 0/5 | 3,8 / 5,1 sn | $0.0072 |

Okuma: güvenlik ölçüleri üç seviyede de tam; `high` ret gerekçesini daha sık anıyor (sezgisel ölçü), gecikme / maliyet farkı küçük. Karar metni
yazıcısı bugün cevap modelinin ayarını paylaşıyor (`decisions/ai-text.ts` → `replyCallParams`) → karar #8: ayrı katman değişkeni.

Geliştirme seti (`decision-text-dev`, 40 satır; aynı bekçi) — yazıcı başına:

| Yazıcı | YZ metni kullanıldı | Yeniden denetim | Onayda saat | İç bilgi | Gerekçeli ret: beklenen gerekçe | Gerekçesiz ret: uydurma | p50 / p95 |
|---|---|---|---|---|---|---|---|
| 5.1 | 40/40 | 40/40 | 19/19 | 0 | **10/14** | 0/7 | 2,9 / 4,5 sn |
| Luna `low` | 40/40 | 40/40 | 19/19 | 0 | 5/14 | 0/7 | 3,4 / 4,9 sn |
| Luna `medium` | **33/40** (7 zaman aşımı → şablon) | 33/33 | 15/15 | 0 | 5/11 | 0/7 | 4,2 / 12,0 sn |
| Luna `high` | 40/40 | 40/40 | 19/19 | 0 | 7/14 | 0/7 | 3,7 / 5,4 sn |

Okuma: hiçbir yapılandırmada güvenlik ölçüsü bozulmadı (kod + bekçi denetimi tuttu; düşen taslak onaylı şablona döner). Gerekçe anmada 5.1
Luna'nın her seviyesinden iyi; Luna `medium` 12 sn anlam katmanı zaman tavanına çarpıyor (p95 12,0). → Karar metni yazıcısını cevap
modelinden ayırmak (karar #8) bu yüzden anlamlı: cevap Luna `low`a geçse bile yazıcı 5.1'de kalabilir.

## Dalga 2 — anlama + konaklama bekçisi (kör kabul `stay-change-acc10`, 160 istek + 200 cevap satırı)

| Anlama + bekçi | Bekçi: istek | Anlama: istek | Bekçi: cevap duruşu | Tehlikeli kaçak | Gereksiz inceleme (birleşim) | Model düştü (satır sayılmadı) |
|---|---|---|---|---|---|---|
| 5.1 | 160/160 | 159/160 | 199/200 | 0/88 | 17/72 | 0 |
| Luna `none` | 160/160 | 158/160 | 200/200 | 0/88 | 17/72 | 0 |
| Luna `low` | 160/160 | 158/160 | 199/200 | 0/88 | 18/72 | 0 |
| Luna `medium` | 160/160 | 158/159 | 192/193 | 0/88 | 18/71 | 1 |
| Luna `high` | 149/149 | 160/160 | 200/200 | 0/83 | 16/66 | **11** (bekçi) |

Okuma: tehlikeli kaçak her yapılandırmada 0 (kelime ağı ∨ bekçi ∨ anlama birleşimi). 5.1 / `none` / `low` doğrulukta eşit; `medium` ve
özellikle `high` modelin düşmesine yol açıyor (12 sn tavanı → satır "bilinmiyor" = insana kalır; güvenli ama gereksiz inceleme). Gereksiz
inceleme payını kelime ağı belirliyor (model seviyesinden bağımsız). → Bekçi ve anlama için **Luna `low`** önerisi değişmedi (`none` da
eşit doğrulukta ve daha hızlı; belirsiz mesajda hedefli soru dalga 1'de `low`da daha iyiydi).

## Öneri (kurucu yokken karar #7 — env değeri; kod varsayılanı `DEFAULT_OPENAI_MODEL` değişmedi)

| Değişken | Değer |
|---|---|
| `OPENAI_MODEL` / `OPENAI_REASONING_EFFORT` | `gpt-6-luna` / `low` |
| `AI_UNDERSTANDING_MODEL` / `AI_UNDERSTANDING_REASONING_EFFORT` | `gpt-6-luna` / `low` |
| `AI_STAY_GUARD_MODEL` / `AI_STAY_GUARD_REASONING_EFFORT` | `gpt-6-luna` / `low` (dalga 2: `medium` / `high` zaman aşımı) |
| `AI_DECISION_TEXT_MODEL` / `…_REASONING_EFFORT` (yeni, karar #8) | `gpt-5.1` / boş (dalga 2: gerekçe anmada en iyi; kör setle doğrulanıyor) |
| `OPENAI_TRANSLATE_MODEL` / `…_REASONING_EFFORT` | `gpt-6-luna` / `medium` (10-02 ölçümü) |
| `OPENAI_STYLE_MODEL` / `…_REASONING_EFFORT` | `gpt-6-luna` / `none` (10-01 ölçümü) |
| `AI_SEMANTIC_MODEL` (yeniden sıralayıcı) | dalga 2 / 3'e göre (önceki ölçüm: 5.1'de kalsın) |
