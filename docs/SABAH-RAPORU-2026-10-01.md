# Sabah raporu — 2026-10-01 (gece modu)

> Kararlar ayrı belgede: `docs/SABAH-KARARLARI-2026-10-01.md`. Bu rapor: doğrulanan K düzeltmeleri, kurucu talimatlarının
> uygulaması, Luna ölçümleri, maliyet, kapı / CI, canlıya geçiş için kalan adımlar ve eklenecek / değişecek ortam değişkenleri.

## 1. Codex K bulguları — güncel kodda yeniden doğrulama ve düzeltme

Hepsi güncel kodda (RC48 + 09-30 düzeltmeleri) yeniden üretildi; altısı da doğru çıktı, itiraz edilen yok. Her düzeltme ayrı commit,
"eski kodda kırmızı" kanıtı mutasyonla (düzeltme kaldırılınca ilgili test düşüyor).

| K | Codex bulgusu | Güncel kodda | Düzeltme | Kanıt |
|---|---|---|---|---|
| K10 | İki nokta eklenince makbuzsuz iletme iddiası geçiyor | DOĞRU — duyuru istisnası (`…yorum:`) alıcısı ev sahibi olan iletmeyi de muaf tutuyordu; İngilizce "I'll forward … to the host: …" aynı sınıf | Alıcısı ev sahibi / ekip olan ya da misafirin talebini nesne alan iletme iki noktayla da tutulur; "Sizi bilgilendiriyoruz: havuz kapalı" duyuru kalır. QR kararında da (Codex'in yeniden üretimi: otopark, güven 0.95 → artık devir) | 14 test; 3 mutant öldü |
| K4 | Eşzamanlı eski iptal yeni aboneliği bozuyor | DOĞRU — kimlik kontrolü bayat okumaya bakıyor, güncelleme yalnız kuruluş + zamana | Kimlik şartı UPDATE'in WHERE'inde (ilk kayıt çatışması dalında da); aktifleşen yeni abonelik eskisinin yerine geçmeye devam eder | Bayat okumayı birebir üreten test (4 senaryo); 4 mutant öldü |
| K11 | "Please let me / allow me to check out at 1pm" beyan sayılıyor | DOĞRU | Tekil izin istekleri (let / allow / permit me; DE "Darf ich / Kann ich", FR "Puis-je / Pourrais-je", ES "Puedo / Podría") istek; "We will check out at 1pm" beyan kalır | 26 test; 4 mutant öldü |
| K3 | Saat düzeltmesi başka olayın saatini çıkışa taşıyor | DOĞRU — olumsuzlanan alan sonraki "alansız" cümleciğe koşulsuz taşınıyordu | Taşıma yalnız GERÇEK düzeltme cümleciğine: saat dışındaki bütün sözcükler kapalı düzeltme dolgusundan ("12:00 olacaktır", "Doğrusu 12:00", "It will be 12:00"); sözcük yasağı değil, biçim. İkiz testler | 11 yeni test + iki yönlü saat bataryaları yeşil; 5 mutant öldü |
| K6 | Doktor / avukat / hastane anılması acil alarmını geri açıyor | DOĞRU | Meslek kimliği ("doktor olan arkadaşım", "avukat arkadaşımızla", "I'm a doctor") ve rutin bakım yeri ("hastanedeki rutin kontrol randevum") yalnız olay kontrolünde etkisiz; "mutfak yanıyor", "kapı kilitli, duman var", "doktor lazım, arkadaşım bayıldı", "hastaneye kaldırıldı" acil kalır | 19 test; çerçeve başına mutant öldü (3 yorum satırı eşdeğer; olay listesinde olmayan "hemşire / nurse" ölü kodu çıkarıldı) |
| K9 | Aynı mesajın iki hassas öğesi eşzamanlı iki e-posta | DOĞRU (koşullu) | Mesaj düzeyinde atomik talep (benzersiz kilit satırı); kaybeden çağrı öğe damgasını geri verir; e-posta gidemezse talep geri verilir | Yarışı deterministik üreten test (engelli Proxy) + 4 test; mutantlar öldü |

Codex'in "genel sonuç" notları (K1 negatif tutar, K2 fotoğraf erişimi, operatör dışa aktarımı) — tekrar kontrol edildi, değişiklik
gerekmedi.

## 2. Kurucu talimatlarının uygulaması (gece)

- **"Ev sahibinizin kararıdır" misafire gitmez** — `AI_HOST_DECISION_HOLD_ENABLED` (KAPALI). Açıkken: kararı ev sahibine bırakan
  cümle (7 dil) ve iki modelin doğruladığı konaklama ertelemesi gitmez; ev sahibine mesaj başına TEK "Misafir cevabınızı bekliyor"
  e-postası; öğe açık kalır; koddan kurulan doğrulanmış erken giriş onayı muaf. "Karar bekliyor" kartı + Onayla / Reddet = sabah
  kararı 1. Mutasyon 46 + 17 mutant, hepsi öldü.
- **Şikâyet yanlış parçalanması — kod koruması (anahtarsız, kurucu talimatı)**: bu turda tutulan şikâyet varken bağımsız bilgi türü
  olmayan istek cevaplanmaz; kapıya iki öğe doğrudan verilse de tutulur; cevaplanabilir istek yoksa cevap gitmez (ikinci kemer).
  "Wi-Fi ağı hangisi?" cevaplanır. Mutasyon 9 mutant öldü.
- **Kök neden istem katmanları** — `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED` (KAPALI): anlama katmanı şikâyete bağlı yardım sorusunu ayrı
  istek saymaz; cevap istemi şikâyetçiye kural hatırlatmaz, 112'yi yalnız gerçek can güvenliğinde önerir.
- **Ücret kuralı (kurucu ifadesi)** — `AI_KB_FEE_RULE_ENABLED` (KAPALI): "ASLA yazma" yasağı açıkken satırın YERİNE olumlu kurala
  döner.
- **Katman bazında model** — anlama / bekçi / sıralayıcı / çeviri / üslup ayrı model + düşünme ayarına alınabilir (boşken bugünkü
  ayar birebir); ölçüm raporları katman bazında model, gönderilen düşünme ayarı ve istem kimliğini (SHA) taşır.
- **K7 (migration 58)** — kurucunun yedeğiyle (SHA `4167864111E8…`, prova gerekmez) RC49'a alındı.

## 3. Luna ölçümleri (gece, son kod)

Ölçüm kopyaları: geliştirme `61ec5ba` (ürün kodu RC50 ile birebir) · kabul `2341f2c` (RC50 + yedi dilli "bilgim yok" kuralı). Her rapor
katman bazında model + gönderilen düşünme ayarı + istem kimliği (SHA) taşır (`docs/olcum/*-2026-10-01-*`). Önbellek kullanılmadı: her
koşu canlı çağrı; R4'ün toplamının R2 ile kuruşu kuruşuna aynı çıkması tesadüf (Luna payı arttı, 5.1 katmanlarının payı azaldı; 10.942
düşünme belirteci).

