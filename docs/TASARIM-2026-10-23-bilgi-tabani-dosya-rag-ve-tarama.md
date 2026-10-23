# Bilgi tabanı: dosyadan yükleme, RAG / gömme, tarama ve eksik bilgi döngüsü — tasarım (10-23 öğle)

> Kurucunun isteği (10-23, aynen kısaltılmış): *"hostlar bilgi tabanı giricek ya her daire için ayrı ayrı olarak dosya bazında oluştursak orda
> embedding oluştursak ve rag sistemi kursak çok iyi olmaz mı şuan bizde bunun ne kadarı var … sık sorulanı … sadece kontrol ederek hemen cevap
> gönderebilir … biz zaten birşeyler yaptık durum nedir … agentlarla güzel fikirlerle sende düşün en güzel şekilde uygulamaya başlayalım ama dosya
> olarak toplu veriler indirmesi bence güzel bir şey olur hostlar için yazmakla uğraşmalarından iyidir bizim ordaki rag ve embeddingimiz iyi olmalı
> ama ona çok dikkat et."* + etiket notları (`docs/KURUCU-ETIKET-NOTLARI-2026-10-23.md` 1, 2, 8, 9, 10, 14, 17, 22, 25, 29) + Codex'in cevabı
> (daire bazında evet, fiziksel dosya şart değil; PDF / metin yükleme → kaynağı korunarak parçalara; iki bağımsız doğru olmasın; önbellek
> ekleme / silme / pasifleştirme / yeni istisna ile geçersiz; "Çıkış kaçta?" ≠ "13:00'te çıkabilir miyiz?").
>
> Bu belge kod yazmadan önceki düşünmedir (CLAUDE.md "KODDAN ÖNCE UZUN DÜŞÜN"). Ev sahibi ekranına ya da misafire giden metne dokunan her
> parça §7'de önce / sonra örnekli SORUdur; cevap gelmeden yüzey kurulmaz. Bu turda yalnız müşteriye dokunmayan çekirdek + ölçüm yapılır (§8).

## 1. Kısaca

- **Daire başına ayrı bilgi: VAR.** Her kalem bir daireye bağlı; getirme yalnız o dairenin onaylı kalemlerine bakar.
- **RAG: VAR, üç katlı.** Sözcüksel arama (Türkçe kök + yazım toleransı + yabancı dil sözlüğü) varsayılan açık; anlamsal arama (gömme) ve
  yeniden sıralayıcı kodda hazır, canlıda açılacak anahtarlar listesinde. ≤30 kalemlik bilgi tabanı BİLEREK bütünüyle gider (seçim yapınca
  ölçülen cevap kaybı vardı); daha büyükte soruya göre 6.000 karakter / 12 parça seçilir.
- **Eksik olan dört şey:** ① dosyadan yükleme (PDF / Word / metin) ② gömmelerin KALICI deposu (bugün yalnız süreç belleği, 4.096 vektör,
  bütün kiracılar ortak — ölçek büyüyünce anlamsal arama sürekli "soğuk" kalır) ③ bilgi tabanı taraması + ev sahibine günde birkaç küçük
  onay sorusu ④ eksik bilgide geçmiş ev sahibi cevaplarından aday + şıklı onay + gönder + "bilgi tabanına kaydedeyim mi?".
