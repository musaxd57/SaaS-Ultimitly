# GPT-6 Luna geçiş hazırlığı — 2026-09-30 (Aşama 1, ücretsiz kısım)

Kurucu talimatı (09-30): "Mevcut onaylı düzeltmelerden sonra Luna geçişini hazırla. Kullanılan modelleri katman bazında
raporla; gerçek değerlendirmelerde model ve reasoning ayarını kaydet. Eski önbellek cevaplarını yeni Luna sonucu sayma.
Ücretli koşu ve canlı geçiş ayrı onay beklesin."

**Güncelleme (09-30 gece):** ücretli ölçüm YAPILDI (≈$5,9) → sonuç ve karar önerisi `docs/olcum/LUNA-KARSILASTIRMA-2026-09-30.md`;
geçiş önerilmedi (kör kabulde 1 hata), canlıda hiçbir şey değişmedi.

**Durum (ilk sürüm):** hazırlık kodu yazıldı (↓§2). **Ücretli koşu YAPILMADI, canlıda hiçbir şey değişmedi.** Ücretli ölçüm planı (§4) ve
canlı geçiş sırası (§5) kurucu onayı bekliyor. Önceki kıyas: `docs/MODEL-KIYASI-2026-09-25-gpt-6-luna.md` (karar: o gün
değiştirilmedi).

## 1. Katman bazında modeller (bugün)

Kaynak: kodun çözücüleri + CLAUDE.md canlı tablosu (Railway ortam değişkenleri bu oturumda görülmedi; "canlı" sütunu
kurucu beyanı / kod varsayılanıdır).

| Katman | Ne yapar | Ortam değişkeni (öncelik) | Kod varsayılanı | Canlıda | Düşünme çabası |
|---|---|---|---|---|---|
| Misafir cevabı | kanal oto-yanıtı, gelen kutusu "AI öner", Ayarlar testi, QR, landing demo | `OPENAI_MODEL` | gpt-5.1 | gpt-5.1 | `OPENAI_REASONING_EFFORT` (ayarsız → gönderilmez) |
| Anlama katmanı | niyet, risk niyeti, sorgu yazımı, öğeler, ev kuralı gölgesi | `AI_SEMANTIC_MODEL` → `OPENAI_MODEL` | gpt-5.1 | gpt-5.1 (`AI_SEMANTIC_*` boş) | `AI_SEMANTIC_REASONING_EFFORT` (ayarsız) |
| Konaklama bekçisi | erken giriş / geç çıkış / uzatma cevap denetimi | aynı | gpt-5.1 | gpt-5.1 | aynı |
| Yeniden sıralayıcı | bilgi tabanı adaylarını sıralar (2,5 sn tavan) | aynı | gpt-5.1 | gpt-5.1 | aynı |
| Gömme | anlamsal bilgi araması | `OPENAI_EMBEDDING_MODEL` | text-embedding-3-small | bilinmiyor (env görülmedi) | — |
| Çeviri | ev sahibinin cevabını misafirin diline, gelen mesajı ev sahibine | `OPENAI_TRANSLATE_MODEL` → `OPENAI_MODEL` | gpt-5.1 | gpt-5.1 | gönderilmez |
| Üslup özeti | ev sahibinin yazış tarzı | `OPENAI_STYLE_MODEL` → `OPENAI_MODEL` | gpt-5.1 | gpt-5.1 | gönderilmez |
| Gölge güvenlik sınıflandırıcısı | yalnız kayıt, karar değil (kurucu org) | `SHADOW_AI_MODEL` | gpt-5.6-luna | gpt-5.6-luna | gönderilmez |
| Tedarik önerisi | alışveriş listesi | `SUPPLY_AI_MODEL` | gpt-5.6-luna | "OpenAI luna" | gönderilmez |
| Kalite denetçisi | operatör aracı (Anthropic) | `QUALITY_AUDIT_MODEL` | `quality-audit.ts` | yalnız `ANTHROPIC_API_KEY` varsa | — |

