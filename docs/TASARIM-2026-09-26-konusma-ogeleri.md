# Konuşma öğeleri (ConversationItem) — öğe bazlı risk · tasarım (2026-09-26)

> Kurucu kararları 09-26 (hepsi önerilen seçenek; önceki inceleme: `docs/BEKLEYEN-RISK-OGE-BAZINDA-2026-09-26.md`).
> Durum: **tasarım**. Kod bayrak arkasında (`AI_CONVERSATION_ITEMS_ENABLED`, varsayılan KAPALI); migration 56 yerelde,
> gönderim = taze `pg_dump` + kurucu onayı. Açma = ücretli ölçüm + örnekli sonuç + kurucu onayı.

## 1. Kurucunun istediği davranış (örneklerle)

| Misafir yazar | Olacak |
|---|---|
| "IBAN'ınızı atar mısınız?" | Misafire HİÇBİR ŞEY gitmez (otomatik "kaydedildi" YOK). Öğe: 🟠 ödeme yöntemi isteği — ev sahibinde açık. Ev sahibine acil e-posta (bugünkü gibi). Konuşma durmaz. |
| Sonra "Wi-Fi şifresi neydi?" | Wi-Fi cevabı otomatik gider; cevap IBAN'a DEĞİNMEZ. IBAN öğesi açık kalır. |
| Aynı mesajda ikisi | Yalnız güvenli kısım (Wi-Fi) cevaplanır; IBAN sessizce açık öğe. |
| "Mutfakta gaz kokusu var" → "Wi-Fi?" | Acil durum: bugünkü gibi konuşma ev sahibine geçer ("Sorunlu"), yapay zekâ susar, acil e-posta. |
| "Daire çok kirli, rezalet" → "Otopark nerede?" | Şikâyet öğesi açık + acil e-posta; otopark sorusu cevaplanır. |
| "12'de gelebilir miyiz?" → "Boşverin, 3'te geleceğiz" | Erken giriş öğesi "misafir vazgeçti" olur (listeden düşer, geçmişte görünür). Acil durum öğesi asla kendiliğinden kapanmaz. |
| Ev sahibi konuşmaya yazar | Açık öğeler "ev sahibi yazdı" olur (tıklama gerekmez). |

Ek kurucu kararları (09-26, ikinci soru turu — hepsi önerilen seçenek):

| Misafir yazar | Olacak |
|---|---|
| "Ev sahibiyle konuşmak istiyorum" | Misafire otomatik mesaj GİTMEZ (bugünkü "Mesajınız kaydedildi; ev sahibiniz görebilir." devri kalkar); "İnsan talebi" açık iş + acil e-posta. Sonraki "Wi-Fi şifresi?" cevaplanır. |
| Hafif şikâyet, Ayarlar'da "bekletme mesajı" açık | Öğe modunda bekletme mesajı ("…Mesajınız kaydedildi ve ev sahibiniz için öncelikli olarak işaretlendi…") GİTMEZ; şikâyet sessiz açık iş + acil e-posta. |
| Yalnız hassas bir şey ("IBAN'ınızı atar mısınız?") | Misafire hiçbir şey gitmez; panelde ev sahibi için TASLAK hazırlanır (bugünkü gibi, gönderilmez). |

Ev sahibi görünümü: konuşma listesinde "1 açık iş" rozeti; konuşma içinde "Açık işler: 🟠 Ödeme yöntemi isteği · ✅ Wi-Fi
cevaplandı"; panelde "Dikkat Gerektirenler" satırı. Host Karar Motoru (`DecisionRequest`, ev sahibinin kararı + final
cevap) AYRI yapıdır; bu öğeler onun girdisi olur.

## 2. Veri modeli (migration 56, yeni tablo — dolu tabloya dokunmaz)

`ConversationItem` — misafirin bir mesajındaki TEK istek/soru. METİN YOK (PII yok): yalnız kimlikler + kapalı küme kodlar.

| Alan | Açıklama |
|---|---|
| `organizationId` (FK, cascade) · `conversationId` (FK, cascade) | kiracı + konuşma |
| `messageId` | kaynak misafir mesajı (düz kimlik, FK yok — `RiskEvent` emsali) |
| `requestIndex` | mesaj içindeki ilk görülme sırası (yalnız görüntü sırası) |
| `kind` | kapalı küme: anlama katmanının niyetleri (`wifi`, `payment_invoice`, `complaint_issue`… `other` dahil) |
| `sensitivity` | `none` · `sensitive` · `emergency` — yalnız YÜKSELİR |
| `riskType` | hassaslığın ilk gerekçesi (kapalı küme etiket) ya da boş |
| `sources` | tespit eden katmanlar (kapalı küme: `lexical`, `understanding`, `reply_model`) |
| `status` | `open` · `pending_host` · `answered` · `withdrawn` · `superseded` · `done` ("ev sahibi yazdı" SAKLANMAZ, türetilir) |
| `notifiedAt` | ev sahibine acil e-posta — atomik claim (gönderilemezse geri alınır, sonraki geçiş yeniden dener) |
| `answeredByMessageId` · `resolvedAt` | cevap/kapanış izi |

