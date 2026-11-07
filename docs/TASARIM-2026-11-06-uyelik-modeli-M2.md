# TASARIM — M-2 üyelik modeli: tek kullanıcı, işletme başına üyelik (2026-11-06, Opus incelemesiyle 2. sürüm)

> Kurucu 11-06 sabah: "k-2yi yapmaya başla … bekleme hemen işe koyul". Codex: "temizlikçi akışını 'bir e-posta yalnız bir işletmeye ait
> olabilir' varsayımı üzerine büyütmeyelim … oturum, aktif işletme, yetki kontrolleri, bildirim hedefleri ve mevcut kullanıcıların geçişi
> birlikte incelenmeli; önce M-2'nin uygulanabilir kapsamı, ardından davet bu temele bağlansın."
> 1. sürüm: üç Haiku envanter taraması + kodda doğrulama. 2. sürüm: Opus derin incelemesi (21 bulgu, M1–M21, her biri dosya:satır
> kanıtlı) bu belgeye işlendi; bulgu numaraları köşeli parantezde ([M5]). Kurucu soruları §12.

## 0. Hedef (kurucunun örneği)
- **Kullanıcı:** Ayşe (tek hesap, tek e-posta, tek şifre, tek 2FA).
- **A işletmesindeki üyeliği:** temizlikçi · Lale 3 ve Lale 5 görevleri. **B'deki üyeliği:** temizlikçi · başka daire.
- A'daki erişimi kaldırılınca B'deki üyeliği ETKİLENMEZ. Davet mevcut hesabı TAŞIMAZ, şifresini DEĞİŞTİRMEZ; kişi kendi hesabıyla
  doğrulanarak katılır.

## 1. Bugün ne var (envanter, kodda doğrulandı)
**Model.** `User.organizationId` (tek işletme, NOT NULL, `onDelete: Cascade`) · `User.role` (owner | manager | staff, **varsayılan
"owner"** [M19]) · `User.email @unique` · `User.sessionEpoch`. Üyelik / davet / işletme değiştirme YOK; ekip ekleme rotası YOK (personel
hesabı bugün yalnız operatör / demo / test yoluyla).

**Oturum.** JWT `{ userId, organizationId, role, email, name, sessionEpoch, mfa, actor*, impersonatedAt }`; `verifySession` alan alan
BEYAZ LİSTE (eklenmeyen iddia sessizce düşer) [M4]. `requireSession` (API) ve `requireAuth` (sayfa) kullanıcı satırını okur ve
`organizationId`'yi **kullanıcı satırından üstüne yazar** — JWT'deki işletme bugün hiç kullanılmıyor [M4]; sayfa yolu rol farkında
oturumu düşürür (B2). Kabuk adı `user.organization.name`. Bürünme: hedef işletmenin en eski sahibi; çıkış operatörün ana işletmesine.

**Kişi ↔ işletme okuyucuları (≈60 yer, Opus listesi [M12]):** `user.findFirst({ id, organizationId })` (görev atama, dairenin
temizlikçisi, bildirim, kimlik e-postası) · ilişki süzgeçleri `users: { where: { role: "owner" } }` (acil uyarı, karar, tehlike, QR,
deneme hatırlatma, ev sahibi kanalı e-postası, döküm, operatör) · `_count.users` (operatör paneli, doğrulanmamış süpürge) · başka adlı
değişkenler (`actor.organizationId`, `u.organizationId`, `assignedTo.role`) · **ham SQL** (hesap silme ön koşulu, süpürge, iki operatör
betiği). Kaynak taraması bunların çoğunu GÖRMEZ → derleyici pin olur (§6.3).

**Rol kararını KULLANICI satırından veren yerler [M1]:** atama e-postasının temizlikçi görünümü (`tasks/notify.ts`, `api/tasks/[id]`),
ev sahibi WhatsApp uygunluğu (`host-channel/binding.ts`, `answer.ts`). Üyelikte bu, başka işletmede SAHİP olan temizlikçiye misafir adı /
mesajı göndermek demek → kural §4.

**Kişiye bağlı işletme ayarları [M5]:** `Organization.alertEmail` (yalnız YAZARKEN ekip üyeliğiyle denetlenir, gönderimde olduğu gibi
kullanılır) · dairenin temizlikçisi kuralı (`AutomationRule.actionJson.userId`) · açık görev atamaları · `HostChannelBinding`
(işletme + kullanıcı, numara GLOBAL tekil [M3]).