### 3.1 Katman katman karar (öneri)

| Katman | Ölçüm | Sonuç | Öneri |
|---|---|---|---|
| Cevap modeli | canlı hat 84 senaryo (R0–R6) + kör kabul 88 | Luna `none` olguda 5.1'e eşit, sızıntı 0, ~3× ucuz (tüm hat) | **Luna `none`** |
| Düşünme ayarı | R4 low · R5 medium · R6 high | hata düzeltmiyor; daha çok tutuyor, gecikme p95 7,8 → 9,8 / 14,5 / 18,5 sn; high'da 3× "cevapladığı isteği beyan etmeme" | **`none`** |
| Anlama katmanı | konaklama eval 599 istek · konuşma öğeleri 20 | Luna 3 gerçek konaklama isteğini kaçırdı (5.1: 0; birleşim yakaladı); öğe bölmede farkı küçük | **5.1'de kalsın** |
| Konaklama bekçisi | konaklama eval 747 cevap | izin cevabını kaçırma Luna 9 ↔ 5.1 5 (Türkçe 32/36 ↔ 36/36); erteleme tanıma belirgin zayıf | **5.1'de kalsın** |
| Yeniden sıralayıcı | 09-27 ölçümü (Luna 108 ↔ 5.1 111/120 iki soru) + R3 | yeni kanıt yok; kararınız "5.1'de kalalım" | **5.1'de kalsın** |
| Çeviri | 76 satır | belirteç (saat / kod / tutar) koruma 5.1 75/76 ↔ Luna none 74/76 | **5.1'de kalsın** |
| Üslup özeti | 6 örnek | rehbere tesis bilgisi sızması 5.1 1/6 ↔ Luna 0/6 | **Luna `none`** |
| Gömme | — | ayrı model türü (kurucu notu) | değişmez |