Tekillik `(conversationId, messageId, kind)`: bir mesajda her tür BİR öğe. İki geçiş aynı öğeyi BİRLEŞTİRİR (senkron uyarı
geçişi yalnız kelime ağını, cevap geçişi anlama katmanını görür; sıra sonucu değiştirmez — hassaslık yalnız yükselir).
İndeks `(organizationId, status)` + `(conversationId, status)`. KVKK: metin taşımaz; konuşma silinince cascade; saklama
süresi sonunda misafir-kaynaklı olarak silinir (süpürge kapsamı testine eklenir). Kiracı yalıtımı: her okuma
`organizationId` ile (davranışsal test). Konuşma birleştirme (dedupe) yeni `conversationId` modelini envanterde görür →
öğeler silmeden önce saklanan konuşmaya taşınır.

**Kodda (bayrak kapalı, çağıranı henüz yok):** saf çekirdek `src/lib/conversation-items/core.ts` (kapalı kümeler, birleşim,
yaşam döngüsü) · tur çıkarımı `extract.ts` · kelime ağı çok etiket `detectRiskTypes` (`fallback.ts`, `detectRiskType` ile
tek tablo) · anlama katmanı öğe kipi (`understanding-schema.ts` / `understand.ts`: istek başına `message`, `withdrawn`
listesi; karar noktası `kb-retrieve.ts`; kapalıyken şema/istem/önbellek bayt bayt eski).

## 3. Öğe çıkarımı — birleşim değişmezi ÖĞE kapsamında

Cevapsız her misafir mesajı öğelere bölünür:
- **Anlama katmanı** (canlı): istek başına niyet; bayrak açıkken şemaya istek başına `message` (hangi cevapsız mesaj)
  eklenir — bayrak kapalıyken istem ve şema BAYT BAYT aynı.
- **Kelime ağı** (mesaj başına, kesin): `detectRiskType` + şikâyet/iade/insan talebi. Etiket, mesajın içindeki uygun
  niyetli isteğe atfedilir (platform dışı ödeme → `payment_invoice`, şikâyet → `complaint_issue`…); hiçbir isteğe
  atfedilemezse MESAJIN TAMAMI hassas (bir katmanın "istek yok"u ötekinin isteğini silemez).
- **Cevap modeli** (tur düzeyi `riskType`): hassas öğenin etiketiyle aynıysa ona atfedilir; atfedilemeyen yüksek riskli
  etiket bugünkü gibi cevabın tamamını tutar (güvenli yön).
- **Tur düzeyinde kalanlar** (öğeye bölünmez): enjeksiyon (metni isteme giren turda hiçbir cevap gitmez) ve acil durum
  (bugünkü acil yol).
- **Emin olunmayan tur öğeye BÖLÜNMEZ → bugünkü konuşma düzeyi kapı** (`extract.ts`): anlama katmanı öğe kipinde sonuç
  vermedi / düştü · bir cevapsız mesajı görmedi (5'ten fazla) ya da tamamını okumadı (1.000 karakter − 100 maske payı) ·
  bir istek mesaja eşlenemedi · bir mesaja hiç istek atfedilmedi · istek tavanına (5) dayandı. Belirsizlik güvenli değildir.
- **Vazgeçme**: katman vazgeçilen isteğin niyetini VE geçtiği mesajı söyler (`0` = önceki, cevaplanmış konuşma). Böylece
  "[1] 12'de gelebilir miyiz? [2] Boşverin, 15'te geleceğiz" ile "Boşverin eskisini, 13'te olur mu?" ayrışır. Geçersiz kayıt
  düşer (vazgeçme bir öğeyi KAPATIR; emin olunmayan kayıt kapatmaz). Acil öğe asla.

## 4. Akış (bayrak açıkken)

1. Öğeler çıkarılır; acil öğe varsa → bugünkü acil yol (Sorunlu + e-posta), başka hiçbir şey değişmez.
2. Hassas öğeler `pending_host` (sessiz) + acil e-posta; konuşma "Sorunlu" OLMAZ.
3. Güvenli öğe varsa cevap modeli çağrılır; isteme "şu istekler ev sahibine bırakıldı — cevap verme, değinme" bloğu
   girer; model cevapladığı öğeleri beyan eder (`answeredItems`, strict). Kapı: tutulan öğeye değinen / beyansız cevap
   gitmez; ödeme öğesi tutuluyken cevapta ödeme yöntemi sözcüğü varsa gitmez (kelime yedeği).
4. Cevap gidince yalnız cevaplanan öğeler `answered`.
5. Sonraki turda anlama katmanı "vazgeçti" derse öğe `withdrawn` (acil hariç).
6. Ev sahibi yazınca açık öğeler `host_replied` — okuma anında TÜRETİLİR (kaçan bir yazma yolu olamaz).

Bugünkü konuşma düzeyi bekleyen tarama (şikâyet/iade/erken ayrılma/insan talebi + üç etiket) bayrak açıkken bu öğe
kuralına devredilir. QR yolu zaten mesaj başına (devir metni bugünkü gibi); öğeler QR'da da yazılır (görünürlük).

## 5. Ölçüm (açmadan önce, ~1-2 $, kurucu onayı alındı)

Gerçek model, bayrak açık: IBAN→Wi-Fi · aynı mesaj · şikâyet→otopark · acil→Wi-Fi · vazgeçme · ev sahibi yazdı ·
çok dilli ikizler. Ölçü: tutulan öğeye değinen cevap = 0 (sızıntı), güvenli öğenin cevaplanma oranı, acilde otomatik
cevap = 0. Sonuç örnekleriyle kurucuya; açma kararı kurucuda.

## 6. Dilimler

a) şema + saf durum makinesi + birleşim kuralı (test) · b) çıkarım + kalıcılık · c) akış + kapı (bayrak) · d) ev sahibi
görünümü · e) ücretli ölçüm → kurucu. Her dilim kırmızı-önce + mutasyon + tam kapılar.

