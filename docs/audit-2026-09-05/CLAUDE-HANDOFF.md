# Lixus: Güvenlik Kapanışları ve V0 İçin Uygulama Talimatı

Bu metin mevcut uzun ürün vizyonunun teknik tamamlayıcısıdır. Yeni bir ürün vizyonu veya bütün fazları tek seferde yeniden yazma talebi değildir. Yanında [SECURITY-ARCHITECTURE-REVIEW.md](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/outputs/audit-73dbfb4-2026-09-05/SECURITY-ARCHITECTURE-REVIEW.md>) ve mümkünse [probe-results.json](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/outputs/audit-73dbfb4-2026-09-05/probe-results.json>) paylaşılmalıdır.

## 1. Final Product Constraint

Lixus'un nihai hedefi, başka PMS'lerin üzerinde çalışan zorunlu bir AI wrapper değil, bağımsız AI-native PMS / Short-Term Rental Operations OS olmaktır. Hedef native bağlantılar Airbnb, Booking.com ve Vrbo'dur. Hospitable mevcut çalışan bağlantıyı sağlayan geçici bridge olarak korunur; native erişim ve pilot kanıtı olmadan production'dan sökülmez.

Kalıcı operasyonel hafıza, açık sorun/taahhüt takibi, kaynaklı öneriler ve güvenli aksiyon icrası rekabet avantajımızdır. RAG veya model yükseltmesi, yetki ve veri doğruluğu kontrollerinin yerine geçmez.

Ürün vizyonundaki tablo, sınıf, adapter ve modül isimleri örnektir. Mevcut sağlam soyutlamaları koru. Property/Reservation/Conversation/Message/Task zaten varsa bunlara paralel kopya domain kurma. Gerektiğinde mevcut modülleri kanıtla böl, birleştir veya genişlet; isim eşleştirmeye göre mimari kurma.

## 2. Önce Kanıtı ve Hedefi Doğrula

Denetimin hedefi `73dbfb4c039a28c23ace4ce2ab838559028a3bf2`. Çalışacağın dal daha ilerideyse güncel HEAD ile farkı incele; eski satır numarasına göre körlemesine yama yapma. Bir maddenin zaten kapandığını test ve kodla göster, yeniden ekleme.

Rapor 18 öncelikli madde içeriyor. Yanındaki 15 probe gerçek kaynak fonksiyonlarının bağımlılıkları sahtelenmiş çevrimdışı kanıtlarıdır. Tam PostgreSQL integration testi, canlı model, canlı exploit veya tamamlanmış mutation suite değildir. Kanıtın bu sınırını koru.

Codex'in önerilerini otorite kabul etme. Yanlış bulgu varsa karşı örnek, gerçek çağrı yolu ve testle reddet; daha iyi çözüm varsa gerekçeli uygula. Fakat yalnız "mevcut testler yeşil" diyerek gösterilmiş davranışı geçersiz sayma.

Bu metin yeni push/deploy/migration/env yetkisi vermez veya mevcut yetkiyi genişletmez. Bu iş için kullanıcının sana verdiği gerçek yetki ve proje kuralları geçerlidir. Ana repo Codex için salt-okumadır; Codex bu turda oraya dosya eklemedi, silmedi, değiştirmedi, push veya PR yapmadı.

Hiçbir dosyayı silme. Kullanıcı değişikliklerini geri alma. Sırları, gerçek mesajları, prod DB URL'lerini veya credential içeriklerini rapora taşıma. Kanıt için sentetik veri ve izole ortam kullan.

## 3. Current Task

Önce aşağıdaki yüksek öncelikli güvenlik ve veri doğruluğu açıklarını kapat. Sonra mevcut uzun promptun V0 işine geç. Property Memory/Revenue Brain/görsel tur gibi sonraki işleri bu güvenlik düzeltmelerine karıştırma.

Rutin teknik kararları gereksiz onay sorularıyla kullanıcıya bırakma. Ancak gerçek veri silme/anonimleştirme, prod ayarı, credential rotasyonu, ticari para akışı veya migration için mevcut özel yetki sınırını atlama. Bloklu operasyon adımını açık kaydet; bağımsız kod ve izole test işine devam et.

