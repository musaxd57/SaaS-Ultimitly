# Conversation dedupe — DRY-RUN aracı tasarımı (Faz B)

> **Durum: YALNIZ TASARIM.** Kod yazılmadı, prod'a dokunulmadı, dedupe
> çalıştırılmadı, migration üretilmedi. Uygulama kullanıcının açık onayına bağlı.
> Önkoşul: gerçek yazma öncesinde **yeniden `pg_dump`**.

## 0. Neden şimdi güvenli bir zemin var

`3effd99` (Faz A) ile `importThread` artık NS-43 rezervasyon-kimlik advisory
kilidi altında çalışıyor. Sonuç, dedupe tasarımını doğrudan etkiliyor:

**Çakışan grup popülasyonu artık KAPALI bir küme.** Yeni çift satır üretilemez,
dolayısıyla dry-run'ın ölçtüğü tablo ile apply'ın göreceği tablo arasında
"yeni çakışma belirdi" riski yok. Kalan tek risk mevcut satırların
değişmesi (yeni mesaj gelmesi) — bunu apply adımı kilit altında yeniden
doğrulayarak karşılar.

## 1. Prod'un ölçülmüş gerçeği (2026-07-26 preflight, çıkış kodu 10)

| Ölçüm | Değer |
|---|---|
| Toplam Conversation | 1335 |
| Çakışan Hospitable grubu | 7 |
| Grup büyüklüğü | hepsi **tam 2 satır** (3+ yok) |
| `externalConversationId` | 7 grubun **tamamında AYNI** |
| Çelişkili / karışık / kanıtsız grup | **0 / 0 / 0** |
| Etkilenen Conversation | 14 |
| Korunacak Message | 58 |
| MessageOutbox / RiskEvent / ShadowVerdict | **0 / 0 / 0** |
| QR / manuel çakışması | 0 |

Yorum: 7 grubun tamamı **bizim yarış artığımız** — sağlayıcı tek thread
verdiği hâlde iki satır açılmış. Otomatik birleştirme için gereken kanıt
gücü en yüksek kova bu.

## 2. Değişmez kurallar (aracın sözleşmesi)

1. **DRY-RUN varsayılan ve tek başına çalıştırılabilir.** Yazma yalnız açık
   `--apply` + ayrıca ortam değişkeni onayıyla; ikisi birden yoksa salt-okuma.
2. **Hiçbir mesaj silinmez.** Ne dry-run'da ne apply'da. Kayıp = kabul edilemez.
3. **`externalConversationId` çelişkisi = o grup için FAIL-CLOSED.** Grup
   raporlanır, plan üretilmez, apply o gruba dokunmaz. (Bugün 0, ama araç
   ölçtüğü ana göre davranır, geçmiş rapora güvenmez.)
4. **Çıktı yalnız kategori + sayı.** Misafir adı, mesaj gövdesi, rezervasyon
   kimliği, konuşma id'si, URL, kimlikten türetilmiş etiket **basılmaz** —
   preflight ile aynı disiplin, aynı test (rapor satır sayısı veri hacminden
   bağımsız + tüm dönüş değerinde kimlik taraması).
5. **Salt-okuma aşaması** preflight'ın kapılarını aynen kullanır: `READ ONLY`
   + `REPEATABLE READ` + `statement/lock/idle-tx timeout` + primary onayı.

## 3. Keeper seçimi — deterministik, beraberlik imkânsız

Sıralama ölçütleri, ilk ayrımda karar (hepsi tek sorguda, `ORDER BY`):

| # | Ölçüt | Yön | Gerekçe |
|---|---|---|---|
| 1 | `reservationId IS NOT NULL` | önce | Konaklama bağı olan satır bağlamı taşır; NULL olan onu geri getiremez |
| 2 | mesaj sayısı | çok olan | Taşınacak satır sayısını azaltır |
| 3 | `createdAt` | eski olan | Tarihsel olarak "asıl" thread |
| 4 | `id` | küçük olan | Son çare — beraberliği yapısal olarak imkânsız kılar |

4. ölçüt sayesinde iki farklı koşu **aynı keeper'ı** seçer; plan tekrar
üretilebilir ve karşılaştırılabilir.

## 4. Kolon birleştirme — "keeper kazanır" YETMEZ

Kritik incelik: keeper'ın mesaj-dışı kolonları hayatta kalır. Körü körüne
keeper'ı almak **insan/AI kararını sessizce düşürebilir**. Her kolon için yön
açıkça seçilir:

