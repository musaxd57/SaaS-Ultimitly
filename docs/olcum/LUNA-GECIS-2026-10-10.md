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

## Dalga 2 — anlama + konaklama bekçisi (kör kabul `stay-change-acc10`) ve karar metni (`decision-text-acc1`)

(koşuyor — sonuçlar buraya eklenecek)

## Öneri (kurucu yokken karar #7 — env değeri; kod varsayılanı `DEFAULT_OPENAI_MODEL` değişmedi)

| Değişken | Değer |
|---|---|
| `OPENAI_MODEL` / `OPENAI_REASONING_EFFORT` | `gpt-6-luna` / `low` |
| `AI_UNDERSTANDING_MODEL` / `AI_UNDERSTANDING_REASONING_EFFORT` | `gpt-6-luna` / `low` |
| `AI_STAY_GUARD_MODEL` / `AI_STAY_GUARD_REASONING_EFFORT` | dalga 2'ye göre (önceki ölçüm: `low`) |
| `OPENAI_TRANSLATE_MODEL` / `…_REASONING_EFFORT` | `gpt-6-luna` / `medium` (10-02 ölçümü) |
| `OPENAI_STYLE_MODEL` / `…_REASONING_EFFORT` | `gpt-6-luna` / `none` (10-01 ölçümü) |
| `AI_SEMANTIC_MODEL` (yeniden sıralayıcı) | dalga 2 / 3'e göre (önceki ölçüm: 5.1'de kalsın) |
