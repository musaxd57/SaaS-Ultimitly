# zod 3 → 4 geçişi (kurucu kararı 4.15, 2026-10-28)

> Kurucu (karar masası 4.15, aynen): "tam bilmiyorum önerin mantıklı gibi açılmadan önce herşeyi halledelim o ayrı güncellemler anlamında".
> Gerekçe: zod GHSA-mrhx-c7xc-m3w5 (yüksek; sınırlanmış koleksiyonda dev girdiyle bellek tüketme) yalnız 4.6.6+'da düzeltildi, 3.x'e yama yok.
> Bizde ulaşılamazdı (istek gövdeleri zod'a girmeden 64 KB'ta kesiliyor) ama triaj 2026-12-31'de doluyordu.

## Sonuç

- `zod` 3.25.76 → **4.6.7**. `@anthropic-ai/sdk` zod'u yalnız isteğe bağlı eş-bağımlılık olarak alıyor (`^3.25.0 || ^4.0.0`) ve zod
  yardımcılarını kullanmıyoruz → paylaşılan tek kopya 4.6.7 (`npm ls zod`).
- Zafiyet kapısı (`npm run audit:check`): üretim 4 danışma / 4 triaj kaydı → yeşil. zod kaydı `security/audit-baseline.json`dan silindi.
- Tip denetimi yalnız iki yeri gösterdi (Türkçe hata haritası imzası, `z.literal(…, { errorMap })`). **Asıl riskler tip denetiminin
  YAKALAMADIĞI davranış farklarıydı** — aşağıda üçü veri / ürün hatası olurdu.

## Tip denetiminin yakalamadığı üç gerileme (hepsi kırmızı-önce testle bulundu, düzeltildi)

| # | Yer | zod 4 farkı | Düzeltilmeseydi | Düzeltme |
|---|---|---|---|---|
| Z1 | `PATCH /api/properties/[id]` (`propertySchema.partial()`) | `.partial()` ile isteğe bağlı yapılan alanın `.default()`u artık UYGULANIR | Yalnız mülk adını değiştiren ev sahibinin giriş / çıkış saati `15:00 / 11:00`'a, temizlik payı `120`'ye EZİLİRDİ (misafire yanlış saat gider); denetim kaydı 3 alanı "değişti" yazardı | `patchSchemaOf` (validators.ts): varsayılanı sök, sonra isteğe bağlı yap; rota `propertyPatchSchema` kullanır |
| Z2 | `PATCH /api/kb/[id]` (`kbSchema.partial()`) | aynı | Bilgi kaleminin yalnız metnini düzelten ev sahibinin KAPATTIĞI kalem yeniden AÇILIRDI (kapatılmış bilgi misafire gider); kategori `general`, dil `tr` olurdu | `kbUpdateSchema = patchSchemaOf(kbSchema)…` |
| Z3 | Mülk sarf profili (`z.record(z.enum(…))`) | Enum anahtarlı `z.record` BÜTÜN anahtarları zorunlu kılar | Form yalnız 0'dan büyük kalemleri gönderdiği için tek mülkün sarf profili neredeyse hiç kaydedilemezdi (400) | `z.partialRecord` |

Testler: `tests/integration/zod4-partial-patch.test.ts` (7 test; düzeltmesiz koşuda 4 kırmızı — tam bu üç hata) + kaynak pini
(`tests/unit/zod-tr.test.ts`: doğrudan `.partial(` yalnız `patchSchemaOf` içinde; enum anahtarlı `record(` yok; tarama anti-vakum).

## Türkçe hata haritası

- zod 4 sorun kodlarına taşındı (`invalid_enum_value` + literal → `invalid_value`; `invalid_string` → `invalid_format`; `invalid_date` →
  `invalid_type`/`date`; `type` → `origin`; eksik alan `input === undefined`). Kurulum `z.config({ customError })`.
- ⚠️ Eski "İngilizce kalmadı" testi yalnız zod 3'ün İngilizce kalıplarını arıyordu → zod 4'te harita HİÇ kurulmasa da geçerdi. Yasak
  kalıplara zod 4'ünkiler eklendi ("Too big", "Invalid input", "expected", "Unrecognized" …) + her sorun kodu için birebir metin testi.
- Var olan bir sızıntı da kapandı: `.int()` hatası ekrana "Geçersiz değer — integer bekleniyor." (zod 3) / "… int bekleniyor." (zod 4)
  basıyordu → "Geçersiz değer — tam sayı bekleniyor." Bilinmeyen tip adı artık ekrana basılmaz ("Geçersiz değer.").

## Fark testi (zod 3 ↔ zod 4, aynı girdiler)

Karalama düzeneği (repoya girmedi): HEAD'deki `validators.ts` + zod 3.25.76 ile çalışma ağacındaki `validators.ts` + zod 4.6.7 yan yana;
rota içi 8 şema (aynı kaynak) da dahil **24 şema, 114.882 girdi** (geçerli taban + alan başına ~150 değerlik palet + tohumlu rastgele çift /
üçlü bozma + bütün-girdi varyantları). API'nin gördüğü şekilde karşılaştırıldı: başarı, çıktı verisi (tanımsız anahtar AYRI işaretli),
`zodFieldErrors` alan → metin haritası.

- **Çıktı verisi farkı: 0** (tanımsız anahtarın varlığı dahil). `propertyPATCH` satırı zod 3 `.partial()` ↔ zod 4 `patchSchemaOf`:
  aynı — Z1/Z2 düzeltmesi zod 3 davranışını birebir geri getiriyor.
- **Başarı farkı: 2** — `version: 2^53+2` (karar ucu, eş zamanlılık sayacı) zod 4'te reddediliyor (`.int()` güvenli tam sayı). Gerçek
  değerler küçük; doğruluk iyileşmesi.
- **Hata metni farkları** (yalnız geçersiz girdide, hepsi bilinçli):

| Önce (zod 3) | Sonra (zod 4) | Neden kabul |
|---|---|---|
| Enum alanına yanlış TİPTE değer: "Geçersiz değer — 'urgent' \| 'standard' \| 'low' bekleniyor." | "Geçersiz seçim." | Haritanın kendi kuralı "seçenekler listelenmez"; zod 3'te bu yol kuralı deliyordu |
| Rezervasyon tarihi boş: "Geçerli bir tarih girin." | "Giriş tarihi gerekli" / "Çıkış tarihi gerekli" | Şemadaki özel metin zod 3'te hiç devreye girmiyordu (ölü metin); form boş tarihte `""` gönderir |
| Sarf profilinde bilinmeyen kalem: alan `supplyProfile.a` "Geçersiz seçim." | alan `supplyProfile` "Tanınmayan alan gönderildi." | İkisi de 400; metin daha doğru |
| "… integer bekleniyor." | "… tam sayı bekleniyor." | İngilizce sözcük sızıntısı |
| 2^53 üstü sayı: "en fazla 1440 olabilir." | "Değer çok büyük." | zod 4 güvenli tam sayı sınırını (9007199254740991) ekrana basmasın diye genel metin |

İlk fark koşusunda iki eşitleme daha bulundu ve zod 3 metnine döndürüldü: enum / literal alanına `null` → "Bu alan gerekli." (zod 4
"Geçersiz seçim." diyordu); sarf profili yanlış tip → "Geçersiz değer — nesne bekleniyor." (zod 4 tip adı `record`).

## Bilinen sınır

- Fark testi `validators.ts` + rota içi şemalar içindir (zod kullanan 10 dosyanın hepsi). İstemci tarafında zod yok.
