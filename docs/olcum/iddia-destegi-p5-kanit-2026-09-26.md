# İddia desteği — P5 kararı için kanıt (09-26)

**Soru (kurucu kararı P5):** cevaptaki desteksiz sayısal iddia (saat / tarih / para / süre / sayı; `ai/claim-support.ts`)
otomatik gönderimi durdursun mu? Bugün yalnız **gölge ölçüm**: hiçbir kapı okumuyor (mimari pin), karar değişmiyor.

## 1. Kaydedilmiş gerçek model koşuları (ücretsiz yeniden okuma)

Veri: `docs/olcum/model-reply-compare-2026-09-25-*.json`. Her koşu 135 sentetik senaryo içerir. `auto` = kapı otomatik
gönderirdi; `u` = desteksiz iddia sayısı (koşu anındaki ölçüm).

| Koşu | Model | Otomatik | u>0 (hepsi) | u>0 ∧ otomatik |
|---|---|---|---|---|
| `gpt-5.1` | gpt-5.1 | 55 | 6 | **0** |
| `gpt-5.1-dil` | gpt-5.1 | 54 | 5 | **0** |
| `gpt-5.1-dil2` (bugünkü yapılandırma) | gpt-5.1 | 56 | 5 | **0** |
| `gpt-6-luna` | gpt-6-luna | 56 | 6 | **0** |
| **Toplam** | | **221** | **22** | **0** |

- **Otomatik gidecek 221 cevabın hiçbiri** desteksiz sayısal iddia taşımıyor.
- **İşaretlenen 22 cevabın tamamı** zaten başka bir kapıda tutulmuş:
  - konaklama değişikliği (`availability_unconfirmed`);
  - şikâyet (`blocked`).

**Sonuç:**
- P5 bu sette **hiç ek taslak üretmezdi**, yani maliyeti yok.
- Bu sette ölçülen faydası da yok. Değeri, başka kapıların kaçırdığı uydurmaya karşı **yedek** olmasıdır.
- Önceki batarya bu yedeği ölçmüştü: 45 uydurmanın 43'ü yakalanıyor, 138 dayanaklı cevapta 0 yanlış alarm var.

## 2. İşaretlenen cevaplar ne? (son koşu, 5 satır)

| Senaryo | Sınıf | Neden işaretlendi | Hüküm |
|---|---|---|---|
| `s-de-early-12` | konaklama | misafir "um 12 Uhr", cevap "12:00 Uhr" | **yankı** — ölçüm "N Uhr" biçimini tanımıyordu |
| `s-ru-early-10` | konaklama | misafir "около 10 утра", cevap "10:00" | **yankı** — aynı sebep (Rusça) |
| `s-de-late-13` | konaklama | misafir "um 13 Uhr", cevap "13:00 Uhr" | **yankı** — aynı sebep |
| `s-tr-gec-cikis-gunluk-dil` | konaklama | misafir "1 gibi", cevap "13:00" | yorum ("1 gibi" = 13:00) — metinden çıkarılamaz, **bilinen sınır** |
| `c-tr-internet-yok` | şikâyet | "10-15 saniye" (modemi kapatıp açma önerisi) | bilgi tabanında yok; genel öneri |

**Düzeltme (09-26):** çift yönlü çıkarıcı artık yalnız KESİN saat biçimlerini tanıyor.
- Tanınanlar:
  - Almanca "N Uhr" (+ gün dilimi);
  - Rusça "N часа утра / дня / вечера / ночи", zaman edatıyla "N утра / вечера", "в N час";
  - İspanyolca "a las N (de la tarde)";
  - Fransızca "à / vers N heures (du matin / du soir)".
- Süre ya da sayı olabilen biçimler ALINMAZ: "2 Stunden", "через 2 часа", "3 дня" (3 gün), "3 ночи" (3 gece), "à 2 heures
  de route", "a las 4 habitaciones".

Etkisi:
- İlk üç satır artık yankı sayılır.
- Aynı biçimle yazılmış saat uydurmaları (örneğin "ab 14 Uhr", bağlamda 15:00) artık yakalanır.
- Mevcut batarya birebir aynı kaldı (ana 43/45, zor 8/25, 0/138).

## 3. P5 açılırsa dikkat

- **Sınıf seçimi.** Açılacaksa önce yalnız `time` / `date` / `money` sınıflarıyla başlanmalı. `number` (çıplak sayı) ve
  `duration` sınıflarında genel bilgi ("modemi 10-15 saniye kapatın", "havalimanı 2 saat") gerçek ama desteksiz görünür.
- **Açma sırası.** Önce gölge kayıtta canlı oran izlenir (`kbEvidenceJson.claims`), sonra kurucu onayı.
- **Tek yönlülük.** Kapı yalnız SIKILAŞTIRIR; tutulan cevap ev sahibine taslak olarak gider. Kanal ve QR aynı yüklemi
  kullanmalı.

## 4. Saat bağımsızlığı düzeltmesi (09-26, sonradan)

**Hata.** Ölçüm bağlamı istemin saat satırını olduğu gibi alıyordu ("Bugün: 26.09.2026 Cumartesi, saat 08:00"). Bu yüzden
o anki saate denk gelen bir işletme saati uydurması "dayanaklı" sayılıyordu. Örnek: İstanbul 08:00'de üretilen "Kahvaltı
sabah 8'de". Ölçüm günün saatine göre değişiyordu; batarya UTC 05:00, 09:00, 11:00 ve 19:00'da birer dakika kırmızıydı.

**Düzeltme.** Saat satırı bağlama saatsiz girer. Bugünün ve yarının tarihi dayanak olmayı sürdürür. Modele giden istem
değişmedi; saat orada aynen durur.

**Bu belgedeki sayılara etkisi: YOK.** Kayıtlı dört koşu saatsiz bağlamla ve güncel çıkarıcıyla yeniden hesaplandı:

- Otomatik gidecek 221 cevapta desteksiz iddia yine **0**.
- Değişen 13 satırın hepsi desteksizden dayanaklıya geçti. Sebep §2'deki çok dilli saat yankısı düzeltmesi.
- Dayanaklıdan desteksize geçen satır yok.