🚨 **Bulgu 1 — tek anahtar beş katman:** `AI_SEMANTIC_MODEL`, `OPENAI_TRANSLATE_MODEL`, `OPENAI_STYLE_MODEL` boş olduğu için
`OPENAI_MODEL=gpt-6-luna` yazmak cevap modeliyle birlikte anlama katmanını, konaklama bekçisini, yeniden sıralayıcıyı, çeviriyi
ve üslup özetini de AYNI ANDA Luna'ya taşır. Bekçi ve anlama katmanı mühürlü kör setle YALNIZ gpt-5.1'de doğrulandı
("model değişimi = yeni kör set"). → §5 adım 1: önce bu üç değişken `gpt-5.1`e sabitlenir (bugünkü değerin aynısı; davranış
birebir), sonra yalnız cevap modeli değişir.

## 2. Bu turda kodda yapılan (ücretsiz, canlı davranışı değiştirmez)

- **Koşu kimliği** (`tests/eval/run-meta.ts`): her ölçüm raporu + yan dosyası katman bazında model + GÖNDERİLEN düşünme
  çabası + commit + hattı değiştiren bayrakları taşır. Cevap katmanı ürünün kendi çağrı parametrelerinden (`replyCallParams`,
  `callOpenAI` ile aynı fonksiyon) okunur — ölçer ayrı kural uyduramaz. Yan dosyası olmayan dört ölçer de (yeniden sıralama
  ölçümü / tavanı, kural kipi, konuşma öğeleri) bloğu raporun sonuna yazar; `docs/olcum`a rapor yazan her ölçer dosyası bunu
  taşımak zorunda (mekanik pin).
- **Eski cevap Luna sonucu sayılmaz:** ücretsiz yeniden puanlama (`EVAL_COMPARE_RESCORE`, `EVAL_CUS_RESCORE`) ESKİ koşunun
  kimliğini korur; 09-30 öncesi yan dosyada yalnız cevap modeli bilinir, gerisi "bilinmiyor" yazar — o anki ortamın modeli
  eski cevaplara YAZILMAZ (pinli). Ölçer önbellekleri zaten model + gönderilen çaba + istem özetiyle anahtarlı (C5, 09-27):
  Luna koşusu 5.1'in önbelleğinden cevap OKUMAZ.
- **Canlı önbellek:** anlama katmanının önbelleği bellek içi ve anahtarında model var; ortam değişkeni değişince süreç yeniden
  başlar → eski modelin sonucu taşınmaz. Kod değişikliği gerekmedi.
- **Canlı karar kaydı:** cevap çağrısının kaydı (`llm`) sunulan modeli zaten taşıyordu; artık GÖNDERİLEN düşünme çabasını da taşır
  (`e`, yalnız gönderildiyse — bugün ayarsız olduğu için kayıt bayt bayt aynı). Luna açılınca hangi ayarın hangi kararı verdiği
  kayıttan okunur. Misafire giden hiçbir şey değişmez.

## 3. Geçiş öncesi diğer bulgular

2. **Yeniden sıralayıcının 2,5 sn tavanı:** 09-27 ölçümü Luna `none` p95 1,4 sn, `low` p95 2,8 sn. Varsayılan çabayla (Luna
   varsayılanda düşünür) çağrıların önemli kısmı tavanı aşar ve sessizce sıralamasız sonuca düşer (parafraz %78 → %67 düzeyi).
   Anlam katmanları 5.1'e sabitlenirse (§5-1) bu risk yok.
3. **`minimal` Luna'da 400:** `OPENAI_REASONING_EFFORT=minimal` + Luna = her cevap çağrısı reddedilir, misafir yedek şablon alır.
   Denenecek değerler: varsayılan, `low`, `none`. (Öneri — uygulanmadı: açılışta "Luna + minimal" uyarısı.)
