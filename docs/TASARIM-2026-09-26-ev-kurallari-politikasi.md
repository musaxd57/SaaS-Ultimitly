# Mülke özgü ev kuralları — anlam + kural politikası · öneri (2026-09-26, ONAY BEKLİYOR)

> Kurucu kararları (09-26): **(1)** "Evet, anlam + mülk kuralı" — parti/evcil hayvan/sigara gibi konularda ihlal hükmü
> global kelime listesinden değil, mülkün GERÇEK kuralından. **(2)** "Mesela evlerin içinde sigara yasak, adam 'sigara
> içebilir miyim' diyor: kuralı söylesin, yasak olduğunu söylesin, yeterli." **(3)** "İkisi birden" — kuralları AI bilgi
> tabanından ÖNERİR, ev sahibi ONAYLAR; onaylanmamış kural = "bana sor".
> Bu belge bir ÖNERİDİR; kod yok. Migration 57 ister (yeni tablo, dolu tabloya dokunmaz).

## 1. Bugün (kodda ölçüldü)

`rule_violation` iki GLOBAL kelime listesinden, düz alt dize eşleşmesiyle üretilir (`fallback.ts` `RULE_VIOLATION_PHRASES`,
`OVERSTAY_REFUSAL_PHRASES`). Mülkün kuralına, olumsuzlamaya, niyete bakmaz. Ölçüm: konu sözcüğü geçen 19 mesajın 19'u
tetikliyor, 16'sında misafir o şeyi YAPACAĞINI söylemiyor. Etki yalnız otomatik cevabın tutulmasıdır (güvenli yön) ama
gereksiz: "Our party of 4 will arrive around 3pm" otomatik cevap alamıyor; "Can I get a partial refund?" iade + kural
etiketi alıyor ("parti" alt dizesi). Karakterizasyon: `tests/unit/detect-risk-types.test.ts`.

## 2. Önerilen yapı

**A. Kural kaydı (migration 57, yeni tablo `HouseRule`):** mülk başına konu başına bir satır.
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
| `asks_permission` | AI kuralı söyler, gider ("Evde sigara içmek yasaktır.") | AI izni kuraldan söyler, gider | Ev sahibinde açık iş (bugünkü gibi tutulur) |
| `announces` | ❓ **karar sizin** (aşağıda) | normal cevap | Ev sahibinde açık iş |
| `asks_info` | kural söylenir, gider | kural söylenir, gider | bilgi tabanında yazıyorsa cevap; yoksa açık iş |
| `not_about_guest` | kural devreye girmez (normal cevap) | aynı | aynı |

Kelime listesi YEDEK kalır: anlama katmanı düşerse bugünkü gibi tutar (belirsizlik güvenli değildir).

## 3. Örnekler (önce → sonra)

- "Sigara içebilir miyim?" · kural onaylı YASAK → **önce:** tutulur, ev sahibi yazar · **sonra:** "Evde sigara içmek
  yasaktır; balkonda içebilirsiniz" (yalnız bilgi tabanında balkon yazıyorsa) — otomatik gider.
- "Köpeğimizi getirebilir miyiz?" · kural onaylı İZİNLİ → **sonra:** "Evcil hayvan kabul ediyoruz." — gider.
- "Köpeğimizi getirebilir miyiz?" · kural YOK → **sonra da:** ev sahibinde açık iş (AI izin vermez).
- "Our party of 4 will arrive around 3pm" → **önce:** tutulur (kelime "party") · **sonra:** `not_about_guest` → giriş
  saati sorusu normal cevaplanır.
- "Parti yapmayacağız, sessiz bir aile tatili" → **sonra:** kural devreye girmez.
- "Can I get a partial refund?" → **sonra:** yalnız iade (hassas, ev sahibinde); "parti" etiketi yok.
- "Bu akşam parti yapacağız" · kural onaylı YASAK → ❓ aşağıdaki soru.

## 4. Kurallar nereden gelir ("ikisi birden")

Mülk sayfasında "Ev kuralları" kartı: AI bilgi tabanındaki ev kuralı metinlerinden konu başına ÖNERİ çıkarır (kalem
değişince bir kez, ücretli çağrı — mülk başına kuruşlar), ev sahibi "Onayla / Değiştir / Reddet" der. Onaylanmayan
öneri hiçbir karara girmez ("bana sor"). Ev sahibi kuralı elle de girebilir.

## 5. Kurucuya sorular

1. Sigara örneğindeki "yasal olduğunu söylesin" → **"yasak olduğunu söylesin"** mi demek istediniz?
2. Misafir YASAK bir şeyi yapacağını söylerse ("Bu akşam parti yapacağız", kural yasak): AI kuralı hatırlatıp göndersin
   mi, ayrıca size de haber gitsin mi (açık iş + e-posta)? Önerim: **ikisi birden** — kural hatırlatması gider, siz de
   haberdar olursunuz (ihlal ihtimali ev sahibinin işidir).
3. Açma sırası: migration 57 (taze yedek + onay) → kural kartı → gölge ölçüm (anlam alanları kayda, karar eski) →
   ücretli kör ölçüm → sizin onayınız. Uygun mu?