- **Önerdiğim ilke: tek doğru.** Dosya bir KAYNAKtır, ikinci bir doğru değil. Dosyadan çıkan her bilgi ev sahibinin onayıyla normal bilgi
  kalemine dönüşür; dosya metni ayrıca aranmaz. Aksi hâlde aynı bilginin iki kopyası zamanla ayrışır (A5'in "çift kopya yasak" kuralı).
- **Önerdiğim güvence: model bilgi yazamaz.** Dosyayı konulara ayırırken model yalnız "şu paragraflar şu konu" der; kalemin metni kodla ev
  sahibinin KENDİ cümlelerinden birleştirilir. Uydurma bilgi bilgi tabanına giremez — her taslak dosyada birebir bulunur (kodla doğrulanır).

## 2. Bugün kodda olan (envanter — Haiku ajanları + kodla doğrulandı)

| Parça | Durum | Yer |
|---|---|---|
| Kalem daireye bağlı; okuma `propertyId + isActive + onay kapısı` | ✅ | `prisma/schema.prisma:847-889`, `ai/kb-fetch.ts:90`, `kb-review.ts:47-49` |
| Onay sözleşmesi: `draft` / `extracted_draft` modele GİTMEZ (izin listesi) | ✅ altyapı hazır, yazan yok | `kb-review.ts:23-49` |
| Elle ekleme / düzenleme / silme · diğer dairelere kopyalama (kopya izi) | ✅ | `api/kb/route.ts`, `api/kb/[id]/copy/route.ts` |
| Şablondan öneri (Wi-Fi, kurallar) · Geçmişten öğren (anahtarlı) | ✅ | `kb-from-templates.ts`, `history-learn/service.ts` |
| Metinden bilgi çıkar (A5, kelime + kalıp, modelsiz) | ⏸ kod + test yerinde; yüzey kurucu kararıyla 09-11'de kaldırıldı ("fazla işlevi yok") | `kb-extract.ts`, `kb-import-text.tsx` |
| **Dosya yükleme (PDF / Word / metin)** | ❌ yok (yükleme yalnız JPG / PNG / WebP) | `api/upload/route.ts:13` |
| Sözcüksel getirme (BM25 + Türkçe kök + 3-gram + yazım toleransı) | ✅ varsayılan açık | `ai/retrieval/*` |
| Küçük bilgi tabanı (≤30 kalem, ≤24k) bütünüyle gider | ✅ bilinçli (ölçüldü, 09-23) | `retrieval/kb-line.ts` `kbFitsWhole` |
| Anlamsal getirme (`text-embedding-3-small`, 1536) | ✅ kodda, anahtar `KB_SEMANTIC_RETRIEVAL` kapalı (canlıda açılacak) | `embeddings/*`, `retrieval/semantic.ts` |
| OpenAI yeniden sıralayıcı | ✅ kodda, `KB_RERANK_ENABLED` kapalı (canlıda açılacak) | `semantic/rerank.ts` |
| **Gömme deposu** | ⚠️ yalnız süreç belleği, LRU 4.096 vektör, saatte 2.000 metin ısıtma; yeniden başlatmada boşalır; kalıcı depo "E2" bekliyor | `embeddings/semantic-retrieval.ts:24-89` |
| Sık sorulana kayıttan cevap (doğrulanmış cevap tekrarı) | ✅ gölge kip, migration 85 ana dalda, anahtar kapalı | `answer-reuse/*`, `TASARIM-2026-10-23-dogrulanmis-cevap-tekrari.md` |
| Saat çelişkisi (kalem ↔ daire ayarı, kalem ↔ kalem) | ✅ sayfa açılışında hesaplanır, kaydedilmez; cevap anında soru insana kalır | `kb-time-conflicts.ts:103`, `ai/time-conflict-gate.ts` |
| Mülk Hafızası çelişki uyarısı (misafir "bilgi yanlış" dedi ↔ kalem) | ✅ | `intelligence/memory/contradictions.ts` |
| **Aynı değer iki dairede (otopark no, kapı kodu)** | ❌ yok | — |
| **Ev sahibine günde sınırlı "onaylar mısınız?" sorusu** | ❌ yok | — |
| **Eksik bilgide geçmiş ev sahibi cevabından aday** | (§6 — envanter ajanı) | |

Ölçülmüş getirme başarısı (yalnız getirme, cevap değil): 276 kalem, bütün bayraklar hazır → Türkçe 437/441, diğer diller 438/441 soru
cevabın geçtiği parça blokta (`docs/RAG-EMBEDDING-SON-DURUM-2026-09-28.md`); 300 kalemlik ölçek setinde para grubu 81/82
(`docs/olcum/rag-lab-2026-10-14-11.md`).

## 3. Kurucunun sorularına doğrudan cevaplar

**"Daire başına dosya bazında embedding + RAG kursak, ne kadarı var?"** — Daire başına ayrım ve RAG var (§2). Eksik olan dosya yükleme ve
gömmelerin kalıcı deposu. Bir not: bugünkü ev sahibi bilgi tabanlarının çoğu 30 kalemin altında; o boyutta model zaten hepsini okuyor ve bu
bilinçli (09-23 ölçümünde "seçerek gönder" parafraz sorularda doğru cevabı düşürüyordu). Dosya yükleme gelince bilgi tabanı büyür → seçim
devreye girer → anlamsal arama ve kalıcı depo o zaman gerçekten önemli olur. Sıralama bu yüzden: önce kalıcı depo + ölçüm, sonra büyük
dosyalar.

**"Havuz / havuz barı hatası (etiket 1–2) — embedding ayırmaz mı, model bunu ayıramıyorsa…"** — Getirme bu iki örnekte DOĞRU kalemi
getirdi; iki bilgi aynı kısa kalemde, aynı 70 karakterlik parçada ("Havuz barı 11:00'de açılır. Havuz 09:00-20:00 arası açıktır."). Gömme
parça düzeyinde çalışır, bir parçanın içindeki iki cümleyi ayırmaz. Yanlış cümleyi cevap yazan model seçti. Bu cevaplar **misafire gitmez**:
parça okuyucusu iki örneği de iki denemede de "soruyu cevaplamıyor" diye tuttu (`docs/olcum/part-reader-dev-2026-10-23-luna-low-s3.json`:
`codex-1` ve `codex-2` → `not_answered`, `not_answered`). Kalıcı iyileştirme bilgi tabanının yapısında: tarama "bu kalemde iki ayrı tesis
var (havuz / havuz barı), ayırayım mı?" diye sorabilir (§5) — ayrı kalemde ilk denemede doğru cümle seçilir.

**"Fine-tuning yapalım kesinlikle"** — Dürüst değerlendirmem: ince ayar modele OLGU öğretmek için değil, DAVRANIŞ öğretmek içindir; her
dairenin bilgisi değişir ve hep bilgi tabanından gelmek zorunda. Yanlış cümle seçme davranışı için ince ayar işe yarayabilir ama (a) bunun
için yüzlerce–binlerce etiketli örnek gerekir (bugün 30 etiket var), (b) bu hatalar zaten kodla + okuyucuyla tutuluyor, (c) ince ayarlı
model sürüme kilitlenir, misafir mesajıyla eğitim KVKK açık rızası ister. Önerim: etiket sayfasını sürekli besleyelim (her ölçümden gelen
örnekler), ~500 etiketli örneğe ulaşınca ince ayarlı küçük bir modeli OKUYUCU olarak eşleştirilmiş ölçümle deneyelim (cevap yazan model
değil — okuyucu daha dar ve ölçülebilir iş). Soru §7-G.

**"Sık sorulanı sadece kontrol ederek hemen gönderebilir"** — Doğrulanmış cevap tekrarı bunu yapıyor (gölge kipte). Codex'in iki şartı
tasarımda: (1) kayıt, cevabın konusunu anan bütün etkin kalemlerin izine bağlı — ilgili kalem eklenir / değişir / silinir / pasife alınır /
yeni istisna eklenirse kayıt geçersiz; (2) aynı tür + sorunun yönü cevapta olmalı ("Çıkış kaçta?" kaydı "13:00'te çıkabilir miyiz?"e
verilmez — birim testi var). Ölçüm (geliştirme seti): doğru tekrar 27/38, yanlış tekrar 0/132. Tekrar yalnız cevap modelinin yeniden
yazmasını atlar; bütün gönderim kapıları yine koşar. Açılması: Railway açılınca gölge ölçüm → kör set → sizin kararınız.

## 4. Dosyadan bilgi tabanına — önerilen akış

### 4.1 İlke: tek doğru, model bilgi yazamaz

1. **Dosya kaynak, kalem doğru.** Onaylanan her şey normal bilgi kalemidir (kategori, başlık, içerik, onay damgası). Dosyanın metni ayrıca
   getirmeye girmez. Böylece "çıkış 11:00" bilgisi hem dosyada hem kalemde iki ayrı doğru olarak yaşamaz.
2. **Model yalnız bölümler.** Kod dosyayı paragraflara böler ve numaralar; model yalnız `[{konu, başlık, paragraflar: [3,4,7]}]` döndürür.
   Kalemin içeriği o paragrafların AYNEN birleşimidir. Model tek bir sözcük ekleyemez; kod her taslağın dosyada birebir geçtiğini sınar.
   (Bugünkü parçalayıcının "metin DEĞİŞMEZ, `content.slice`" ilkesinin aynısı.)
3. **Daire alanı olan bilgi kalem olmaz.** Giriş / çıkış saati daire ayarında tutulur; dosyada geçerse "daire ayarı önerisi" olarak ayrı
   gösterilir (A5 kuralı). Yer tutucu satırlar (`{isim}`, `___`) taslağa girmez, "atlandı" diye gösterilir.
4. **Sır taşıyan paragraf işaretlenir** (kapı kodu, kasa şifresi, alarm kodu): bugünkü sır kuralları aynen geçerli (QR'da kapı kodu yok,
   Wi-Fi bağlı cihazda vb.); ev sahibine "bu paragrafta bir kod var, şu kurallarla kullanılır" diye gösterilir.

### 4.2 Metin nerede çıkarılır — tarayıcıda

PDF / Word dosyası sunucuda AÇILMAZ; metin ev sahibinin tarayıcısında çıkarılır (PDF: pdf.js, Word: mammoth, .txt / .md doğrudan) ve
sunucuya yalnız metin + sayfa numarası gider. Gerekçe: kötü niyetli PDF / sıkıştırma bombası sunucuya hiç ulaşmaz; A5'te de çıkarım
tarayıcıdaydı. Ev sahibi zaten aynı metni elle yazabildiğinden metin yolu yeni bir yetki açmaz. Taranmış (resim) PDF ve fotoğraf (OCR)
ikinci aşama — görsel model ister, ayrı ölçüm.

Kütüphane güvenliği (araştırma ajanı, 10-23; GitHub advisory sayfaları ajanın okuduğu hâliyle — kurulumda `npm audit` kapısı ve
`security/audit-baseline.json` ile yeniden doğrulanır, TRİAJSIZ açık kabul edilmez):
- **pdf.js (`pdfjs-dist`)**: CVE-2024-4367 (keyfi betik, 4.2.67'de düzeltildi; ek önlem `isEvalSupported: false`) ve ajanın bildirdiği
  GHSA-hq66-cqwq-w95j (5.6.83 ≤ v < 6.2.108). Kullanım: yalnız metin (`getTextContent`), DOM'suz bir Web Worker içinde; çizim, form,
  açıklama katmanı ve belge betikleri KAPALI; sürüm ≥ 6.2.108. Node gereksinimi (≥ 22.13) bugünkü 22.22 ile uyumlu.
- **mammoth** (Word): CVE-2025-11849 (belgedeki harici bağlantılı görselle sunucu dosyası okuma, 1.11.0'da düzeltildi, harici dosya erişimi
  varsayılan kapalı). Tarayıcıda koştuğu için sunucu dosyası zaten erişilemez; yine de sürüm ≥ 1.11.0.
- `pdf-parse` önerilmez (bakımı zayıf, kendi pdf.js'i yok).
- Boyut tavanları: dosya ≤ 10 MB, metin ≤ 200.000 karakter, sayfa ≤ 100 (tarayıcıda; sunucu yalnız metin tavanını yeniden uygular).
- Rakip ürünler (ajan, çoğu resmi sayfaya erişilemedi → "özet"): Enso Connect ve HostBuddy belge yüklemeyi mülk / kategori bazında alıyor;
  Hospitable Knowledge Hub mülk verisi + geçmiş mesajlardan taslak üretiyor ve Touch Stay rehberini içe alıyor; Uplisting belgeden
  soru-cevap çiftleri üretiyor. Kaynak saklama, çelişki tespiti ve "model bilgi yazamaz" güvencesi hiçbirinde doğrulanamadı — bizim ayrışan
  yanımız bu üçü olabilir.

### 4.3 İnceleme ekranı (önce / sonra §7-A)

Her taslak dört etiketten biriyle: **Yeni** · **Zaten var (aynı)** · **Mevcutla çelişiyor** (yan yana: "Bilgi tabanınızda: Çıkış 11:00 —
Dosyada: Çıkış 12:00. Hangisi doğru?") · **Daire ayarı**. "Çelişkisizleri onayla" tek tık; çelişkiler tek tek. "Dosyadakini kullan" = eski
kalem pasif + yenisine bağlanır (migration 70'teki "daha güncel olanı seç" akışı). Onay mevcut yazma yolundan geçer (plan sınırı, istek
kimliği, hafıza eşitlemesi, gömme ısıtması).

### 4.4 Plan sınırı

Paketler daire başına 15 / 30 / 60 etkin kalem. Konu başına TEK kalem (aynı konunun paragrafları birleşir) önerisiyle tipik bir ev rehberi
10–15 kaleme iner. 15'lik pakette taşabilir → soru §7-B.

### 4.5 Yeni sürüm yükleme (ikinci aşama, migration ister)

Aynı dosyanın güncel hâli yüklenince yalnız DEĞİŞEN konular taslak olur ("Otopark paragrafı değişmiş: 12 → 14"). Bunun için dosyanın
kendisi (ya da paragraf izleri) bir tabloda tutulmalı (`KbDocument`). İlk aşamada kalemde yalnız PII'siz işaretçi tutulur
(`sourceRef = dosya özeti + sayfa`; alan zaten şemada, bugün yazan yok).

## 5. Bilgi tabanı taraması ve günde en çok 3 soru (etiket 9, 10, 14, 17, 25)

Kurucunun tarifi: ev sahibi kalem ekleyince tara; eksik / hatalı / anlaşılması zor yerleri küçük onay soruları olarak sor; günde 3 sınır;
onaylanınca yalnız o daire; sonra "aynı durum öteki dairelerinizde de var, onlara da uygulayayım mı?" diye kısa ön gösterimle sor.

**Bulucular (önce KOD, model değil — ölçülebilir, ücretsiz, kendi kendine yanlış alarm üretmesi sınanır):**

| # | Ne bulur | Örnek (etiket) | Önerilen soru |
|---|---|---|---|
| T1 | Tek kalemde iki ayrı tesis + iki ayrı saat | "Havuz barı 11:00'de açılır. Havuz 09:00-20:00" (1–2) | "Bu kayıtta havuz ve havuz barı birlikte. İkiye ayırayım mı?" |
| T2 | Genel kural ve istisnası AYRI kalemlerde | "Bahçe 21:00'e kadar" + "Cumartesi 23:00'e kadar" (10) | "Bahçe: cumartesi hariç 21:00'e, cumartesi 23:00'e kadar açık — böyle birleştireyim mi?" |
| T3 | Yalnız istisna var, genel kural yok | "Hafta sonu havuz 23:00'e kadar" (8) | "Hafta içi havuz kaçta kapanıyor?" (cevap yeni kaleme/kaleme eklenir) |
| T4 | Saatin hangi günlere geçtiği belirsiz | "Kahvaltı 08:00-10:30, hafta sonu 11:00'e kadar" (17) | "Kahvaltı hafta içi 08:00–10:30, hafta sonu 08:00–11:00 — doğru mu?" |
| T5 | Çelişen saatler (var olan kural) | kalem 11:00 ↔ daire ayarı 12:00 | "Hangisi doğru?" |
| T6 | Aynı değer iki farklı dairede | otopark 12 iki dairede (14) | "Lale 1 ve Lale 2'de aynı otopark numarası (12) yazıyor. Doğru mu?" — "Evet, ortak" cevabı kaydedilir, bir daha sorulmaz |
| T7 | Yer tutucu kalmış | "Wi-Fi şifresi: ____" | "Wi-Fi şifresi boş görünüyor." |
| T8 | Ücret / koşul eksik izlenimi (evcil hayvan) | "10 kg altı kabul, gecelik 100 TL" (22) | bulucu değil, cevap kuralı → §7-E |

**Model nerede:** yalnız birleştirme / ayırma önerisinin METNİNİ yazmakta (T1, T2, T4). Kod öneriyi sınar: önerideki her saat / sayı /
tutar kaynak kalem(ler)de birebir var, yeni değer yok, olumsuzluk (dahil değil / kabul edilmez) korunmuş — bugünkü parça doğrulayıcısı
(`answer-binding.ts`) bunu zaten yapıyor. Geçmeyen öneri soru olmaz.

**Soru kuyruğu:** önem sırası (çelişki > tek kalemde iki tesis > ayrı kalemde istisna > belirsiz gün > aynı değer > yer tutucu); günde en
çok 3; cevaplar: **Onayla** · **Düzenle** · **Böyle kalsın** (aynı soru bir daha sorulmaz). Kalıcı kayıt ister (`KbQuestion` tablosu →
migration). Onaylanınca yalnız o daire değişir; ardından aynı bulucu öteki dairelerde aynı durumu bulursa ön gösterim: "Lale 2, Lale 3:
'Bahçe 21:00'e kadar' → 'Bahçe cumartesi hariç 21:00'e, cumartesi 23:00'e kadar'. Uygulayayım mı?" (tek tık, daire başına tik kutusu).

## 6. Eksik bilgi döngüsü (etiket 8, 9, 29)

Kurucunun tarifi (etiket 8, kısaltılmış): soru bilgi tabanında yoksa ya da yarımsa → (1) RAG ile ara → (2) ev sahibinin ÖNCEKİ cevaplarında
hemen ara ("en güncel verdiği cevap çok büyük tüyodur") → (3) ev sahibine şıklı onay bildirimi, önceki cevabın TARİHİYLE → onaylarsa hemen
misafire gönder (süre geçmemiş, konu değişmemiş, araya mesaj girmemişse; "peki teşekkürler" dendiyse bağlama göre "Bu arada …") → (4)
"Bilgi tabanınıza kaydedeyim mi?". Etiket 13: "onay olursa otomatik doğru kabul edilebilir hosttan".

**Bugün kodda (Haiku envanteri, kodla doğrulandı):**

| Adım | Durum |
|---|---|
| (1) RAG | ✅ (§2) |
| (2) geçmiş ev sahibi cevaplarında CEVAP ANINDA arama | ❌ yok. "Geçmişten öğren" yalnız toplu çalışma (540 gün, maskeli, modelle taslak → onaylı kalem; `history-learn/service.ts:67,230`); cevap yoluna bağlı tek parçası mülk talimatı (`prompt-instructions.ts:48-73`). Geçmiş cevap öneri bacağı kapalı (`kb-suggestions-flag.ts`). Açık iş #131 (L1). |
| (3) şıklı onay + tek tık gönder | ⚠️ yalnız konaklama talepleri (erken giriş / geç çıkış; Host Karar Motoru, anahtar kapalı, `decisions/core.ts:20`); onay → düzenleyici → "Misafire gönder", sunucuda "misafir yeniden yazdı" + metin denetimi (`api/conversations/[id]/decisions/[decisionId]/route.ts:131-291`). "Bilgi yok" için kart yok. |
| bildirim kanalı | yalnız e-posta + uygulama içi panel (`decisions/notify.ts:92`, `host-reply-waiting.ts:97`). WhatsApp / SMS / anlık bildirim YOK. |
| (4) "bilgi tabanına kaydet" | ⚠️ yalnız yapay zekâ taslak kartındaki "Eksik bilgi" satırında ön dolu forma bağlantı (`conversation-thread.tsx:1031-1046`); elle cevap ya da karar onayından sonra teklif YOK. |

**Önerilen akış (ikinci aşama; ev sahibi ekranı + misafire giden → §7-D sorusu):**

1. Cevap anında açık kalan her ihtiyaç için (sessiz tur ya da kısmi gönderim — Soru 6 / Soru 10 ile aynı kayıt) o dairenin son 540 gündeki ev
   sahibi cevaplarından (soru ↔ cevap eşleştirmesi ve maskeleme Geçmişten öğren'de HAZIR) en yakın 1–3 aday bulunur. Aday misafire ASLA
   kendiliğinden gitmez.
2. Ev sahibine tek kart + tek e-posta: misafirin sorusu, bilgi tabanında ne var / ne yok, adaylar TARİHLERİYLE ("12 Eylül'de başka bir
   misafire: 'Hafta içi 22:00'ye kadar açık'"). Düğmeler: **Bunu gönder** · **Düzenle ve gönder** · **Ben cevaplarım**.
3. Gönderim anında (Host Karar Motoru'nun bugünkü kontrolleri): misafir arada yeni bir konu yazdıysa kart "misafir yeniden yazdı" der, tek tık
   gönderim durur; konaklama bittiyse gönderilmez; aynı konuda arada yazdıysa ("peki teşekkürler") metin "Bu arada, …" ile başlatılabilir
   (önce / sonra §7-D).
4. Gönderildikten sonra: "Bilgi tabanınıza şöyle kaydedeyim mi? — 'Havuz hafta içi 22:00'ye, hafta sonu 23:00'e kadar açıktır.'" (var olan
   kalemle birleşmiş hâli; birleştirme önerisi §5'teki gibi kodla sınanır: yeni değer yalnız ev sahibinin onayladığı metinden).

## 7. Sorular (önce / sonra örnekli)

**7-A — Dosya: yükleme mi, indirme mi, ikisi mi?** Notunuzda "dosya olarak toplu veriler indirmesi" yazıyor; "yazmakla uğraşmalarından
iyidir" dediğiniz için ev sahibinin dosya YÜKLEMESİ olarak anladım. Üç parça önerebilirim:
(1) **Yükle**: daire sayfasında "Dosyadan ekle" → PDF / Word / .txt seçilir → inceleme ekranı (§4.3).
(2) **Şablonu indir → doldur → yükle**: başlıklı boş bir Word / metin dosyası (Giriş · Wi-Fi · Otopark · Çöp · Kurallar …) — boş form yerine
    tanıdık bir belge.
(3) **Bilgi tabanını dosya olarak indir**: bütün dairelerin bilgileri tek dosyada (yedek / düzenleme / başka sisteme taşıma).
Örnek inceleme ekranı:
```
ev-rehberi.pdf — 14 konu bulundu
✓ Yeni        Otopark       "Otopark ücretsizdir; 12 numaralı yer size ayrılmıştır."  (s. 2)
✓ Zaten var   Çöp           bilgi tabanınızdakiyle aynı
⚠ Çelişiyor   Çıkış saati   Bilgi tabanında: 11:00 · Dosyada: 12:00  → [Dosyadakini kullan] [Mevcudu koru]
ⓘ Daire ayarı Giriş 15:00   (daire ayarlarınızla aynı — kayıt açılmaz)
– Atlandı     "Sayın {isim}, …"  (yer tutucu)
[Çelişkisiz 12 konuyu onayla]
```
Hangileri? Önerim: önce (1), sonra (2) + (3).

**7-B — Plan sınırı:** dosyadan gelen konular daire başına 15 / 30 / 60 sınırına sayılsın mı? Önerim: sayılsın (bugünkü kural), konu başına
tek kalem; sınır aşılırsa "en çok N konu seçin" ekranı. Alternatif: dosya konuları sınıra sayılmaz (paket farkı daralır). Hangisi?

**7-C — Bilgi tabanı taraması (§5) ve günde en çok 3 soru:** böyle yapalım mı? Soru nerede görünsün: (a) yalnız panelde kart, (b) panel + günde
bir özet e-posta? Önerim (a) (e-posta kalabalığı yok). Kalıcı soru kaydı yeni tablo ister (migration, ayrıca onay).
Örnek kart:
```
Bilgi tabanı önerisi (bugün 1 / 3) — Lale 1
Bahçe ile ilgili iki ayrı kayıt var:
  "Bahçe 21:00'e kadar açık."  ·  "Cumartesi bahçe 23:00'e kadar açık."
Böyle birleştireyim mi?
  "Bahçe cumartesi hariç 21:00'e, cumartesi 23:00'e kadar açık."
[Onayla] [Düzenle] [Böyle kalsın]
→ Onaylanınca: "Lale 2 ve Lale 3'te de aynı iki kayıt var. Onlara da uygulayayım mı?"  [Lale 2 ☑] [Lale 3 ☑]  [Uygula]
```

**7-D — Eksik bilgi döngüsü (§6):** böyle yapalım mı? Alt sorular: (1) Bildirim kanalı: bugün e-posta + panel. WhatsApp yeni bir sistem
(Meta onayı, mesaj başı ücret, onaylı şablon) — ayrı karar; şimdilik e-posta + panel mi? (2) Onaydan sonra gönderim süresi: önerim misafir
arada yazmadıysa ve konaklama sürüyorsa 24 saate kadar doğrudan; arada aynı konuda yazdıysa "Bu arada, …" ile; başka konu yazdıysa tek tık
yerine düzenleyici açılır. Örnek:
```
Önce:  Misafir 14:02 "Havuz kaçta kapanıyor?" → (bilgi tabanında yalnız hafta sonu) → "Hafta sonu havuz 23:00'e kadar açık." gider,
       hafta içi sorusu panelde açık; size bir şey gelmez.
Sonra: aynı cevap gider + size kart: "Hafta içi kapanış saati bilinmiyor. 12 Eylül'de başka bir misafire 'hafta içi 22:00'ye kadar'
       yazmıştınız. [Bunu gönder]" → 14:20 onay → misafire "Bu arada, hafta içi havuz 22:00'ye kadar açık." → "Bilgi tabanınıza kaydedeyim mi?"
```

**7-E — Kalıcı gömme deposu (migration, müşteriye dokunmaz):** gömmeleri veritabanında tutalım mı? Bugünkü bellek deposu 4.096 vektörle
bütün kiracılara ortak; 100 ev sahibi × 10 daire × ~30 parça = 30.000 parça olunca sürekli boşalır ve anlamsal arama çoğu soruda sessizce
sözcüksele düşer. pgvector eklentisi GEREKMEZ (daire başına birkaç yüz vektör; benzerlik bellekte hesaplanır). Önerim: evet, Railway
açılmadan önce hazır yama.

**7-F — Sık sorulana kayıttan cevap:** gölge kipte ölçmeye devam (Railway açılınca), kör set + gölge sonuç sonrası açma kararı sizde. Değişiklik yok.

**7-G — İnce ayar (fine-tuning):** rapor 4.7 — etiketleri biriktirip ~500 örnekte okuyucu için eşleştirilmiş deneme. Uygun mu?

## 8. Bu turda yapılan (müşteriye dokunmayan; hiçbir ekrana / cevap yoluna BAĞLI DEĞİL)

1. **`src/lib/kb-import/document.ts`** — dosyadan taslak çekirdeği (saf; veritabanı, ağ, model yok):
   - `splitDocument`: sayfa metinlerini paragraf bloklarına böler (görünmez / kontrol karakteri silinir, satır uçları kırpılır, başka hiçbir
     şey değişmez); başlık yalnız "#", sonu ":" ya da kısa tamamı büyük harf satır; uzun paragraf parçalayıcının cümle sınırından AYNEN bölünür;
     200.000 karakter / 100 sayfa tavanı ("kesildi" söylenir).
   - `sectionByHeadings`: modelsiz konu ayırma — başlığın kapsamı dar (farklı konudaki ya da başka sayfadaki paragraf başlığa yapışmaz;
     ölçülen hata: "Otopark:" altında çöp, kural ve havuz paragrafları toplanıyordu).
   - `assembleDrafts`: bölümlerden taslak; içerik = blokların AYNEN birleşimi, başlık = belgenin başlık bloğu ya da kategorinin sabit adı
     (dışarıdan başlık kabul edilmez), şablon kategorileri (karşılama / giriş talimatı / çıkış mesajı) reddedilir, tek geçersiz / tekrar eden
     blok numarası bütün bölümü düşürür, yer tutucu ve yalnız giriş / çıkış saati paragrafı kalem olmaz (daire ayarı önerisi döner), her
     paragraf ya taslakta ya "atlandı + neden" listesinde, 20.000 karakteri aşan konu sıralı parçalara bölünür, `sourceRef = doc:<özet>:p<sayfa>`.
   - `draftIsVerbatim`: "model bilgi yazamaz" değişmezinin sınayıcısı (sunucu kaydetmeden önce yeniden çalıştırır).
2. **`src/lib/kb-scan/same-value.ts`** — tarama bulucusu T6: aynı otopark yeri / giriş kodu iki farklı dairede (yalnız etiketli değer; saat,
   tutar, kat, araç sayısı, telefon öbeği değer sayılmaz; aynı daire içindeki tekrar bulgu değildir).
3. Testler: `tests/unit/kb-import-document.test.ts`, `tests/unit/kb-scan-same-value.test.ts` (iki değişmez, şablon kategorisi reddi, sahte
   bölüm, başlık kaynağı, tavanlar, 200.000 karakterde süre pinleri).

Sıradaki dilimler (sorularınızın cevabına göre): yükleme + inceleme ekranı (7-A, 7-B) · modelle konu ayırma (yalnız blok numarası döner, aynı
`assembleDrafts` yolundan geçer) + ölçümü · tarama kartı ve günlük soru kaydı (7-C, migration) · eksik bilgi döngüsü (7-D; L1 geçmiş cevap
araması) · kalıcı gömme deposu (7-E, migration).
