# CSP — ölçüm ucu ve kontrollü geçiş raporu

> **08-09 (2), P1 #6.** Kullanıcı direktifi: *"CSP enforce açma; yalnız ölçüm ve
> kontrollü geçiş raporu hazırla."* Bu belge ölçümün nasıl kurulduğunu ve
> enforce'a geçişin hangi kanıtlara bağlı olduğunu yazar. **Enforce AÇILMADI.**

---

## 1. NE DEĞİŞTİ

| Değişiklik | Durum |
|---|---|
| `/api/csp-report` toplama ucu | ✅ eklendi (kimliksiz, korumalı) |
| `report-uri` → **yalnız report-only** politikada | ✅ eklendi |
| Enforce politikası | ❌ **DEĞİŞMEDİ** — `script-src` hâlâ enforce edilmiyor |

**Öncesi:** iki CSP başlığı da yayımlanıyordu ama `report-uri`/`report-to` YOKTU
→ report-only politika **fiilen kördü**, hiçbir ihlal toplanmıyordu. Yani
"enforce'a geçelim mi" sorusunun cevabı ölçülemiyordu.

---

## 2. UÇ KİMLİKSİZ — KORUMALAR VE GEREKÇELERİ

Kimlik doğrulaması **eklenemez**: tarayıcı CSP raporunu çerezsiz/kimliksiz
gönderir. Dolayısıyla her koruma gövde ve hız tarafında:

| Koruma | Değer | Neden |
|---|---|---|
| Gövde tavanı | 8 KB | Kimliksiz uçta OOM koruması |
| Content-Type | 3 MIME (kapalı küme) | Rastgele form POST'u geçemez |
| Hız limiti | 30/saat **IP başına** | Tek gürültücü herkesi susturmamalı (kova global olsaydı olurdu) |
| Alan seçimi | **İzin listesi** | Ham gövde asla kullanılmaz |
| URL işleme | query + fragment **atılır** | `document-uri` panel URL'idir: `?orgId=`, `?q=<arama>` taşır |
| `script-sample` | **hiç okunmaz** | Sayfadan birebir alıntı — içinde token/PII olabilir |
| Log enjeksiyonu | CR/LF + kontrol karakterleri temizlenir | Sahte log kaydı uydurulmasın |

🚨 **Ham rapor SAKLANMAZ.** Ne DB'ye yazılır ne olduğu gibi loglanır. Kapalı bir
alan kümesi (`effective-directive`, `blocked-uri`→origin+path,
`document-uri`→origin+path, `disposition`) tek satır hâlinde `console.warn`a
yazılır.

🚨 **`reportError` BİLEREK KULLANILMAZ.** Bu depoda Sentry'ye ve alarm
e-postasına giden tek yol odur; kimliksiz bir uçtan tetiklenebilen bir alarm,
saldırganın eline operatörün alarm kanalını verir (`/api/leads`'in kutu-bombalama
riskiyle aynı sınıf).

**Yanıt daima `204`** — gövdesiz. Uç bir yankı/oracle olarak kullanılamaz.

---

## 3. ENFORCE'A GEÇİŞ — HANGİ KANITA BAĞLI

Bugün enforce edilen politikada **`script-src` YOK**. Sebebi CLAUDE.md'de:
nonce altyapısı olmadan `script-src` enforce paneli komple kırar (Next.js satır
içi hydration script'leri + Paddle overlay).

**Geçiş, sırayla ve kanıtla:**

1. **Ölç (≥2 hafta).** Railway log'unda `[csp-report]` satırlarını topla.
   Beklenen gürültü: tarayıcı eklentileri (`chrome-extension:` `blocked-uri`
   ile gelir) — bunlar bizim politikamızın değil kullanıcının sorunu, **enforce
   kararına girmemeli.**
2. **`report-only` politikayı ÖNCE doğru yap.** Şu an report-only,
   `script-src 'self' 'unsafe-inline'` içeriyor; yani hedef politika hâlâ
   `unsafe-inline` taşıyor ve enforce edilse XSS'e karşı asıl kazancı vermez.
   Gerçek hedef: `'unsafe-inline'` YOK + `'nonce-<rastgele>'`.
3. **Nonce altyapısı** (ayrı tur): middleware'de istek başına nonce üret,
   `next.config.mjs` statik header'ından çıkıp middleware'e taşı (nonce statik
   olamaz), Next'in `nonce` desteğini bağla. ⚠️ Bu ölçüm turuna DAHİL DEĞİL.
4. **Önce report-only'de nonce'lu politikayı yayımla**, ihlal akışının sıfıra
   indiğini gör.
5. **Sonra enforce'a al** — ve ilk 24 saat log'u izle.

**Bu adımlar tamamlanmadan `script-src` enforce edilmemelidir.**

---

## 4. OPERATÖR ADIMI BEKLEYEN — YOK

Bu madde **kod tarafında tamamlandı** ve deploy ile canlıya iner: uç yayına
girer, report-only başlığı raporları oraya yollar, log akmaya başlar.
Ek env/ayar **gerekmiyor**.

⚠️ **Ama "CSP sertleştirildi" DEMEK DEĞİL.** Bu tur yalnız **ölçümü** kurdu.
Enforce kapsamı bugünkü hâliyle duruyor.

---

## 5. KALAN RİSK (dürüstçe)

- **Log gürültüsü.** İhlal akışı beklenenden yüksekse Railway log'u şişer.
  Hız limiti IP başına 30/saat ile sınırlar ama çok sayıda istemci bunu aşabilir.
  Gerekirse limit düşürülür — kodda tek sabit.
- **`console.warn` kalıcı bir depo değil.** Railway log saklama süresi neyse
  ölçüm penceresi odur. Kalıcı ölçüm istenirse ayrı bir tabloya yazmak gerekir
  ve o zaman KVKK kapsamı (path'te id'ler var) yeniden değerlendirilmelidir.
- **`blocked-uri` origin+path olarak tutuluyor.** Üçüncü taraf bir kaynağın
  yolu genelde hassas değil, ama bir gün `data:` URL'i gelirse ilk 120 karakter
  loglanır — `data:` gövdesi teorik olarak içerik taşıyabilir. Bugün ölçülmüş
  bir örnek yok; enforce turunda yeniden bakılmalı.