**Silme [M7].** Hesap silme işletmeyi siler → `User.organizationId` Cascade → o işletmenin bütün kullanıcıları silinir. İki çağıran
(hesap silme rotası, doğrulanmamış kayıt süpürgesi), ikisinin de ön koşulu ham SQL.

## 2. Hedef model
```
Membership
  id             String   @id                     // doldurmada belirlenimli: 'mem_' || md5(userId || ':' || orgId) [M10]
  userId         String   → User (Cascade)
  organizationId String   → Organization (Cascade)
  role           String                           // owner | manager | staff — VARSAYILANSIZ
  status         String   @default("active")      // active | revoked
  epoch          Int      @default(0)             // rol değişimi / çıkarma → o işletmedeki oturumlar düşer
  origin         String                           // signup | operator | demo | backfill | invite — kötüye kullanım sinyalleri için [M9]
  invitedById    String?  → User (SetNull) [M10]
  revokedAt      DateTime?
  createdAt      DateTime @default(now())         // doldurmada = User.createdAt ("en eski sahip" sıralaması değişmesin) [M10]
  updatedAt      DateTime @updatedAt
  @@unique([userId, organizationId])
  @@unique([userId])            // 🚨 GEÇİCİ BEKÇİ [M11]: dilim 6c'ye kadar kişi başına TEK üyelik veritabanında imkânsız
  @@index([organizationId, status])
User += lastActiveOrganizationId String? → Organization (SetNull)   // iki ilişki → @relation adları [M10]
```
- **Kimlik kullanıcıdadır** (e-posta, şifre, 2FA, `sessionEpoch`, "beni hatırla", tanınan cihaz); **yetki üyeliktedir** (işletme, rol,
  üyelik kuşağı). `sessionEpoch` yalnız KİMLİK olaylarında artar (şifre, 2FA sıfırlama) [M16].
- `User.organizationId` / `User.role` geçiş boyunca **ana işletme aynası**; yalnız tek yazıcı (§6.2) yazar. Okuyucular dilim 3'te
  üyeliğe geçer; ayna yetki / görünüm kararında OKUNMAZ (§4).
- Daire kapsamı alan değil ayrı tablo, yalnız personel, boş küme = hiçbir daire (fail-closed) [M20] — ayrı dilim (§8).

## 3. Oturum ve aktif işletme [M4, M14, M15]
- JWT'ye `membershipId` + `membershipEpoch` girer (kimlik farklı olunca yeniden davet eski token'ı DİRİLTEMEZ — ABA [M4]).
  `verifySession` beyaz listesine eklenir; sayı değilse 0 (`sessionEpoch` emsali); `session-payload-roundtrip.test.ts` `FULL`'a eklenir.
- **Tek doğrulayıcı** `resolveSessionMembership(session)`: kullanıcı + `(userId, session.organizationId)` üyeliği tek Prisma çağrısında (iki
  SQL sorgusu — iç içe seçim ayrı sorgudur, Opus S12);
  `requireSession`, `requireAuth`, `(app)/layout` üçü de bunu kullanır. Üyelik yok / `revoked` / kuşak ya da kimlik farklı → oturum
  GEÇERSİZ. Rol üyelikten. **İki `organizationId` üstüne-yazması SİLİNİR** (pin: JWT'de B, ana A → `requireSession` B döner). Sayfa
  yolunda `membership.role !== session.role` → çıkış (B2 anlamı korunur).
- Eski (iddiasız) token: kuşak 0 = doldurulan üyelik kuşağı 0 → sessizce geçerli. **Toplu `sessionEpoch` artırma YAPILMAZ** (WhatsApp
  bağları, "beni hatırla" ve tanınan cihaz çerezleri ölürdü).
- **Giriş / e-posta doğrulama:** tek seçim `pickLoginMembership(userId)` = son kullanılan AKTİFSE o → ana AKTİFSE o → en eski aktif →
  hiçbiri yoksa oturum BASILMAZ, sade metin: "Hesabınız şu an hiçbir işletmeye bağlı değil." (davet ipucu yok — bugün bu dala yalnız
  kayan dağıtım artığı düşer; Opus S5) (bu dala yalnız doğru şifre + 2FA ile ulaşılır — numaralandırma yok). Etkin üyelik yoksa
  kurtarma kodu YAKILMAZ: geçerliliği tüketmeden sınanır, sonra 403 (Opus S7). ~~Giriş kaydı seçilen işletmeye [M6].~~ → **Ü-3
  kararına kadar GİRİŞ ROTASININ bütün kimlik kayıtları (başarılı / başarısız giriş, 2FA hatası, kurtarma kodu) kişinin ANA işletmesine —
  tek kural (Opus S8; başarısızlık üyelik seçilmeden yazılır, iki kural yan yana A'nın dökümüne B'nin denemelerini taşırdı).** Oturum
  içindeki kimlik işlemleri oturumun işletmesine yazar: `account.password_change` (`account/password`), `2fa_enable` / `2fa_disable` /
  `2fa_recovery_generate` (`account/2fa`), `account.reauth_failed` (`auth/reauth-guard.ts`) — beşi de Ü-3 kapsamında (Opus R4). **Ü-3
  dilim 6a'dan ÖNCE karara bağlanır:** 6a ile A'dan çıkarılan ama aynası A'da kalan kişinin her hatalı girişi (IP'li) A'nın günlüğüne
  düşmeye devam ederdi.