### A. Düzeltme Öncelikleri

1. **F08, test DB güvenliği:** Test koşturmadan önce [tests/global-setup.ts](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/tests/global-setup.ts>) ve kardeş reset/seed yollarının disposable DB dışında veri kaybettiren işlem yapamadığını garanti et. Yalnız URL'de test kelimesi aramak yeterli değil. Production credential'ı test ortamına hiç taşınmasın.
2. **F01, AI output:** Strict şema; eksik risk veya coercion ile güvenlik alanı üretme. Boolean confidence veya eksik risk hiçbir otomatik mesaj gönderimine yetki vermesin. Geçerli zararsız yanıtı engelleyen aşırı düzeltme de testte kırılsın.
3. **F02, QR bilgi sınırı:** Uzun KB'nin ortasını atlayıp tam metni modele verme açığını kapat. Bounded içeriği bütünüyle işle; işlenemeyen veriyi fail-closed ele al. Sır görünürlüğünün kalıcı çözümünü field/category access policy olarak kur; blacklist'i yetkilendirme yerine kullanma.
4. **F03, silme ve outbox:** Normal conversation/property DELETE yollarını da kuyruğun iptal/redaksiyon sözleşmesine bağla. Missing Message manuel mesaj demek olmasın. AI, host, holding-ack ve lifecycle türleri için hedef varlığı/tenant/connection kontrolü açık olsun. Claim sonrası bellek snapshot'ını ayrıca sınayıp sınırını yaz.
5. **F04, OAuth refresh:** Başarı tarafına connection ownership/version fencing ekle. Gecikmiş refresh disconnect'i geri çevirmesin, reconnect ile seçilen hesabı eski hesapla ezmesin. CAS kaybında token'ı çağırana aktif token gibi döndürme. Birden fazla instance yarışını ölç.
6. **F05, teslim ve escalation:** Provider cevabı beklenirken yeni inbound/problem oluşursa eski teslim bunu answered yapamasın. Delivery ACK ile konuşmanın iş durumunu ayır; yeni trigger/revision korunmalı. lastMessageAt geriye yazılmamalı.
7. **F06, session fail-closed:** Sayfa tarafı güncel epoch/MFA doğrulayamazken eski allowlist+MFA claim'iyle hassas sorguya ilerleyemesin. Page/API ortak doğrulama politikası; geçici DB arızası ile geçersiz oturumu ayrı işle.
8. **F07, retention kapsamı:** Message-age düzeltmesi ile tam yeniden-temizlenebilirlik aynı şey değildir. Adı anonim kalırken eklenen telefon, not, outbound PII ve türevler tekrar değerlendirilmelidir. Seçici kapsamını, sonlanmayı, parti ilerlemesini ve taze mesajların korunmasını birlikte test et. Bayrağı bu metne dayanarak production'da açma.

F09/F10 merkezi log politikası ve F12 audit şema kontrolünü bu tura yakın ele al. Ardından F11 obje yaşam döngüsü, F13 property-fact ayrımı, F14 bağlam/tarih, F15 evaluator, F16 iCal completeness, F17 sync adaleti ve F18 login savunma tasarımını ilgili modül turunda tamamla. Tek büyük commit'te hepsini birbirine bağlama; mantıksal düzeltme sınırları olsun.

### B. Her Düzeltmede İstediğim Kanıt

