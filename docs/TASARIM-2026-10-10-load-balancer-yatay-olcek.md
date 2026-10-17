# Load balancer / yatay ölçek — durum ve öneri (GOAL SONRASI BAKILACAK)

> Kurucu sorusu (10-10, gece): "Load balancerımız var mı bizim? Onu da eklemek mantıklıysa goal işi bittikten sonra bakmamız için
> dosyaya ekle." Bu belge kodda ölçülen durumu ve önerimi yazar; KOD DEĞİŞİKLİĞİ YOK, karar kurucunun.

## 1. Kısa cevap

- **Ayrı bir load balancer'ımız yok ve bugün GEREKMİYOR.** Uygulama Railway'de tek servis olarak çalışıyor; önündeki Railway proxy'si
  trafiği karşılıyor (`TRUSTED_PROXY_HOPS=2` bu proxy zincirini sayıyor). Railway'de servis kopya (replica) sayısı artırılınca trafiği
  kopyalara dağıtmayı yine bu proxy yapar — yani "load balancer eklemek" bizde ayrı bir ürün kurmak değil, **kopya sayısını artırmak**.
- **Bugünkü yük için tek kopya yeter** (9 işletme, ~11 daire; 2 dakikalık senkron + panel trafiği). Kopya artırmanın asıl kazancı hız değil
  **kesintisizlik**: bir kopya çökerse / güncellenirken öteki cevap verir.
- **Önerim:** şimdi değil. Müşteri sayısı ya da "panel yavaş / bakımda erişilemedi" şikâyeti geldiğinde, aşağıdaki §3 ön koşulları
  tamamlanıp 2 kopyaya geçilir.

## 2. Kod birden fazla kopyaya hazır mı? (Haiku taraması + kodda doğrulandı, 10-10)

**Hazır olanlar (veri bozulmaz):**
- Zamanlanmış senkron tek kopyada koşar: veritabanı kilidi (`SystemLock` + fencing token, `src/lib/scheduled-sync.ts`); öteki kopyalar
  "kilitli" deyip çıkar. Mesaj / e-posta kuyrukları `FOR UPDATE SKIP LOCKED` + advisory lock ile; iCal kaynağı advisory lock ile;
  elle cevap / oto-cevap "önce sahiplen sonra gönder" ile korunuyor.
- Hız sınırları veritabanında (atomik sayaç) — kopyalar ortak sayar.
- Oturum JWT (sunucu belleğinde oturum yok), OAuth durumu çerezde → "yapışkan oturum" (sticky session) GEREKMEZ. Canlı bağlantı
  (SSE / WebSocket) yok; panel ve QR sohbeti kısa aralıklı yoklama yapıyor.
- `/api/health` (normal mod) "veritabanına ulaşılıyor mu" der — kopya sağlık kontrolüne uygun. `?strict=1` sağlık kontrolüne
  BAĞLANMAMALI (zamanlayıcı bayatlayınca bütün kopyalar aynı anda düşerdi).
- Migration: her kopya açılışta `prisma migrate deploy` koşar; Prisma bunu veritabanı kilidiyle sıraya koyar (yalnız ikili kanıtı,
  canlıda denenmedi). Migration'larımız zaten "yalnız ekle" kuralında.

**Ön koşul gerekenler (§3):** bağlantı havuzu, proxy hop sayısı, anlamsal arama (embedding) deposu, yerel yükleme dalı.

**Kopya başına çoğalan ama bozmayan:** hata e-postası kısıtı (N kopya = N e-posta), açılış ısıtması (N kat embedding maliyeti),
süreç içi zamanlayıcı tıkı (2 dk) ve e-posta yoklayıcısı (15 sn) kopya sayısı kadar.

## 3. 2 kopyaya geçmeden önce yapılacaklar (sırayla)

1. **Veritabanı bağlantı havuzu:** kodda `connection_limit` yok (`src/lib/db.ts`, `DATABASE_URL` env'den). Kopya × havuz, Postgres
   `max_connections`ı aşmamalı → `DATABASE_URL`e `?connection_limit=…` eklenir (Railway Postgres planının sınırına göre).
2. **Proxy hop sayısı:** Railway kopya dağıtımı aynı proxy'den geçer → `TRUSTED_PROXY_HOPS` muhtemelen DEĞİŞMEZ; ama araya ayrı bir
  katman (Cloudflare vb.) girerse +1 olur. Az sayım herkesi tek hız-sınırı kovasına düşürür, fazla sayım sahte IP ile limiti atlatır.
  `/admin` sayfasındaki hop önizleme kartıyla canlıda doğrulanır.
3. **Anlamsal arama (embedding) deposu:** canlıda `KB_SEMANTIC_RETRIEVAL=1` AÇIK ve parça vektörleri süreç içi bellekte
  (`src/lib/ai/embeddings/semantic-retrieval.ts` `store = new Map`). İki kopyada aynı soru, ısınmış kopyada anlamsal, soğuk kopyada
  sözcüksel yoldan çözülebilir (cevap kalitesi kopyaya göre oynar) ve açılış ısıtması iki kat ödenir. Seçenek: (a) kabul (soğuk yol
  güvenli, sözcüksel), (b) vektörleri veritabanına taşımak (RAG tasarımındaki E2 adımı). Karar kurucunun; önerim (b) — 2 kopyadan önce.
4. **Yerel yükleme:** üretimde yerel dosyaya yükleme varsayılan KAPALI (`ALLOW_LEGACY_LOCAL_UPLOADS` yoksa reddedilir; dosyalar Tigris'te).
  Bu bayrağın canlıda AÇIK olmadığı doğrulanmalı — açıksa dosya yalnız yazıldığı kopyada bulunur, saklama silmesi öteki kopyadakileri
  silemez (KVKK).
5. **Uzun org senkronu:** senkron kilidinin süresi 15 dk; tek işletmenin senkronu bunu aşarsa ikinci koşu paralel yazabilir (kod bunu
  kabul ediyor, tek kopyada da geçerli). Büyük müşteri gelmeden önce ölçülmeli.

## 4. Maliyet ve getiri (özet)

| | Tek kopya (bugün) | 2 kopya |
|---|---|---|
| Kesinti | Güncelleme / çökme anında birkaç saniye–dakika erişilemez | Öteki kopya cevap verir |
| Hız | Bugünkü yükte yeterli | Bugünkü yükte fark yok |
| Maliyet | 1 × servis | ~2 × servis + embedding ısıtması 2 kat |
| İş | Yok | §3 maddeleri (1, 2, 4 kısa; 3 asıl iş) |

**Karar soruları (goal sonrası):** (1) kesintisizlik şimdi gerekli mi, yoksa müşteri sayısı / şikâyet eşiği mi beklenir? (2) anlamsal
arama deposu veritabanına taşınsın mı (§3.3)?
