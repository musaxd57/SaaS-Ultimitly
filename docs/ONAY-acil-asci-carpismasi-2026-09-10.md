# ONAY PAKETİ — `SAFETY_CRITICAL_WORDS` "acil" ↔ "açıl-" ASCII çarpışması (2026-09-10) — UYGULANMADI

> Durum: **öneri**, kod değişikliği YOK. Bu bir GÜVENLİK AĞI DARALTMASIDIR (yalnız daha AZ mesaj
> `safety_emergency` sayılır) → kurucu onayı olmadan uygulanmaz. Bulan: şikâyet dilimi inceleme ajanı
> (salt-okuma), 09-10; ölçümler bu belgede kodla yeniden üretildi.

## Kök neden (tek satır)

`foldTurkishAscii("açıl") === "acil"` ve `includesAnyFold` **altdizi** arar; `SAFETY_CRITICAL_WORDS`
listesinde **çıplak `"acil"`** var (`src/lib/ai/fallback.ts`). Yani "aç-ıl-" fiilinin her çekimi ve
İngilizce/Fransızca/İspanyolca "facil…" gövdesi acil durum sayılıyor.

## Ölçülen bugünkü davranış (`detectRiskType`)

| Girdi | Bugün | Doğrusu |
|---|---|---|
| "Havuz ne zaman açılıyor?" | `safety_emergency` | `null` (bilgi sorusu) |
| "Market kaçta açılıyor?" | `safety_emergency` | `null` |
| "Kahvaltı açılış saati nedir?" | `safety_emergency` | `null` |
| "Balkon kapısı açılır mı?" | `safety_emergency` | `null` |
| "Kapı kolayca açıldı, teşekkürler." | `safety_emergency` | `null` (övgü) |
| "Televizyon açılmıyor" / "Klima açılmıyor" | `safety_emergency` | `complaint` |
| "What facilities does the apartment have?" | `safety_emergency` | `null` |
| "The facilities were great, thanks!" | `safety_emergency` | `null` |
| "Are there laundry facilities nearby?" | `safety_emergency` | `null` |
| "C'est facile d'arriver en métro ?" / "Es muy fácil…" | `safety_emergency` | `null` |
| "Kapı açılmıyor." / "Kilit açılmadı." | `safety_emergency` | `complaint` (09-10 turu bunu complaint YAPTI; etiket hâlâ safety) |
| "Acil durum var" / "ACİL!!!" / "acil yardım lazım" | `safety_emergency` | ✅ doğru, korunmalı |

## Bedel (kodla izlendi)

1. **Oto-yanıt vetosu:** `passesAutoReplySafetyGate` yüksek-bahis `riskType` gördüğünde otomatik gönderimi
   kapatır → "Havuz ne zaman açılıyor?" gibi en sık bilgi sorusu sınıfı asla otomatik yanıtlanamaz.
2. **QR devri:** `evaluateEscalation` → `keyword_risk_type` → misafire `escalationReply()` gider
   (asistan cevabı yerine "mesajınız kaydedildi").
3. **Otomatik görev:** `src/lib/tasks/detect.ts` acil sınıfta 2 saatlik "acil güvenlik" görevi açar →
   host'un acil kutusu bilgi sorularıyla dolar ve **alarm değerini yitirir** (listenin kendi yorumu bu
   riski zaten yazıyor: "yaygın gündelik kelimelerle çakışan kökler seçilmez").
4. **Holding-ack bloklanır** (`holdingAckBlockedSignals` → `detectRiskType`).

## Önerilen değişiklik (dar)

`SAFETY_CRITICAL_WORDS` içindeki çıplak `"acil"` **kaldırılır**, yerine kelime-sınırlı / çapalı biçimler:

- Çapalı ifadeler: `"acil durum"`, `"acil yardım"`, `"acilen"`, `"acildir"`, `"aciliyet"`, `"çok acil"`,
  `"acil!"`, `"acil bir"` (+ ASCII ikizleri gerekmez: `includesAnyFold` kelimeyi de katlar).
