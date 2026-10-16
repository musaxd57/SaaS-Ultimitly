# Transactional outbox — bizde ne var, ne eksik, plan (10-16)

> Kurucu (10-16, dört görsel: "Transactional outbox · Polling publisher · Transaction log tailing · Polling mi, log tailing mi? —
> consumer'lar idempotent olmalı"): "görseldeki sistem tarzında bir sistemimiz var mı yoksa mantıklı şekilde eklenebilecek şeyleri
> ekleyelim, bunları da plana ekle, bu kısmı da yap". Envanter: Haiku ajanı (51 satır, dosya:satır) + ana ajanın kodda doğrulaması.

## 1. Kısa cevap

**Var.** Görseldeki desenin üç parçası da kodda, iki kuyrukta canlı / hazır:

| Görseldeki kavram | Bizde | Durum |
|---|---|---|
| **Transactional outbox** — mesajı iş verisiyle AYNI işlemde yaz | `EmailOutbox` (kimlik e-postaları: kayıt doğrulama, şifre sıfırlama / değiştirme kodu, "hesap zaten var") — kullanıcının sır karması ile kuyruk satırı tek işlemde | **CANLI** (`EMAIL_OUTBOX_ENABLED=1`) |
| | `MessageOutbox` (misafire giden her mesaj: AI cevabı, ev sahibi cevabı, karşılama / giriş / çıkış, kapanış teşekkürü) — mesaj satırı + kuyruk satırı tek işlemde | **HAZIR, KAPALI** (`DURABLE_OUTBOX_ENABLED`; açmak senin kararın) |
| | `IngestEvent` (rezervasyon / mesaj olayları — iCal, dosya, QR, sağlayıcı senkronu) — olay iş verisiyle aynı işlemde | **CANLI** |
| **Polling publisher** — kuyruğu düzenli sorgula | 2 dakikalık senkron her geçişte iki kuyruğu da boşaltır; kimlik e-postası için ayrıca 15 saniyelik yoklayıcı. Satır alma `FOR UPDATE SKIP LOCKED` + danışma kilidi → birden çok kopya aynı anda güvenle boşaltır | **CANLI** |
| **Transaction log tailing** (WAL / CDC) | YOK — bilinçli (↓ §3) | — |
| **Idempotent consumer** — "1 e-posta" | E-posta: "güncellik kapısı" — yalnız kullanıcının GEÇERLİ sırrını taşıyan satır gider, eski kuşak iptal; misafir mesajı: mantıksal anahtar (`auto:{konuşma}:{mesaj}`, `welcome:{işletme}:{rezervasyon}` …) + benzersiz kısıt, tek POST, belirsiz sonuçta KÖR TEKRAR YOK (sağlayıcı geçmişinden uzlaştırma, olmazsa insana); olay tüketicisi: `Signal.dedupeKey` benzersiz + `skipDuplicates` + `dispatchedAt` | **CANLI** |

**Dürüst garanti:** "tam bir kez" DEĞİL, "en az bir kez + çift gönderim sınırlı". Sağlayıcı (Hospitable) mesaj gönderiminde tekilleştirme
anahtarı sunmuyor; cevabı kaybolan bir POST'un misafire ulaşıp ulaşmadığı bilinemez → o satır "Doğrulanamadı / İnceleme bekliyor" olur,
otomatik yeniden gönderilmez (Gönderim Kuyruğu ekranı).

## 2. Kuyruk dışı yan etkiler (envanter)

Ev sahibine giden bildirim e-postalarının çoğu kuyruk TABLOSU değil, **"atomik işaret → gönder → başarısızsa işareti geri al"** deseniyle
(bir sonraki 2 dakikalık geçiş yeniden dener): acil şikâyet uyarısı (periyodik tarama), "misafir cevabı bekleniyor", "karar bekliyor", konuşma
öğesi uyarısı, QR acil e-postası, deneme hatırlatmaları. Bu, kuyruğun hafif bir biçimi — işaret kolonu kuyruk satırı yerine geçer.

Kuyruksuz / tekrarsız olanlar (başarısızlık yalnız hata uyarısıyla görünür):
- Elle oluşturulan rezervasyonun "yeni rezervasyon" e-postası, görev atama e-postası, demo talebi (lead) bildirimi — düşük önem.
- İki acil yol işareti BİLEREK geri almaz (gelen mesaj kuralı ile oto-yanıt içi acil e-posta) — denetimde geri almanın iki gerileme getirdiği
  ölçüldü; ev sahibi o anda ekranda "Sorunlu" rozetini görüyor. Değiştirilmedi.
- Paddle plan değişikliği doğrudan çağrı (Paddle tekilleştirme anahtarı sunmuyor) — yerine tek kullanımlık önizleme jetonu + işlem kilidi +
  belirsizde abonelik okumasıyla uzlaştırma var (ödeme idempotency envanteri, 10-10).

## 3. Log tailing neden YOK (öneri: şimdilik eklenmesin)

WAL okuma (Debezium benzeri) PostgreSQL'de mantıksal çoğaltma yuvası + ayrı sürekli çalışan bir süreç ister; Railway'de yuva yönetimi ve
yuva şişmesi (okuyucu durursa WAL birikir, disk dolar) ayrı bir işletme yükü. Bizim hacmimizde (dakikada birkaç mesaj) 2 dakikalık / 15
saniyelik yoklama gecikmesi sorun değil ve yoklama yayıncısı veritabanına özel değil (görseldeki "+ doğru / − DB'ye özel" dengesi). Yatay
ölçek belgesindeki (TASARIM-2026-10-10-load-balancer-yatay-olcek) 2 kopya ön koşulları SKIP LOCKED ile zaten karşılanıyor.

## 4. Bu turda yapılanlar (müşteriye / misafire giden DEĞİŞMEDİ, migration YOK)

1. **Kuyruk sağlığı (operatör paneli → Operasyon Teşhisi):** iki kuyruğun durum sayıları, vadesi gelmiş en eski bekleyen satırın bekleme
   süresi (10 dakikayı geçerse kırmızı — yoklayıcı geride ya da durmuş) ve son 24 saatin kalıcı başarısızlıkları. Yalnız sayılar; metin /
   alıcı yok (`src/lib/outbox/health.ts`, test `tests/integration/outbox-health.test.ts`).
2. **Açılış uyarısı:** şifre sıfırlama isteği e-postayı bayraktan bağımsız kuyruğa yazıyor (zamanlama yan kanalı kapansın diye), ama kuyruğu
   yalnız `EMAIL_OUTBOX_ENABLED=1` boşaltıyor → bayrak kapanırsa sıfırlama e-postası HİÇ gitmezdi, sessizce. Artık açılışta uyarı (hata değil;
   canlıda bayrak açık).
3. Bayat yorum düzeltildi (`outbound-claim.ts` "4×20 sn yeniden deneme" diyordu; gönderim tek atış).

## 5. Plan (sıra önerim — açma / migration kararları senin)

| # | İş | Neden | Migration | Karar |
|---|---|---|---|---|
| O1 | **`DURABLE_OUTBOX_ENABLED` açılışı** — misafir mesajı görseldeki desene tam geçer (mesaj + kuyruk satırı tek işlem; süreç gönderim ortasında ölse de niyet kaybolmaz) | Bugün kapalıyken yol "işaret → gönder → mesajı SONRA yaz"; gönderim ile yazım arasında süreç düşerse misafire giden mesaj bizde kayıtsız kalabilir | Yok (tablo var) | Senin — Railway açılınca, ilk denemeler birlikte; Gönderim Kuyruğu ekranı hazır |
| O2 | **Ev sahibi bildirim kuyruğu** — kuyruksuz üç e-postayı (yeni rezervasyon, görev atama, lead) "işaret + geri al" desenine ya da genel bir `NotificationOutbox`a taşımak | Sağlayıcı arızasında bildirim kaybolmasın | Genel tablo = EVET; işaret deseni = kolon ister | Önce sen: önem düşük; öneri işaret deseni yalnız görev ataması için |
| O3 | **Kuyruk birikme ALARMI** — §4/1'deki okumayı geçiş tabanlı alarma bağlamak (`alertTracker`: ilk 15 dk aşımında bir e-posta, düzelince temizlenir) | Panel bakılmazsa birikme fark edilmez | Yok | Senin — operatör e-postası ekler |
| O4 | Log tailing / ayrı mesaj kuyruğu (Kafka, SQS) | Yalnız çok kopya + yüksek hacimde | — | Bugün gerekmiyor (§3) |

Mutlak iddia yok: bu belge kodun bugünkü hâlini anlatır; canlı env değerleri Railway kapalıyken doğrulanamadı (CLAUDE.md canlı durum tablosu).

## 6. O1 hazırlık incelemesi (Opus, 10-16) — özet

Kodda doğrulandı (dosya:satır kanıtlarıyla; tam rapor oturum notlarında):
- **ENGEL — düzeltildi:** öğe kipinde (canlı) "insanla görüşmek istiyorum" niyetli cevaptan sonra satır içi yol yapay zekâyı SUSTURMUYOR
  (`automation.ts` `human_request && !itemsPlan`), kuyruk yolunun teslim etkisi ve onarıcısı susturuyordu → bayrak açılınca misafirin sonraki
  güvenli soruları 12 saat cevapsız kalırdı. Kuyruk yolu artık tetik misafir mesajında konuşma öğesi varsa kilit kurmuyor
  (`outbox/worker.ts` `itemsModeTurn`, test `tests/integration/outbox-items-handoff.test.ts`).
- **RİSK (karar motoruyla birlikte açılırsa engel):** karar kartı kuyruğa girer girmez "onaylandı / reddedildi" kapanıyor; teslim düşerse kart
  yeniden açılmıyor. O1 denemesinde `HOST_DECISIONS_ENABLED` KAPALI kalsın.
- **RİSK:** ev sahibinin elle cevabı anında değil 2 dk'lık senkron sonunda gider; Hospitable 402'de ev sahibi hata yerine "sıraya alındı" görür;
  karşılama / giriş metni kuyruğa girdiği andaki bilgi tabanından donar.
- **NOT (kurucuya):** bayrak açılınca doğrulanmış erken giriş otomatik onayı kapanır (onay ev sahibine taslak).
- **Temiz:** gönderim kapısı kararları, bayat cevap vetosu, teslimde koşullu "answered", yaşam döngüsü damgası, genel kapatma, KVKK silme.
- Kapanış nezaketi: konuşma kuyruğa girmeden "answered" yapılıyor (yorumla çelişki gerçek) ama misafir yeni yazarsa senkron `new`e çevirir —
  kaybolan yalnız nezaket satırı. `holding_ack` için kuyruğa yazan yok (ölü tür).
- Geri dönüş güvenli (boşaltma bayraktan bağımsız); istisna: iki "teslim edilmemiş taslak" süzgeci bayrağa bağlı — geri dönüşten sonra iptal
  edilmiş taslaklar modele "verilmiş cevap" olarak girebilir (açılıştan önce düzeltilecek).
- İlk deneme önerisi: kurucu işletmesi (Hospitable aboneliği aktif olmalı — 402'de her satır `blocked`), sıra elle cevap → AI cevabı →
  karşılama / giriş / çıkış; başarı: çift gönderim 0, `failed / blocked / review` 0, teslim gecikmesi p95 ≤ ~5 dk; geri dönüş: env'i kaldır.