- **İşletme değiştir** (dilim 6c): `POST /api/account/switch-organization` + `withAuth`; **bürünme oturumu REDDEDİLİR** (operatör
  işletmeler arası yalnız `/api/admin/enter`); denetim kaydı yalnız HEDEF işletmeye, kaynak kimliği taşımadan; yanıttan sonra tam sayfa
  yükleme (istemci önbelleği 30 sn — `staleTimes`).
- Kabuk adı aktif üyeliğin işletmesinden; `exitImpersonation` operatörün kendi üyeliğini (son kullanılan → ana) kuşağıyla imzalar.

## 4. Yetki ve görünüm kararları [M1, M21]
- **Kural:** oturum dışındaki bir kişi hakkındaki HER rol kararı (temizlikçi görünümü, ev sahibi kanalı uygunluğu, alıcı listesi) o
  kişinin **O İŞLETMEDEKİ** üyelik rolüyle verilir; `User.role` yetki / görünüm kararında okunmaz.
- Yardımcı boolean değil ÜYELİK döndürür: `activeMembership(db, orgId, userId) → { id, role } | null`.
- Atama doğrulaması atamayla AYNI işlemde, üyelik satırı `FOR SHARE` (çıkarmayla yarışta çıkarılmış kişiye görev yazılmasın).
- Kiracı kapsamı (bütün rotalar `session.organizationId`) DEĞİŞMEZ.

## 5. Bildirim hedefleri [M3, M5, M18]
- İşletmenin sahip / yöneticileri → `orgMembers(db, orgId, { roles })` (aktif üyelikler; sıralama "en eski sahip üyeliği" = bugünkü kişi).
- `alertEmail` GÖNDERİM anında yeniden denetlenir: hâlâ aktif üye adresi değilse (ve doğrulanmış dış adres değilse) sahip adresine düşer.
- **En az bir aktif sahip** değişmezi: son sahibi çıkaran / düşüren / ayrılan işlem reddedilir (sahipsiz işletmede acil uyarılar sessizce
  durur).
- Kişiye giden bildirim metninde işletme / daire adı yazılır (çok işletmeli kişi). Davet e-postasında işletme adı YOK (kimlik e-postası
  kuralı); kabul sayfasında oturum açıldıktan sonra görünür [M13 notu].
- WhatsApp: bugünkü bağ işletme + kullanıcı, numara global tekil — §12 Ü-5 kararı; her iki yolda çıkarma / rol düşürme o işletmedeki
  bağları AYNI işlemde iptal eder, bağ `membershipId` taşır.

