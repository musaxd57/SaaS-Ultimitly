# Arşiv önerisi — sık okunan belgeler (2026-10-01)

> Kurucu talimatı (10-01 gece): "Luna çalışması tamamlandıktan sonra, V2'ye başlamadan önce sık okunan belgelerdeki tekrarları ve
> eski koşu ayrıntılarını arşive taşıma önerisi çıkar. Dosya silme; güvenlik kurallarını, kurucu kararlarını ve bekleyen onayları
> koru. SAKIN KISALTMAK İÇİN GEREKLİ YERLERİ SİLME."
>
> Bu belge YALNIZ ÖNERİDİR — hiçbir metin taşınmadı, hiçbir dosya silinmedi. Taşıma kurucu onayıyla tek commit'te yapılır; taşınan
> her parça arşive AYNEN kopyalanır (önceki iki sadeleştirmedeki gibi), kaynağı yazılır.
>
> Kaynak: salt-okuma araştırma ajanı + iddiaların kodda / belgede tek tek kontrolü (aşağıda "doğrulandı" yazanlar). Boyutlar
> CLAUDE.md'nin 10-01 gece hâline göre (203.411 bayt).

## Neden

CLAUDE.md her oturumda VE her alt ajanda baştan okunur (kurucu 09-23: "ajan token maliyeti birikimlidir"). Bugün dosyanın ~%9'u
kural değil, tur anlatısı / eski ölçüm sayısı / kopyadır. Kural metinleri olduğu gibi kalır; yalnız anlatı ve sayılar arşive gider.

## Önerilen arşiv dosyası

`docs/history/CLAUDE-2026-10-01-durum-ve-olcum-arsivi.md` — CLAUDE.md başlığındaki arşiv listesine eklenir. "Durum" bölümünde tek
işaretçi kalır: "Eski tur anlatıları (09-23 → 09-30) ve kural içindeki ölçüm sayıları AYNEN: docs/history/CLAUDE-2026-10-01-…".

## A. "Durum" bölümündeki tur anlatıları (≈13k karakter)

| # | Parça (ilk sözcükler) | Neden taşınabilir | CLAUDE.md'de KALACAK |
|---|---|---|---|
| 1 | "09-23/24 TURU", "09-23 ÜÇÜNCÜ / DÖRDÜNCÜ / BEŞİNCİ TUR" | Kuralları Retrieval / AI güvenlik / Kalıcı ürün kararları bölümlerinde zaten var; "kredi bitmiş", "müsaitlik vetosu ONAY BEKLEYEN" eskidi | ortak işaretçi |
| 2 | "09-24 ANLAM KATMANI TURU", "09-24 DOĞRULANMIŞ ERKEN GİRİŞ TURU" | Paragrafın kendisi "Ayrıntı ↑" diyor; aynı içerik AI güvenlik maddelerinde | ortak işaretçi |
| 3 | "09-24 BELİRSİZLİK TURU", "09-24 KANIT MODELİ DİLİMLERİ" | BELİRSİZLİK / BİRLEŞİM / KANIT MODELİ / PARA maddeleri aynı sayıları taşıyor | **Bekleyenler'e:** temizlikçi davet, anlama `events[]` + "çıktık" kaydı, varsayılan temizlikçi |
| 4 | "09-25 ÖLÇÜM + YAYIN", "09-25 İKİNCİ İNCELEME TURU" | Eval "A seti YANDI", ANLAM KATMANI "CANLIDA AÇTI", "Repo PUBLIC" maddeleri taşıyor | ortak işaretçi |
| 5 | "09-25 MESAJLAŞMA ÇEKİRDEĞİ v2", "09-25 MESAJ ANLAMA ÇEKİRDEĞİ" | KAPANIŞA SESSİZLİK, ZAMAN BAĞLAMI, BEKLEME SÖZÜ, ENQUEUE_CLOCK, KONUŞMA KAYITLARI, EYLEM BEYANI maddeleri | **Bekleyenler'e:** Host Karar Motoru, A/B (SABİTLENMEDİ), iki bayrağın açılışı, CUS v2 defteri, anlama v2 §4 (KURUCU ONAYI) |
| 6 | "09-26 CODEX P2 TURU", "09-26 EV SAHİBİ GÜN KURALI" | Kalan P2 listesi ve "EV SAHİBİ YÜZEYLERİ (166a)" maddesi | **Bekleyenler'e:** 167b (görev saati UTC — ONAY BEKLEYEN) |
| 7 | "09-26 GECE #189", "09-27/28 GECE MODU", "09-28 ÖĞLEDEN SONRA", "09-30 CODEX ÜÇ PARTİ" | Kuralları ilgili maddelerde | 🚨 **"KESİNLİKLE ÜCRETLİ TEST YAPMA"** cümlesi AYNEN kalır (siren); **Bekleyenler'e:** SABAH-KARARLARI kalanları |
| 8 | "09-30 gece — LUNA ÖLÇÜMÜ" | MODEL KIYASI "09-30 ÖLÇÜM" alt maddesinin kopyası | **Bekleyenler'e:** yeni kör set + üç bayrağın açılışı (10-01 gece ölçümünün sonucuyla güncellenecek) |
| 9 | "09-26 KONUŞMA ÖĞELERİ" + "Canlı değişkenler (kurucu 09-26)" | KARIŞIK — bazı kurallar YALNIZ burada | **Önce** kurallar AI güvenliğe yeni madde olur (hassas istek sessizce ev sahibinde, HAZIR TASLAK, ev kuralları dilim 2/3, "karar değişmez yalnız KOD için", ödeme / fatura niyetten hassas); arşive yalnız commit kimlikleri, yedek SHA ve eskimiş "açma =" cümlesi gider |