- **YA DA** (tercih edilen, tek satır): `"acil"` için `includesAnyFold`'a **kelime sınırı** seçeneği eklenir
  (harf komşusu yoksa eşleş) ve yalnız bu kelimede kullanılır. Böylece "Acil", "ACİL!!!", "acil bir durum"
  tutar; "açılıyor", "facilities", "facile" tutmaz.
  ⚠️ "acilen"/"aciliyet" kelime sınırında DÜŞER → onlar ayrıca listeye yazılır.

Diğer diller (`urgence`, `emergencia`, `emergency`, `notfall`, …) DEĞİŞMEZ.

## Test planı (K2) — kırmızı-önce dosyası hazır

`tests/unit/safety-acil-collision.test.ts` YAZILDI ve bugünkü kodda **24 kırmızı** veriyor (dosya
`scratchpad/parked/` altında bekletiliyor, repoya alınmadı — kırmızı test commit edilmez). İçerik:
- 12 meşru cümle (`açılıyor` / `açıldı` / `açılır mı` / `facilities` / `facile` / `fácil`) →
  `safety_emergency` DEĞİL **ve** `passesAutoReplySafetyGate` GEÇER.
- 11 gerçek acil biçimi (`Acil`, `ACİL!!!`, `acilen`, `aciliyeti var`, `çok acil`, …) → `safety_emergency`
  **ve** kapı VETO.
- Kilitli-kalma ağının bağımsızlığı: "içeri giremiyoruz", "locked out" → hâlâ acil.
- "Kapı açılmıyor" / "Kilit açılmadı" → `complaint` (09-10 şikâyet turu bunları complaint yaptı; çarpışma
  kalkınca etiket de doğruya oturur).
Ek olarak `language-parity.test.ts` MESRU listesine "açılıyor"/"facilities"/"facile" satırları eklenir;
ACİL 7×7 matrisi AYNEN geçmelidir (regresyon kapısı).
Mutasyon: çapayı kaldır → meşru cümle düşer; kelime sınırını kaldır → aynı; `"acil durum"`u sil → gerçek
acil düşer.

## Riskler / karşı görüş

- **Yön:** bu bir DARALTMA. Listenin belgeli ilkesi "aşırı-eşleşme bu listede GÜVENLİ taraf". Karşı argüman:
  aşırı-eşleşme burada bedava DEĞİL — ölçülen dört etkiden üçü (oto-yanıt kapanması, QR devri, sahte acil
  görev) doğrudan ürünün işini kısıyor ve dördüncüsü alarmı değersizleştiriyor.
- **Kaçırma riski:** "acil" kelimesini bitişik yazan bir misafir ("acilll", "acilacil") kelime sınırında
  yine tutar (harf komşusu şartı sağdan/soldan boşluk/noktalama arar; "acilll" içinde "acil" var ama sağında
  harf var → DÜŞER). Bu bilinen sınır; çapalı liste bunu kapsamaz. Ölçülüp belgelenmeli.
- **Kapsam:** yalnız `detectRiskType`'ın safety dalı. Model tarafı (`riskLevel`/`riskType` beyanı) ve
  injection vetosu DEĞİŞMEZ. Migration YOK, ücretli servis YOK.

## Karar noktaları (kurucu)

1. Daraltma yapılsın mı? (Evet/Hayır — hayırsa üç yerdeki yorum "bilinçli aşırı-eşleşme" olarak kalır ve
   09-10 turunda zaten dürüstçe böyle yazıldı.)
2. Kelime sınırı mı, çapalı ifade listesi mi? (Öneri: kelime sınırı + `acilen/aciliyet` ayrıca.)
3. "acilll" gibi bitişik tekrar biçimleri kapsam dışı bırakılsın mı (öneri: evet, bilinen sınır olarak pinli)?