## 6. Mevcut kullanıcıların geçişi
### 6.1 Migration (dilim 1) [M10]
- Yeni tablo + doldurma aynı migration'da: `INSERT INTO "Membership" (id, "userId", "organizationId", role, status, epoch, origin,
  "createdAt", "updatedAt") SELECT 'mem_' || md5(u.id || ':' || u."organizationId"), u.id, u."organizationId", u.role, 'active', 0,
  'backfill', u."createdAt", CURRENT_TIMESTAMP FROM "User" u ON CONFLICT DO NOTHING`. Önce `SELECT role, count(*) … GROUP BY role`
  beklenmeyen değer yok mu.
- Doğrulama: 91'e kadar migrate edilmiş, kullanıcı TOHUMLANMIŞ bir veritabanında 93'ü koş (boş veritabanı sahte yeşil verir); sıfır sapma.
- Kayan dağıtım boşluğu: dilim 2'nin migration'ı aynı doldurmayı tekrarlar; `/api/health?strict=1`'e "üyeliksiz kullanıcı = 0".
- Numara: son migration 91; 92 `{daire}` tasarımına ayrıldı (kod yok) → üyelik 93.

### 6.2 Tek yazıcı [M11, M16]
- `createUserWithMembership(tx, …)` — dört yaratıcı (kayıt, operatör müşteri açma, demo kiracı, `prisma/seed.ts`) + demo yenilemesinin rol
  güncellemesi + (dilim 4) yeniden-ana-işletme. Tetikleyici RED (testte `db push` yüzünden yok, üretimde var → hatayı gizler);
  "üyelik yoksa eski sütun" RED (silinen üyelik kişiyi geri üye yapar).
- Demo / operatör değişmezi [M17]: demo kimlikli kullanıcı yalnız demo işletmesine, demo işletmesine yalnız demo kimlikleri üye olur;
  operatör adresi müşteri işletmesine üye OLAMAZ (davet de oluşturulamaz).

### 6.3 Derleyici pini (dilim 3) [M12]
- Prisma alanları SQL'e dokunmadan yeniden adlandırılır: `homeOrganizationId @map("organizationId")`, `homeRole @map("role")`, ilişkiler
  `homeOrganization` / `homeUsers`. Sütun adları aynı → `migrate diff` sıfır sapma. Derleyici BÜTÜN okuyucuları listeler; her biri ya
  üyeliğe çevrilir ya "ana işletme" anlamıyla bilinçli kalır. Kaynak taraması yalnız ham SQL için (izin listeli).
- Testler: yardımcı `makeUser({ orgId, role })`; `tests/` altında yardımcı dışı `prisma.user.create` yasak (küçülen izin listesi).
- `User.role` varsayılanı kaldırılır [M19] (`DROP DEFAULT` dolu tabloda güvenli; unutanı derleyici yakalar).

## 7. Silme, çıkarma, KVKK [M2, M5, M6, M7, M8, M18]
- **Taşı-sonra-sil** `deleteAccountData`'nın İÇİNDE, ön koşuldan sonra, `organization.delete`'ten önce; kalan üyelik satırları
  `FOR UPDATE` (çıkarma da aynı satırları aynı sırayla kilitler). İki ham SQL ön koşulu üyelik tablosuna çevrilir. Süpürge: adayın başka
  HERHANGİ bir üyeliği varsa atlanır ("terk edilmiş kayıt" değildir).
- **Çıkarma / rol değişikliği TEK işlem, tek yazıcı:** üyelik `revoked` (+ kuşak artışı) · ana üyelikse ayna yeniden yazılır (aktif
  üyelik kalmadıysa §12 Ü-1) · o işletmedeki WhatsApp bağları iptal · kişiyi gösteren temizlikçi kuralları devre dışı · başlanmamış
  görevleri atanmamışa · `alertEmail` onunsa boşaltılır · kişinin gönderdiği bekleyen davetler iptal · son sahip korunur · denetim kaydı.
- Kimlik olayları (giriş IP'si, 2FA, şifre) işletme günlüğünde değil KİŞİDE (§12 Ü-3) — başka işletmenin dökümü görmesin.
- İşletme dökümünde üye = ad, e-posta, o işletmedeki rol, katılma / çıkarılma anı; kimlik alanları kişinin kendi dökümünde [M21].

## 8. Daire kapsamı (personel) — ayrı dilim [M20]
- `MembershipProperty(membershipId, propertyId)` FK Cascade + üyelikte `allProperties Boolean`. Yalnız personel; boş küme = hiçbir daire.

## 9. Davet [M13, M17]
- `StaffInvite { organizationId, email, role, tokenHash, expiresAt, status, invitedById(SetNull), … } @@unique([organizationId, email])`
  (aynı adrese tek satır, durumla yeniden kullanılır — kısmi tekil dizin Prisma'da ifade edilemez, testte olmazdı).
- Belirteç URL parçasında (`#t=`), e-posta tarayıcısı açınca TÜKETİLMEZ; açık **"Katıl"** + POST.
- **Kabul şartları:** oturum e-postası = davet adresi (değilse "Bu davet başka bir e-posta adresine gönderildi", davet tüketilmez) ·
  bürünme oturumu kabul edemez · kabul `emailVerifiedAt` yazar (bağlantı posta kutusunu kanıtlar) · yeniden davet çıkarılmış üyeliği
  AYNI satırda etkinleştirir + kuşağı artırır (sil-yarat yok) · davet rolü ilk sürümde yalnız `manager | staff`.
- Operatör ve demo adresleri davet edilemez.