- Önce gerçek production fonksiyonunu/rotasını kullanan kırmızı davranış testi. Fonksiyonun test içinde yeniden yazılmış bir kopyası değil.
- Beklenen HTTP statüsünün yanında sonuç: yanlış veri hiç dönmedi, provider hiç çağrılmadı, DB'de yeni sorun ezilmedi, silinmiş veri yeniden oluşmadı.
- Düzeltme sonrası yeşil.
- Koruyucu kontrolü kaldırınca ilgili test kırmızı.
- Aşırı kısıtlayan mutasyonda meşru akış kırmızı. Her şeyi 401/false/no-op yaparak güvenlik testi geçmesin.
- Sıralama yarışlarında kontrollü promise/barrier ile gerçek fonksiyon akışı ve izole PostgreSQL üzerinde iki bağlantılı integration testi. Prisma delegate spy'ı bozuyorsa injection/modül sınırını düzelt; gerçek yarışı sırf kaynak-regex pinine bırakma.
- Feature flag varsa açık/kapalı ve geçiş durumlarını ölç. Bayrak kapalı diye test edilen güvencenin production'da aktif olduğunu söyleme.
- Dosya metninde bir kelime arayan test yardımcı canary olabilir; tenant/veri/yan etki kontratının tek kanıtı olamaz. indexOf/slice çapaları bulunmayınca test sert biçimde başarısız olsun.

Her push için mevcut zorunlu kapıları koru: typecheck, lint, tam test, build, e2e, migration-chain ve security-audit. İlgili mutasyonlar mantıksal düzeltmeye bağlansın; sonradan dosya değiştiyse eski yeşil sonucu yeni HEAD'in kanıtı sayma. CI'nın sonucu doğrulanmadan bitti deme. Kodun deploy olması ve production smoke ayrı satırlardır.

## 4. V0 İçin Teknik Değişmezler

### Identity ve Tenant

- Core business logic Hospitable payload, credential veya endpoint semantiği gerektirmesin.
- Sales channel, connectivity provider ve protocol ayrı kavramlar. Airbnb rezervasyonu Hospitable veya başka meşru kaynak üzerinden gelebilir; iCal tek başına satış kanalı değildir.
- External ID global benzersiz varsayılmasın. Provider/account/connection/entity kapsamı gerçek sözleşmeye göre belirlensin. Tenant scope her read/write/dispatch'te korunsun.
- Yerel ID'ler, mevcut ilişkiler ve denetim geçmişi korunmalı. Ad/e-posta/tarih benzerliğinden otomatik guest/reservation merge yapma.
- Current outbox ve tombstone anahtarları mapping değişince anlamını kaybetmesin. Yeni kaynak yolu silinmiş veriyi yeniden oluşturmasın.

### Connector ve Teslimat

- Yeni adapter yalnız HTTP wrapper değil: capabilities, yetki, kimlik, normalize event, cursor/completeness, rate limit, typed errors, disconnect/reconnect ve delivery outcome sözleşmesi taşımalı.
- Mevcut `sendOnChannel` facade'ını değerlendir; gereksiz ikinci dispatch hattı kurma.
- `queued`, `provider accepted`, `delivered`, `local-only`, `failed`, `unknown` birbirinden ayrı olsun. Desteklenmeyen yetenek success gibi gösterilmesin.
- Provider timeout sonrası sonucu belirsiz yan etkiyi otomatik retry ederek çift mesaj/çift işlem üretme. Mevcut outbox unknown/reconciliation politikası korunmalı.
- Her dış yan etkiye tek yetkili yazar. Shadow parity salt hesap/okuma karşılaştırmasıdır; iki connector'ın aynı mesajı göndermesi değildir.
- Yeni bağlantı eski connection generation'ının refresh, webhook, polling veya queued işiyle ezilemesin.
- Mevcut SSRF, DNS pinning, redirect, byte/deadline, signature, idempotency ve tenant korumaları adapter sınırının altında kalmalı; bypass edilmemeli.

### Veri Geçişi

Önce reader/writer ve constraint haritası çıkar. Gerekirse additive şema, idempotent bounded backfill, tenant bazlı count/conflict/mismatch raporu, eski-yeni read parity ve kontrollü dispatch geçişi uygula. Unmatched/ambiguous kaydı tahminle birleştirme. Eski sürüm rollback uyumluluğunu ve bekleyen işlerin davranışını test et.

Migration gerekiyorsa yerelde hazırla ve prova et. Taze doğrulanmış pg_dump, gerçek restore kanıtı ve açık prod yetkisi olmadan migration içeren commit'i oto-deploy branch'ine gönderme. `pg_restore -l` ve SHA256 tek başına başarılı uygulama restore'u değildir. DB'de sorgu örnekleri veya gerçek değerler loga taşınmasın.

