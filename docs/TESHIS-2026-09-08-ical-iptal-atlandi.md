# Teşhis — canlı iCal iptal denemesi "1 atlandı", rezervasyon Onaylı kaldı (2026-09-08)

> Bulgu (Codex, Chrome'dan doğrulandı): test mülkü `cmtsbfyh60001pk2qw9z048fj`; iptal dosyasının içeriği
> DOĞRU (`STATUS:CANCELLED`, aynı UID), buna rağmen senkron sonucu **"1 atlandı"** ve rezervasyon
> **Onaylı** kaldı. Bu belge nedeni koddan çıkarır, operatörün doğrulama adımlarını verir ve
> "Airbnb kaynak seçimi" sorusunu cevaplar. **Kaynak silinmez** (kurucu talimatı).

## 1. "atlandı" hangi dallardan gelir (kod: `src/lib/import/sync.ts`)
Senkron sayacı `skipped` yalnız şu dallarda artar:

| # | Dal | Koşul | Rezervasyona etkisi |
|---|---|---|---|
| 1 | geçersiz satır | ad/tarih eksik veya çıkış ≤ giriş | yazma yok |
| 2 | `erased` | KVKK tombstone'u bu UID'yi bloklar | yazma yok |
| 3 | `skip` (iptal dalı) | `STATUS:CANCELLED` var **ama** o kaynağa BAĞLI canlı satır yok | yazma yok |
| 4 | **`unchanged`** | satır zaten birebir aynı (kaynak, durum, tarihler, ad, not) | **yazma yok** |
| 5 | dedupe (P2002) | UID başka kaynağın satırında | yazma yok |
| 6 | satır hatası | DB hatası | yazma yok |

**Rezervasyonun Onaylı kalması + tam olarak 1 atlanması**, 3 ve 4'e uyar. İkisi arasındaki fark
belirleyicidir:

- **(4) `unchanged` → besleme hâlâ ESKİ (iptalsiz) içeriği veriyor.** Satır bu kaynağa bağlı, durum
  `confirmed`, tarih/ad aynı → hiçbir şey yazılmaz, `skipped++`. Sunucu iptal işaretini hiç görmemiştir.
- **(3) `skip` → besleme iptali veriyor ama satır bu kaynağa bağlı değil.** İptal dalı bilinçli olarak
  yalnız `calendarSourceId = <bu kaynak>` olan satırı iptal eder; sahipsiz (`NULL`) veya başka kaynağa ait
  satıra ASLA dokunmaz (`row.status !== "CANCELLED"` koşullu legacy araması). Bu kural, bayat bir dosyanın
  canlı bir aboneliğin kaydını devirmesini engeller.

## 2. En olası HİPOTEZ (kanıtlanmadı): Gist "Raw" bağlantısı REVİZYONA SABİT

> ⚠️ Codex düzeltmesi (09-08): aşağıdaki açıklama **hipotezdir**. Rezervasyonun `calendarSourceId`'sinin kaynağa
> eşit çıkması yalnız "sahiplik" ihtimalini ELER; beslemeden eski içerik geldiğini KANITLAMAZ. Kök neden ancak
> o bağlantıdan **gerçekten çekilen içerik** görülünce (metinde `STATUS:CANCELLED` var mı) kapanır — adımlar
> `docs/V1-KALAN-CANLI-DOGRULAMALAR-2026-09-08.md` §B.3. Ayrıca aynı çıktıyı veren başka atlama dalları da var
> (satır zaten iptalli · tombstone · geçersiz satır · dedupe · beslemenin o koşuda hiç okunamaması).
GitHub Gist iki farklı ham bağlantı üretir:

```
https://gist.githubusercontent.com/<kullanici>/<gist_id>/raw/<dosya>.ics              → HER ZAMAN en son sürüm
https://gist.githubusercontent.com/<kullanici>/<gist_id>/raw/<40_karakter_sha>/<dosya>.ics → O REVİZYONA SABİT
```

Gist sayfasındaki **Raw düğmesi ikincisini** (SHA'lı) verir. Kayıtlı kaynak SHA'lı bağlantıysa, Gist
düzenlense bile besleme sonsuza kadar ilk (iptalsiz) sürümü döndürür → her senkron `unchanged` → **"1
atlandı"**, rezervasyon Onaylı. Gözlenen tabloyla birebir uyuşan tek açıklama budur.

**Doğrulama (operatör, 30 saniye):**
1. Mülk sayfası → Kanal Takvimleri → kaynağın maskeli bağlantısında **40 karakterlik onaltılık dizi** var mı?
   Varsa neden budur.
2. Aynı bağlantıyı tarayıcıda aç: metinde `STATUS:CANCELLED` **görünmüyorsa** besleme eski sürümdedir.
3. DB tarafı (isteğe bağlı, salt okuma):
   ```sql
   SELECT r.id, r.status, r."calendarSourceId", r."sourceReference", cs.label, cs."lastStatus", cs."lastResult"
     FROM "Reservation" r
     LEFT JOIN "CalendarSource" cs ON cs.id = r."calendarSourceId"
    WHERE r."propertyId" = 'cmtsbfyh60001pk2qw9z048fj';
   ```
   `calendarSourceId` doluysa satır beslemeye bağlıdır → dal (4). NULL ise → dal (3).

## 3. Airbnb kaynak seçiminin iptale etkisi: YOK (kod-doğrulandı)
Etiket yalnız `channelFromLabel()` ile rezervasyonun `channel` alanını belirler ("Airbnb" → `airbnb`).
İptal dalı kanala **bakmaz**; tek ölçütü kaynak sahipliğidir (`calendarSourceId`). Yani "Airbnb" seçmek
iptalin işlenmesini engellemez.

⚠️ Ayrı bir yan etki (test mülkünde zararsız, bilinmeli): `channel = "airbnb"` satırlar yaşam-döngüsü
mesaj filtresini (`channel notIn ["ics","manual"]`) geçer; gerçek koruma `calendarSourceId` üzerinden
`automation.ts`'dedir. Sahte bir test kaydına mesaj gitmez.

## 4. Çözüm — kaynağı silmeden (kurucu şartı)
Kaynağın bağlantısını **güncelleyen bir uç bugün yok** (`/api/calendar-sources/[id]` yalnız DELETE).
Dolayısıyla besleme SHA'ya sabitse o kaynak üzerinden iptal akışı tamamlanamaz. Kaynak silinmeden iki yol:

1. **Dosyadan içe aktar (bu turda eklendi).** Mülk sayfası → Kanal Takvimleri → "Dosyadan içe aktar":
   `test-reservation.ics` → önizleme → aktar; sonra `test-reservation-cancelled.ics` → önizleme "İptal
   edilecek" → aktar. Bu yol dosya-sahipli satırı (kanal `ics`, `calendarSourceId` NULL) kendi kurar ve
   kendi iptal eder; **mevcut besleme kaydına dokunmaz** (önizlemede "takvim bağlantısına ait" der).
   Kurucunun canlı doğrulaması bu yolla tamamlanabilir.
2. **Beslemeyi düzelt:** Gist'te **SHA'sız** ham bağlantıyı kullanacak şekilde yeni bir kaynak eklenirse
   eski kaynak kayıtlı kalır (silinmez) ve yeni kaynak iptali işler. Bu, aynı ilan için iki kaynak demektir;
   `docs/GEREKSINIM-dogrudan-kanal-ve-ical-birlikte-yasama.md` kapsamında sahiplik kuralı gelene kadar
   önerilmez.

**Kalan iş (kayıt, bu turda yapılmadı):** (a) takvim kaynağının bağlantısını güncelleyen PATCH ucu —
bugün URL değiştirmenin tek yolu silip yeniden eklemek; (b) senkron sonucunda "atlandı" nedeninin
görünmesi (`unchanged` / `sahiplik` / `geçersiz`) — bugün tek sayı gösteriliyor ve bu teşhis tam da o
körlük yüzünden elle yapıldı.