## 10. Dilimler (sıra — 2. sürüm) [M16]
1. **Şema + belirlenimli doldurma + tek yazıcı** (migration 93, `@@unique([userId])` bekçisi). Okuma değişmez.
2. **Oturum üyelikten** (§3): `resolveSessionMembership`, beyaz liste, üstüne-yazmaların silinmesi, B2, kabuk, operatör çıkışı,
   `pickLoginMembership`; doldurma tekrarı + sağlık denetimi.
3. **Okuyucular üyeliğe** (§4–§5): derleyici pini (`@map`), `activeMembership` (rol döndürür) — temizlikçi görünümü üyelik rolünden
   (kırmızı-önce: A'da sahip, B'de personel kişiye B'den giden e-posta personel görünümünde), `orgMembers`, ham SQL, süpürge, deneme
   sinyalleri `origin`'le; test yardımcısı + pin.
4. **Silme güvenliği** (§7 taşı-sonra-sil) — çok üyelik henüz İMKÂNSIZKEN kanıtlanır.
5. **6a Ekipten çıkar / rol değiştir** (tek üyelikli kişide, bekçi yerinde) — §7 tek işlem + son sahip.
6. **6b Davet yalnız KAYITSIZ adreslere** (yeni kişi = yine tek üyelik) + §9 kabul şartları.
7. **6c Bekçi düşer:** kayıtlı kişiye davet (çok üyelik) + işletme seçici (§3).
8. Daire kapsamı (§8).
- Her dilim: kırmızı-önce, mutasyon, tam kapı. **Migration'lı push = taze yedek + açık onay** — Railway kapalı (canlı veri yok); yine de
  push kurucu onayıyla. Dilimler ayrı dalda birikir.
- Geri dönüş: ilk çıkarma yazıldıktan sonra dilim 3'ü geri almak YASAK (çıkarılan herkes aynadan geri girerdi) — geri dönüş = önce
  çıkarma / davet anahtarını kapat [M2].

### 10.1 Uygulama durumu (dal `m2/membership`, push EDİLMEDİ — migration'lı, kurucu onayı)
- **Dilim 1 ✓ `99c2e014`:** tablo + migration 93 (dolu veritabanında denendi; taze ve dolu veritabanında sapma sıfır) + tek yazıcı (kayıt,
  operatör, demo, tohum) + geçici tek-üyelik bekçisi. 12 dosya / 123 test, kırmızı-önce 4, mutasyon 14/14.
- **Dilim 2 (yazıldı, doğrulanıyor):** `requireSession` / `requireAuth` / `(app)/layout` üyelikten (işletme üstüne yazması SİLİNDİ, B2 üyelik
  rolüyle, kabuk adı oturumun işletmesinden) · beyaz listede `membershipId` + `membershipEpoch` · giriş, e-posta doğrulama, bürünme
  giriş / çıkış `pickLoginMembership` + `membershipClaims` · etkin üyeliği olmayan kişiye oturum basılmaz (sade metin) · migration 94
  (doldurma tekrarı: yalnız HİÇ üyelik satırı olmayan kullanıcı; çıkarılmış üyelik dirilmez) · strict sağlık: üyelik satırı olmayan kullanıcı
  → 503 · test yardımcısı `makeUser` (üretim yazıcısıyla), gerçek doğrulamadan geçen 15 test dosyası ona çevrildi.
- 🚨 **Yayın sırası (Opus M10c):** dilim 1 TEK BAŞINA yayınlanır (yazıcı yeni hesaplara üyelik yazmaya başlar); dilim 2 SONRAKİ yayında
  (migration 94, dilim 1 yayını sırasında eski kodun açtığı hesapları yakalar). İkisi tek yayında giderse o aralıkta açılan hesap giriş
  yapamaz (sağlık denetimi bunu 503 ile gösterir; onarım betiği `scripts/membership-backfill.ts`: önce salt-okuma, sonra
  `MEMBERSHIP_BACKFILL_APPLY=1` + `MEMBERSHIP_BACKFILL_EXPECT=<sayı>` — 94'ün ifadesi dosyadan, sayı değiştiyse yazmaz).
- **Dilim 2 Opus incelemesi (S1–S12, `scratchpad` raporu; üretim istek yolunda P1 açık YOK)** — kalıcı notlar:
  - 🚨 **S3 ön koşulu (dilim 4–6'dan ÖNCE):** iddiasız (üyelik kimliği taşımayan) eski belirteçler kuşak 0 sayılır ve kimlik denetimini atlar.
    Bugün üyelik satırını SİLEN yol yok (çıkarma = `revoked` + kuşak; tek yazıcı pini silmeyi yazıcının KENDİSİ dahil yasaklar — Opus R3), açık kapalı. Satırı silip aynı
    (kişi, işletme) için yeniden yaratan herhangi bir yol eklenmeden ÖNCE iddiasız belirteçlere son tarih konur (emsal
    `LEGACY_SESSION_COOKIE_READ_UNTIL`) — yalnız yeniden giriş ister; cihaz güveni ve WhatsApp bağları `sessionEpoch`e bağlı, etkilenmez.
    Ayrıca `requireSession` / `requireAuth` doğruladığı üyeliğin kimliğini / kuşağını oturuma yazar → parola / 2FA yeniden imzaları belirteci
    yükseltir (pin `membership-session-pins.test.ts`). Son tarihten ≥14 gün ÖNCE (oturum penceresi): `requireSession` iddiasız belirteci
    bir kez yeniden imzalar (yalnız API yolu — sayfa yolu çerez yazamaz; bürünme belirteci hariç, ≤2 sa yaşar) → son tarih yalnız 14 gündür
    hiç API çağırmamış belirteci düşürür. Bugün YAPILMADI: silme yolu olmadan faydası yok, her kimlikli API yanıtına çerez yazımı ekler
    (çerez sayımı ölçen 5 test dosyası). Son tarihle aynı turda, ayrı yayında.
  - **S6:** WhatsApp ev sahibi kanalı (`host-channel/binding.ts`, `answer.ts`) yetkiyi hâlâ aynadan (`User.organizationId` / `User.role`)
    veriyor — "oturum üyelikten" yalnız web oturumunu kapsar; kanal dilim 3'te `activeMembership`'e bağlanır (M1 listesi).
  - **S10:** kalıcı karar #211 ("rol değişince `sessionEpoch` artar") ile üyelik kuşağı mekanizması ayrıştı → kurucu sorusu Ü-4'e eklendi.
  - **S11:** "hiç üyelik satırı yok = arıza" sayacı ve onarım betiği, Ü-1 "askıda hesap" seçilirse o tasarımla birlikte yeniden tanımlanır
    (yoksa askıdaki hesap kalıcı 503 verir ve betik onu ana işletmesine geri yazar).

## 11. Riskler
- Oturum doğrulaması her istekte bir satır daha okur — `requireSession` kullanıcıyı zaten okuyor; iç içe seçim aynı Prisma çağrısında
  AYRI bir SQL sorgusudur (`relationJoins` yok; Opus S12 / R10).
- 179 test dosyası kullanıcıyı doğrudan yaratıyor; 30 dosya gerçek doğrulamadan geçiyor (bürünme / oturum kuşağı / hesap silme pinleri) →
  dilim 2 bunları kırar (beklenen; yardımcıyla düzeltilir, sahte geçiş yok).
- Paddle müşterisi e-postayla tekilleşir: iki işletmenin sahibi aynı kişi olunca "nadir" durum olağanlaşır (webhook eşlemesi onaydan /
  `custom_data`'dan — iyi; silmedeki ikinci redaksiyon geçişi gözden geçirilecek) [M21].
- Operatör betikleri işletmeyi kişinin e-postasından seçiyor → işletme kimliği açık parametre olacak [M21].

## 12. Kurucu kararları (11-06) — dilim 4–6 bunlara göre yazılır
- **Ü-1 → KARAR: askıda kalır** (kurucu: "en iyi en güvenli akışı seç"). Seçilen akış:
  - İşletme kendini silince, YALNIZ orada etkin üyeliği olan kişi SİLİNMEZ, **askıya** alınır: `User.suspendedAt` + `suspendedReason`
    (`org_deleted`) aynı silme işleminde, işletme satırı silinmeden ÖNCE yazılır; ana işletme alanı boş olabilir hâle gelir (şemada
    zorunlu → isteğe bağlı: dolu tabloda güvenli yön). Başka işletmede etkin üyeliği olan kişi askıya alınmaz (ana işletmesi oraya taşınır).
  - Askıdaki kişi giriş yapabilir ama oturum ALMAZ (§13): "Bağlı olduğunuz işletme hesabını kapattı" + yapabilecekleri (davet kabul /
    hesabı sil). Askıya alınırken sade bilgi e-postası gider.
  - **Süre sınırı (KVKK, en az veri):** 12 ay içinde hiçbir işletmeye katılmazsa kimlik silinir; 30 gün önce hatırlatma e-postası.
    **12 ay — kurucu onayladı (11-06: "Ü-1 uygun").**
  - 🚨 Değişmez korunur: girişteki onarım (`repairHomeMembershipIfMissing`) askıdaki kişiyi ATLAR (yoksa onu silinen işletmenin yerine
    ana işletmesine geri yazardı — §13). Sağlık sayacı ve onarım betiği de askıdakini saymaz (Opus S11).
- **Ü-2 → kurucu "neden üçe ayrılsın?" diye sordu; açıklama (karar bekliyor):** bugün "Hesabı sil" İŞLETMEYİ siler (işletme + içindeki
  herkes + bütün veri; yalnız sahip yapabilir). Üyelikle üç ayrı istek doğar, tek düğme üçünü de yanlış yapar:
  1. **İşletmeyi kapat** (sahip): "Lale Daireleri'ni kapatıyorum" → işletme + verisi silinir; içindeki kişiler Ü-1'e göre askıya alınır.
  2. **İşletmeden ayrıl** (her üye): temizlikçi Ayşe hem A'da hem B'de çalışıyor, A ile işi bitti → yalnız A'daki üyeliği biter; B'deki işi
     ve hesabı SÜRER. (Son sahip ayrılamaz — önce sahipliği devreder ya da işletmeyi kapatır.)
  3. **Kullanıcı hesabımı sil** (kişi, KVKK): Ayşe artık hiç çalışmayacak → kimliği silinir, bütün üyelikleri biter; işletmelerin kayıtları
     (yaptığı temizlik görevleri) kalır ama adı silinir. Bugün personelin kendi verisini sildirme yolu YOK — KVKK açısından eksik.
  Tek düğmede kalırsa: Ayşe'nin "hesabımı sil"i ya B'deki işini de bitirir (yanlış) ya da A'yı siler (felaket — sahipse). Önerim: üç ayrı yol.
- **Ü-3 → KARAR: evet.** Giriş / 2FA / şifre / yeniden doğrulama kayıtları (IP'li) kişiye ait ayrı kayda gider; çıkarıldığı (ya da hiç
  üyesi olmadığı) işletme bu kayıtları GÖRMEZ. Operatör (süper-admin) veritabanında / yönetim panelinde görür. Kapsam: giriş rotasının dört
  kaydı + oturum içi beş kayıt (§3). Geçerli ikinci faktörden sonraki "hiçbir işletmeye bağlı değil" 403'ü de kişinin kaydına iz bırakır.
  **Dilim 6a'dan ÖNCE uygulanır.**
- **Ü-4 → KARAR: evet** (kurucu: "sadece düşürülen yerde düşsün"). Rol değişimi / ekipten çıkarma = YALNIZ o işletmedeki üyelik kuşağı
  (o işletmedeki oturum düşer); `sessionEpoch` yalnız kimlik olaylarında artar (şifre, 2FA, hesap). Kişinin diğer işletmelerdeki oturumu,
  "beni hatırla"sı ve WhatsApp bağları etkilenmez. Kalıcı karar #211 metni buna göre güncellendi (`docs/claude/kalici-kararlar.md`).
- **Ü-5 → KARAR: evet.** WhatsApp bağı işletme başına + amaç alanı (ev sahibi / personel); gelen cevap hangi işletmeye ait olduğunu bağdan
  bilir. Bağ üyelik kimliği + kuşağını taşır → çıkarma / rol değişimi bağı da kendiliğinden geçersiz kılar (Opus S6; dilim 3).
- **Ü-6 → KARAR: davetle "sahip" rolü VERİLEBİLİR** — 🔔 **ERTELENDİ (kurucu 11-06: "Ü-6 sonradan web sitesini tamamen bitirince yapıcam")**:
  özellik ve hukuk maddesi web sitesi tamamen bitince, kurucuyla birlikte. Şartlar (kurucu: "verilmeden önce verilecek yetki ve
  yapabilecekleri gösterilsin, onay verilip gönderilebilsin"):
  - Davet formunda seçilen rolün yetki listesi gösterilir (sahip: faturalandırma, işletmeyi kapatma, ekip yönetimi, bütün misafir verisi,
    bağlantılar…). "Sahip" seçilince ayrı onay adımı: "Bu kişiye işletmenizin TAM yetkisini veriyorsunuz" + kutucuk; davet eden kişiden
    taze yeniden doğrulama (şifre / 2FA — mevcut `reauth-guard`).
  - Davet e-postası ve kabul sayfası da rolü ve yetkilerini gösterir; kabul eden kişi görerek kabul eder.
  - Yeni sahip katılınca mevcut bütün sahiplere bilgi e-postası; işlem denetim kaydında. İşletmede her zaman en az bir sahip kalır.
  - **Hukuk metni:** sorumluluk maddesi kullanım koşullarına (ve gerekiyorsa aydınlatma metnine) — özellik YAYINA GİRERKEN aynı turda
    (metin olmayan bir özelliği anlatmasın); taslak ↓ avukat onayına:
    > *Hesap sahibi, işletmesine eklediği kişileri ve bu kişilere verdiği rolleri kendisi belirler. Eklenen kişilerin, verilen rol
    > kapsamında hesap üzerinden yaptığı işlemlerden hesap sahibi sorumludur. Lixus AI, hesap sahibinin yetkiyi yanlış kişiye vermesinden
    > ya da yetkili kişinin işlemlerinden doğan sonuçlardan sorumlu değildir.*

## 13. İşletmesi olmayan kişi — akış kararı (kurucu 11-06: "sen karar ver, uzun vadede en sürdürülebilir sistemi kur")
**İlke:** işletme oturumu YALNIZ etkin bir üyelikten basılır. Üyeliği olmayan kişi için "işletmesiz oturum" BASILMAZ — işletme kapsamlı
rotalar `session.organizationId` ile süzer; boş bir değer Prisma'da "süzgeç yok" demektir (bütün işletmelerin verisi). Bu sınıf hata ancak
yapıyla önlenir: ileride gereken "hesap merkezi" (davet kabul, hesabı sil, işletme aç) AYRI bir kimlik belirteciyle (ayrı çerez adı, ayrı
amaç iddiası) kurulur; `requireSession` / `requireAuth` onu ASLA kabul etmez (dilim 6a ile, eylemleri olduğunda).

| Durum | Bugün | Kişi ne görür |
|---|---|---|
| HİÇ üyelik satırı yok (kayan dağıtım artığı — sistem hatası) | girişte / e-posta doğrulamada **onarılır** (`repairHomeMembershipIfMissing`, migration 94 ile aynı kural, köken `repair`); operasyon sinyali `reportError` | fark etmez, girer |
| Satırları var, hiçbiri etkin değil (ekipten çıkarıldı — dilim 6a) | oturum yok, 403 + `reason: "no_membership"` | "Hesabınız şu an hiçbir işletmeye bağlı değil. Bir işletmeye katılmak için o işletmenin sahibinden davet isteyin." |
| Askıda (işletme kapandı — Ü-1, dilim 6) | onarım ATLAR (askı işareti) | "Bağlı olduğunuz işletme hesabını kapattı…" + hesap merkezi |
| Bekleyen davet (dilim 4–5) | davet bağlantısı kabulden sonra üyelik yazar | hesap merkezinde davet |

- Onarım çağrılma anı: giriş — doğru ŞİFREDEN sonra, ikinci adımdan ÖNCE (kurtarma kodunun tüketilip tüketilmeyeceği son üyelik
  durumuyla verilsin; sonra koşsa üyeliksiz sanılan kişinin kodu yakılmadan oturum basılırdı); e-posta doğrulama — belirteç + şifreden
  sonra (onarım düşerse 500 değil "giriş yapın"; giriş yeniden dener). Onarım hiçbir şey VERMEZ: oturum yine ikinci adımdan sonra basılır,
  yalnız hesabın sahip olması gereken satır geri yazılır. `requireSession` onarmaz (eski oturum 401 → yeniden giriş → onarım).
- Eşzamanlı iki giriş: tekil bekçi tek satır bırakır; onarım yazmasa da seçim yeniden yapılır (ikinci giriş boşuna 403 almaz).
- 🚨 Değişmez: "üyelik satırı yok" ⇔ "hiç üye olmadı" — üyelik satırı silinmez (tek yazıcı pini, yazıcının kendisi dahil); askıdaki kişi
  ayrı işaretle atlanır. Bu değişmezi bozan bir yol eklenirse onarım da aynı turda değişir.
- Sağlık sayacı (`users_without_membership`) ve onarım betiği kalır: girişe hiç gelmeyen artıkları (ör. seyrek giren personel) görür.
- Pinler: `tests/integration/membership-session-pins.test.ts` (satırsız kişi onarılır · eşzamanlı iki giriş tek satır · çıkarılmış kişi
  DİRİLMEZ, 403 + sebep · e-posta doğrulamada onarım).
