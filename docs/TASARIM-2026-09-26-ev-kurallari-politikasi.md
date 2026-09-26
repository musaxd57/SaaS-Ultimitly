# Mülke özgü ev kuralları — anlam + kural politikası (2026-09-26, ONAYLANDI — dilim dilim uygulanıyor)

> Kurucu kararları (09-26): **(1)** "Evet, anlam + mülk kuralı" — parti/evcil hayvan/sigara gibi konularda ihlal hükmü
> global kelime listesinden değil, mülkün GERÇEK kuralından. **(2)** "Mesela evlerin içinde sigara yasak, adam 'sigara
> içebilir miyim' diyor: kuralı söylesin, yasak olduğunu söylesin, yeterli." **(3)** "İkisi birden" — kuralları AI bilgi
> tabanından ÖNERİR, ev sahibi ONAYLAR; onaylanmamış kural = "bana sor".
> **(4) 09-26 cevap:** "Evet, güzel bir dille yasak olduğunu da belirtsin, kızar gibi değil" → yasak kural nazik ve açık
> söylenir (örnek: "Evin içinde sigara içilmesine izin verilmiyor, anlayışınız için teşekkür ederiz."); azarlama / uyarı
> tonu / yaptırım cümlesi YOK. Metin KODDAN kurulur (doğrulanmış kural + 6 dil), model serbest yazmaz.
> **(5) 09-26 cevap (§5 soru 3 ve 4):** "mantıklıysa yapalım, en mantıklı şekilde" → açma sırası ve "izinli ama ev sahibinde
> kalan konular" önerildiği gibi (↓§5). **Uygulamada migration GEREKMEDİ (↓§6 dilim 2):** kurallar erken giriş kuralıyla
> aynı depoda (`AutomationRule`, mülk başına tek satır) tutulur — yeni tablo, yedek ve onay kapısı yok, geri alınabilir.

## 1. Bugün (kodda ölçüldü)

`rule_violation` iki GLOBAL kelime listesinden, düz alt dize eşleşmesiyle üretilir (`fallback.ts` `RULE_VIOLATION_PHRASES`,
`OVERSTAY_REFUSAL_PHRASES`). Mülkün kuralına, olumsuzlamaya, niyete bakmaz. Ölçüm: konu sözcüğü geçen 19 mesajın 19'u
tetikliyor, 16'sında misafir o şeyi YAPACAĞINI söylemiyor. Etki yalnız otomatik cevabın tutulmasıdır (güvenli yön) ama
gereksiz: "Our party of 4 will arrive around 3pm" otomatik cevap alamıyor; "Can I get a partial refund?" iade + kural
etiketi alıyor ("parti" alt dizesi). Karakterizasyon: `tests/unit/detect-risk-types.test.ts`.

## 2. Önerilen yapı

**A. Kural kaydı (ilk öneri: migration 57 / yeni tablo `HouseRule`; UYGULANAN: migration'sız, erken giriş kuralının deposu
`AutomationRule` — mülk başına TEK satır, konu listesi JSON'da, ↓§6 dilim 2):** mülk başına konu başına bir kural.
- `topic` kapalı küme: `party_event` · `smoking` · `pets` · `extra_guests` · `quiet_hours` · `visitors`.
- `policy`: `allowed` · `forbidden` · `ask_host` (varsayılan — kural yoksa da bu).
- `status`: `suggested` (AI önerdi) · `confirmed` (ev sahibi onayladı) · `rejected`. **Yalnız `confirmed` karar verir.**
- Kaynak kanıtı: önerinin dayandığı bilgi tabanı kalemi (kimlik + güncelleme anı); kalem değişince öneri yeniden sorulur.

**B. Anlam (anlama katmanı, mevcut çağrıya iki alan):** her istek için `rule_topic` (yukarıdaki küme ya da `none`) ve
`stance`: `asks_permission` (izin istiyor) · `announces` (yapacağını söylüyor) · `asks_info` (kuralı soruyor) ·
`not_about_guest` (başkası / grup anlamında "party" / olumsuzlama / dışarıda mekân).

**C. Karar KODDA (tablo):**

| Durum | Onaylı kural `forbidden` | Onaylı kural `allowed` | Kural yok / `ask_host` / yalnız öneri |
|---|---|---|---|
| `asks_permission` | AI kuralı nazikçe söyler, gider ("Evin içinde sigara içilmesine izin verilmiyor, anlayışınız için teşekkür ederiz.") | AI izni kuraldan söyler, gider | Ev sahibinde açık iş (bugünkü gibi tutulur) |
| `announces` | nazik hatırlatma gider **+** ev sahibine açık iş + e-posta (kurucu 09-26 "İkisi birden") | normal cevap | Ev sahibinde açık iş |
| `asks_info` | kural söylenir, gider | kural söylenir, gider | bilgi tabanında yazıyorsa cevap; yoksa açık iş |
| `not_about_guest` | kural devreye girmez (normal cevap) | aynı | aynı |

Kelime listesi YEDEK kalır: anlama katmanı düşerse bugünkü gibi tutar (belirsizlik güvenli değildir).

## 3. Örnekler (önce → sonra)

- "Sigara içebilir miyim?" · kural onaylı YASAK → **önce:** tutulur, ev sahibi yazar · **sonra:** "Evin içinde sigara
  içilmesine izin verilmiyor, anlayışınız için teşekkür ederiz. Balkonda içebilirsiniz." (balkon cümlesi yalnız bilgi
  tabanında yazıyorsa) — otomatik gider.
