# Açık işler + o alanların kalıcı kuralları (sınıflandırıcı, eval, KB, şablon)

> CLAUDE.md'den 2026-10-08'de AYNEN taşındı (kurucu: ".md'ye yığma, gerekli yerlere taşı, gerekli şeyleri silme").
> Bu dosyadaki kurallar CLAUDE.md'deki kadar BAĞLAYICIDIR. İlgili alanda iş yapmadan önce oku.

## Açık işler + bu alanların kalıcı kuralları
> Tur anlatıları, ölçüm tabloları ve "neden" gerekçeleri 09-23'te AYNEN arşive taşındı:
> `docs/history/CLAUDE-2026-09-23-sadelestirme-2-oncesi-tam-metin.md`. Aşağıdaki maddeler oradan
> damıtılmış KURALLARDIR; bir kuralı değiştirmeden önce arşivdeki gerekçesini oku.

**V0 kalanları** (madde madde: `docs/YOL-PLANI-DURUM-2026-10-09.md` §2; V0.8 ✅ kimlik bilgisi + bağlantı durumu kanal katmanında, `channels/access.ts`): kolon contract'ı okuyucuları (backfill · token teşhisi · connect rotası · credentials kolon
dalı) · webhook girişi (write service hazır) · bağlantı sağlığı sinyali · `toChannel` ham platform ·
`Property.hospitableId` global unique (kapsamlı kimlik) · `api/hospitable/diagnostics`.
`CHANNEL_CONNECTION_READ` DB'ye kaydedilmiş ilk gerçek bağlantı olmadan AÇILMAZ (prod'da DB token'lı org yok,
kurucu org env fallback'te); `hospitable*` kolon DROP'u okuma anahtarı ≥2 hafta canlıdan SONRA
(`docs/V0.7-CANLI-GECIS-OPERATOR-PLANI.md`). Prod'daki 17.436 mesaj / 1.538 rezervasyon `legacy` provenance
sınıfında, çıkarım backfill'i BİLEREK yok.
**GEREKSİNİM (uygulanmadı):** doğrudan kanal + iCal aynı mülkte; aynı kanalın iCal'i pasif/yedek, diğerleri
çalışır, iCal doğrudan veriyi ezmez (`docs/GEREKSINIM-dogrudan-kanal-ve-ical-birlikte-yasama.md`).
**AÇIK QR kalitesi:** boş KB'de devir emergent (eşik = güvenlik kapısı, GOLDEN SET ister); hakaret/kışkırtma
`general` kalıyor (`docs/ACIK-2026-09-08-qr-cevap-kalitesi.md`).

**Şikâyet sınıflandırıcı (`fallback.ts`; 8 inceleme turu, 09-10/11) — kurallar:**
- 🚨 **Acil ağı BAĞLAMLA (K6, kurucu kararı 09-30, `neutralizeNonEmergency`):** yer / eşya sorusu ("polis merkezi / yangın söndürücü
  nerede") ve "acil değil" olumsuzlaması tek başına acil DEĞİL; aynı mesajda olay sözcüğü (yangın, hırsızlık, tehdit, yaralanma, sağlık,
  kilitli kalma, su kaçağı…) varsa acil KALIR ("Yangın söndürücü nerede, mutfak yanıyor!"). Koruma ASCII biçimde aday başına bir kez
  (maliyet pinli). Bilinen sınır: "Mutfak yanıyor!" tek başına ve yalnız hırsızlık bildirimi acil sayılmıyor. 10-01 (Codex): meslek
  KİMLİĞİ ("doktor olan arkadaşım", "avukat arkadaşımızla", "I'm a doctor") ve RUTİN BAKIM yeri ("hastanedeki rutin kontrol randevum")
  olay kontrolünde etkisiz (`NON_INCIDENT_FRAMES`); ihtiyaç / eylem ("doktor lazım", "hastaneye kaldırıldı") olay kalır. Kesme işareti
  eşleşme biçiminde BOŞLUĞA iner ("I'm" → "i m") — yeni İngilizce kalıp bunu kapsamalı.