| Kolon | Kural | Neden |
|---|---|---|
| `status` | **problem > new > waiting > answered > closed** önceliği; grup içindeki en "dikkat isteyen" değer kazanır | "Sorunlu" bayrağı düşerse şikâyet gizlenir |
| `autoReplyHoldUntil` | **MAX** (null en zayıf) | İnsana devir penceresi kısalmamalı; AI host'un üstüne konuşmamalı |
| `lastMessageAt` | **MAX** | Gelen kutusu sıralaması doğru kalsın |
| `syncCursorAt` | **MIN** (biri NULL ise NULL) | İhtiyatlı yön: yeniden import idempotent, atlama ise mesaj kaybı |
| `reservationId` | non-null olan; ikisi de non-null ve FARKLI ise → **fail-closed** | İki farklı yerel konaklamaya bağlı satırlar birleştirilemez |
| `guestIdentifier` | keeper'ınki; keeper `ANON_*` sentinel'i ise diğerinden gerçek ad **ASLA geri yazılmaz** | KVKK diriltme guard'ı |
| `priority`, `skippedReason`, `lastRiskLevel`, `lastRiskType` | keeper | Görüntüleme/analitik; risk bayrağı `status` üzerinden zaten korunuyor |
| `externalConversationId` | tek non-null değer; çelişki → fail-closed (kural 3) | — |

## 5. Mesaj taşıma planı — çakışmalar sayıyla

`Message @@unique([conversationId, externalId])` var. Kaybeden satırın
mesajları keeper'a taşınırken üç sınıf çıkar:

| Sınıf | Tanım | Plan |
|---|---|---|
| **taşınabilir** | `externalId` keeper'da YOK | `UPDATE conversationId` |
| **çakışan** | `externalId` keeper'da VAR **ve gövde AYNI** | Aynı sağlayıcı mesajının ikinci kopyası — keeper'daki kalır, kaybedendeki artık gereksizdir. **Silme kararı ayrı onaya bırakılır**; varsayılan plan "bırak, raporla" |
| **çelişkili** | `externalId` aynı, **gövde FARKLI** | **FAIL-CLOSED** — grup planlanmaz, insana gider |
| **anahtarsız** | `externalId IS NULL` (iyileşmemiş giden mesaj) | **Taşınır**, asla düşürülmez. `dup > silent miss` invariant'ı |

Beklenti (7 grup, aynı thread iki kez import edilmiş): mesajların büyük
kısmı **çakışan** sınıfına düşer. Dry-run bunu sayıyla doğrulayacak; sayı
beklentiye uymazsa bu, planı uygulamadan önce durup bakmak için sebeptir.

## 6. FK'sız tablolar

`MessageOutbox` / `RiskEvent` / `ShadowVerdict` üzerinde `conversationId`'nin
FK'si **yok** → kaybeden satır silinirse dangling kalır. Plan bunları
keeper'a **repoint** eder (`updateMany`). Prod'da bugün üçü de **0**, ama
araç sayıyı ölçer ve sıfır olmayan durumda repoint'i plana yazar —
"bugün sıfır" bir kod garantisi değildir.

## 7. Apply aşaması (AYRI ONAY — bu turda YOK)

Sıra, atlanmaz:

1. **Taze `pg_dump`** (preflight yedeği yeterli değil; arada Faz A deploy oldu).
2. Grup başına **tek transaction**, **NS-43 kimlik kilidi altında** — Faz A'nın
   kilidini yeniden kullanır, böylece birleştirme sürerken eşzamanlı bir sync
   üçüncü satırı açamaz.
3. Kilit içinde **planı yeniden doğrula** (keeper/mesaj sayıları hâlâ aynı mı).
   Sapma → o grup atlanır, rapor edilir. (Billing'deki "apply'dan önce yeniden
   preview" deseninin aynısı.)
4. Taşı → repoint → kolon birleştir → boşalan kaybeden satırı sil.
5. **Son-koşul iddiası**: anahtar başına tam 1 satır ve mesaj sayısı beklenen
   birleşim değerine eşit; değilse transaction **rollback**.
6. Ancak bundan sonra unique migration; ardından iki paralel sync testi.

## 8. Bu tasarımın kapsamadıkları (bilinçli)

- `cleanupDuplicateConversations` **değiştirilmez**. O ayrı bir araç ve
  unique ile **aynı kural değildir** — kesişirler, hiçbiri diğerini kapsamaz.
- `NULLS NOT DISTINCT` kullanılmaz; manuel satırların `NULL`'ları serbest kalır.
- Farklı `externalConversationId` taşıyan hiçbir grup otomatik birleştirilmez.