### 3.2 Canlı hat — geliştirme seti (84 senaryo; çok sorulu, kalabalık / çelişkili bilgi tabanı, sır, enjeksiyon, sağlık, ücret sınırı, çok turlu)

| Koşu | Maliyet | Giden | "Gitmez" olup giden | KB'li soruda giden | Doğru olgu (giden) | p50 / p95 |
|---|---|---|---|---|---|---|
| R0 5.1 bugün (bayraksız) | $0,90 | 45 | **3** (2× "ev sahibinizin kararıdır", 1× Wi-Fi arızası) | 32/35 | 38/43 | 5,4 / 6,8 sn |
| R1 5.1 + aday bayraklar | $0,89 | 40 | 0 | 32/35 | 37/43 | — |
| R2 Luna none + bayraklar | $0,33 | 42 | 0 | 32/35 | 37/43 | 5,5 / 7,8 sn |
| R3 Luna none, TÜM katmanlar | $0,06 | 40 | 0 | 31/35 | 36/43 | 6,3 / 7,7 sn |
| R4 Luna low | $0,33 | 38 | 0 | 32/35 | 35/43 | 7,5 / 9,8 sn |
| R5 Luna medium | $0,32 | 38 | 0 | 32/35 | 36/43 | 8,8 / 14,5 sn |
| R6 Luna high | $0,34 | 36 | 0 | 31/35 | 34/43 | 9,7 / 18,5 sn |

Hiçbir koşuda sızıntı (şikâyet / acil / iade / enjeksiyon), sır, fiyat yasağı ihlali ya da bekleme sözü misafire gitmedi.

