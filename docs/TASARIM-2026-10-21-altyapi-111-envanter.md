# Altyapı envanteri — 111 konu (kurucu 10-21)

Kurucu 10-21: "bunları kontrol eder misin, eksikler varsa / iyi olacaklar varsa soru sormadan entegre et." Üç Haiku 5.5 ajanı kodu
okudu (test koşmadan); bulgular kodla doğrulandı. Ölçüt: **müşteriye giden mesajı / ekranı / parayı değiştirmeyen, eklemeli, testli** iş
hemen yapıldı. Müşteri davranışını, kimlik akışını ya da maliyeti değiştiren iş "Kurucuya sorular"da (CLAUDE.md "sormadan sistem
kurulmaz" kuralı kurucunun bu mesajından önce gelir: kapsam iç sertleştirme olarak okundu).

Bağlam: tek Railway servisi, tek PostgreSQL, ~10 işletme. Bu yüzden 111 konunun bir kısmı bugün **uygulanamaz** (Kubernetes, Helm,
sharding, gRPC…). Bunlar eklenmedi. Kullanılmayan altyapı eklemek bakım yükü ve saldırı yüzeyi getirir, karşılığında fayda yok.

## Bu turda yapılanlar (kod + test: `tests/unit/infra-hardening-2026-10-21.test.ts`)

| # | Konu | Ne yapıldı | Neden |
|---|---|---|---|
| 41 | Bellek sızıntısı | Hata e-postası kısıtlama haritası (`report-error-core.ts`) 2.000 anahtarda tavanlı; penceresi geçmişler silinir | Anahtar işletme kimliği taşıyor, harita hiç küçülmüyordu |
| 44 | Geri basınç | Ödeme bekletmesi okuması (`outbox/billing-hold.ts`) en çok 5 paralel | İşletme sayısı kadar paralel DB okuması havuzu doldurabilirdi |
| 40 | Kilitlenme (deadlock) | Görev silme yollarında çok satırlı `FOR UPDATE` artık `ORDER BY "id"` ile (`automation.ts`, iki yer) | Aynı satırları farklı sırayla kilitleyen iki işlem birbirini bekleyebilir; sabit sıra bunu önler |
| 57 | Canlılık / hazır olma | `/api/health?live=1`: veritabanına dokunmadan 200 | DB arızası süreci yeniden başlatma sebebi değildir; hazır olma (`/api/health`) ve izleme (`?strict=1`) aynen |
| 26 | Sorgu iyileştirme | Üretimde yavaş sorgu satırı (`db-slow-query.ts`, eşik `DB_SLOW_QUERY_MS`, varsayılan 1000 ms, "0" kapatır); yalnız parametreli SQL, değerler yazılmaz | Yavaş sorgu bugün görünmüyordu |
| 58 / 28 | İzleme / bağlantı havuzu | Açılış uyarısı: `SENTRY_DSN` yoksa; `DATABASE_URL`'de `connection_limit` yoksa (adres basılmaz). Uyarıdır, açılışı durdurmaz | Hata takibi ve havuz tavanı sessizce eksik kalabiliyordu |
| 109–111, 63–65, 83–85, 55 | Olay yönetimi, SLO, felaket kurtarma, geri alma | `docs/OPS-OLAY-YONETIMI-VE-SLO.md` | Runbook'lar dağınıktı; SLO / nöbet / postmortem şablonu / RTO-RPO yoktu |

**Bilinçli yapılmayan (ajan önerdi, kodda doğrulandı):** `automation.ts` held mesaj başına okuma (madde 27). Tek mesajda 1–3 öğe var,
kazanç yok. Ayrıca bu yolu sınayan bir test yok; davranışı eşdeğer de olsa kanıtsız değişiklik yapılmaz. · E-posta kuyruğu kurtarma
saatini DB `now()`'a taşımak (madde 96). Tek kopyada saat kayması yok, testler saati parametreyle veriyor. İkinci kopya açılırken
yapılacak (`TASARIM-2026-10-10-load-balancer-yatay-olcek.md` listesine eklenmeli). · Dockerfile `--mount=type=cache` (madde 107). Railway
önbellek bağlamasını yalnız servis kimliğine bağlı özel kimlikle kabul ediyor; yanlış kimlik derlemeyi düşürür, canlı kapalıyken
denenemez.

## 111 konunun durumu (özet)

**VAR (kanıtlı):** 1 hız sınırı (DB sayaçlı, rota başına) · 4 ters vekil güveni (`TRUSTED_PROXY_HOPS`) · 6 CI/CD (doğrulama, migration
zinciri + sıfır sapma, smoke, derleme, güvenlik denetimi; Railway "Wait for CI") · 7 Docker (çok aşamalı, `USER node`) · 11 zaman aşımı
(**zaman aşımsız dış çağrı yok**) · 12 yeniden deneme · 14 idempotency · 15 mesaj kuyruğu (DB kuyrukları, `SKIP LOCKED`) · 20 ölü mektup
(`failed` / `review` / `blocked` + elle yeniden dene) · 21 zamanlanmış işler (`SystemLock` + fencing) · 25 dizinler (126) · 33 lider seçimi ·
35 nihai tutarlılık (transactional outbox) · 36 iyimser kilit (sürüm CAS) · 37 kötümser kilit (`FOR UPDATE`, advisory) · 38 dağıtık kilit
· 39 yarış koşulları (CAS + unique) · 43 iş parçacığı güvenliği · 50 önbellek geçersizleştirme (içerik parmak izi) · 56 sağlık
yoklaması · 62 uyarılar (geçiş tabanlı) · 68 roller · 76 CORS (varsayılan red) · 77 CSRF (JSON şartı + SameSite) · 78 SQL enjeksiyonu
(69 ham SQL, hepsi parametreli) · 80 SSRF (DNS sabitleme, özel adres yasağı) · 81–82 migration + sürümleme · 95 ağ bölünmesi (belirsiz
teslim → uzlaştırma, körlemesine yeniden gönderim yok) · 97 DNS yeniden bağlama savunması · 101 webhook (HMAC, 5 dk, tekil olay) · 108
bağımlılıklar (kilit dosyası, Dependabot, süreli denetim tabanı).

**KISMİ (kalan iş aşağıda):** 2 önbellek (yalnız süreç içi) · 10 devre kesici (yalnız uyarı, çağrıyı kesmiyor) · 13 jitter (kuyrukta
var, e-posta / Hospitable'da yok) · 17–19 olay güdümlü / dağıtık işlem / saga (tek adımlı telafi yeterli) · 26–28 (bu turda kapandı,
havuz tavanı Railway env'inde) · 32 / 83 / 84 yedek ve geri yükleme (elle, prova kanıtlı) · 46 yatay ölçek (ön koşullar belgede) · 51
özellik bayrakları (yalnız env, işletme bazlı yok) · 54 sıralı yayın (SIGTERM işleyicisi yok) · 59 günlük (serbest metin, redaksiyonlu)
· 60 izleme (takip numarası var; OpenAI çağrısına taşınmıyor) · 67 sır yönetimi (env; CI'da sır taraması yok) · 69 OAuth (PKCE yok) ·
70 JWT (tek anahtar, `kid` yok) · 72 at-rest şifreleme (anahtar kimliği yok — **ENCRYPTION_KEY rotasyonu ASLA** kuralı geçerli) · 73 DB
TLS (Railway iç ağ) · 75 DDoS (yalnız uygulama katmanı) · 79 XSS (CSP `script-src` zorlanmıyor, bilinçli) · 87 kaos (yarış / çökme
testleri var, enjeksiyon yok) · 88 maliyet (çağrı sayısı tavanı; token / USD yok) · 91–94 gecikme (yüzdelik ölçüm yok) · 104 IaC
(Dockerfile + railway.json; panel env'leri dışarıda).

**YOK ama gerekmiyor:** 16 pub/sub · 22 WebSocket · 23 uzun yoklama · 24 SSE (gelen kutusu 5 sn yoklamayla yeterli; değişiklik ürün
kararı → soru 6) · 61 metrik sistemi (Prometheus / OTEL — tek kopyada olay günlüğü + strict sağlık yeterli) · 103 semver / CHANGELOG
(dal = yayın) · 105 Terraform.

**UYGULANAMAZ (tek servis, tek bölge):** 3 yük dengeleme · 5 API ağ geçidi · 8 Kubernetes · 9 servis keşfi · 29 okuma kopyası · 30
sharding · 31 bölümleme · 34 CAP · 42 GC ayarı · 45 otomatik ölçek · 47 dikey ölçek (Railway panelinde) · 48–49 CDN / kenar önbelleği
(kiracı sayfaları dinamik) · 52 mavi-yeşil · 53 kanarya · 86 çok bölge · 89–90 soğuk başlangıç / serverless · 98 TCP/UDP · 99 HTTP/2-3
(Railway kenarı) · 100 gRPC · 102 API sürümleme (dış API yok) · 106 Helm.

## Kurucuya sorular (müşteri / kimlik / maliyet / panel ayarı — onaysız uygulanmadı)

1. **Dış çalışma süresi izleyicisi (madde 58 / 85):** Railway açılınca ücretsiz bir izleyici (ör. UptimeRobot) `/api/health?strict=1`'i
   5 dakikada bir yoklasın, düşünce size e-posta / SMS gitsin mi? Bugün uygulama dururken haber veren hiçbir şey yok (uyarı e-postası da
   uygulamanın içinden gidiyor). Panel işi, kod değişmez.
2. **Otomatik veritabanı yedeği (madde 84):** Railway'in günlük yedeğini açalım mı (ücretli olabilir) ya da haftalık elle yedek mi? Öneri:
   günlük otomatik + migration'lı her yayından önce elle yedek (bugünkü kural).
3. **Yapay zekâ devre kesicisi (madde 10):** OpenAI art arda 3 kez zaman aşımı / 5xx verirse, 60 sn boyunca model hiç çağrılmasın ve mesajlar
   doğrudan bugünkü yedek yola (`ai/index.ts` model düştüğünde kullanılan deterministik yol) gitsin mi? Bugün her mesaj ayrı ayrı modeli
   bekliyor (reasoning modelinde 60 sn, diğerlerinde 20 sn tavan), sonra aynı yedek yola düşüyor. Örnek: OpenAI çöktüğünde 10 misafir mesajı.
   Bugün 10 × ~60 sn bekleme ve senkron turu uzuyor. Sonra ilk 3'ü bekler, kalan 7'si hemen yedek yola gider. Misafire giden yolun KENDİSİ
   değişmez (aynı yedek yol), yalnız bekleme kısalır. Yine de müşteri akışı olduğu için önce soruyorum.
4. **Oturum anahtarı döndürme (madde 70, kimlik akışı):** `AUTH_SECRET_PREVIOUS` ile eski anahtarla imzalı oturumlar bir süre daha geçerli
   kalsın mı? Bugün anahtar değişirse herkes çıkış yapar. Acil durumda (anahtar sızdı) herkesi çıkarmak istenen davranış, planlı döndürmede
   değil.
5. **Cloudflare WAF / DDoS (madde 74–75):** alan adı zaten Cloudflare'de. Yönetilen kural setini açalım mı? Uygulama bugün Cloudflare
   başlığına bilerek güvenmiyor (`TRUST_CF_HEADER` EKLEME kuralı), bu değişmez. Panel işi.
6. **Gelen kutusu anında güncelleme (madde 24, SSE):** yeni misafir mesajı bugün ~5 sn içinde görünüyor. Anında görünsün mü? Tek kopyada
   sorunsuz, ikinci kopyada ek iş ister. Öneri: şimdilik hayır.
7. **CI'da sır taraması (madde 67):** her push'ta gitleaks benzeri tarama eklensin mi? Test fikstürlerindeki sahte anahtarlar için izin
   listesi gerekir. İlk koşu yanlış alarm verebilir, CI kırmızıya döner (canlı açıkken yayını durdurur).
8. **Ev sahibi rotalarına hız sınırı (madde 75):** oturumlu 25 yazma rotasında (QR cevabı, görev, KB…) hız sınırı yok. Ekleyelim mi? Hatalı
   bir tarayıcı eklentisi / döngü dışında gerçek kullanıcı etkilenmez, ama tavan aşılırsa ev sahibi "çok fazla istek" görür.

## Sonraki adaylar (soru gerektirmeyen, sıradaki turlar)

- E-posta / Hospitable yeniden denemesine deterministik jitter (kuyruktaki `backoffMs` gibi). Önce zaman damgasını birebir sabitleyen
  testler taranacak.
- `SIGTERM` ile zamanlayıcıları durdurup senkron kilidini bırakma. Önce Next'in kendi kapanış davranışı ölçülecek.
- OpenAI çağrısına takip numarası başlığı (`openai-request-contract` pini güncellenerek).
- Kalıcı kuyruk ve sağlık sayaçlarının strict yoklamada sayısız özetle gösterilmesi (metrik yerine).
