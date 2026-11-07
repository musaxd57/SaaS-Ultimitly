# V2 — Para etkisi, ilk dilim (2026-09-24)

> Yol planı: V2 Exception Feed ("Dikkat Gerektirenler") **+ money impact**. Değişmez 15: para etkisi sahte
> kesinlik üretmez — varsayım, kanıt, güven ve **aralık** taşır.

## 1. Neden yalnız çift rezervasyon

Veri denetimi (ajan, 09-24; kodla doğrulandı) bugün savunulabilir tek tutarın bu olduğunu gösterdi:

| Kaynak | Durum |
|---|---|
| `Reservation.totalAmount` | Pratikte dolmuyor: sağlayıcıda `financials:read` yok, iCal tutar taşımaz, CSV'nin ekranı yok. |
| `Reservation.currency` | Bilinmediğinde **uydurma "EUR"** yazılıyor (mevcut bir hata; ayrı iş). |
| Geç çıkış teklif metni | Serbest metin; fiyat güvenilir biçimde ayrıştırılamaz. |
| Boş gece / iptal / cevapsız mesaj | Tutar formülü ya savunulamıyor ya da doğrulanmış müsaitlik ister (V7 Revenue Brain). |

Bu yüzden ilk dilim **yalnız gerçek çakışma** satırında tutar gösterir ve tutarın tek kaynağı **ev sahibinin
kendi girdiği tipik gecelik fiyat aralığıdır** (host verisi; kanal verisi değil → değişmez 14'ün kanal-veri
politikasına girmez, "gelir/ödeme verinize erişmeyiz" sözünü bozmaz).

## 2. Formül

Çakışan iki konaklamadan biri taşınmak zorundadır:

* **alt** = çakışan gece × aralığın altı (yalnız çakışan geceler kaybedilir)
* **üst** = etkilenen en uzun konaklamanın gece sayısı × aralığın üstü (o konaklamanın tamamı iptal olursa)
* Rakamlar DIŞA doğru 2 anlamlı basamağa yuvarlanır (aralık daralmaz). Platform cezaları ve misafiri taşıma
  masrafı **dahil değil** (varsayım kodu olarak taşınır).
* Güven: `medium`; onay bekleyen talep ya da kanıtsız kayıtlar varsa `low`. **Asla `high`.**
* Bilinmiyor (`no_rate` · `rate_stale` 180 gün · `rate_invalid` · `duplicate_likely`) → hiçbir sayısal alan yok.

Kod: `src/modules/intelligence/money/impact.ts` (saf) · `money/rates.ts` (okuma/yazma) ·
`incidents/attention.ts` (satıra ekleme; aralık yalnız çakışma varsa okunur) · `components/attention-panel.tsx`.

## 3. Aralığın saklanması (migration YOK)

`PropertyMemory` satırı: `source: "human"`, `sourceRef: "nightly_rate_range"`, `kind: "fact"`,
`category: "pricing"`, `observedAt` = girildiği an, `expiresAt` = +180 gün, `humanOverride*` = kim girdi.
Benzersiz anahtar (propertyId, source, sourceRef) → mülk başına tek satır; kaldırma satırı `retired` yapar.
KB eşitlemesi ve örüntü yenilemesi yalnız kendi kaynaklarına dokunur. "Mülk Hafızası" kartı olgu listesinde
yalnız KB kaynaklıları gösterir. Veri dışa aktarımı (`hostEnteredFacts`) host girişli kayıtları içerir.

Rota: `PUT/DELETE /api/properties/[id]/nightly-rate` (sahip/yönetici; başka kiracının mülkü 404; tam sayı,
alt < üst, üst ≤ 1.000.000, TRY/EUR/USD/GBP; denetim kaydı alan adıyla, değer olmadan).

## 4. Yapay zekâ ile ilişkisi

Aralık **hiçbir istem/cevap yolunda okunmaz** — misafire fiyat söylemek ayrı bir üründür (istem zaten fiyat
söylemeyi yasaklıyor). Mekanik pin: `src/lib/ai`, misafir rotası, `automation.ts`, `guest-chat.ts` para
modülünü ve anahtarı içermez (`tests/unit/money-impact.test.ts`).

## 5. Bilinçli olarak YAPILMAYANLAR (kurucu kararı gerektirir)

1. Portföy toplamı ("Bugün risk altında ₺…") ve paraya göre sıralama — önem kanıta göre kalır.
2. Rezervasyon tutarlarının kullanımı — kamuya verilen söz, para birimi kökeni (migration) ve kanal
   şartları incelemesi gerekir.
3. Boş gece / geç çıkış satışı gibi GELİR fırsatları — doğrulanmış müsaitlik ister (V7).
4. 180 günlük bayatlık eşiği ürün kararıdır; değiştirilebilir.
5. Tipli kolonlara taşıma (migration + onay).
