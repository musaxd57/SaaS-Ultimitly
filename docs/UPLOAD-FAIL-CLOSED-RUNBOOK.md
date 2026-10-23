# Yükleme — private depolama doğrulaması, fail-closed ve geri alma

> **08-09 (2), P1 #5.** Kullanıcı direktifi: *"Önce mevcut mimarinin gerçekten
> private olup olmadığını kod ve Railway sözleşmesinden doğrula; isimden
> varsayma. Boot kapısı mevcut prod'u durdurabilecekse aktif etme. Legacy
> dosyaları silme veya taşıma."*

---

## 1. "PRIVATE Mİ?" — KODDAN DOĞRULANDI

| İddia | Kanıt |
|---|---|
| Nesneler **public-read değil** | Kodda `public-read` / `x-amz-acl` **hiç geçmiyor** (test-pinli). Adapter yalnız imzalı `PUT`/`DELETE` yapar. |
| Okuma **imzalı ve kısa ömürlü** | `/api/storage/photo/<key>` → `presignGetUrl(..., SIGNED_URL_DEFAULT_TTL_S)` → 302. Public URL üretilmiyor. |
| **Çapraz-kiracı kapalı** | Servis rotası: oturum şart + `orgIdFromKey(key) !== session.organizationId` → **opak 404**. |
| DB'de sağlayıcı URL'i **yok** | Saklanan `photoUrl` aynı-origin göreli yol (`/api/storage/photo/…`). |
| Anahtar **tahmin edilemez** | `org/{orgId}/task/{taskId}/{ts}-{12 hex}.ext` → **48 bit** rastgelelik (test-pinli, 200 üretimde çakışma yok). |
| Yükleme **sahipliğe bağlı** | Anahtar (org, task) gömer; rota önce org-kapsamlı `task` arar, staff ise `assignedToId` şartı. |
| İçerik **gerçekten görsel** | Uzantı **sihirli bayttan** türer (`sniffImageExt`), spoof edilebilir MIME'dan değil. SVG/HTML/PHP/GIF **reddedilir**. |

🚨 **KOD BURAYA KADAR SÖYLEYEBİLİR.** Bucket'ın **sağlayıcı tarafındaki**
görünürlüğü (Railway Buckets / Tigris panelinde "public" işaretli mi) koddan
okunamaz — **isimden de varsayılmaz**. ↓Operatör adımı 1.

---

## 2. NE DEĞİŞTİ — ÇALIŞMA ZAMANI FAIL-CLOSED

**Sorun:** `STORAGE_ENABLED` kapalıyken yükleme rotası sessizce eski yola
düşüyor ve dosyayı `public/uploads/{org}/` altına yazıyor. O dizin **statik
servis edilir**: URL bir capability'dir (48 bit, tahmin edilemez) ama
**süresizdir, oturum istemez, kiracı kontrolü yoktur.**

Bugün üretimde `STORAGE_ENABLED` **açık**, yani bu dal **ulaşılmaz**. Tehlike
**sessiz düşüşte**: env bir gün Railway'den düşerse yüklemeler hata vermez,
sessizce zayıf yola geçer ve kimse fark etmez.

**Eklenen:** üretimde o dala düşülürse **503** (`serverError`) — sessiz
seviye düşürme yerine görünür arıza.

⚠️ **BOOT'A DOKUNULMADI.** Bu bir **çalışma zamanı** kapısıdır; yalnız yükleme
isteğini etkiler. Uygulama açılışı, `/api/health` ve diğer tüm yüzeyler aynen
çalışır.

⚠️ **KAÇIŞ KAPISI VAR ve ÖLÜ DEĞİL (test-pinli):**
`ALLOW_LEGACY_LOCAL_UPLOADS=1` eski davranışı **birebir** geri getirir —
**deploy gerekmez.**

---

## 3. OPERATÖR ADIMLARI (bekliyor)

1. **Bucket görünürlüğünü DOĞRULA (isimden varsayma).**
   Railway → Storage Buckets → `lixus-uploads` → objelerin public erişime
   kapalı olduğunu teyit et. Hızlı test: bir nesnenin **imzasız** sağlayıcı
   URL'ini tarayıcıda aç — **403/AccessDenied gelmeli.**
   ⚠️ 200 gelirse bu bir P0'dır: kod private davranıyor ama bucket değil.
2. **`STORAGE_ENABLED`'ın gerçekten açık olduğunu teyit et** (Railway env).
   Bu commit'ten sonra kapalıysa üretimde yüklemeler 503 verir — ve bu
   **kasıtlıdır**, ama bilerek karşılaşmalısın.
3. **Envanteri al** (salt okuma, hiçbir şey silmez):
   `node scripts/inventory-legacy-uploads.mjs`
   ⚠️ Railway diski **efemerdir**: 0 dosya "hiç olmadı" değil "bu konteynerde
   yok" demektir.
4. Sorun çıkarsa: `ALLOW_LEGACY_LOCAL_UPLOADS=1` → eski davranış geri gelir.
   Düzeldikten sonra **env'i sil**.

---

## 4. YAPILMAYANLAR (bilinçli)

- **Legacy dosyalar silinmedi/taşınmadı.** Direktif gereği. Envanter aracı
  yalnız sayar.
- **Boot kapısı eklenmedi.** `STORAGE_*` eksikse uygulama yine açılır.
  Gerekçe: mevcut prod doğrulanmadan boot'u durduracak değişiklik pushlanmaz.
- **`StorageObject` manifesti yazılmadı.** Upload→PATCH arasında öksüz kalan
  obje hâlâ bilinen açık madde (bucket açma turuna bağlı).

---

## 5. KALAN RİSK (dürüstçe)

- **Bucket görünürlüğü doğrulanmadı.** Kod private davranıyor; sağlayıcı
  tarafı operatör adımı 1'e bağlı. Bu tur bunu **kapatmadı**, görünür kıldı.
- **Eski `/uploads` dosyaları hâlâ oturumsuz erişilebilir.** Capability URL
  tahmin edilemez ama süresiz; gerçek çözüm (taşıma/silme) ayrı bir karar turu.
- **`..` kontrolü büyük ölçüde yedek.** Ölçüldü: traversal denemelerinin
  neredeyse hepsi segment regex'lerine takılıyor; satırın yük taşıdığı tek
  vaka nokta-nokta içeren bir DOSYA ADI (`a..b.jpg`) ve o da artık pinli.
  Satır savunma derinliğidir, tek savunma değil.
- **503 mesajı hosta jenerik görünür.** Yükleme başarısızlığının sebebi
  operatör log'unda (`reportError`) yazılı, arayüzde değil.