4. **Dakikalık token sınırı:** hesapta Luna 200k token/dk (≈ 11 cevap/dk; 5.1'de 500k). Bugünkü hacme yeter; aynı dakikada
   ~11'den fazla misafir mesajı gelirse fazlası 429 → yedek şablon. Canlı geçişten önce hesap sınırı kontrol edilir.
5. **Ücret sorusu (KURAL-4):** 09-25'te Luna bilgi tabanındaki SABİT ücreti ("otopark günlük 150 TL") söylemedi, "ücret ev
   sahibinizin kararıdır" dedi ve bu cevaplar otomatik gidiyordu. Düzeltmek istem değişikliğidir = müşteriye giden metin →
   önce/sonra örnekli kurucu onayı (§4-F).
6. **Çıktı tavanı:** cevap çağrısında `max_completion_tokens` 2.000 (gizli düşünme dahil). 09-25 Luna koşusunda 135 cevapta 0
   düşüş, ortalama düşünme ~255 token → yeterli; canlıda `ai_unusable` sayacı izlenir.
7. (Belge kayması, küçük) `.env.example`te `SHADOW_AI_MODEL` / `SUPPLY_AI_MODEL` hâlâ eski Akash değerini gösteriyor; kod
   varsayılanı gpt-5.6-luna.

## 4. Önerilen ücretli değerlendirme (her adım AYRI onay; her kol önce 20 satırlık deneme)

Kurallar: misafire giden her şey canlıdaki modelle de ölçülür (vekil model yok); `RAG_LAB_RPM` zorunlu; aynı hesabın bakiyesi
canlıyla ortak → her koşudan önce tahmini tutar yazılır; kredi biterse her şey durur ve kurucuya hemen söylenir. Tutarlar liste
fiyatıyla KABA tahmindir (09-25 / 09-27 koşularından ölçeklendi).

| Adım | Ne | Neden | Tahmini tutar |
|---|---|---|---|
| A | 5.1 taban, güncel commit — cevap kıyası (135) | 09-25 sayıları eski istemle; kıyas aynı commit'te olmalı | ≈ $0,7 |
| B | Luna × {varsayılan, low, none} — aynı 135 | doğru olgu, sızıntı, dil, gecikme, maliyet | ≈ $0,3 (üçü) |
| C | Konaklama eval'i (dev + holdout, Luna cevap modeli) | cevap modelinin konaklama beyanı birleşimin katmanı | ≈ $0,5–2 |
| D | Cevap düzeyi RAG (dev, canlı yapılandırma, 5.1 ↔ Luna) | bilgi tabanından doğru cevap, kanıtsız iddia | ≈ $3–6 |
| E | Konuşma durumu + konuşma öğeleri eval'leri | selam / kapanış / öğe davranışı | ≈ $0,5–1 |
| F | KURAL-4 netleştirmesi onaylanırsa: A + B yeniden | ücret cevabı | ≈ $1 |
| G | Yeni kör set + gölge (`SHADOW_AI_MODEL=gpt-6-luna`, canlı env) | son karar | set yazımı ücretsiz; gölge ≈ kuruşlar |

Toplam kaba tahmin: **≈ $6–12**. 09-25 Luna koşusunda istemin ~%87'si önbellekten geldi (135 cevap $0,08); tutarın çoğu 5.1
tabanı ve cevap düzeyi ölçümü.

## 5. Canlı geçiş sırası (her adım AYRI onay; geri alma = değişkeni eski değerine yazmak)

1. `AI_SEMANTIC_MODEL=gpt-5.1`, `OPENAI_TRANSLATE_MODEL=gpt-5.1`, `OPENAI_STYLE_MODEL=gpt-5.1` — bugünkü değerin aynısı, davranış
   birebir; amaç cevap modelini TEK başına değiştirebilmek.
2. Gölge: `SHADOW_AI_MODEL=gpt-6-luna` (yalnız güvenlik sınıflandırması, kayıt).
3. Hesabın Luna dakika sınırı kontrolü.
4. `OPENAI_MODEL=gpt-6-luna` + ölçümle seçilen `OPENAI_REASONING_EFFORT` → ilk gün `ai_unusable`, 429, gecikme, yedeğe düşüş izlenir.