## 7. `rule_violation` nereden geliyor? — mülke özgü politika önerisi (kurucu sorusu 09-26, ONAY BEKLİYOR)

**Bugün (kodda gösterildi):** `rule_violation` mülkün kuralından DEĞİL, iki GLOBAL kelime listesinden üretilir
(`src/lib/ai/fallback.ts` `RULE_VIOLATION_PHRASES` — parti, evcil hayvan, ek misafir, sigara — ve
`OVERSTAY_REFUSAL_PHRASES`); eşleşme katlanmış metinde DÜZ ALT DİZE (`includesAnyFold`). Mülkün ev kuralına, olumsuzlamaya,
kimin yaptığına bakmaz. Cevap modeli de kendi `riskType` etiketini verebilir (istem Bölüm 4; bilgi tabanındaki kuralı görür
ama karar modelin). Etki yalnız TUTMAK (asla izin vermez): kanal kapısı cevapsız mesajlardan birinde görürse otomatik
cevap gitmez.

**Ölçüm (19 mesaj, `tests/unit/detect-risk-types.test.ts` karakterizasyon bloğu):** 19'unun 19'u `rule_violation` —
gerçek niyetli 3'ü ve niyetsiz 16'sı: "Our party of 4 will arrive around 3pm", "partial refund" ("parti" alt dizesi),
"Parti yapmayacağız", "Komşular parti yapıyor", "Is it pet friendly?", "Köpeğimizi evde bırakıp geliyoruz"…

**Öneri (anlam ile kural ayrılır):**
1. Anlama katmanı her istek için KONU (parti/etkinlik · ek misafir · evcil hayvan · sigara · çıkmayı reddetme · yok) ve
   TUTUM (izin istiyor · niyet bildiriyor · kuralı soruyor · olumsuzluyor · başkasından söz ediyor) çıkarır.
2. Mülke özgü YAPILANDIRILMIŞ ev kuralı (ev sahibi mülk sayfasında girer): her konu için "izinli · yasak · bana sor".
   (Migration + arayüz.)
3. Karar KODDA: konu yok / olumsuzluyor / başkasından söz → politika öğesi YOK · kuralı soruyor + kural girili → cevap
   kuraldan · izin/niyet + izinli → normal cevap · izin/niyet + yasak → **kurucu kararı** · "bana sor" ya da girilmemiş →
   ev sahibine (bugünkü gibi tutulur). Kelime listesi yalnız anlama katmanı yokken yedek.

| Misafir yazar (kural: parti yasak, evcil hayvan izinli) | Bugün | Öneriyle |
|---|---|---|
| "Our party of 4 will arrive around 3pm" | otomatik cevap yok | giriş saati cevaplanır |
| "Parti yapmayacağız, sessiz aile tatili" | otomatik cevap yok | normal cevap |
| "Komşular parti yapıyor, gürültü var" | "kural ihlali" etiketi | şikâyet olarak ev sahibine |
| "Evde parti yapmak yasak mı?" | otomatik cevap yok | "Evde parti ve etkinlik yapılmıyor." |
| "Is it pet friendly?" | otomatik cevap yok | "Evcil hayvan kabul ediliyor." (şart varsa kuraldan) |
| "Bu akşam parti yapacağız" | otomatik cevap yok + ev sahibine | kurucu kararı (kuralı bildiren otomatik cevap + bildirim, ya da yalnız ev sahibi) |
