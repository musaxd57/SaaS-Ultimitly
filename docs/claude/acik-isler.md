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
**GEREKSİNİM (✅ 10-11 kod, yalnız DOĞRUDAN kanal — kurucu: Hospitable köprüsü hariç):** doğrudan kanal + iCal aynı mülkte; aynı
kanalın iCal'i yedek (`channels/ical-authority.ts`, `lastStatus: standby`, müsaitlikte tanık değil), diğerleri çalışır, iCal doğrudan
veriyi ezmez (`docs/GEREKSINIM-dogrudan-kanal-ve-ical-birlikte-yasama.md`). Geçiş adımı açıkları `docs/YOL-PLANI-DURUM-2026-10-09.md` §2b.
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

**Diğer açıklar (10-15 gece yeniden tarandı — kalanlar):** Codex P2 F09 / F13 / F15 / F16 KAPANDI; KISMEN F10 (denetim kaydı yazılamazsa
eylem başına politika — karar), F11 (geçici yükleme + sahipsiz nesne uzlaştırması), F12 (haftalık zamanlanmış denetim iş akışı yok), F14 (CUS v2),
F17 (org başına gecikme ölçüsü), F18 (passkey — karar) · `docs/DENETIM-2026-08-09.md` başındaki 10-15 satırı · `docs/ACIK-ISLER-2026-08-08.md`
başındaki 10-15 satırı · eski satır: Codex P2 (F09–F18) · `docs/DENETIM-2026-08-09.md` (27) · `docs/ACIK-ISLER-2026-08-08.md` (16) ·
`docs/MIGRATION-BEKLEYEN-ISLER.md`. Operatör: bucket görünürlüğü (imzasız URL 403) · `weekly-audit.yml` `main`'e ·
`security@lixusai.com` · retention onay paketi · `UNVERIFIED_SWEEP` (dry-run önce) · Railway Pro + PITR lansmandan 2-3
gün önce · eski org'ların aktif-saat penceresi (migration 55 varsayılanı 0/0; prod damgası bekliyor). LEGAL (avukat):
SELLER etiketi · yıllık peşinde cayma · alt-işleyen listesi (Akash çıkar) · VERBİS · erasure bayrağı · `LEGAL_VERSION`.
Güvenlik tasarım kararları bekleyen: kurtarma kilitleme (email+IP) · `paused` grace · reconcile'da yerel plan · bekleyen
mesajlarda risk ÖĞE BAZINDA (D1–D6, `docs/BEKLEYEN-RISK-OGE-BAZINDA-2026-09-26.md`) · middleware noktalı yol · halka açık sayfada çerez yenileme · `PADDLE_WEBHOOK_SECRET`
boot kapısı · 09-23 §9.4'teki dokuz öneri (`docs/DENETIM-2026-09-23-alarm-seli-ve-guvenlik-turu.md`).

**🔔 11-11 gece — kurucu kararları ve durum (ayrıntı: `docs/TASARIM-2026-11-11-kurucu-kararlari-s1-s8-3b-3d.md`):**
- ✅ **Uygulandı (şemasız; 11-11 gece):** S1 çift onay → işlem kimliği "konuşma + önerinin üretildiği andaki konuşma sonu" · S7 işlenemeyen
  Paddle olayı saatlik yeniden işlenir (API anahtarı sınanır, tek ortak alarm) · S8 reddedilen otomatik mesaj aralıklı yeniden denenir
  (var olan otomatik gönderim kaydından türetilir) · 3c görsel kısım (avatar + gönderen + saat; "görüşmeye katıldı" yok) · 3d model
  yokken söz veren taslak yok ("Yapay zekâ önerisi şu an hazırlanamadı.") · S5 metinleri ("Daha sonra tekrar deneyin").