- 🚨 **Kısa acil sözcükleri TAM SÖZCÜK (09-26, kurucu onayı, #51):** `gas`/`fire`/`acil`/`acilen` alt dize DEĞİL
  (`SAFETY_CRITICAL_WHOLE_WORDS`): "Gastgeber", "Gastfreundschaft", "fireplace", "Havuz ne zaman açılıyor?" (ASCII açıl→acil),
  "facilities" canlıda yanlış acildi (oto-cevap kapanıyor + acil rozeti). Türkçe ad çekimleri TEK TEK (acile/acilde/aciliyeti/
  acildir…; "acili"/"acildi" YOK = ASCII "acılı"/"açıldı"), harf uzatması ("ACİLLL") tutar, bileşikler (Gasgeruch/firefighter/
  wildfire) açık listede; 7 dil × 7 kategori acil matrisi AYNEN; batarya `safety-whole-words.test.ts`. Türkçe "gaz" da TAM SÖZCÜK
  (ikinci onay 09-26: "mağaza", "Gazipaşa", "gazete", "Doğalgaz faturası" acil değil; ekler tek tek, "gazi" YOK = "Gazi";
  "doğalgaz/tüpgaz + koku/kaçak/sızıntı" kalıp listede). 🚨 09-30 (kurucu kararı): "kaza / polis / hurt" de TAM SÖZCÜK + gerçek çekimler
  ("Kazağımı unuttum", "polisiye", "It wouldn't hurt" acil değil; "kazan/kazanın" bilerek yok); çıkış YERİ ifadesi (emergency / fire exit,
  acil çıkış, yangın merdiveni) eşleşmeden önce nötrlenir — AMA mesajda kilit / engel sözcüğü varsa ("Acil çıkış kilitli", "Fire exit is
  blocked") nötrlenmez, acil kalır. Yangın ifadeleri (alev aldı / alevler / ateş aldı-çıktı / tutuştu / caught fire / flames) acil + QR
  fiziksel acil; çıplak "ateş" ("ateşi var" = sağlık) ve "alev" (ad) YOK. Söküm kapısı Latin YAZI SİSTEMİ harfi arar (tamamen küçük-kapital
  "ᴅᴀɪʀᴇᴅᴇ ʏᴀɴɢɪɴ" sökülür; ꜰ ꜱ ǫ haritada); saf Rusça sökülmez.
- 🚨 **Sözcük İÇİ / öbek çakışması acil DEĞİLDİR (10-02, kurucu onayı — Sabah Kararları 49):** Almanca rauch / feuer, İspanyolca humo,
  Fransızca blessé, İngilizce smoke TAM SÖZCÜK (+ acil bileşikleri Feuerwehr / Feueralarm / Feuermelder / Rauchmelder); Rusça "ранен"
  yalnız sözcük başında ("хранение" bagaj saklama), Arapça "مصاب" ardında "يح" yoksa ("المصابيح" lambalar), Türkçe "her yeri su" yalnız
  "su" tam sözcükken ("her yeri süper"), "priz / kablo yanı" yerine yanma biçimleri (`SAFETY_CRITICAL_PATTERNS`); sabit öbek nötrlemesi
  `LEXICAL_NON_EMERGENCY_PATTERNS` (get in touch · smoke-free · flooded with light · feu d'artifice · feu rouge / vert · pas le feu · fuegos
  artificiales) + "gas station" (K6 yer sınıfı). Yeni acil sözcüğü ALT DİZE eklenmeden önce yedi dilin sık sözcükleriyle çakışma
  taranır. Anlam gerektirenler ("bayıldık" övgüsü, "İnternet düştü", sigara SORUSU, "Помогите, пожалуйста", Wi-Fi'ye "giriş")
  kurucu kararı (Sabah Kararları 51).
- **Kural konusu ağında Türkçe "parti" TAM SÖZCÜK (10-02, aynı sınıf):** `TR_PARTY_RE` (ad çekimleri: -ye/-yi/-yle/-de/-den/-si(n…)/-ler…/
  -miz/-niz; yalnız ASCII katlamada — "Partıye" noktasız yazım dahil); "partir / compartido / partie / particular / partial / repartí"
  kural sözcüğü DEĞİL (İspanyolca giriş sorusu "¿A partir de qué hora…?" otomatik cevap alamıyordu); İngilizce party / parties / partying
  listede kalır. Anlam belirsizliği ("il est parti" = gitti, "party of four" = grup) kurucu kararı (Sabah Kararları 51 g).
- Olumsuz fiil kalıpları ÇAPALI (tesis adı + fiil; gövde "-yo" ile: gelmiyor/gelmiyo). Çıplak `gelmiyor · gitti ·
  kesildi · su yok · arıza · yanmıyor · bozuldu · blackout · no heat · elektrik yok · cereyan yok · ısınmıyor ·
  elektrik kesintisi · power cut` listeye GİRMEZ (tuzaklar pinli). "İnternet gelmiyor"/"wifi çekmiyor" BİLİNÇLİ wifi.
  Tam biçim, gövde değil (olumsuz/türetilmiş biçim övgüdür: "arızalanmadı", "tıkanıklığı yok").
- KOŞUL BİLDİRİM DEĞİLDİR: yalnız eşleşmenin HEMEN ARDINDAKİ ek okunur (`CONDITIONAL_TAIL` `^[ry]?s[ae]`);
  guard yalnız 09-10 kalıplarına (`NEGATIVE_VERB_COMPLAINTS`) — eski ağa uygulanmaz (gerçek yorum tehdidi düşüyordu).
- Arıza ailesi `hasDeviceBreakdown`: cihaz adı KELİME BAŞINDA + ÇEKİM doğrulaması (türetme eki elenir: kapı+cı,
  makine+li) + koşulsuz fiil + ÖZNE YUVASI (`reportSubjectSlot`, varsayılan RET): iyelik zinciri (tamlayan cihazsa
  kabul, fiil testinden ÖNCE), zarf öbeği kapalı sınıflarla (`TIME_WORDS`/`NUMBER_WORDS`, `ADVERBIAL_SUFFIX` iyelik
  almaz), ulaç ekleri (‑ınca/‑dığında/‑dıktan/‑madan), "ve" bağlacı özne DEĞİL, mastar dalı YOK. 🚨 CÜMLECİK şartı
  ölçülüp GERİ ALINDI (30/44 gerçek bildirimi düşürüyordu) — geri koyma. `VERBLIKE_NOUN_OVERRIDES` = t/d eşsesliliği.
- `BREAKDOWN_DEVICES` bir ENVANTERDİR (145 girdi; yazılmamış cihaz = oto-gönderim izni). `su`/`suy` CİHAZDIR;
  `router` = `modem` paritesi. 🚨 ÖLÇÜLÜP REDDEDİLDİ, GERİ EKLEME: fön · batarya · kablo · hoparlör · kasa · masa ·
  zil · küvet · çekmece · fan · cam · gider · uydu · raf · stor · halı · sigorta · kart · kamera · alarm · adaptör.
- Kesme birleştirmesi YALNIZ soldaki parça zaten cihaz adıysa ("Klima'mız" ✓, "Van'a/Kaş'a/Bor'u" ✗ — yer adları).
  `APOSTROPHES`: U+00B4 ÖLÜ (NFKC boşluk yapar), U+02BC/U+2032 var.
- `hasUnnegatedProblemWord` üçüncü okuma = `deconfuse(normalizeForMatch(…))` (görünmez karakter + homoglif);
  `matchCandidates`i olduğu gibi dolaşmak YANLIŞ (melez "yasamadık" övgüyü complaint yapar). Ham okumalar kalır
  ("Sorun  yok" complaint). `PROBLEM_CONDITIONAL_NEGATIONS` + ALINTI FRENİ (`" diye "`) + İngilizce "ı"lı ikiz;
  "sorun değil" daraltması REDDEDİLDİ (nezaket kapanışları).
- İzafet kalıpları (`POSSESSIVE_FACILITY_COMPLAINTS`) + SORU EKİ guard YALNIZ o alt kümede (harf sınırı şart).
  🚨 İZAFET ÇAPASI (daire-içi/dışı) ÖLÇÜLÜP REDDEDİLDİ — tekrar tasarlama (106 mesaj tablosu arşivde).
- Bilinen sınırlar pinli: sahiplik körlüğü (misafirin kendi cihazı, mimari) · belirtisiz tamlama FP ("şarj aleti") ·
  "Tatil düşümüz bozuldu" · bitişik yazım · DE/FR/ES/RU/AR paritesi borç (`docs/ACIK-2026-09-08-turkce-sikayet-…md`).

**Eval:** harness `evals/*.json` + `tests/eval/`, AYRI config `npm run eval` (`vitest.eval.config.ts`: globalSetup
YOK, anahtar boşaltılmaz; normal suite anahtarı ZORLA boşaltır — ikisi de pinli). İki kapı `RUN_REAL_EVAL=1` + anahtar.
EKSİK KOŞU "GEÇTİ" DİYE OKUNAMAZ (beklenen/tamamlanan/geçersiz ayrı). LLM grader YOK. Bulutta `NODE_USE_ENV_PROXY=1`
şart (Node fetch proxy'yi okumaz). Model kıyası `scripts/eval-compare-models.mjs` (her model AYRI SÜREÇ, markdown
parse edilmez, `EVAL_COMPARE_YES=1` ücretli kapı); gölge katmanı yalnız GÜVENLİK sınıflandırmasını kıyaslar, cevap
kalitesi bu harness'la ölçülür. 09-24 kredi yüklendi (OpenAI bakiyesi org geneli ve PEŞİN; panodaki harcama
"limit"i yalnız UYARI, durdurmaz) → ücretli koşu önce küçük deneme (`EVAL_STAY_LIMIT`, 20 satır ≈ 0,10 $) + kurucu onayı.
🚨 **ÜCRETLİ ÖLÇÜM (09-27 olayı: ölçümler ~25–30 $ harcadı, kredi BİTTİ, canlı yapay zekâ aynı hesapta durdu):** harcama TAVANI YOK
(kurucu 09-27: "gerekliyse istediğin kadar kullanabilirsin"), ama ölçüm canlıyla AYNI OpenAI hesabında koşar: her koşudan önce tahmini
tutar yazılır; `RAG_LAB_RPM` ZORUNLU (cevap ölçümü 8, sıralama/anlama 30 — dakikalık token sınırı canlıyla paylaşılır; 3 işçi 09-27'de
552 isteğin 252'sini 429'a düşürdü); otomatik yeniden yükleme açık DEĞİLSE bakiyeyi sıfırlayabilecek koşudan önce kurucuya haber
verilir. Kredi biterse tüm koşular durdurulur, kurucuya HEMEN söylenir; kurucu "kredi yüklendi" demeden ücretli çağrı YOK. Öneri (kurucuya iletildi): otomatik yeniden yükleme + ölçümlere ayrı proje/anahtar
(aylık bütçe sınırlı; bu ortamın `OPENAI_API_KEY`i o anahtar olur, canlı Railway kendi anahtarında kalır).
🚨 **ÖLÇÜM MODELİ KURALI (kurucu 09-27: "müşteriye ne gideceğini gerçekten test edelim, dümenden olmasın"):** keşif / ablasyon
(retrieval yapılandırma kıyasları: pencere, bütçe, eşik…) UCUZ modelle (`rrm:gpt-6-luna+rre:none`; 09-27'de 5.1 ile aynı yönü verdi);
misafire giden HER ŞEY — cevap modeli çıktısı, güvenlik katmanları (anlama / bekçi / kapı), son kabul (holdout) — CANLIDAKİ modelle
(bugün gpt-5.1), örneklemle ucuzlatılır ama VEKİL modelle ölçülmez. Luna ile çıkan sonuç 5.1 kararına kanıt DEĞİLDİR.
🚨 **MÜHÜRLÜ FİNAL SETİ (09-24, `docs/EVAL-MUHURLU-FINAL.md`):** konaklama eval'inin `dev` + `holdout` bölümleri
GÖRÜLDÜ (ayar + denetim ölçümleri) → açma kararı YALNIZ `evals/sealed/` altındaki kör yazılmış setle. İçerik açılmaz/
basılmaz/ajana verilmez; harness yalnız `EVAL_SEALED_FINAL=1` + gerçek model koşusunda okur (kısmi koşu hata);
SHA-256 `SEALS.json` ile pinli, adı yalnız izinli dosyalarda (`sealed-eval-access.test.ts`). Dondurulmuş SHA'da BİR
kez koşulur, sonra "yandı" (yeni kör set). **A seti 09-25'te `f584075`te koşuldu → YANDI** (kaçak 0/117 · bekçi izin
45/45, iddia 22/22 · gereksiz inceleme 7/63, hepsi kelime ağından; `docs/olcum/stay-change-FINAL-eval-2026-09-25.md`);
B'siz koşuldu (kurucu: bayraklar bugün) → B için yeni kör A ya da yalnız-B harness değişikliği. Yanmış kayıt pinli
(`burnedAt`/`runSha`/`report` zorunlu, baytlar değişmez). 🚨 **SET B — GERÇEK MİSAFİR MESAJLARI (09-24, kurucu: "salt okuma"):**
`scripts/eval-real-export.ts` kurucunun makinesinde canlı DB'ye bağlanır: tek işlem, İLK komut `SET TRANSACTION READ
ONLY` + `SHOW transaction_read_only` doğrulaması + yalnız SELECT (mekanik pin `eval-real.test.ts`); anonimleştirir
(`eval-real/anonymize.ts`; tarih/saat kuralı tek kaynak `semantic/date-time-tokens.ts`), aday süzgeci ürünün
dedektöründen BAĞIMSIZ; çıktı YALNIZ git'in yok saydığı `evals/private/` (pin). Kör etiket `scripts/eval-real-label.ts`
(tahmin/katman göstermez). Mühür `SEALS.json` `location: local-only` (dosya depoda OLAMAZ, pin); harness yalnız
`EVAL_SEALED_FINAL=1` + `EVAL_REAL_SET` + SHA eşleşmesiyle okur, rapora metin girmez. Geliştirici ve ajanlar içeriği
GÖRMEZ; metin OpenAI dışında hiçbir servise gitmez. Protokol `docs/EVAL-MUHURLU-FINAL.md`.
**Tüm geçmiş taraması** `scripts/eval-real-stats.ts` (Set B'nin AYNI pinli `readOnly` kapısı; model/kredi YOK; çıktı
YALNIZ SAYI — saf `eval-real/replay-stats.ts`, hazırlık/tarih kuralı ürünle aynı; kelime ağı sayımı ALT SINIRDIR).
**Konuşma Anlama Durumu eval'i (09-26, MÇ v2 §5.1):** `conversation-state-harness.ts` bayrak KAPALI/AÇIK iki kolu SIRAYLA
koşar (kol ↔ bayrak uyuşmazlığı fırlatır), kanal yolunun yapı taşlarını ürünün sırasıyla çağırır (geçmiş cevaplanan mesajı
taşır), bekçi KOŞMAZ (kapanış birebir, sızıntı temkinli); bağlantı pini `conversation-state-wiring.test.ts`. Ölçüler ortak
`reply-metrics.ts`; bekleme sözü ölçüsü TEK kaynak ürünün çıktı vetosu (09-25 dört koşunun 540 cevabında söz 0). Kör
set `evals/conversation-state.json` ajanla (30 Eylül sonrası); ilk ücretli koşudan sonra set "görüldü".
**Konaklama eval'i ölçer sözleşmesi (10-01):** model gövdesi tamamlanmadıysa (zaman aşımı) rapor GEÇERSİZ (yarım tablo "GEÇERLİ" yazılıyordu);
rapor adı anlama / bekçi modelini VE düşünme ayarını taşır (Luna low koşusu Luna none raporunu ezdi); süre `EVAL_STAY_TIMEOUT_MS`; anlama
istemi ürünle aynı bayraktan (`AI_COMPLAINT_FOLLOWUP_RULE_ENABLED` → cfu). 🚨 Ölçer KİMLİĞİ koşunun ortamında alınır (10-01 öğlen: 25 raporda
yanlıştı, düzeltme notu düşüldü): stub'lı bayraklar geri ALINMADAN önce; ölçer anlama kipini kendi değişkeniyle veriyorsa `evalRuntime({ understanding })`
(istem kimliğinin yanında "kip:" yazar). Anlama kipi canlıyla aynı ölçülür: `EVAL_UNDERSTANDING_ITEMS=1` + `EVAL_UNDERSTANDING_RULES=1`
(+ ürün bayrağı `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED` → "cfu"); 10-02'den beri `EVAL_STAY_SET=<dosya>` ek seti okur (`dev2` geliştirme,
`acc10` kör kabul), cevap satırının `guest` alanı bekçiye gerçek misafir mesajını verir, rapor adı seti ve `EVAL_STAY_TAG`i taşır.
**Konuşma öğeleri ölçeri (10-02 ölçer sadakati):** senaryolar konaklama içidir → harness ONAYLI AKTİF konaklama verir (canlı hat ölçeriyle aynı).
10-02'ye kadar `reservation: null` veriliyordu: istem "rezervasyon onaylanmamış — Wi-Fi şifresini ASLA paylaşma" derken bilgi tabanı şifreyle
gidiyordu (üründe `kbForStayScope` onaylanmamış konaklamada sırrı modele vermez); kurala uyan Luna `medium` "güvenli kısmı cevaplamadı" sayıldı,
kuralı çiğneyen 5.1 / Luna `none` geçti. O tarihten önceki "güvenli kısım cevaplandı" sayıları bu koşulla okunur. Rapor adı `EVAL_ITEMS_TAG`.
Bir ölçerde istem kuralı ile verilen bağlam çelişiyorsa ölçü kurala uyan modeli cezalandırır — yeni ölçer ürünün kod süzgeçlerini aynen uygular.

**KB onay (A1, migration 53 CANLI):** `source`/`reviewState`; eski satırın onayı VARSAYILMAZ (varsayılan `legacy`,
`approved` yalnız POST'ta açık eylem). Erişim ALLOWLIST `legacy+approved`, TEK kapı `kb-review.ts`; `kb-fetch` AND'ler
(çağıran ezemez; `count` aynı filtre). Şablonlar modelden geçmez → gönderici + önizleme + Gönderilenler ortak
`GUEST_DELIVERABLE_KB_WHERE`. PATCH onay iddiası üretmez; COPY onay soyunu devralır; taslak hafızaya girmez.
**A2 izlenebilirlik (migration 54 CANLI):** `RiskEvent` 7 nullable kolon, 🚨 NULL = ÖLÇÜLMEDİ (0 değil);
`kbNewestUpdatedAt` tazelik işareti (sürüm kimliği değil); `kbEvidenceJson` = kalem kimliği + sürüm, İÇERİK YOK,
misafire ve modele gitmez; `declared` ≠ `verified` (uydurma atıf görünür). `classifyGrounding` ETİKET döndürür, hiçbir
sınıf `decisive` değil; "bilgi ekle" önerisi yalnız `absent`.
**A3/A4/A5:** kod + testler yerinde, YÜZEYLER KALDIRILDI (kurucu 09-11); panelin yanlışlıkla geri mount edilmesi pinli.

**Geçmiş host cevapları (Bacak B):** yüzey VE veri KAPALI (`KB_HISTORY_SUGGESTIONS_ENABLED` varsayılan kapalı →
mesaj sorgusu hiç koşmaz, `scanned:null`). Eşleştirme fail-closed (tek kategori bloğu, peş peşe cevap birleşir,
`PAIR_MAX_GAP_MS` 12 sa, gerçek çift, konuşma sayar), PII işaretlenir (silinmez; sır kapısı ölçülüp reddedildi).
GERİ AÇMA ön koşulları: yakınlık + araya giren outbound yok · gerçek çift · proaktif mesaj tespiti · tercihen
`Message.replyToMessageId` (migration) · UI `?propertyId=` gönderir ve `capped`i okur.
**Şablon → KB önerisi (`kb-from-templates.ts`, CANLI):** kategori allowlist YALNIZ `wifi`+`rules` (gerekçeler arşivde);
`{{guestName}}`→`{isim}`, başka her `{{…}}` → şablon REDDEDİLİR; `TEMPLATE_VAR_SOURCE` + `ANY_DOUBLE_BRACE` tek kaynak
(`template-apply.ts`); özgüllük sırası (mülke özel önce); "zaten dolu" yalnız AI-okunabilir kalemle; iki bacak ayrı
bileşen (`kb-template-suggestions.tsx` canlı / `kb-past-answers.tsx` kapalı). 🚨 Bir kartı/yüzeyi kaldırırken içindeki
HER bacağın tüketicisini say VE verinin üretildiği yeri kapat (render'ı değil).
**Şablon düzenleme/uygulama:** PATCH `propertyId` alanı var; create şemasındaki `.nullish().transform(v => v || null)`
PATCH'e KOPYALANMAZ (anahtarı null yapıp şablonu "Tüm mülkler"e taşır). Uygulama tek kaynak `template-apply.ts`, tek
geçiş, `Object.hasOwn`, `LEFTOVER_DOUBLE` yalnız düzgün belirteci siler.
**Panel yerleşimi (lg):** dış kap `lg:fixed lg:inset-0`, `fillsViewport` dikey flex, grid `lg:flex-1 lg:min-h-0`, kart
`lg:h-full`; `100vh` aritmetiği ve sabit `11rem` GERİ GELMEZ (pin `mobile-grid-min-width.test.ts`, TAM öznitelik eşitliği).

**Diğer açıklar:** Codex P2 (F09–F18) · `docs/DENETIM-2026-08-09.md` (27) · `docs/ACIK-ISLER-2026-08-08.md` (16) ·
`docs/MIGRATION-BEKLEYEN-ISLER.md`. Operatör: bucket görünürlüğü (imzasız URL 403) · `weekly-audit.yml` `main`'e ·
`security@lixusai.com` · retention onay paketi · `UNVERIFIED_SWEEP` (dry-run önce) · Railway Pro + PITR lansmandan 2-3
gün önce · eski org'ların aktif-saat penceresi (migration 55 varsayılanı 0/0; prod damgası bekliyor). LEGAL (avukat):
SELLER etiketi · yıllık peşinde cayma · alt-işleyen listesi (Akash çıkar) · VERBİS · erasure bayrağı · `LEGAL_VERSION`.
Güvenlik tasarım kararları bekleyen: kurtarma kilitleme (email+IP) · `paused` grace · reconcile'da yerel plan · bekleyen
mesajlarda risk ÖĞE BAZINDA (D1–D6, `docs/BEKLEYEN-RISK-OGE-BAZINDA-2026-09-26.md`) · middleware noktalı yol · halka açık sayfada çerez yenileme · `PADDLE_WEBHOOK_SECRET`
boot kapısı · 09-23 §9.4'teki dokuz öneri (`docs/DENETIM-2026-09-23-alarm-seli-ve-guvenlik-turu.md`).