V0 boyunca çalışan Hospitable bridge ve iCal korunur. Airbnb doğrudan erişimi yokken endpoint, scope veya başarı durumu icat edilmez. Native bağlantı önce resmi erişim, contract test, temsili demo ve küçük gerçek pilotla doğrulanır.

## 5. Sonraki AI Fazına Taşınacak Gereksinimler

Bunları V0'ı şişirerek erken implement etme; veri/izin sınırları bunlara engel olmayacak biçimde kurulsun:

- Son 25 mesaj + token bütçesi, kararlı sıra, author/direction/timestamp/delivery bilgisi.
- Pencerenin dışına atılarak kaybolmayan açık sorun ve cevapsız taahhütler; aynı tenant/konaklama kapsamlı, kaynaklı özet.
- RAG'e property/tenant/access filtreleri retrieval öncesi uygulanmalı. Kaynak kimliği, sürümü, geçerlilik zamanı ve silme yayılımı tutulmalı. Başka tenant'a ait vector sonuçları sonradan promptla filtrelenmez.
- Availability modeli değil kodu sorgular. Tarih-only/timezone, aralık, iptal/blok/tampon/kapasite, freshness/coverage ve unknown durumu açık olsun. İzin veren takvim okuması rezervasyon garantisi değildir.
- Yapılandırılmış tesis gerçekleri ve host üslubu ayrıdır. `aiStyleProfile` property A gerçeğini property B için kaynak yapamasın.
- Her AI generation için input IDs/snapshot, kaynak/araç kanıtı, policy/model sürümü, taslak/gerçek teslim, karar, latency/token/maliyet kaydı. Gizli model düşünce zinciri istenmez.
- Read-only founder quality console: allowlist + güncel MFA; list/detail/export ayrı kontrol; amaç ve erişim audit'i. Misafire mesaj gönderme veya misafir adına işlem yapma yeteneği bu konsolda bulunmasın. Kalite etiketi/iç not ayrı capability olabilir.
- Production sohbetinden eval'e bilinçli, redakte, provenance koruyan terfi. Harici training/fine-tuning'e otomatik aktarım yok. Türevlerin retention/erasure ve backup restore politikası kapsamlı olsun.
- Eval release gate: desteklenmeyen gerçek, missed context, tekrarlı selam, tarih hatası, stale knowledge, retrieval/tool hatası, unsafe autosend ve escalation failure. Model yükseltmesini aynı ölçüm setiyle kıyasla.

Airbnb başvurusu için yalnız iyi kod yeterli sayılmasın: izinli veri kullanımı, access/scope matrisi, security review kanıtı, demo tenant, yedek/restore ve incident runbook hazır olsun. API verisinin tüm analitik/eval/üçüncü taraf AI kullanımlarını otomatik izinli varsayma; geçerli program ve partner koşullarına göre ayır. 100 property keyfî blocker olmasın; gerçek ürün kullanımı ve işletim kalitesi gösterilsin.

## 6. Tur Sonunda Raporlama

Her madde için şu alanları yaz:

`Bulgu → gerçek kök neden → ön koşul → düzeltme → kırmızı-önce test → kaldırma mutasyonu → aşırı-kısıtlama kontrolü → integration/critical-flow → commit → son HEAD CI → deploy → prod smoke → kalan risk`.

Kod hazır, flag kapalı, dış servis kurulmadı veya prod doğrulanmadı durumlarını ayrı göster. Yapısal pin ile tam uçtan uca kanıtı aynı isimle sunma. Yeni bir açığı test sırasında keşfedersen önce etkisini sınıflandır; önemliyse düzeltme kapsamını gerekçeli genişlet, ürünü kozmetik olarak yeniden yazma.

Token veya zaman nedeniyle bitmezse tamamlanmış iş, gerçek son commit, uncommitted değişiklikler, çalışan testler ve en küçük sonraki adımı kalıcı durum belgesine yaz. Kullanıcının yeniden araştırma yapmasını gerektiren "devam edilecek" notuyla bırakma.
