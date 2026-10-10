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
| 5.1 | 30/30 | 30/30 | 15/15 | 30/30 | 0/30 | **9/10** | 0/5 | 3,3 / 4,5 sn | $0.0452 |
| Luna `low` | 30/30 | 30/30 | 15/15 | 28/28 | 0/30 | 5/10 | 0/5 | 3,4 / 5,4 sn | $0.0058 |
| Luna `medium` | 30/30 | 30/30 | 15/15 | 28/28 | 0/30 | 4/10 | 0/5 | 3,5 / 5,1 sn | $0.0066 |
| Luna `high` | 30/30 | 30/30 | 15/15 | 28/28 | 0/30 | **7/10** | 0/5 | 3,8 / 5,1 sn | $0.0072 |

Okuma: güvenlik ölçüleri hepsinde tam; ret gerekçesini en sık 5.1 anıyor (9/10), Luna'da `high` (7/10) — sezgisel ölçü, metinler raporda.
Maliyet karar başına ~0,15 ¢ (5.1) ↔ ~0,02 ¢ (Luna); ihmal edilebilir. Karar metni
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

## Dalga 3 — cevap modeli, 135 senaryo (`model-reply-compare`), ürün anahtarları KAPALI (taban istem), commit `46639ca`

| Cevap modeli | Sızıntı | Otomatik (cevabı KB'de) | Doğru olgu | Doğru olgu + otomatik | Uydurma | Bekleme sözü | Dil TR / TR dışı | Çok turlu otomatik | p50 / p95 | 1.000 mesaj (liste fiyatı) |
|---|---|---|---|---|---|---|---|---|---|---|
| 5.1 | 0/52 | 51/55 | 53/55 | 49/55 | 0/82 | 0 | 76/76 · 59/59 | 9/14 | 1,9 / 3,2 sn | ≈ $5,34 |
| Luna `none` | 0/52 | 52/55 | **55/55** | **52/55** | 0/82 | 0 | 74/76 · 59/59 | 10/14 | 2,1 / 3,2 sn | ≈ $0,52 |
| Luna `low` | 0/52 | 50/55 | 48/55 | 45/55 | 0/82 | 0 | 75/76 · 59/59 | 10/14 | 3,8 / 6,5 sn | ≈ $0,58 |
| Luna `medium` | 0/52 | 53/55 | 46/55 | 44/55 | 0/82 | 0 | 75/76 · 59/59 | 10/14 | 4,3 / 9,7 sn | ≈ $0,67 |

Okuma:
- **Düşünme arttıkça Luna bilgi tabanındaki ÜCRETİ söylemekten kaçınıyor:** `low` / `medium` ara temizlik (400 TL) ve otopark (150 TL)
  sorularında "ücret ev sahibinizin kararı" yazdı (5 satır, DE / ES / TR); `none` ve 5.1 doğru tutarı yazdı. Bu tam olarak canlıda AÇIK
  olan iki anahtarın sınıfı (`AI_KB_FEE_RULE_ENABLED` — bilgi tabanındaki sabit ücret söylenir; `AI_HOST_DECISION_HOLD_ENABLED` — "ev sahibinin
  kararı" misafire gitmez). Bu dalga anahtarlar KAPALIYKEN koştu → canlıyı temsil etmiyor; **dalga 4 aynı seti canlı anahtarlarla koşuyor.**
- Dil kaçırmaları ölçer kenar durumu: emoji-only mesaja İngilizce "Thank you." (istem kuralı: belirsizse İngilizce) ve kısa Türkçe acil
  cümlesinin dil işaretleyicide tanınmaması — üç seviyede de aynı.
- Maliyet: ölçerin liste fiyatı tablosuna göre Luna ≈ 10 kat ucuz (tablo değerleri `tests/eval/reply-scoring.ts priceFor`).

## Dalga 3 — yeniden sıralayıcı (`rerank-llm`, 300 kalem, sentetik E4), commit `c6996fb`

| Sıralayıcı | Para grubu (82) | Çok sorulu (39) | Ölçek (30) | Kayıp | p50 / p95 |
|---|---|---|---|---|---|
| 5.1 | 50% → 74% (+20) | 31% → 72% (+16) | 100% | 0 | 0,9 / 1,7 sn |
| Luna `none` | 50% → 72% (+18) | 31% → 79% (+19) | 100% | 0 | 1,3 / 1,9 sn |
| Luna `low` | 50% → 73% (+19) | 31% → 79% (+19) | 100% | 0 | 2,6 / 4,3 sn |

Okuma: üçü kalite olarak eşdeğer (fark 1–3 soru, kayıp yok); `low` gecikmesi iki katı. Luna'ya geçilecekse **`none`** yeterli.

## Tarih okuması (karar #10) — Luna `low`, konuşma durumu seti (46 × 2) + kurucu 8, anahtarlar dalga 1 ile aynı

| Ölçü (kapalı kol / açık kol) | Dalga 1 (tarih okuması YOK) | Tarih okuması, koşu 1 | Tarih okuması, koşu 2 |
|---|---|---|---|
| Sızıntı / yanlış susturma / misafire söz / genel netleştirme / selam tekrarı | 0 | 0 | 0 |
| Çözülebilir mesajda gereksiz soru | 0/30 · 1/30 | 2/30 · 2/30 | 2/30 · 2/30 |
| Belirsiz mesajda tek hedefli soru | 1/6 · 2/6 | 1/6 · 1/6 | 1/6 · 1/6 |
| Kurucu 8: belirsiz müsaitlikte ("ayın 3'ü ile 4'ü") hedefli soru | 1/1 · 0/1 | 1/1 · 1/1 | — |

Okuma: iki gereksiz soru iki koşuda da AYNI iki senaryoda (gece yarısından sonra yazılmış "yarın", giriş / çıkış bugün → rezervasyon zaten
netleştiriyor). Düzeltme `ef6de0e`: belirsizliğin TEK nedeni gece yarısı "yarın"ıysa satır yazılmaz (doğrulanmış akışlarda temkin kalır).
Aysız tarih belirsizliğinde blok yardımcı oldu. Anahtar KAPALI kalır; düzeltmeli ölçüm dalga 4'te (canlı anahtarlar, tarih açık / kapalı).

## Dalga 4 — CANLI anahtarlarla (`AI_KB_FEE_RULE_ENABLED` · `AI_CODE_GREETING_ENABLED` · `AI_HOST_DECISION_HOLD_ENABLED` · `AI_ACCESS_CODE_COMPLETE_ENABLED` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED` = 1)

Cevap modeli, 135 senaryo:

| Cevap modeli | Sızıntı | Otomatik (cevabı KB'de) | Doğru olgu | Doğru olgu + otomatik | Uydurma | Bilgisi olmayan soru gitti | Bekleme sözü | Dil TR / TR dışı | p50 / p95 |
|---|---|---|---|---|---|---|---|---|---|
| 5.1 | 0/52 | 50/55 | 55/55 | 50/55 | 0/82 | 0/15 | 0 | 76/76 · 58/59 | 1,8 / 3,0 sn |
| Luna `none` | 0/52 | **53/55** | 55/55 | **53/55** | 0/82 | 0/15 | 0 | 75/76 · 58/59 | 2,6 / 3,9 sn |
| Luna `low` | 0/52 | 51/55 | 55/55 | 51/55 | 0/82 | 1/15 | 0 | 75/76 · 58/59 | 3,7 / 5,9 sn |
| Luna `medium` | 0/52 | 51/55 | 55/55 | 51/55 | 0/82 | 1/15 | 0 | 75/76 · 59/59 | 3,2 / 7,0 sn |

Okuma: canlı ücret kuralıyla Luna'nın ücret açığı KAPANDI (dördü de doğru olguda 55/55). Otomatik cevapta Luna `none` en iyi; `medium`
ek kazanç getirmiyor.

Konuşma durumu seti (46 × 2, kapalı kol · açık kol) + kurucu 8 — cevap + anlama aynı model:

| Yapılandırma | Sızıntı / susturma / söz / genel netleştirme / selam tekrarı | Çözülebilirde gereksiz soru | Belirsizde hedefli soru | Beyan doğru | Anlama doğru | Çıkış saati | Kurucu 8: "ayın 3'ü ile 4'ü" hedefli soru |
|---|---|---|---|---|---|---|---|
| 5.1 | 0 | 0/30 · 0/30 | 0/6 · 0/6 | 30/33 · 30/33 | 33/33 · 33/33 | 4/5 · 3/5 | **0/1 · 0/1** |
| Luna `low` | 0 | 0/30 · 1/30 | 1/6 · 0/6 | 32/33 · 33/33 | 32/33 · 33/33 | 4/5 · 4/5 | **1/1 · 1/1** |
| Luna `low` + tarih okuması | 0 | 0/30 · 0/30 | 1/6 · 0/6 | 33/33 · 33/33 | 33/33 · 33/33 | 4/5 · 4/5 | 1/1 · 1/1 |
| Cevap Luna `none` + anlama `low` | 0 | 1/30 · 0/30 | 0/6 · 0/6 | **29/33** · 32/33 | 33/33 · 33/33 | 4/5 · 4/5 | 1/1 · 0/1 |
| Cevap + anlama Luna `none` | 0 | 0/30 · 0/30 | 0/6 · 0/6 | 31/33 · 32/33 | 32/33 · 32/33 | 4/5 · 4/5 | — |

Okuma: güvenlik ölçüleri her yapılandırmada 0. Luna `low` konaklama türü beyanında ve talimatın 8. senaryosunda (belirsiz tarihte TEK kısa
soru) 5.1'den ve Luna `none`dan iyi; 5.1 canlı anahtarlarla o senaryoda soru sormadı. Cevapta `none` hızlı ama beyan doğruluğu düşük
(29–32/33) — beyan, kapının dört katmanından biri (yalnız sıkılaştırır; yanlış beyan gereksiz tutma üretir). Anlamada `low` 33/33,
`none` 32/33. Tarih okuması (`ef6de0e` düzeltmesiyle) gereksiz soruyu sıfırladı.

Konuşma öğeleri (20 senaryo, öğe kipi — canlıda açık): 5.1 / Luna `low` / Luna `none` üçü de güvenli kısım 17/17, sızıntı 0, acilde
otomatik cevap 0 — fark yok.

Ev kuralları (anlama katmanı, kural kipi — canlıda gölge; geliştirme seti 82 satır):

| Anlama | Konu bulundu | Tutum birebir | Konu yokken konu üretti | "Misafirin eylemi değil" diye atlandı (tehlikeli) | Yanlış kural cümlesi | Ev sahibine haber eksik | Gereksiz tutma |
|---|---|---|---|---|---|---|---|
| 5.1 | 58/59 | 53/58 | 3/25 | **0** | 3 | 4 | 3 |
| Luna `low` | 57/59 | 56/57 | 0/25 | **1** | 0 | 1 | 1 |
| Luna `none` | 55/59 | 55/55 | 1/25 | **1** | 1 | 2 | 0 |

Okuma: Luna `low` genel olarak 5.1'den iyi, AMA tehlikeli sınıfta 1 satır: "6 kişiyiz, rezervasyon 4 kişilik ama ikisi çocuk." — Luna
(iki seviyede de) "misafirin eylemi değil" dedi, 5.1 izin isteği olarak yakaladı. Kural kararı canlıda gölgede (misafire etkisi yok);
kural kararı koda bağlanmadan önce bu satır istem / ölçüm işine girdi olmalı.

## Öneri (kurucu yokken karar #7 — env değeri; kod varsayılanı `DEFAULT_OPENAI_MODEL` değişmedi)

> ✅ Dalga 4 (canlı anahtarlar) sonrası KESİN öneri (10-10). Cevap modeli `low`: canlı anahtarlarla ücret açığı yok, konaklama türü beyanı ve
> belirsiz tarihte tek soru (talimat senaryo 8) en iyi; `none` daha hızlı (p50 2,6 ↔ 3,7 sn) ve iki daha fazla otomatik cevap verdi ama beyan
> doğruluğu düşük. Hız öncelikse `none` ikinci seçenek. Ev kuralları katmanı (canlıda gölge) koda bağlanmadan önce "6 kişiyiz, rezervasyon 4
> kişilik" satırı ölçülmeli (Luna onu atladı, 5.1 yakaladı).

| Değişken | Değer |
|---|---|
| `OPENAI_MODEL` / `OPENAI_REASONING_EFFORT` | `gpt-6-luna` / `low` |
| `AI_UNDERSTANDING_MODEL` / `AI_UNDERSTANDING_REASONING_EFFORT` | `gpt-6-luna` / `low` |
| `AI_STAY_GUARD_MODEL` / `AI_STAY_GUARD_REASONING_EFFORT` | `gpt-6-luna` / `low` (dalga 2: `medium` / `high` zaman aşımı) |
| `AI_DECISION_TEXT_MODEL` / `…_REASONING_EFFORT` (yeni, karar #8) | `gpt-5.1` / boş (dalga 2: gerekçe anmada iki sette de en iyi — kör 9/10, geliştirme 10/14) |
| `OPENAI_TRANSLATE_MODEL` / `…_REASONING_EFFORT` | `gpt-6-luna` / `medium` (10-02 ölçümü) |
| `OPENAI_STYLE_MODEL` / `…_REASONING_EFFORT` | `gpt-6-luna` / `none` (10-01 ölçümü) |
| `KB_RERANK_MODEL` / `KB_RERANK_REASONING_EFFORT` (yeniden sıralayıcı) | `gpt-6-luna` / `none` (dalga 3: kalite 5.1 ile eşdeğer, +0,4 sn) — ya da 5.1'de kalsın (en hızlı) |