- ⏳ **Migration turu — tek açık onay bekliyor (§13):** S4 atamanın kaynağı · S6 abonelik kaydı + ayar bölümü sürümü · 3c yazan kişi +
  rol kopyası + misafire görünen ad · 3b rezervasyonda "yapay zekâ otomatik cevap vermesin" · 3d-b "paylaşılabilir iletişim" işareti ·
  öğe ↔ gönderim bağı · (S1'in tam hâli: taslak sürümü kaydı).
- ⏳ **Ücretli ölçüm isteyenler (anahtar kapalı yazılır):** S3 "Wi-Fi gitsin, hayvan sorusu sizde kalsın" (kurucu: "testleri
  çalıştırabilirsin"; yeni kör set + iki sayı) · S2 geç alınan mesajı yapay zekâ değerlendirsin · §11 devir cümlesi yerine ayrı alan
  (istemden "…kaydedildi; ev sahibiniz görebilir" kalkar — bütün cevap kategorilerini etkiler).
- ❓ **Sabah soruları (11-12):** (1) 3b — erken giriş ücret cevabı herkese gitmesin: tekrar gelen misafir / "bu misafire dokunma" için
  §8'deki üç satırdan hangileri · (2) §12'deki metinler: 3d rozeti ("Kayıtlı bilgilerinizden hazırlandı — soruya uygunluğunu kontrol
  edin"), S1 ikinci onaylayana ayrı cümle istenir mi, öneriden sonra yeni misafir mesajı gelince onay engellensin mi, S8'de reddedilen
  otomatik mesaj ev sahibinin kartında görünsün mü · (3) migration turu onayı (§13) · (4) yol haritası AA-1…AA-9
  (`docs/TASARIM-2026-11-11-otomasyon-yol-haritasi.md` §3) · (5) depo private yapılınca haber (bellek düzeltmesinin küçük makinede kanıtı
  için CI yeniden tetiklenecek).
- **Önceki turdan kalan, hâlâ açık:** 3a QR'da kodu bilmeyen misafire ne denecek · "Fotoğraf artık kullanılamıyor…" ve Girişler /
  operatör kuyruğu metinlerinin onayı · modelsiz taslak dili (kısa Türkçe mesajda İngilizce selam — `detectGuestLanguage` sınırı, gözlem).

**🔔 Bekleyen kurucu soruları (kurucu 11-06: "unutmayalım; Codex'ten yardım alarak sonra cevaplayacağım"):** erken giriş EK-1 (E1–E5
sırası) · EK-2 (zarf kelime ağı yasağına girer mi) · EK-4 (onayda daire adı) · EK-5 (Karar Motoruyla tek ses) · EK-6 (erişim kontrolü +
ilk onaylar gölgede) → `docs/TASARIM-2026-11-06-erken-giris-guvenilir-cevap.md` · üyelik Ü-2 (hesabı sil üçe) →
`docs/TASARIM-2026-11-06-uyelik-modeli-M2.md` §12 · işletme belgesi S3 (doğrudan rezervasyon sayfası olacak mı) + §16.1 iş fırsatı akışı
ve asistan örneği + Ek B / P3-20 ev sahibi metinleri + Bakanlık tesis sorgusunun sütunları (işletmeci unvanı görünüyor mu — Codex) →
`docs/TASARIM-2026-11-06-isletme-belgesi-dogrulama-ve-yetki.md` §16, §18 (Faz 1a kodu 11-06 gece dalda, anahtar KAPALI) · misafir hizmetleri
YOL PLANI sorular D-1…D-7 + P0 avukat soruları → `docs/TASARIM-2026-11-06-misafir-hizmetleri-ve-dogrudan-rezervasyon.md` (2. sürüm) · QR
TARAF ETİKETLERİ tek soruda (A "ekibimiz" / B): alt yazı ("Otomatik asistan + ev sahibi") + Türkçe açıklama / ayraç / gönderen adı
("İşletme ekibi" — 08-08 kurumsal hitap kuralına aykırı; ekran 11-06'ya dek taranmıyordu, istisnası `tests/unit/guest-text-quality.test.ts`
PENDING listesinde, metin değişince çıkarılır) + İngilizce gönderen adı ("Host team") · model yokken taslaklar (`ai/fallback.ts` iade +
"insanla görüşmek istiyorum": "ev sahibimiz değerlendirecek / ev sahibimize ilettim" → ben dili, önce/sonra rapor 11-06 gece-2) · QR "uygulamanın
mesaj bölümünden bize yazın" cümlesi UYGULAMASI OLMAYAN misafire (elle / doğrudan / dosyadan rezervasyon; Opus 11-06 P2) — A kanala göre
("bize her zamanki yoldan ulaşın") / B herkese "bize ulaşın" · "Erken giriş var mı?" → "Erken giriş ücreti ₺500." "evet" gibi okunabilir —
"; müsaitliğe bağlıdır" eki mi, böyle mi (Opus 11-06 P2) · (küçük, soru değil) İspanyolca ücret cümlesi iki yerde farklı: `early-checkin/reply.ts`
"La tarifa del check-in anticipado…" ↔ `decisions/core.ts` "La tarifa por entrada anticipada…" — birleştirmek kurucu onayıyla · istem örneği
("bilgi tabanındaki 'ev sahibine …' cümlesini 'bize …' yaz") ✅ 11-07 ÖLÇÜLDÜ (kurucu onayı): gpt-5.1 + canlı anahtarlarla FARK YOK —
model 10-30 kuralıyla bu cümleyi zaten birinci kişiye çeviriyor (üçüncü şahıs 3/42 → 5/42, kapıdan geçen 29/42 = 29/42, olgu 38 → 36,
kontrol 10/10 iki kolda) → kurucu 11-07 "sil": katman, anahtar ve ölçer KALDIRILDI (gerekirse commit `6d7ed3c8`; set `evals/host-voice-kb-2026-11-07.json` kaldı); kalan üçüncü şahıslar istemin kendi devir cümlesinden
("mesajınız kaydedildi; ev sahibiniz görebilir" — bu cevaplar zaten tutuluyor). Rapor `docs/olcum/host-voice-kb-2026-11-07-gpt-5.1.md`.
Cevap gelmeden bu maddeler UYGULANMAZ.

**🔔 11-06 araştırma bulgusu (doğrulanmalı, AYRI konu):** Genelge 2026/1 (16.04.2026) belgeli konaklama tesislerini ve yazılım
sağlayıcılarını Merkezi Turizm Veri Tabanına API ile veri göndermeye zorluyor olabilir — Lixus otellere PMS olarak satılırsa doğrudan
ilgili. Tam metin okunmadı → avukat + ayrı tasarım (`docs/TASARIM-2026-11-06-isletme-belgesi-dogrulama-ve-yetki.md` §11.5). İşletme
belgesi tasarımının kendisi kurucu + Codex kararını bekliyor (aynı belge §13–§14).

**🔔 Kurucu 11-06 akşam (WEB SİTESİ TAMAMEN BİTİNCE — "Ü-6 sonradan web sitesini tamamen bitirince yapıcam"): davetle "sahip" rolü.**
Karar verildi, uygulama ertelendi (Ü-6, `docs/TASARIM-2026-11-06-uyelik-modeli-M2.md` §12): davet formunda rolün yetki listesi; "Sahip"
seçilince ayrı onay + davet edenden taze yeniden doğrulama (şifre / 2FA); davet e-postası ve kabul sayfası yetkileri gösterir; yeni sahip
katılınca bütün sahiplere e-posta; işletmede her zaman en az bir sahip. Hukuk maddesi (yetkinin yanlış kişiye verilmesinden doğan
sonuçlardan Lixus sorumlu değil) koşullara AYNI TURDA, avukat onayıyla, kurucuyla birlikte girer. Bugün ekip daveti akışı YOK (üye yalnız
kayıt ve operatör panelinden açılır; doğrulandı 11-06); davet bu turdan önce yapılırsa yalnız yönetici / personel seçilebilir.

**🔔 Kurucu 11-05 gece (AYRI TUR — "en en iyi şekilde"): takvim serisini (RRULE) açma.** Bugün (doğrulandı): tekrarlar açılmaz, içe alınan
tek kayıt serinin ilk örneğidir; ilk örneğin iptali onu iptal eder (CAL-2 11-05), sonraki örnekler (ör. 17 Kasım) içe alınmaz; kaynak "kısmi
okuma" — takvim kartında sarı uyarı + "tekrarlayan etkinlikler okunamıyor", müsaitlik o geceler için "bilinmiyor" (başarılı okuma gibi
davranılmaz). Ayrı turun şartları (kurucu + Codex): belirli bir tarih aralığında tekrarlar hesaplanır; bir örneğin iptali / taşınması
diğerlerini bozmaz; serinin iptali bütün örnekleri kaldırır; 🚨 TEKRARLANAN DOLULUK OTOMATİK "YENİ MİSAFİR REZERVASYONU" SAYILMAZ (haftalık
bakım kaydı her hafta karşılama mesajı / temizlik görevi üretmez). Mevcut düzeltmenin içine sıkıştırılmaz.

**🔔 Kurucu 10-29 gece (unutma):** "ilerde WhatsApp'tan en önemlilerini bağlamak istiyorum" — ev sahibine giden EN ÖNEMLİ bildirimler (acil / kilitli
kaldım / kayıp anahtar / Sorunlu konuşma) ileride WhatsApp'tan da gitsin. Bugün yalnız e-posta + panel. Kapsam ve hangi bildirimlerin "en önemli" olduğu
kurucuyla belirlenecek; bildirim tablosu `docs/INCELEME-2026-10-28-gece-dongusu.md` (10-29 gece bölümü). Yeni sistem → önce soru, sonra tasarım.

**🔔 Kurucu 10-10 — SONRADAN BAKILACAK (unutma):** ödeme idempotency'si İYİ (webhook olay kimliği eşsiz, fatura işlem başına tek, plan
değişikliği tek kullanımlık jeton) — üç küçük boşluk: ikinci aktif abonelik sessizce ilkinin yerine geçer (alarm yok) · webhook gelmeden çift
ödeme ekranı penceresi · eşzamanlı teslim testleri eksik. Deneme kötüye kullanımı: deneme başına IP engeli YOK (yalnız kayıt hız limiti),
yeni e-postayla yeni 14 gün alınabiliyor; öneri: işletme kimliği (aynı Hospitable hesabı / ilan / iCal → ikinci deneme yok) + kayıt anında
risk puanı (engel değil, kademeli), cihaz parmak izi şimdilik YOK (KVKK). Ayrıntı + örnekler + kurucuya dört soru:
`docs/TASARIM-2026-10-10-odeme-idempotency-ve-deneme-kotuye-kullanim.md`. Kod yazılmadı (ödeme / kimlik akışı = kurucu onayı + ilk denemeler).

**🔔 GOAL BİTTİKTEN SONRA (kurucu 10-10, 8 ekran görüntüsü):** Correlation ID / takip numarası — her işleme rastgele kimlik, zincir boyunca
(ödeme onayı → Paddle `customData` → webhook → abonelik / fatura / alarm) aynı numara, hata bildirimlerinde ve (onayla) kullanıcının hata
ekranında; destek ekranında numarayla arama. Bugün: genel takip numarası YOK; QR `requestId` ve kuyruk `idempotencyKey` İDEMPOTENCY
anahtarıdır, takip değil; ödemede `consentId` fiilen zincir kimliği ama loglarda / hata yanıtında yok. Adım adım plan + kurucuya dört soru:
`docs/TASARIM-2026-10-10-correlation-id-takip-numarasi.md`.

**11-12 sabah — kurucudan beklenenler (gece modunda sorulmadı; rapor `rapor-1112-sabah`):** (1) **S3 anahtarı** (`AI_HELD_PET_SPLIT_ENABLED`): kör sette yanlış izin 0/45, yanındaki soru 29/38 cevaplandı, ama 1 yanlış değer gitti (anahtar kapalıyken 0) — 🚨 sert inceleme sonrası öneri: bu hâliyle AÇILMASIN (`docs/INCELEME-2026-11-12-opus-s3.md`; anahtar artık cevap parçaları kipi olmadan etkisiz). Sorular: (a) cevap parçaları kipinin + cevabı misafirin mesajıyla okuyan denetimin kabul ölçümü öne alınsın mı (S3 onlardan sonra yeni mühürlü setle ölçülür); (b) evcil hayvan sorusu ÖNCEKİ mesajdan bekliyorken sonraki soruya cevap gitsin mi — dün "Köpeğimizi getirebilir miyiz?" (cevaplanmadı), bugün "Otopark nerede?" → bugün gitmez, anahtar açıkken de gitmez; istenirse çok turlu ayrı ölçümle; (c) o 1 yanlışa bakmak için yanmış set ayrıntılı koşulsun mu. (2) **Uydurma cevap (bugünkü yapılandırma, S3'ten bağımsız):** dayanak şartı bütün öğe kipine uygulansın mı / cevap parçaları kipinin kabul ölçümü öne alınsın mı — örnek "İnternet şifresi ne? Kahvaltı veriyor musunuz?" → bugün "… Kahvaltı hizmeti sunmuyoruz." gidiyor. (3) 11-11 gece listesi aynen: 3b üç satır · §12 metinleri (3d rozeti, S1 ikinci onaylayan, S1 doğrulanamayan gönderim cümlesi, yeni misafir mesajında onay, S8 görünürlük, eski "gönderilemedi" öneri satırını cevaptan sonra elle yeniden deneme) · migration turu (§13) · AA-1…AA-9. (4) Depo private yapılınca yazması yeterli (CI aynı commit'te yeniden tetiklenir). (5) Kör set yazarının taslak klasörü oturumun geçici alanında duruyor (silme izni reddedildi; açılmadı, depoda değil) — oturum kapanınca silinir.


**11-12 akşam — kurucudan beklenenler (örnekli hâli `docs/INCELEME-2026-11-12-istem-denetimi.md` §8, `docs/TASARIM-2026-11-12-dayanak-ve-yetki-mimarisi.md` §9):** 🚨 **D-2 OpenAI kredisi** — hesapta kredi kalmadı; kör (kabul) koşuları (dayanak beş kol + geç mesaj üç kol, ~8–10 dolar) ve bundan sonraki her gerçek model ölçümü bunu bekliyor · **D-1 uydurma sorunu için yol** (A: parça kipi + okuyucu + istem katmanı — önerim; B: yalnız katman; C: aynı kalsın) — karar kör sonuçtan sonra · **D-3 çok mesajlı tur** (parça kipinden sonra) · **D-4 parça okuyucusu iki okuma** (kör sonuca göre) · **D-5 evcil hayvan / erken giriş turunda yandaki cevabın tutulması** (S3 kararıyla aynı) · **D-6 dilim sırası** · **D-7 QR'a taşıma** · S2: tekrar eden soruya ikinci cevap (A / B) ve açma sırası (`docs/TASARIM-2026-11-11-kurucu-kararlari-s1-s8-3b-3d.md` §2.2 / §2.3). **Bekleyen iş (kredi gelince, sırayla):** kör koşular → mühür kaydı "burned" + erişim pini → ayrıntı dosyasından neden analizi (Opus) → D5 açma ölçütü. **Kök neden incelemesinden kalan işler (`docs/INCELEME-2026-11-12-kok-neden.md`; hiçbiri bugünkü canlı davranışı değiştirmiyor):** D1d ücret çelişkisi kodda (ücretsiz ↔ tutar) · D1e değerin sahibi (taşınan 900 TL / 150 m) · boş cevabın parça kipi dışında "arıza" sayılması (istem katmanı parça kipsiz açılacaksa ÖNCE) · sıra kipi kapalıyken aynı türden iki sorunun tek öğede birleşmesi (bugünkü hatta bilinmeyen soru sessizce kapanabiliyor — ayrı karar) · "history" kaynağının içeriğe bakılmadan doğrulanması (D2) · ölçerin dört kör noktası + okuyucu setindeki "iletişim" beklentisi · İngilizce edilgen itiraflar ("is not provided", "has not been shared", "do not have … listed") sözcük ağında yok (okuyucu kapsıyor; gizlilik güvencesiyle karışmaması için ölçümle eklenir). **Kayıtlı bilinen sınırlar (parça doğrulayıcısı):** yalnız nitelik sözcüğü taşıyan ihtiyaç nitelik sözcüğünü konu sayar · İngilizce "guest" ihtiyaç sözcüklerinde düşer ("guest room" ↔ "game room") · konu alıntıda hiç geçmiyorsa (`subject_missing`) okuyucu kipinde kod tutmaz (eldeki ölçümlerde 31 doğru parçada da yanıyor) — o sınıf okuyucunun.

**11-13 gece — kurucudan beklenenler (gece modunda sorulmadı; örnekli hâli `docs/TASARIM-2026-11-12-anlamsal-karar-mimarisi.md` §10 ve `docs/INCELEME-2026-11-13-fable-istem-denetimi.md` §6):** 🚨 **OpenAI kredisi hâlâ yok** — bekleyenler: kör (kabul) koşuları (açılış kipinde) ve **ham kolun gpt-5.1 koşusu** (AM-5, yaklaşık yarım dolar; "model mi, hat mı" sorusunu ayıran tek ölçüm) · **AM-1 geçiş sırası** (ölçüm → kaynak sunumu → anlama şeması → GÖLGEDE yeni cevap hattı → yargıçlar → kelime kapıları yedeğe → QR) · **AM-2 koşullu bilgi** (not "hafta sonu 23:00", soru hafta içi: (a) hiçbir şey gitmez · (b) "Havuzumuz hafta sonları 23:00'e kadar açık." gider, hafta içi sorusu ev sahibinde kalır — önerim (b)) · **AM-3 "ev sahibimiz"** de tutulsun mu (11-06'dan beri açık) · **AM-4 getirme bağlamı** (kayıt kimliği + tarih + başlık öneki; ölçümle) · **AM-6 bağımsız doğrulayıcının maliyeti** · **AM-7 üç kurucu kararının bedeli ÖLÇÜLSÜN mü** (cevaplanmayan soruya sessizlik · tehlikede sessizlik · "olmazsa yazın" yasağı — kararlar değişmedi) · Fable denetiminin dar istem bulguları (ÖRNEK 11'deki kaynaksız arıza adımı · güven tablosunda "kısmen mevcut = 0,7–0,9" · kelime sayısına bağlı uzunluk · saat çelişkisi bloğunun "her cevabı düşür" cümlesi · 09-30'dan beri yanlış "misafir standart teslim bildirimini alır" cümlesi) — hepsi misafire gideni değiştirir, önce / sonra + ölçümle · üçüncü şahıs kapısının iki yanlış pozitifi ("the owner bakes…", "sorun olmaz") — kapıyı gevşetir, tekrar oynatma ölçümüyle · kesilen dört Fable merceği yeniden koşulsun mu (koşucu düzeltmesinden sonra, tahmini 8–10 dolar). **Yapılacak (soru değil):** Claude çalışma koşucusunda önbelleğin yeniden yazılma sebebi + mercek başına çıktı tavanı; açılmadan önce düzeltilecekler: karar yazıcısının "onayladık" yasağı (veto makbuz okumalı) · bilgim yok hakeminde dolu alıntının "hayır"ı "evet" yapması · cevap parçaları bloğunda alıntının metinden sonra gelmesi ve kaynak kimliği taşımaması.

**11-13 sabah — UX soruları (UX-1…UX-12, kurucudan beklenir; bulgu kimlikleri ve önce / sonra örnekleri `docs/INCELEME-2026-11-13-ux-denetimi.md` §8):** QR'da cümlesiz "Gönderildi" işareti (K10'a çarpmayan tek biçim) · ev sahibi QR uyarısından "Wi-Fi şifresi"nin çıkması · pasif düğmeler basılabilir olsun mu (kimlik akışı, ilk denemeler birlikte) · telefonda konuşma yanıt kutusu altta sabit · tanıtım turu başlığı + üçüncü şahıs örnek cevap · yasal sayfalar (taslak notu, etiket, iletişim adresi, gün, cayma, yıllık yenileme) · bağlantılar kartında tek cümle Hospitable açıklaması + tek ad "bağlantı anahtarı" · deneme bitiş tarihi · konaklama dışı ekranı (⚠️ iki ayrı metin dairenin doluluk zamanını QR'ı okutan herkese söyler — önerim tek, sızıntısız metin) · Girişler'e eylem · 44 px (önerim şimdilik hayır) · 20 konuşma altında "Mükemmel" etiketi yok. Listeye eklenmesi önerilen: QR panel rozeti "Ev sahibine iletildi" (okuyana üçüncü şahıs) · çıkmaz ekranlara tek düğme · ürün içi tek sözlük · 2FA'da QR.

**11-13 akşam — kurucudan / avukattan beklenenler:** 🚨 **Paddle asıl satıcı mı (d-1):** Paddle Billing'de tüketiciye karşı satıcı Paddle ise Ön Bilgilendirme Formu / Mesafeli Satış Sözleşmesi'ndeki taraf ve "cayma hakkınız sona erer" cümlesi Paddle'ın kendi iade şartlarıyla uyumlu olmalı (bu oturumda paddle.com açılmadı; arama özetleri 14 günlük "takdire bağlı" iade ve yerel hukukun önceliğini söylüyor — doğrulanmadı) · **K3 zorunlu mu (d-3):** "hemen başlasın" onayı vermeyen kişiye satış kapalı (bugünkü uygulama, ücretsiz deneme gerçek seçenek) — haksız şart riski avukata · **kartla deneme (d-5):** üçüncü kutu bu yolda gösterilmiyor; metin önerisi avukata · **satın alma sonrası sözleşme e-postası (b-5):** 6502 md. 4 kalıcı veri saklayıcısı ister, bugün YOK; tasarım + ilk gönderim kurucuyla (e-posta akışı) · **onay kutularının satıra ayrı yazılması (b-4):** migration ister; şimdilik metin özeti (`legalTextHash`) kanıt · **AAS-1…AAS-8** (`docs/TASARIM-2026-11-13-aaas-yonu.md` §7; AAS-8 "kontrol bekliyor" giriş mesajı tutulsun mu) · `TRIAL_DAYS` ortamdan değişebilir ama yasal metinler "14 günlük ücretsiz deneme" der — değiştirilirse metin de değişmeli.
**11-13 gece (7) — "kalan işleri bitir" turu sonucu (soru YOK, yalnız bilgi):** taslak ↔ gönderim bağı (migration 96) ve T3 ekip kişisi (migration 97) dalda, anahtarlar KAPALI; ikisi de Railway açılışında migration'la gider (`docs/RAILWAY-ACILIS-2026-10-15.md`). T3'te bilinçli olarak YOK: temizlikçiye giden mesaj (onay cevabı dahil) ve "bitti" / fotoğraf / [Gelemem] işleme → T5; ekip kişisini silme; telefonsuz kişi → T6. T4 (teklif motoru) İ1 cevabını bekliyor (sessizlik = geliyor mu); Ö1 (gölge karar kaydı) ÖZ-1…ÖZ-6 cevaplarını bekliyor — ikisi de kurucunun toplu cevabından sonra. Açılışta Meta'da temizlikçiler için İKİNCİ numara + `TEAM_WHATSAPP_PHONE_NUMBER_ID` / `TEAM_WHATSAPP_NUMBER` gerekir.
**11-14 gece — sızma testi tur 1 (kurucu: "20 dk'da bir uyan, derin ve sert sızma testi") — kurucu soruları (örnekli, `docs/INCELEME-2026-11-14-sizma-testi-tur1.md` §4):** E-1 (QR'da kod sözcüğü olmadan yazılmış anahtar kutusu kodu da verilmez) + E-3 (iade / şikâyet tutulurken tazminat sözü veren cevap gitmez) onayı — misafire gideni değiştirir, onaylanmazsa geri alınır · B-1 eski v1 kurtarma kodları (yerinde sarma önerisi; v2 kimlik akışı — Railway açılınca birlikte denenecek) · A-2 QR doluluk sinyali · A-3 ilk açan kazanır (eski sekme) · C-1 bağlı numara yoklama · C-E2 bağlama kodu aktarma · E-2 QR kapısı yalnız son mesaj · bilgi tabanındaki ödeme talimatı kapsamı · G-2.1 fotoğraf konum bilgisi. **Tur 2 soruları (§7):** L-1 konuşma sayfasında son 300 mesaj + "tamamını göster" · pasif KB kalemine toplam üst sınır (1.000 / daire) · L-4 işletme başına depolama / mesaj kotası. **Not (kod):** görev kapıları ve WhatsApp ev sahibi kanalı hâlâ `User.role` okuyor (M-2 askı / 6a gelince üyelik rolüne geçmeli) · J-2 `mineRecurringAdditions` karesel (bugün çağıran yok; bağlanmadan önce süre pini).
**11-13 gece (6) — kurucu cevabı:** (a) **taslak ↔ ev sahibinin gönderdiği metin bağı KESİNLİKLE tutulsun, "en iyi şekilde": embedding (anlam benzerliği) + gerçek metin farkı birlikte; buraya ML eklensin** → tasarım + kod sırada (`docs/TASARIM-2026-11-13-taslak-gonderim-bagi.md`, yazılıyor; gölge kayıt, misafire / ev sahibine görünmez) · (b) **migration onayı VAR** (T3 hesapsız personel + kanal bağı, T4 teklif tablosu, Ö1 gölge karar kaydı) · (c) diğer sorular (İ1, ÖZ-1…ÖZ-5, AT-*, AM-*, D-*) kurucu tarafından sonra TOPLUCA cevaplanacak — bekleniyor.
**11-13 gece (5) — temizlikçi akışı T1 + T2 yazıldı; kurucudan beklenen iki karar:** T1 ✅ "Yapamıyorum" kalktı (yeni "Yapılamıyor" yazılamaz, eski kayıt okunur, yeniden atanınca "Yapılacak"a döner); Girişler'den atama ve temizlikçi değişince aktarımda ev sahibinin yeniden atama kaydı "iş başladı" SAYILMAZ (S-E1 cevabı uygulandı; kişinin işareti / notu / fotoğrafı iz kalır — kurucunun sözü yeniden atama kaydı içindi; iptal onarımının silme kümesi gevşetilmedi) · T2 ✅ yedek temizlikçi (daire sayfasında ayrı seçim; temizlikçi değişince / "Kimse"de kaybolmaz; temizlikçiyle aynı kişi olamaz; Girişler'de kişi değişecekken ön seçili "(yedek)", atama yine "Atayın" ile; kimseye iş atamaz, bildirim yok). **Sorular:** (a) **İ1** — dairenin kalıcı temizlikçisinde sessizlik = geliyor; akşam yalnız hatırlatma + [Gelemem]; yedeğe yalnız [Gelemem] ya da sabah başlama son saati geçince gidilir (önceki tasarımdaki "21:00'e kadar cevap yoksa yedeğe" kalkar) — onay? · (b) **migration onayı (T3 + T4):** ekip kişisi = giriş yapamayan personel kullanıcısı + "personel kanal bağı" tablosu (kişi kendi ilk WhatsApp mesajıyla bağlanır — QR / kod) ve teklif tablosu. Tasarım `docs/TASARIM-2026-11-13-temizlikci-akisi-whatsapp-yedek.md` §7, §9. **Not:** 11-06 WhatsApp şablon başvurusu bu hâliyle Meta'ya GİTMEZ ("Yapamıyorum" düğmeleri, teklif şablonu yok) — T5'te yeniden yazılır. **Özerklik akışı (öneri 3) + değer satırı (öneri 6)** tasarımı `docs/TASARIM-2026-11-13-ozerklik-akisi-ve-deger-satiri.md` — sorular ÖZ-1…ÖZ-6 (yön · eşik · yeniden teklif · geri çekilme işaretleri · platform N · gölge karar kaydı migration'ı) + §9 Codex'e dört soru.
**11-13 gece (4) — temizlikçi akışı (kurucu):** temizlikçi siteye GİRMEZ (yaşlı / telefonsuz olabilir), akışı sistem adını bile bilmeden yürütür, WhatsApp düğmeleriyle · "Yapamıyorum" KALDIRILIR · yedek temizlikçi EKLENİR ve kendiliğinden devreye girer (ev sahibine her adımı yaptırmadan — AaaS) · temizlikçiyi yalnız sahip + yönetici değiştirir (bugün de böyle — doğrulandı) · fotoğrafı kimin attığı için hesap yeterli · başlama saati ev sahibine görünür. Tasarım `docs/TASARIM-2026-11-13-temizlikci-akisi-whatsapp-yedek.md` (dilimler T1–T5; T4 Meta şablon onayı ister); Opus tasarım incelemesi koşuyor → sonra T1 (Yapamıyorum kaldırma + "başladı" tanımı) ve T2 (yedek temizlikçi) kodlanır.
**11-13 gece (3) — kurucu cevapları:** **AT-4 ✅** daire kartındaki yanlış cümle nötr, azarlamayan cümleye çevrildi ("Bu mesaj bilgi tabanınızdaki eski kayıtlardan buraya aktarıldı. Bilgilerin güncel olduğuna bir göz atıp kaydedin.") · **AT-6 ✅** kapı kodunun şifreli kopyası yeni tabloda TUTULSUN, güvenlik sorunu olmasın, migration onaylı · **Daire gerçekleri şartı (kurucu):** ev sahibi bir bilgiyi değiştirince HEMEN her yerde geçerli olmalı, güncellemek zahmet çıkarmamalı; kurucu eve gidince Codex'e yazacak ve bize iletecek → kodlama o notla birlikte (tasarım + güvenlik ayrıntısı hazırlanır) · **S-E6 ✅** abonelik bitince de Girişler'den giriş mesajı gönderilebilir — KALIR (Claude değerlendirmesi: gereksiz kolaylık değil; misafirin kapıda kalmasını önler, elle cevapla aynı sınıf) · **S-E1** akışı kurucuya anlatıldı (kurucunun eğilimi: yeniden atama "iş başladı" sayılmasın) — cevap bekleniyor · **3–6 cevapları:** (3) "küçük tablo 4–5 satır olabilir ama daha iyi bir fikir için uzun düşün; en mantıklı akış, görsel olarak güzel; host sürekli siteye girip elle ayar yapan bir sisteme benzemesin; sistemimiz platform düzeyinde öğrenen (ML) olabilir" → Claude tasarım + görsel taslak hazırlar (kod yok; misafire gideni değiştiren özerklik kararı kurucuda) · (4) önce ÖLÇ, sonra karar (bugünkü çakışma sıklığı — canlı veri, Railway açılınca) · (5) UNUTMA: Fable 5.2 gelince ona mimariyi çizdirerek ileride yapılacak · (6) Claude kendi önerisini yazar, kurucu Codex'e soracak · kurallar sadeleştirildi (çalışırken gelen mesaj; hata ayıklama ajanı — araştırma ajanı bu kuralın konusu değil).
**11-13 gece (2) — kurucuya sorular (Bugün ekranı + atomik çelişki + iki inceleme):** **AT-1** "kontrol bekliyor" için C yönü (daire gerçekleri: olgu düzeyinde tek kaynak + metinde atıf + yazım anında çelişki + kapı metni kuran fonksiyonda + veritabanında "tek güncel değer" kısıtı) mı, kısa yol B mi · **AT-2** kritik olgu listesi (bina / daire / anahtar kutusu kodu · Wi-Fi adı + şifresi · giriş / çıkış saati · yol tarifi / kat / daire no · otopark) · **AT-3** göçte yalnız selam farkı olan satırlar gitmeye devam etsin mi · **AT-4** daire kartındaki "birden fazla kayıt vardı; en son eklenen seçildi" cümlesi yanıltıcı (işaret yalnız saniyesine kadar eşit zamanlı iki kayıtta konmuş; tarihleri farklı çelişen kayıtlarda en yenisi İŞARETSİZ seçildi — 11-13 açıklamam eksikti) → nötr cümle mi · **AT-5** dairenin erken giriş kuralı "otomatik" ise doğrulanmış erken giriş kendiliğinden gidiyor: "önceden yazılan kural = ev sahibinin kararı" yorumu doğru mu · **AT-6** kapı kodunun şifreli kopyası yeni tabloda mı, yalnız özet mi · **S-E1** yöneticinin "Yapılamıyor" görevi yeniden atadığı durum kaydı görevi "başlanmış" saydırıyor (Girişler'den ikinci atama yok; temizlikçi aktarımıyla aynı tanım) — "Yapılacak'a geri alma" iş sayılmasın mı · **S-E6** elle giriş mesajı abonelik bitince de gidiyor (elle cevap gibi) — doğru mu · **"Bugün" ekranı** ilk dilimi kodda (ekran görüntüleri kurucuya); ayrı sayfa / menü sadeleşmesi ve satır içi tek dokunuş eylemleri ekranı gördükten sonra. Ayrıntı `docs/TASARIM-2026-11-13-bugun-ekrani-ve-aaas-akisi.md` §2, §7; incelemeler `docs/INCELEME-2026-11-13-gunun-sert-incelemesi.md`.
**11-13 gece — kurucunun kaydettirdiği dört soru (kurucu: "o 4 sorunu kaydet"; avukat / kurucu kararı, kod bekliyor):** (1) **Satıcı kim** — Paddle tüketiciye karşı asıl satıcı (Merchant of Record) ise Ön Bilgilendirme Formu / Mesafeli Satış Sözleşmesi'ndeki taraf ve "cayma hakkınız sona erer" cümlesi Paddle'ın kendi iade şartlarıyla çelişebilir (paddle.com bu ortamdan açılmadı; doğrulanmadı) · (2) **satın alma sonrası sözleşme e-postası** — 6502 md. 4 sözleşmenin kalıcı veri saklayıcısıyla verilmesini ister, bugün YOK; tasarım + ilk gönderim kurucuyla (e-posta akışı) · (3) **Kullanım Koşulları md. 20** "kullanmaya devam etmek kabul sayılır" — ücretli müşteride tek taraflı değişiklik riski; bildirim sözü verilmeden değiştirilmedi · (4) **talep formu** — aydınlatma ile açık rıza tek zorunlu kutuda birleşik (yasal dayanak seçimi). AaaS cevapları (aynı mesaj): 1 "Bugün" ekranı ONAYLI (ilk dilim kodda) · 2 sabah özeti ŞİMDİLİK YOK · 3–6 sade anlatım + AAS-8 için atomik çelişki tasarımı (AT-1…AT-3) `docs/TASARIM-2026-11-13-bugun-ekrani-ve-aaas-akisi.md`.
**11-13 gece — "Giriş mesajını gönderin" (D5) Haiku incelemesi (6 bulgu, 6'sı kodda doğrulandı ve düzeltildi — `c7090deb`, `5cad75e1`):** sonuç penceresi liste yenilenmeden okunur (belirsiz teslim uyarısı kaybolmuyordu → artık pencere kapanınca yenilenir) · yükleme sırasında kapatılan pencere yeniden açılmaz · kesin ret sonrası damga geri alınamazsa alarm (otomatik gönderimle aynı) · kalıcı kuyrukta var olan satırın durumuna göre cevap (ertelenmiş → öne çekilir; gönderildi / doğrulanamadı / başarısız / uçuşta ayrı) · kuyruktaki mesaj için düğme sunulmaz. **Kurucuya haber (yeni ev sahibi cümlesi, misafire GİTMEZ):** kalıcı kuyrukta kesin başarısız satır varken "Bu giriş mesajı daha önce gönderilemedi; buradan yeniden gönderilemez. Mesajı konuşmadan kendiniz gönderin." (kalıcı kuyruk anahtarı bugün kapalı). **Açık:** S-1b (elle gönderime ayrı acil durdurma) · ilk gerçek gönderim kurucuyla.
**11-13 akşam — Opus dilim sonu incelemesi (ödeme onayı + Girişler'den atama; 0 P1 · 8 P2 · 10 P3, kayıt `scratchpad/handoff/OPUS-1113G-inceleme.md`):** düzeltilen: P2-1 (kayıt `privacyAcceptedAt` yazmıyor) · P2-2 (ödeme satırı özeti yola göre: yalnız gösterilen cümleler) · P2-5 (Koşullar md. 1 / 7 / 18 + OBF md. 14) · P2-6 (MSS md. 17 gönderilmeyen "örneği sunulur" sözü kalktı) · P2-7 (atama: seçim + "Atayın", klavye güvenli) · P2-8 (dokunulmuş "Yapılacak" atanmaz; temizlikçi aktarımıyla aynı tanım, sunucu kilitli satırda) · P3-1…P3-9. **Açık (kod / karar):** P2-4 YÜKSELTME tarafı ✅ (`f2b9283f`: kutu + sunucu alanı + denetim kaydı); 🚨 DEVAM ETTİRMEDE kutu yok — `PADDLE_RESUME_ENABLED` kapalı kalır (kurucu SG3), açılacaksa önce kutu ya da avukat b-6 · P2-3 kartla deneme süresi ≥ 14 gün ön şartı (açılış belgesine yazıldı; d-5) · Koşullar md. 20 "kullanmaya devam = kabul" (ücretli müşteriye tek taraflı değişiklik — avukat; bildirim sözü verilmeden değiştirilmedi) · P3-10 talep formu aydınlatma + açık rızayı tek zorunlu kutuda birleştiriyor (yasal dayanak seçimi kurucu / avukat).

**11-18 — Codex 11-17 turu: kurucudan beklenenler (örnekli hâlleri `docs/INCELEME-2026-11-18-codex-bulgulari.md` §5, `docs/TASARIM-2026-11-18-odeme-alindi-abonelik-bekleniyor.md` §6, `docs/TASARIM-2026-11-18-ev-sahibine-nerede-soruyoruz-ve-ilk-akis.md` §11):** **Ö-1** yeni müşteri metni (ödeme alındıktan 10 dakika sonra hâlâ abonelik yoksa: "Ödemeniz alındı, aboneliğiniz henüz hesabınıza tanımlanmadı. Lütfen yeniden ödeme yapmayın; kısa sürede tanımlanmazsa bize yazın." — ilk 10 dakikada bugünkü "işleniyor" metni; kodda, onayınıza kadar değiştirilebilir) · **Ö-2** abonelik olayı hiç gelmezse Lixus aboneliği Paddle'dan kendisi okuyup bağlasın mı (bugün: 15 dakikada operatöre alarm, bağlama elle) · **Ö-3** migration turu adayları (olay başına "sonraki deneme zamanı" · ödeme kaydında abonelik kimliği · mesajda teslim yolu + cevap kapsamı · kuyrukta iptal isteği · görev istek kimliği) — #83 ile birlikte tek onay · **Plan değişikliği sürerken abonelik değişirse** müşteriye bugün "başarılı" deniyor, operatöre alarm gidiyor; müşteriye bekleme metni mi gösterilsin · **Y-1** yeni ev sahibi metinleri (kanala bağlı olmayan konuşmada: önce "Mesaj gönderildi." → sonra "Cevabınız kaydedildi. Bu konuşma bir kanala bağlı olmadığı için misafire gönderilmedi." + yazma alanı üstünde kalıcı not) · **Y-2** aynı durumda WhatsApp'tan onaylanan cevaba ayrı metin · **S-1** elle açılmış konuşmada kaydedilen cevap konuşmayı "Cevaplandı" yapıp ihtiyacı kapatmasın mı · **S-2** gönderimi doğrulanamayan cevap ihtiyacı kapatmasın mı · **S-3** o konuşmada düğme "Kaydet" mi olsun · **S-4** misafirin görmediği yerel cevaptaki sözden görev üretilsin mi · **Kalan-2** onaylıdan "bekliyor"a dönen rezervasyonun kuyruktaki mesajı ertelensin mi iptal mi (kuyruk kapalı; açılış ön şartı) · **H-1…H-8** ürün yönü: "yazdım" ile "çözdüm" ayrımı (09-26 kararıyla gerilim) · devir günü tek takip satırı · varış gününden önce sorulan erken giriş · geç çıkış kuralı · ikinci onay · fatura sorusu sayımı · panelden bilgi tabanı önerisi · hangisi ilk. **Sandbox denemesinde doğrulanacak Paddle varsayımları:** `transaction.paid` olayında abonelik kimliği boş gelebilir · `origin` alanının değerleri · yenileme işlemlerinin `custom_data` taşıyıp taşımadığı (tasarım buna dayanmıyor) — `docs/RAILWAY-ACILIS-2026-10-15.md` ödeme denetim listesi.

**11-18 (2) — dalga 2a: kurucudan beklenenler / bilgi:** **(a) giriş:** saldırganın denemesi SÜRERKEN (sayaç sınırdayken) hesap sahibinin tanınmayan cihazdan doğru parolası da o an "çok fazla deneme" alır (eskiden girerdi) — "kova doluyken yalnız tanınan cihaz girer" kararının eşzamanlı hâli; bilgi. **(b) pano:** başlamış işi panodan yeniden atamak serbest kalsın mı (bugün serbest, pinli). **(c) görev:** aynı istek kimliği + farklı içerik için ayrı ev sahibi metni ister misiniz (bugün "Geçersiz istek"; arayüz bu duruma düşmüyor). **(d) QR:** bekleme sırasında misafire ayrı bir metin (ör. balon altında "Gönderiliyor…", vazgeçişte "Mesajınız henüz iletilemedi. Lütfen tekrar gönderin.") ister misiniz — bugün var olan "yazıyor" göstergesi ve var olan hata metni kullanılıyor. **(e) görev saati:** tam UTC 00:00 / 12:00'a düşen saat için 1 ms'lik iç düzeltme yerine kalıcı çözüm (vade hassasiyeti sütunu) migration turuna eklendi (#83). **AY-1…AY-5** arayüz yönü soruları `docs/TASARIM-2026-11-18-arayuz-yonu-taslagi.md` §6. **Ayrı tura kalan:** sıfırlama kaydı ile kuyruk satırının aynı işlemde yazılması (F3 ikinci parça; zamanlama eşitliği pinleri) · 2FA günlük hata tavanı ve yeniden doğrulama sayaçları için aynı "önce ayır" deseni.

**11-18 (4) — dalga 2b: kurucudan beklenen metin kararları (hiçbiri koda konmadı; var olan metinler kullanılıyor):** **(f) "Açık işler" kartı okunamadı:** bugün var olan genel cümle "Durum okunamadı. Sayfayı yenileyin."; öneri "Açık işler yüklenemedi. Sayfayı yenileyin." **(g) gizlenen kapanmış işler:** konuşmada 3 açık + 30 kapanmış iş varsa 20 satır görünür; öneri altına "13 kapanmış iş gizlendi" (+ isterseniz "Tümünü göster"). **(h) karar paneli okunamadı:** bugün panel boş görünür (hata kaydı düşer); öneri "Karar bekleyen istekler yüklenemedi. Sayfayı yenileyin." **(i) eski sekme çatışması:** bugün bilgi tabanının cümlesi çıkıyor ("Bu bilgi siz düzenlerken başka bir yerde değiştirildi. Sayfayı yenileyip değişikliğinizi yeniden yapın."); şablon ve daire ayarları için ayrı cümle ister misiniz ("Bu şablon …" / "Daire ayarları …"). Önce: eski formdan adres kaydedilince başkasının yaptığı 12:00 çıkış saati sessizce 11:00'e dönüyor, ekranda "Kaydedildi." Sonra: kayıt yapılmaz, yazılanlar formda kalır, çatışma cümlesi çıkar. **(j) sıradaki en riskli sürümsüz form stok formu** (tam nesne gönderiyor): sürüm ön şartıyla mı, "yalnız değişen alan gider" kalıbıyla mı kapatılsın. **(k) pano tavanı:** bekleyen hassas istek adayları 500'ü aşarsa bugün yalnız operatöre alarm gider; panoya "ve daha fazlası" satırı ister misiniz.

**11-18 (5) — dalga 2c: bilgi + iki küçük karar:** **(l) karar mesajı sırası:** kuyruk açıkken karar mesajı doğrudan gittiği için aynı konuşmada kuyrukta bekleyen bir cevaptan ÖNCE ulaşabilir (elle giriş mesajında bugün de aynı) — kabul mü; sıra garantisi istenirse yeri işçide konuşma başına sıradır. **(m) operatör freni:** "teslimatı durdur" çekiliyken karar onayı gönderilmez, kart yeniden açılır ve var olan "Şu anda gönderilemedi — lütfen birazdan tekrar deneyin." cümlesi çıkar — ayrı bir cümle ister misiniz. **Açılış belgesi güncellendi (11-18 (6)):** `docs/RAILWAY-ACILIS-2026-10-15.md`deki "karar kartı ile kalıcı kuyruk birlikte açılmasın" şartı kaldırıldı (engel kalktı); kuyruğu açmadan önce kalan tek ön şart son kontrol → gönderim penceresidir (migration turu). **Temizlik (ayrı iş):** karar sonucundaki `queued` dalları ve WhatsApp'taki "Sıraya alındı" metni artık pratikte kullanılmıyor.

**11-18 (6) — alıntılanan söz görev açmasın (kod YOK; `docs/TASARIM-2026-11-18-alintilanan-soz-gorev-acmasin.md`, bugünkü davranış ölçüldü):** örnek — ev sahibi misafire şunu yazıyor: *Misafir şöyle yazdı: "Teknisyen yarın gelecek"* → bugün bakım görevi kendiliğinden açılıyor; öneriyle "kesin değil" kartı kalır, görev açılmaz (ev sahibi kartta onaylarsa açılır). *Teknisyenimiz yarın 10'da gelecek* → bugün de öneriyle de görev açılır. **G1-a** alıntı içindeki söz kart mı olsun (öneri), hiç söz sayılmasın mı · **G1-b** ilk adım yalnız tırnak + `>` satırı mı (öneri), tırnaksız "şöyle yazdı:" de girsin mi · **G1-c** karta "Alıntı içinde — kesin söz sayılmadı." satırı (yeni metin) · **G1-d** "… demişsiniz / yazmışsınız" için sözcük ağına ek mi, anlam katmanına mı bırakılsın. Bilgi: çeviriyle gönderim alanı kaldırıldı (arayüzde yoktu); çeviri ileride istenirse önizlemeli akış ayrı tasarım + onay ister. **(n) aynı rezervasyon iki dairede kayıtlıysa (düşük öncelik):** bugünkü kural (eskiden beri, şimdi açık yazıldı) — rezervasyonun sıralamadaki ilk kaydı belirler: ilk kaydın dairesinde otomatik mesaj metni yoksa o rezervasyona karşılama / giriş bilgisi / çıkış mesajı GİTMEZ, öteki dairenin metni kullanılmaz (yanlış dairenin giriş bilgisi gitmesin). Örnek: aynı rezervasyon "Lale 1" (metin yok) ve "Lale 2" (metin var) altında kayıtlı → mesaj gitmez. Seçenek: böyle bir rezervasyonda ev sahibine "bu rezervasyon iki dairede kayıtlı" uyarısı gösterilsin mi (bugün sessiz).

**11-18 akşam — kurucunun rapora cevabından sonra bekleyenler (örnekli hâlleri `docs/INCELEME-2026-11-18-aksam-kararlar.md` §5):** **AK-1** "Gönderim doğrulanamadı" etiketi ürün genelinde "Gönderim teyidi bekleniyor" mi olsun · **AK-2** iki dairede kayıtlı rezervasyonda yalnız giriş bilgisi mi, üç otomatik mesaj da mı tutulsun (bugün üçü) · **AK-3** Girişler / Dikkat paneli cümleleri · **AK-4** öteki dairedeki "bekliyor" kopya da tutma sebebi mi (bugün evet) · **AK-5** saatli söz 15:00'te kartta saatsiz görünüyor — düzeltelim mi · **SM-1…SM-3** söz okuyucusu (`docs/TASARIM-2026-11-18-soz-sahipligi-model-okumasi.md` §6). Not: (6)'daki G1-a…G1-d soruları GEÇERSİZ (öneri geri çekildi). **Sırada, karar beklemeden yapılacaklar:** gölge kaydı tablosu · kuyrukta atomik iptal / gönderim · ödeme anında doğrulama + otomatik bağlama (canlı deneme kurucuyla, açılışta) · Y-1 tasarım + ilk dilim (iç not) · H-1 tasarım · H-3 örnek bankası · mobil taslak.

**11-18 gece (dalga B) — yeni sorular:** **AK-6** WhatsApp karar cevabı hedefi olmayan konuşmada "Gönderildi ✓" diyor (panel "kaydedildi") —
metin panelle aynı olsun mu · **EG-1** son karar payının varsayılanı (öneri 30 dk; son dakikada gelen isteği de tutar — örnekli) ve form
metinleri ("Otomatik onay en geç ne zaman verilsin?" · "Sınır yok" · "İstenen saatten 30 dakika öncesine kadar") · **EG-2** "yalnız ücretsiz"
anahtarı açılsın mı (ücretli + otomatik kuralda onay hazır cevaba döner) · **EG-4** otomatik onay için giriş bilgisinin gönderilmiş olması
şart olsun mu · yeni ev sahibi metinleri: "Erken giriş ücretli; onay kendiliğinden gönderilmez, hazır cevabı siz gönderin." · "İstenen saate
çok az kaldı; onay kendiliğinden gönderilmez, hazır cevabı siz gönderin." · "Ücret yazılıyken onay kendiliğinden gönderilmez; hazır cevap size
gelir, siz gönderirsiniz." Örnekli hâlleri `docs/TASARIM-2026-11-18-otomatik-erken-giris-pilotu.md` §5.

**11-19 — dalga C sonrası yeni sorular:** **ÖD-3** ödeme ekranında destek bağlantısının etiketi (e-posta adresinin kendisi) ve kısa takip
numarasının ekranda yazılı olmaması (önce / sonra `docs/TASARIM-2026-11-18-odeme-aninda-dogrulama.md` §7) · **İK-1** eski formun 405
iletisi bugün "Konuşma oluşturulamadı" (yalnız eski sekmede görünür) — öneri: "Konuşmalar artık yalnız kanaldan ya da QR sohbetinden gelir.
Ekip içi kayıt için konuşmada 'İç not' kullanın." · **İK-2** iç kayda gönderim reddinin metni: "Bu kayıt bir kanala bağlı değil. Misafire
buradan mesaj gönderilemez." (yalnız eski sekmede) · **İK-3** iç not kartı: silme onayı ("Bu not silinsin mi?"), "Daha eski notlar",
"Notlar okunamadı." metinleri eklensin mi · **UA-1** "Aynı rezervasyon iki dairede kayıtlı: A ve B" · "<gün> · Otomatik mesajlar
bekletiliyor. Yanlış kaydı kaldırın." metni + ev sahibinin yanlış kaydı kaldıracağı bir yer bugün yok (rezervasyon silme / iptal ucu var,
arayüzü yok) + kart dolarsa gösterim tavanı (öneri en çok 3).

**11-19 (2) — kurucu cevabından sonra kalan sorular (örnekli hâlleri `docs/INCELEME-2026-11-19-kurucu-cevabi.md`):** **Ö-a** anında
doğrulama ekranındaki "Ödeme tamamlandı. Planınız hazır olduğunda…" Paddle penceresi kapanınca, sunucu doğrulamasından ÖNCE görünüyor —
doğrulama sonrasına mı kalsın (önce "Ödemeniz işleniyor…") · **Ö-b** kısa takip numarasının yanına "Takip no:" etiketi · **A-a** kanal
uzlaştırmasının ev sahibi metinleri: "Kanalda görünmüyor — Lixus konuşmayı 30 dakika boyunca kontrol etti; mesaj misafire ulaşmamış
görünüyor." + [Yeniden gönder] · "Kanal şu an okunamıyor — gönderim doğrulanamadı." · içerikle görülen mesajın etiketi "Gönderildi" mi
"Kanalda görünüyor" mu · **E-a** EG-4: otomatik erken giriş onayı için kuralda ev sahibinin açık beyanı "Giriş bilgisi erken saatte de
geçerli" (varsayılan kapalı; yoksa hazır cevap ev sahibine gelir) · İK-1'deki `Mesajlara dön` düğmesi eski sekmenin kendi kodunda olduğu
için eklenemez (bilgi).

**11-19 (3) — ajan turundan kurucuya sorular:** **T2-B8 (P2)** mesaj şablonu sayısı sınırsız ve liste ucu / sayfası hepsini tek yanıtta döküyor
(ölçüm: ~10 dk yazımla 3.000 şablon → tek istek 284 MB yığın, 2,8 sn) — liste sayfalansın mı, işletme başına şablon sınırı mı (öneri: ikisi;
sayfalama sınırdan bağımsız) · **T2-B10** vektör ısıtma bütçesi bütün işletmelerde ORTAK (bir deneme hesabı saatlik bütçeyi dakikalar içinde
tüketip başka işletmelerin anlamsal aramasını o saat kapatabiliyor) — işletme başına adil pay mı · **B3** iyelik ekiyle biten daire adında
bulunma eki ("Sahil Evi'de" → doğrusu "Sahil Evi'nde"; kuralla güvenle ayrılamaz) — başlık "Bu rezervasyon iki dairede görünüyor: A ve B"
biçimine mi dönsün · **UA-a ek** son elle kopya kaldırılmaz metni "Bu rezervasyonun başka dairede kaydı kalmadı; bu kayıt kaldırılamaz."
(yalnız eski sekmede görünür) · **bilgi** konuşma silindikten sonra elle "Gönder"e basılan giriş mesajı artık gerçekten gidiyor (eskiden
"sıraya alındı" deyip gitmiyordu; misafir silme talebi ayrı korumayla engelli) · **açılışta ölç** panel sayfasının eşzamanlı okumaları ↔
veritabanı bağlantı havuzu · WhatsApp web kancası düz `JSON.parse` (Paddle'daki NUL sınıfının komşusu, bakılmadı).

**11-20 gece — kurucuya sorular (örnekli hâlleri sabah dosyasında):** **B-1** "iki dairede kayıtlı" satırının ikinci satırında varış günü ve
"Otomatik mesajlar bekletiliyor." kalsın mı (şu an daire adlarının ardında) · **B-2** "Rezervasyonu aç" takvimi açıyor ("Beklemede" kayıt
takvimde görünmez) — tek rezervasyon sayfası ileride mi · **E-1…E-6** anlamsal arama: işletme kovası saatte 600 · ortak tavan 2.000 + günlük
üst tavan · soğuk pencerede dayanak (dar kural A mı genel dayanak işi B mi; QR'da tutmak ne demek) · `KB_VECTOR_STORE_ENABLED` açılışta 1 mi ·
gecikmeli ısıtma 20 sn · kalıcı kuyruk tablosu ne zaman · **Ş-1** şablon ekranı yeni metinleri · **Ş-2** sınıra yaklaşınca uyarı · **Ö-1** QR'da
model düşünürken iptal edilen konaklama (öneri: cevap gitmez, "sohbet kapalı" metni, mesaj ev sahibine) · **Ö-2** mesaj içi sorgu tekrarlarını
kaldırma + yeniden sıralayıcı sonucunu içeriğe bağlı önbelleğe alma (misafire gideni değiştirmez) · konaklama bekçisini atlamak ÖNERİLMEDİ.

**11-20 öğlen — kurucuya sorular (örnekli hâlleri öğlen raporunda):** **A3** kuyruk açıkken çıkış günü 12:00'den sonra tutması kalkan / geciken
çıkış mesajı ("Bugün çıkış gününüz…") gitsin mi, iptal mi edilsin (kuyruksuz yol bugün 12:00'den sonra hiç göndermez; kuyruk gönderiyor — doğrudan
yolla misafire giden FARK, F-1 kuralıyla önce örnek) · **G-2** Girişler'de gönderimi belirsiz giriş mesajı metni "Otomatik giriş mesajının gönderimi
doğrulanamadı · konuşmayı kontrol edin" (düğme yok) · **EMB-S1** ilk hafta ölçüsü nerede görünsün (öneri: operatör konsolunda tek satır kart) ·
**F4-a** plan sınırı istek başına iki kez okunuyor — tek okuma kanal yolunu da değiştirir, ayrı dilim mi · **F4-b** QR'da "daha yeni misafir
mesajı varsa bu cevabı yazma" kontrolü yok (kanal yolunda var) — eklensin mi (misafire gideni değiştirir, örnekli soru) · **R-1…R-6** rezervasyon
detay ekranı (`docs/TASARIM-2026-11-20-rezervasyon-detay-ekrani.md` §10) · **A4 (bilgi)** "durduruldu" yazısı abonelik kapısına bakmıyor
(faturalandırma uygulaması bugün kapalı; Girişler de aynı).

**11-25 — Codex raporundan kurucuya sorular (örnekli hâlleri tasarım belgelerinde; özet `docs/INCELEME-2026-11-25-codex-raporu.md` §7):**
**OP-S1…S5** operatör taze 2FA (kapsam: 2FA sıfırlama · hesaba giriş · tam dışa aktarma; izin 5 dk tek kullanım; hatırlanan cihaz operatör
hesabında kodu atlatsın mı) `docs/TASARIM-2026-11-25-operator-taze-2fa.md` · **GÖ-S1…S5** gönderim öncesi kontrol (gölge ölçüm açılışla
başlasın mı; kapı kodu model düşünürken değişirse cevap bir kez yeniden üretilsin mi; uzun vadede kapı kodu / Wi-Fi ayrı alanda mı)
`docs/TASARIM-2026-11-25-gonderim-oncesi-yetki-kontrolu.md` · **AD-S1…S4** acil durdurma (salt okunur kapsam tablosu; genel anahtar kapalıyken
QR'daki yapay zekâ da sussun mu; tek şalter) `docs/TASARIM-2026-11-25-acil-durdurma-kapsami.md` · **IP-1** ortak ağda şifre kodu isteme tavanı
12 → 5 (doğrulamaya 7 ayrıldı) uygun mu · **ÖD-4** yeni ödeme sözleşmesinin gerçek Paddle sandbox denemesi (açılışta, kurucuyla).

**11-25 (2) — üç küçük işten kurucuya sorular (örnekli hâlleri tasarım notlarında):** **Ç-1** çıkış satırında gecikmiş söz ayrıca
belirtilsin mi ("sıcak su (söz bugün 14:00 · gecikti)") · **Ç-2** 48 saatten eski açık söz de çıkıştan önce hatırlatılsın mı (bir ek okuma) ·
**B-1** usta / temizlikçi kendi bakım kartında "son bakım işi" satırını görsün mü (bugün yalnız yönetici — not serbest metin) · **B-2** satır
tamamlanmış bakım kartında da çıksın mı · **B-3** ikinci yüzey: Dikkat panelindeki tekrarlayan sorun satırında da gösterilsin mi (okuma hazır) ·
**T-1** erken giriş isteyen daire saatten bağımsız öne mi geçsin (bugün evet) · **T-2** atanmamış temizliklerin sırası gösterilsin mi (bugün
evet) · **T-3** sayımda "kim yaptı" = atanan kişi (bugün) mi, "bitti"yi işaretleyen mi · **T-4** "giriş hazırlığı" görevleri de temizlik
sayılsın mı (bugün hayır) · **T-5** sıra önerisi temizlikçinin kendi gün görünümünde de çıksın mı (bugün yalnız Girişler / yönetici).
Fikir planından kalan: Meta (WhatsApp) kurulumu · yorumlardan "bilinen sorunlar" öne alınsın mı · QR'da Wi-Fi adı kartı · Hospitable'sız
denemede "ödeme anı" (`docs/PLAN-2026-11-25-urun-fikirleri-iki-ajan.md`).

**11-25 (3) — Codex ikinci rapordan kurucuya sorular (örnekli hâlleri `docs/INCELEME-2026-11-25-k27-*.md`):** **K1-S1** kuyruk okuması 15 dk
sürekli okunamıyorsa strict yoklama 503 versin mi · **K3-S2** kilit `syncHospitable` içinde de yenilensin mi, önce süre mi ölçülsün ·
**K2-S** sohbet ekranı son 50 mesajla açılsın, "Daha eski mesajları göster" düğmesi olsun mu · **K8-a** silme doğrulaması tamamlanamayınca ekran
metni ("Misafir verisi silindi. Son kontrol tamamlanamadı; bir kez daha deneyin.") · **K11-1** EXIF / GPS: dokunma · yalnız GPS'i sıfırla ·
yeniden kodla (yeni bağımlılık) · **K11-2** piksel tavanı 268 MP kalsın mı · **K11-3** çok büyük görsele ayrı metin · **K13-2** OAuth token
adresi yalnız `auth.hospitable.com` olsun mu (önce Railway değeri görülmeli) · **K15-3** elle "hepsini eşitle" 60 sn'de dursun mu · **K16-1**
dışa verilen takvimin başlığı genel olsun mu ("Lixus AI takvimi") · **K17-2** ödeme ekranı kurulu ama ödeme zorunlu değilken webhook anahtarı
eksikse uyarı · **K22-2** öteki geç yazıcılar (taslak izi, konuşma öğesi konusu, WhatsApp sorusu, taslak bağı, misafire söz) aynı sınırla
kapatılsın mı · **K25** bileşik "aynı işletme" kısıtı (önce iki tabloya işletme sütunu) · **K26** büyük işletmede dışa aktarma parça parça mı.
**Açılış notu (C1):** `QR_PIN_ENABLED` açıldıktan sonra Ayarlar'da "sohbet kodu iste" bir kez yeniden kaydedilir (eski cihaz bağları o zaman düşer).