- "Köpeğimizi getirebilir miyiz?" · kural onaylı İZİNLİ → **sonra:** "Evcil hayvan kabul ediyoruz." — gider.
- "Köpeğimizi getirebilir miyiz?" · kural YOK → **sonra da:** ev sahibinde açık iş (AI izin vermez).
- "Our party of 4 will arrive around 3pm" → **önce:** tutulur (kelime "party") · **sonra:** `not_about_guest` → giriş
  saati sorusu normal cevaplanır.
- "Parti yapmayacağız, sessiz bir aile tatili" → **sonra:** kural devreye girmez.
- "Can I get a partial refund?" → **sonra:** yalnız iade (hassas, ev sahibinde); "parti" etiketi yok.
- "Bu akşam parti yapacağız" · kural onaylı YASAK → **sonra:** "Evde parti ve etkinlik yapılmasına izin verilmiyor, anlayışınız
  için teşekkür ederiz." gider **ve** ev sahibine açık iş + e-posta (kurucu 09-26).

## 4. Kurallar nereden gelir ("ikisi birden")

Mülk sayfasında "Ev kuralları" kartı: AI bilgi tabanındaki ev kuralı metinlerinden konu başına ÖNERİ çıkarır (kalem
değişince bir kez, ücretli çağrı — mülk başına kuruşlar), ev sahibi "Onayla / Değiştir / Reddet" der. Onaylanmayan
öneri hiçbir karara girmez ("bana sor"). Ev sahibi kuralı elle de girebilir.

## 5. Kurucuya sorular

1. ~~Sigara örneğindeki "yasal olduğunu söylesin" → "yasak olduğunu söylesin" mi?~~ **CEVAPLANDI 09-26:** evet, yasak
   olduğu nazik bir dille söylenir (kızar gibi değil).
2. **CEVAPLANDI 09-26 — "İkisi birden":** kural nazik hatırlatması misafire gider + ev sahibine açık iş ve e-posta
   (ihlal ihtimali ev sahibinin işi). Soru metni: Misafir YASAK bir şeyi yapacağını söylerse ("Bu akşam parti yapacağız", kural yasak): AI kuralı hatırlatıp göndersin
   mi, ayrıca size de haber gitsin mi (açık iş + e-posta)? Önerim: **ikisi birden** — kural hatırlatması gider, siz de
   haberdar olursunuz (ihlal ihtimali ev sahibinin işidir).
3. **CEVAPLANDI 09-26 ("en mantıklı şekilde"):** açma sırası migration 57 (taze yedek + onay) → kural kartı → gölge ölçüm
   (anlam alanları kayda, karar eski) → ücretli kör ölçüm → kurucu onayı.
4. **CEVAPLANDI 09-26 (aynı cevap):** "İzinli" kural otomatik izin cümlesine YALNIZ evet/hayır söylenebilen konularda döner
   (sigara, evcil hayvan, ziyaretçi). Parti (platformların genel parti yasağı), ek misafir (kaç kişi? ücret?) ve sessiz saatler
   (hangi saat?) "izinli" olsa da ev sahibinde kalır. Örnek: "6 kişi kalabilir miyiz?" + ek misafir İZİNLİ → AI "kabul
   ediyoruz" DEMEZ, ev sahibinde açık iş (saf çekirdekte zaten böyle, pinli).

## 6. Uygulama durumu

- **Dilim 1 — saf çekirdek (09-26, `src/lib/house-rules/core.ts`, çağıranı YOK, davranış değişmez):** kapalı kümeler,
  "yalnız onaylı kural" + çelişen onaylılar = bana sor, §2.C karar tablosu, 6 dilde koddan metin (yasak cümlesi teşekkür
  eder; azarlama / yaptırım sözcüğü yok; çıktı vetosu + "bilgim yok" + dil kapısı temiz). 19 test, mutasyon 17/17.
- **Dilim 2 — depo + kayıt rotası + mülk sayfası kartı (09-26, migration YOK):** `src/lib/house-rules/store.ts` (erken giriş
  kuralıyla aynı depo ve kilit sırası: önce mülk satırı; eşzamanlı kayıt tek satır; mülk silinmişse yazılmaz; bozuk satır = kural
  yok = her konu "bana sor"), `PUT /api/properties/[id]/house-rules` (yönetici; personel 403; başka kiracı 404; ev sahibinin seçimi
  ONAY; denetim kaydı konu adıyla, seçim değeri olmadan), mülk silme kuralı aynı işlemde siler, kart "Ev kuralları" (6 konu ×
  İzinli / Yasak / Bana sor). Kart ve rota `HOUSE_RULES_CARD_ENABLED=1` iken var (varsayılan KAPALI); kart "yapay zekâ bu
  kuralları henüz kullanmıyor" der — karar hâlâ YOK, davranış değişmez.
- Sonraki: anlama katmanına `rule_topic`/`stance` (bayrak kapalı, istem bayt bayt aynı) → kapıya bağlama (gölge: kayıt,
  karar eski) → ücretli kör ölçüm → kurucu onayı. Yapay zekâ önerisi (bilgi tabanından `suggested`) ayrı dilim.
