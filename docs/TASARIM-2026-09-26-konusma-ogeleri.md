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

Ev sahibi görünümü: konuşma listesinde "1 açık iş" rozeti; konuşma içinde "Açık işler: 🟠 Ödeme yöntemi isteği · ✅ Wi-Fi
cevaplandı"; panelde "Dikkat Gerektirenler" satırı. Host Karar Motoru (`DecisionRequest`, ev sahibinin kararı + final
cevap) AYRI yapıdır; bu öğeler onun girdisi olur.

## 2. Veri modeli (migration 56, yeni tablo — dolu tabloya dokunmaz)

`ConversationItem` — misafirin bir mesajındaki TEK istek/soru. METİN YOK (PII yok): yalnız kimlikler + kapalı küme kodlar.

| Alan | Açıklama |
|---|---|
| `organizationId` (FK, cascade) · `conversationId` (FK, cascade) | kiracı + konuşma |
| `messageId` | kaynak misafir mesajı (düz kimlik, FK yok — `RiskEvent` emsali) |
| `requestIndex` | mesaj içindeki sıra (0'dan) |
| `kind` | kapalı küme: anlama katmanının niyetleri (`wifi`, `payment_invoice`, `complaint_issue`…) + `other` |
| `sensitivity` | `none` · `sensitive` · `emergency` |
| `riskType` | hassaslığın gerekçesi (yüksek riskli etiket kümesi) ya da boş |
| `sources` | tespit eden katmanlar (kapalı küme: `lexical`, `understanding`, `reply_model`) |
| `status` | `open` · `answered` · `pending_host` · `withdrawn` · `superseded` · `host_replied` · `done` |
| `answeredByMessageId` · `resolvedAt` | cevap/kapanış izi |

Tekillik `(conversationId, messageId, requestIndex)` (tekrar denemede çift öğe yok). İndeks `(organizationId, status)`.
KVKK: metin taşımaz; konuşma silinince cascade; saklama süresi sonunda misafir-kaynaklı olarak silinir (süpürge kapsamı
testine eklenir). Kiracı yalıtımı: her okuma `organizationId` ile (davranışsal test).

## 3. Öğe çıkarımı — birleşim değişmezi ÖĞE kapsamında

Cevapsız her misafir mesajı öğelere bölünür:
- **Anlama katmanı** (canlı): istek başına niyet; bayrak açıkken şemaya istek başına `message` (hangi cevapsız mesaj)
  eklenir — bayrak kapalıyken istem ve şema BAYT BAYT aynı.
- **Kelime ağı** (mesaj başına, kesin): `detectRiskType` + şikâyet/iade/insan talebi. Etiket, mesajın içindeki uygun
  niyetli isteğe atfedilir (platform dışı ödeme → `payment_invoice`, şikâyet → `complaint_issue`…); hiçbir isteğe
  atfedilemezse MESAJIN TAMAMI hassas (bir katmanın "istek yok"u ötekinin isteğini silemez).
- **Cevap modeli** (tur düzeyi `riskType`): hassas öğenin etiketiyle aynıysa ona atfedilir; atfedilemeyen yüksek riskli
  etiket bugünkü gibi cevabın tamamını tutar (güvenli yön).
- Anlama katmanı düşerse / öğe çıkarılamazsa: bugünkü davranış (mesaj tek öğe, kapı aynen).

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