Durumda iki paragraf AYNEN kalır: "09-30 akşam K1–K18" (K7 yayını) ve "09-25 HOST COPILOT" (Faz 0 onayı bekliyor).

## B. Kural cümlelerinin içindeki ölçüm sayıları (≈2,6k)

Kural cümlesi aynen kalır; yalnız sayı parantezi taşınır, yerine belge atfı ("ölçüm: `docs/olcum/…`") yazılır.

| # | Yer | Taşınacak | Kalacak |
|---|---|---|---|
| 10 | Retrieval › yeniden sıralayıcı, #189, A5, noHitFill, ölçek harness'ı | "288 çağrı…", "%71→%98", "6→2", "%30 → %0", "0/10 → 9/10", "+16/−9", "Legacy inPrompt %51", "kâhin %87→≥%90" | bayrak, tavan, "REDDEDİLDİ" hükümleri |
| 11 | Kalıcı ürün kararları › MODEL KIYASI | "135 senaryo…", "~1.000 soruda…", "`low` p95 2,8 sn" | karar + gerekçe ("Luna ücreti söylemedi", "5.1'de kalalım", `minimal` 400) |
| 12 | Embedding durumu | "Sözcüksel taban…", "E4 … %38→%66…", "643 metin" | "E4 koştu 09-26 (kurucu onayı; rapor)" |
| 13 | Çıktı vetosu / saat alanı / karesel iş | "Korpus 1.287…", "23→0, 76→1", "131→1, 44→13", "99/168…", "6/67 → 67/67", "1,6–2,5 sn" | "edilgen bilinçli", ikiz batarya, "görüldü" kuralları |
| 14 | Dil / iddia desteği / eval | "52/59…", "139…", "221 cevabın…", "552 cevap 21→1", "kaçak 0/117…" | "P5 CANLIDA KAPALI", "önce time/date/money", "YANDI" |

## C. Kopyalar (≈0,5k)

| # | A ↔ B | İşlem |
|---|---|---|
| 15 | Retrieval "Mutasyon kontrol koşusu (M0)" ↔ Çalışma dersleri "Mutasyon YALNIZ mutation-run.mjs" | Retrieval satırı çalışma derslerine birleşir |
| 16 | Çalışma dersleri "Tam suit koşarken başka vitest…" ↔ Çalışma tarzı "Tam suit koşarken BAŞKA vitest KOŞMA" | Çalışma tarzındakine "eval config'i paralel koşabilir" eklenir |
| 17 | Açık işler "Selam tekrarı…" ↔ AI güvenlik "Selam tekrarı…" | AI güvenlik maddesine "(konuşmanın tamamı, pencere değil)" |
| 18 | Kalıcı kararlar "Retrieval yabancı sözlüğü" ↔ Retrieval "Yabancı dil sözlüğü" | Retrieval maddesine test adı + çarpışma tuzağı notu |

Birleştirilmeyecek (kurucu onayı olmadan): "KESİNLİKLE ÜCRETLİ TEST YAPMA" (Durum) ↔ Eval "ÜCRETLİ ÖLÇÜM" — ikisi de siren işaretli,
Durum'daki sürüm ek ayrıntı taşıyor.

## D. Taşımadan ÖNCE düzeltilmesi gereken eski / eksik ifadeler (doğrulandı)

1. **Yedi canlı bayrak "Canlı durum" tablosunda YOK** (yalnız düz yazıda): `AI_UNDERSTANDING_ENABLED`, `AI_STAY_GUARD_ENABLED`,
   `AI_CONVERSATION_ITEMS_ENABLED`, `KB_SEMANTIC_RETRIEVAL`, `KB_RERANK_ENABLED`, `HOUSE_RULES_CARD_ENABLED`, `AI_HOUSE_RULES_SHADOW`
   (hepsi canlıda =1, kurucu beyanı). Taşımadan önce tabloya eklenmeli — yoksa düz yazı arşive gidince canlı durum kaybolur.