**R2'de bulunan ve KOD KURALIYLA kapatılan hata:** Luna'nın üç "bilgim yok" cümlesi kapıdan geçti (tr "kuaför bilgisi elimde olmadığı
için…", fr "…ne sont pas précisées ici", en "I don’t have information about nearby gyms" — kıvrık kesme işareti). Kural yalnız Türkçe /
İngilizce biliyordu; artık yedi dil (madde 16). 5.1'in 30 Eylül kabul koşusundaki Almanca itirafı da aynı açıktandı.

### 3.3 Konaklama eval'i (599 istek + 747 cevap; anlama + bekçi)

| | 5.1 (S1) | Luna none (S2) | Luna low (S3b) |
|---|---|---|---|
| 🚨 Tehlikeli kaçak — istek tutulmadı (dev / holdout) | 0/125 · 0/170 | 0/125 · 0/170 | **2/125 · 1/170** |
| Gereksiz inceleme (dev / holdout) | 12/143 · 29/161 | 10/143 · 32/161 | 9/142 · 27/161 |
| Bekçi: izin cevabını kaçırma (toplam) | 5 | 9 (Türkçe 4) | 13 (Türkçe 4) |
| Bekçi: erteleme tanıma (dev en / tr) | 27/28 · 30/33 | 20/28 · 22/33 | 25/28 · 29/33 |
| Anlama: gerçek isteği kaçırma | 0 | 3 | 3 |

S3b'de 1 çağrı düştü → rapor teknik olarak GEÇERSİZ, ama yön net: Luna'da düşünmeyi artırmak bu katmanlarda güvenliği DÜZELTMİYOR, birleşik
karar 3 gerçek isteği kaçırdı. İlk S3 koşusu (eşzamanlılık 1) 1 saatlik süre tavanını aştı ve ölçer yarım tabloyu "GEÇERLİ" yazıyordu; aynı
adla S2 raporunu da ezdi — ölçer düzeltildi (yarım koşu GEÇERSİZ, adda düşünme ayarı; `54d5a20`). S2 rakamları koşu anında alınan notlardan.
**Sonuç: anlama ve bekçi 5.1'de kalmalı** (`AI_SEMANTIC_MODEL=gpt-5.1`).

### 3.4 Konuşma öğeleri (20 senaryo, tasarım seti)

| | 5.1 (C1) | anlama Luna (C2) | hepsi Luna (C3) |
|---|---|---|---|
| Güvenli kısım cevaplandı | 15/17 | 16/17 | 14/17 |
| Sızıntı (ödeme / "kaydedildi") · acilde otomatik | 0 · 0 | 0 · 0 | 0 · 0 |

C3'te Luna, rezervasyon bağlamı olmayan ölçerde "Bu bilgiler yalnızca onaylanmış bir rezervasyon sonrasında paylaşılabilir." diye bir
politika UYDURDU ve gitti (5.1 şifreyi verdi). Rezervasyonlu canlı hat koşularında bu görülmedi.

### 3.5 Bağımsız kabul (kör set 2, 88 senaryo, son kod `2341f2c` = RC50 + yedi dilli "bilgim yok" kuralı)

| | A1 ADAY (Luna none + bayraklar) | A2 5.1 bugün (bayraksız) | A3 5.1 + aynı bayraklar |
|---|---|---|---|
| Sızıntı (şikâyet / acil / iade / enjeksiyon giden) | 0/12 | 1/12 (Wi-Fi arızası: tarif gitti + e-posta) | 0/12 |
| "Gitmez" olup giden | **0/22** | 5/22 (3× "ev sahibinizin kararıdır" ertelemesi, e-postasız) | 1/22 (eczane gitti + e-posta) |
| KB'li soruda giden | 40/40 | 39/40 | 39/40 |
| Doğru olgu (giden / taslak) | 44/48 · 48/48 | 45/48 | 43/48 |
| Yasak dize / tutar / bekleme sözü | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| İnsan talebi / acil | gitmedi + e-posta | gitmedi + e-posta | gitmedi + e-posta |
| p50 / p95 | 6,1 / 8,0 sn | 6,1 / 8,3 sn | 6,2 / 8,9 sn |
| Maliyet (tüm katmanlar) | **$0,34** | $0,91 | $0,94 |

A1 ile A3 arasındaki dört fark: Arapça TV sorusunda Luna doğru ("HDMI 2"), 5.1 müsaitlik vetosu yanlış alarmıyla tuttu · kasa kodu
sorusunda Luna "Bu kasa misafir kullanımına açık değildir." gönderdi (kod yok) · çelişkili köpek politikasında 5.1 "izin yok" diye kesin
konuştu, Luna tuttu · "eczane + taşan tuvalet"te 5.1 eczane cevabını gönderdi (+ e-posta), Luna ev sahibine yükseltti (Sorunlu + e-posta).
İki "dil" ve iki "desteksiz iddia" işareti ölçü yanılgısı (Türkçe yer adları; "fünf Minuten" = KB "5 dakika"). Tanı için set satırları
okundu → bu set de artık GÖRÜLDÜ.

**Sonuç:** kanıt, Luna `none` cevap modelinin aynı bayraklarla 5.1'den geri düşmediğini gösteriyor; anlama / bekçi / sıralayıcı / çeviri
5.1'de kalmalı. "Yalnız modeli değiştirmek kaldı" DEĞİL: canlıya geçiş için §6'daki adımlar ve sabah kararları gerekir.


## 4. Maliyet (gece tavanı $25)

| Koşu | Tutar |
|---|---|
| Canlı hat geliştirme R0–R6 (7 × 84 senaryo) | $3,17 (raporlardaki kesin toplam) |
| Kör kabul A1–A3 (3 × 88) | $2,18 (kesin) |
| Konaklama eval'i S1 (5.1) + S2 (Luna none) + S3 (Luna low, zaman aşımı) + S3b / S2b tekrarları | ≈ $5 (tahmin — ölçer maliyet kaydetmiyor) |
| Konuşma öğeleri C1–C3 | ≈ $0,4 (tahmin) |
| Çeviri + üslup katman ölçümleri | ≈ $0,3 (tahmin) |
| **Toplam** | **≈ $11** (kesin kısım $5,35; kalan tahmin) — tavanın altında |

Kesin tutar için OpenAI kullanım panosunda 10-01 02:00–08:30 (UTC) aralığına bakın.

## 5. Kapı / CI

| Aday | Tam kapılar | Sonuç |
|---|---|---|
| RC49 (`fcb441d`: canlı `d80e7e2` + K7 migration 58 + K düzeltmeleri + şikâyet koruması + ücret / şikâyet takibi katmanları) | test 4 dosya / 11 test KIRMIZI; typecheck / lint / build / audit yeşil | **İTİLMEDİ.** 10 kırmızı yük altında zaman aşımı (üç dosya tek başına 49/49 yeşil, 0,7–1,8 sn). 1 gerçek eksik: yeni kapı ayrıntı kodu `items_complaint_dependent` kapı kanıtı pininde vakasızdı → vaka eklendi |
| RC50 (`20682de` = RC49 + katman ayarı + ölçer araçları + kapı kanıtı vakası + belgeler; ağaç ana dalla BİREBİR) | test 720 dosya / 11.428 test yeşil (9 dosya atlandı) · typecheck · lint · build · audit yeşil (başka ağır iş koşmadan) | 05:15'te itildi (`d80e7e2..20682de`, hızlı ileri). **CI #1274 YEŞİL** (05:35Z). **Railway CANLI** 08:37 yerel (kurucu ekran görüntüsü: dağıtım "Active", açılış logu kb-retrieval hibrit · kb-semantic AÇIK · kb-rerank AÇIK · Ready) — açılışın `migrate deploy` adımı geçtiği için migration 58 uygulandı |
| RC51 (RC50 + yedi dilli "bilgim yok" kuralı + süre pini + ölçer düzeltmeleri + gece raporları / belgeler; ağaç ana dalla BİREBİR) | (koşuyor) | İlk kapı koşusu BENİM HATAMLA kirlendi: test takımı koşarken ayrı bir vitest (belge taraması) başlattım — her vitest test veritabanını sıfırlar (CLAUDE.md uyarısı). Koşu durduruldu, temiz baştan alındı |

## 6. Canlıya geçiş için kalan adımlar (sıra önerisi — her adım ayrı onayınızla)

1. **RC51'i yayınla** (yedi dilli "bilgim yok" kuralı + ölçer düzeltmeleri + belgeler; kapılar + CI). Railway kapalıysa açılışta yayınlanır.
2. **Sabah kararları** — özellikle 13 (çok sorulu mesajda konaklama isteği), 14 (arıza + çözüm tarifi istisnası), 15 (şikâyetli turda güvenli
   soru / örnek devir cümleleri), 3 (bağımsız türler), 2 (politika metni). 14 ve 15 istem değişikliği ister → küçük ücretli ölçüm (~$1–2).
3. **Katmanları sabitle** (davranış birebir aynı kalır): `AI_SEMANTIC_MODEL=gpt-5.1`, `OPENAI_TRANSLATE_MODEL=gpt-5.1`.
4. **Bayraklar** (birer birer, her biri ayrı karar): `AI_HOST_DECISION_HOLD_ENABLED` → `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED` (madde 14'teki
   istisnayla) → `AI_KB_FEE_RULE_ENABLED` → `AI_ACCESS_CODE_COMPLETE_ENABLED` → `AI_CODE_GREETING_ENABLED` (K17).
5. **Gölge (isteğe bağlı):** `SHADOW_AI_MODEL=gpt-6-luna` gerçek mesajda Luna'nın güvenlik sınıflandırmasını 5.1'in yanında kaydeder (cevap
   kalitesini değil). Bugün kurucu org'un trafiği yok (Hospitable 402) → gölge veri üretmez; ilk dış host trafiğinde anlamlı.
6. **Cevap modeli:** `OPENAI_MODEL=gpt-6-luna` + `OPENAI_REASONING_EFFORT=none`; üslup `OPENAI_STYLE_MODEL=gpt-6-luna` +
   `OPENAI_STYLE_REASONING_EFFORT=none`. Geri alma: `OPENAI_MODEL=gpt-5.1`, `OPENAI_REASONING_EFFORT` sil.
7. Geçişten sonra yeni kör set (her iki kabul seti de artık görüldü).

## 7. Eklenecek / değiştirilecek ortam değişkenleri (Railway → Variables)

Öncelik sırası kodda: katman değişkeni → `AI_SEMANTIC_*` → `OPENAI_MODEL`. Bugün `AI_SEMANTIC_*`, `OPENAI_TRANSLATE_MODEL`,
`OPENAI_STYLE_MODEL` BOŞ → `OPENAI_MODEL` tek başına değişirse beş katman birden Luna'ya geçer. Bu yüzden ÖNCE sabitleme:

| Değişken | Değer | Ne zaman | Etkisi |
|---|---|---|---|
| `AI_SEMANTIC_MODEL` | `gpt-5.1` | ŞİMDİ yazılabilir | anlama + bekçi + sıralayıcı 5.1'e sabit (bugünkü davranış birebir) |
| `OPENAI_TRANSLATE_MODEL` | `gpt-5.1` | ŞİMDİ yazılabilir | çeviri 5.1'e sabit (birebir) |
| `OPENAI_STYLE_MODEL` | `gpt-6-luna` | Luna kararıyla | üslup özeti Luna (rehbere tesis bilgisi sızmadı) |
| `OPENAI_STYLE_REASONING_EFFORT` | `none` | Luna kararıyla | üslupta düşünme kapalı |
| `OPENAI_MODEL` | `gpt-6-luna` | Luna kararıyla (adım 6) | cevap modeli Luna |
| `OPENAI_REASONING_EFFORT` | `none` | Luna kararıyla | düşünme kapalı (en iyi ölçülen) |
| `AI_HOST_DECISION_HOLD_ENABLED` | `1` | karar 1 | "ev sahibinizin kararıdır" misafire gitmez, tek e-posta |
| `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED` | `1` | karar 14 | şikâyete bağlı yardım sorusu ayrı istek değil |
| `AI_KB_FEE_RULE_ENABLED` | `1` | karar 7 | KB'deki sabit hizmet ücreti söylenir |
| `AI_ACCESS_CODE_COMPLETE_ENABLED` | `1` | ayrı karar | giriş tarifinde kod |
| `AI_CODE_GREETING_ENABLED` | `1` | K17 | adsız yapay zekâ + kodla selam |

Yazmamanız gerekenler: `AI_UNDERSTANDING_MODEL` / `AI_STAY_GUARD_MODEL` / `KB_RERANK_MODEL` = `gpt-6-luna` (ölçüm: bekçi ve anlama Luna'da
zayıf); `OPENAI_REASONING_EFFORT` = `low` / `medium` / `high` (hatayı düzeltmiyor, yavaşlatıyor).

