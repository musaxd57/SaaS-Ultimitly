# GuestOps AI — Railway'de 7/24 Yayına Alma (Deploy) Rehberi

Bu rehber uygulamayı **Railway**'de sürekli açık (7/24) çalıştırır. Böylece
gece otomatik cevap, sen uyurken / bilgisayarın kapalıyken bile çalışır.
SQLite olduğu gibi kalır (kalıcı disk üzerinde tutulur).

> **Önemli:** Hiçbir gizli anahtarı (token, şifre) GitHub'a koyma. Hepsi
> aşağıda Railway panelindeki **Variables** bölümüne girilir.

---

## 1) Railway projesini oluştur

1. <https://railway.app> → **Login with GitHub**.
2. **New Project** → **Deploy from GitHub repo** → `musaxd57/SaaS-Ultimitly`.
3. Branch olarak en güncel kodun olduğu dalı seç (örn. `claude/great-edison-3zqpZ`
   ya da `main`'e birleştirdiysen `main`).

Railway otomatik olarak Next.js'i tanır ve `npm run build` ile derler.
Başlatma komutu `railway.json` içinde tanımlı (önce `prisma db push`, sonra
`next start`).

## 2) Kalıcı disk (Volume) ekle — SQLite burada yaşar

1. Servise tıkla → **Settings** → **Volumes** → **+ New Volume**.
2. **Mount path:** `/data`
3. Kaydet. (Bu disk, her deploy'da silinmez — veritabanın güvende.)

## 3) Ortam değişkenleri (Variables)

Servis → **Variables** → her birini ekle:

| Değişken | Değer |
|---|---|
| `DATABASE_URL` | `file:/data/dev.db`  ← volume yolu! |
| `AUTH_SECRET` | Güçlü rastgele değer (`openssl rand -base64 32`) |
| `CRON_SECRET` | Güçlü rastgele değer (`openssl rand -base64 32`) |
| `HOSPITABLE_API_TOKEN` | Hospitable kişisel erişim token'ın |
| `OPENAI_API_KEY` | OpenAI anahtarın (AI cevaplar için) |
| `OPENAI_MODEL` | `gpt-4o-mini` (opsiyonel) |
| `NODE_ENV` | `production` |

> `PORT`'u **elle ekleme** — Railway otomatik verir, Next.js onu kullanır.
> İstersen e-posta/WhatsApp için `.env.example`'daki diğer değişkenleri de ekleyebilirsin (opsiyonel).

## 4) Deploy + alan adı (domain)

1. **Deploy** çalışsın (ilk kez `prisma db push` boş veritabanına tabloları kurar).
2. **Settings** → **Networking** → **Generate Domain** → herkese açık bir
   adres alırsın: `https://<senin-uygulaman>.up.railway.app`

## 5) Hesabını oluştur ve mesajları çek

1. `https://<senin-uygulaman>.up.railway.app/register` → yeni hesap aç
   (yayındaki veritabanı boş başlar — yerel hesabın taşınmaz, sorun değil).
2. Giriş yap → **Mesajlar** → **Hospitable testi** ile bağlantıyı doğrula →
   **Mesajları çek** ile konuşmalar gelsin.
3. **Oto-yanıt testi** ile AI'ın ne göndereceğini gör (hiçbir şey gönderilmez).

## 6) Zamanlayıcı (her birkaç dakikada bir otomatik çekme)

Gece otomatik cevabın **kendi kendine** çalışması için, düzenli aralıkla
`/api/cron/sync` çağrılmalı. En kolayı ücretsiz **cron-job.org**:

1. <https://cron-job.org> → ücretsiz hesap → **Create cronjob**.
2. **URL:** `https://<senin-uygulaman>.up.railway.app/api/cron/sync`
3. **Schedule:** her 5 dakikada bir (`*/5 * * * *`).
4. **Advanced / Headers** → bir başlık ekle:
   - Key: `Authorization`
   - Value: `Bearer <CRON_SECRET>`  ← Railway'e girdiğin `CRON_SECRET` ile aynı
5. Kaydet.

> Bu uç nokta güvenlidir: doğru `CRON_SECRET` gönderilmezse **401** döner.
> Auto-reply yalnızca **aktif saat aralığında (varsayılan 00:00–09:00)** ve
> oto-yanıt **Açık**ken mesaj gönderir; gündüz çağrılsa bile mesaj göndermez,
> sadece yeni mesajları çeker.

> **Alternatif:** Railway'in kendi **Cron** servisini de kullanabilirsin
> (ayrı bir servise `*/5 * * * *` zamanlaması verip aynı URL'yi `curl` ile
> çağırırsın). cron-job.org daha basit olduğu için onu öneriyoruz.

## 7) Gece otomatik cevabı aç

**Mesajlar** sayfasında **"Gece oto-yanıt (00:00–09:00)"** butonunu **Açık** yap.
Artık 00:00–09:00 arası gelen güvenli misafir mesaplarına AI otomatik cevap
verir. İstediğin an aynı butonla **kapatabilirsin**.

---

## Özet akış

```
cron-job.org  ──(her 5 dk, Bearer CRON_SECRET)──▶  /api/cron/sync
                                                        │
                                   Hospitable'dan yeni mesajları çek
                                                        │
                       00:00–09:00 arası + oto-yanıt Açık mı?
                                          │evet                │hayır
                          güvenli+emin cevapları gönder      sadece çek
```

## Saat aralığını değiştirmek

Varsayılan pencere **00:00–09:00**. Değiştirmek istersen söyle; ayar
veritabanında `autoReplyStartHour` / `autoReplyEndHour` alanlarında tutuluyor
(0–23). İstersen arayüze küçük bir saat seçici de ekleyebilirim.