2. **"Embedding durumu" maddesi "E2 tablo = migration 56" diyor** — 56 konuşma öğelerine verildi (aynı dosyada). Düzeltilmeli.
3. **Aynı madde "AÇMA KARARI KURUCUDA" diyor** — `KB_SEMANTIC_RETRIEVAL=1` canlıda (kurucu 09-26). Düzeltilmeli.
4. **ÇALIŞMA BİÇİMİ: "Railway ayın 1'ine kadar aktif"** — bugün 10-01. Kurucu teyidi gerekir (push = canlı yayın varsayımı buna dayanıyor).

## E. Diğer sık okunan belgeler

- **`docs/LUNA-GECIS-HAZIRLIGI-2026-09-30.md`** — "Durum (ilk sürüm)" (Güncelleme paragrafıyla çelişiyor), §2 (CLAUDE.md'de var),
  §4 (planlanan ücretli ölçüm; yapıldı) arşive (≈%40). §1 tablosu 10-01 katman değişkenleriyle (`AI_UNDERSTANDING_MODEL` vb.)
  GÜNCELLENMELİ — taşıma değil, düzeltme.
- **`docs/INCELEME-2026-09-30-codex-ve-ajanlar.md`** — karara bağlanmış öneri metinleri (K1–K4, K6, K8–K12, K14, K16, K18) ve iki
  mutasyon paragrafı arşive (≈%26); K5, K7, K13, K15, K17 ve tablolar kalır. Beşi kapanınca dosyanın tamamı arşive.
- **`ROADMAP.md`** (son güncelleme 07-22) — "Gerçek durum" ve tamamlanmış satırlar (≈%36) arşive. ⚠️ Faz 5'teki "2. PMS adaptörü
  (Guesty/Hostaway)" satırı 09-07 kurucu talimatıyla ("PMS connector'ları çoğaltmak strateji değil") çelişiyor — SİLİNMEZ, kurucuya
  sorulur.

## F. Dokunulmayacaklar

Yol planı · Değişmez kural · DOKUNMA / DİKKAT (işletme adı anlatısı dahil) · Teknik mimari · Fiyat · Hospitable ortaklığı · Mevcut
özellikler · Çalışma tarzı · Çalışma dersleri · Intelligence · bütün kural metinleri (Kalıcı kararlar / Kalıcı ürün kararları / AI
güvenlik) · Saat alanı kuralı maddesi (tur etiketli ama içeriği kural) · "Yeni org 7/24 … 09-12 GÜNCELLEME" · ÇALIŞMA BİÇİMİ
bölümünün siren işaretli başlığı.

## G. Taşıma sonrası kontrol (önerilen)

- Önce / sonra sayım: 🚨 işareti, "ONAY BEKLEYEN / bekliyor / KURUCU ONAYI" ifadeleri ve bayrak adları — düşüş olmamalı.
- Arşiv dosyası taşınan her parçayı AYNEN içermeli (parça başına `grep -F` ile kontrol).
- Beklenen kazanç: CLAUDE.md ≈16k karakter (~%8,6) küçülür; "Durum" bölümü ≈18,8k → ≈3,5k.

## Karar

Sabah kararları listesinde madde olarak: onaylanırsa taşıma tek commit + yukarıdaki kontroller; onaylanmazsa belge öneri olarak kalır.

## EK (10-02 gece — Luna çalışması TAMAMLANDI; öneri son hâle getirildi, yine HİÇBİR metin taşınmadı)

- **Boyutlar bugün:** CLAUDE.md 220.982 bayt (öneri yazılırken 203.411 — gece 2'nin "Durum" paragrafları ve yeni kalıcı kurallar eklendi);
  `docs/SABAH-RAPORU-2026-10-01.md` ≈70k, `docs/SABAH-KARARLARI-2026-10-01.md` ≈79k.
- **CLAUDE.md "Durum":** "10-01 GECE 2" ve "10-01 GECE" paragrafları da A grubuna eklenir (tur anlatısı); her biri tek satırlık işaretçiyle
  arşive. Kalıcı kural cümleleri (ör. `items_fix_money`, "bilgim yok" çözüm sınıfı, uyarı adresi kuşağı) olduğu yerde KALIR.
- **Sabah raporu:** kurucu Luna kararını verince §1–§3.14 (ölçüm ayrıntısı, R0–R6, kör set 2–8 tabloları) `docs/history/SABAH-RAPORU-2026-10-01-
  olcumler.md`'ye AYNEN; raporda §0 özet + §3.15 (son kör kabul) + §4 maliyet + §5 kapı / CI + §6 / §7 kalır.
- **Sabah kararları:** "KARAR: …" satırıyla kapanan maddeler `docs/history/SABAH-KARARLARI-2026-10-01-kapananlar.md`'ye AYNEN; açık maddeler ve
  öncelik listesi kalır (numaralar DEĞİŞMEZ — bağlantılar kopmasın).
- **Dokunulmayacaklar (F) aynen:** güvenlik kuralları, kurucu kararları, bekleyen onaylar (özellikle 6, 22, 46–50) taşınmaz.
