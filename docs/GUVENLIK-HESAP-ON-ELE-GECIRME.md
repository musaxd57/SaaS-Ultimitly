# Hesap ön-ele-geçirme (account pre-hijacking) — ✅ KAPATILDI (08-06)

> **Durum: KAPATILDI.** Seçenek **S1** (doğrulamada parola şartı) uygulandı; ayrıca
> aynı turda üç yan bulgu da kapatıldı (↓"Uygulanan"). Aşağıdaki zincir anlatısı
> TARİHÇE olarak korunuyor — düzeltmenin neyi kapattığını anlatır.
>
> **Uygulanan (hepsi mutasyon-doğrulandı, 6 mutasyonun 6'sı kırmızı):**
> 1. `verify-email` artık `{token, password}` ister; parola doğrulanmadan
>    `emailVerifiedAt` YAZILMAZ → zincirin 3. halkası kırıldı.
> 2. Yanlış parola token'ı TÜKETMEZ (yazım hatası bağlantıyı yakmaz).
> 3. 2FA açık hesapta oturum BASILMAZ (`requiresLogin`) — bugün ulaşılamaz bir
>    dal, ama değişmezi pinler.
> 4. Başka bir hesabın oturumu açıkken doğrulama REDDEDİLİR (`session_mismatch`)
>    — sessiz hesap değişimi / login-CSRF kapandı.
> 5. Parola sıfırlama artık canlı doğrulama token'ını da öldürür (İKİ yol da):
>    `sessionEpoch` artışı onu öldürmüyordu, çünkü doğrulama rotası oturumu TAZE
>    epoch'la basıyor.
> 6. `mfa: false` kaynak-taramayla pinlendi — operatör kapısı bu yoldan açılamaz.
>
> ⚠️ **SIRA KISITI:** boş-parola kontrolü token aramasının SONRASINDA kalmalı.
> `tests/e2e/security-controls.spec.ts` tarayıcı-botnet Content-Type kapısını bu
> rota üzerinden ölçüyor ve ayrım `expired` ↔ `missing` sebep kodlarına dayanıyor.
>
> **Eski durum notu:** KOD DEĞİŞTİRİLMEDİ. Zincir 2026-08-06'da bir denetim ajanı tarafından
> raporlandı ve **beş halkasının hepsi ayrı ayrı kod-doğrulandı** (aşağıda file:line).
> Kimlik/kayıt akışına dokunmak kullanıcı onayı ister → sorduğum soru yanıtsız kaldı,
> bu yüzden yalnız belgelendi.
>
> **🚨 LANSMAN ÖN-KONTROL LİSTESİNE AİT.** `REGISTRATION_OPEN=1` canlı. Bugün tek
> gerçek müşteri kurucunun kendisi olduğu için pratik risk düşük; **reklam/geniş
> açılıştan ÖNCE kapatılmalı.**

---

## Saldırı

Saldırganın ihtiyacı olan tek şey **kurbanın e-posta adresi**.

1. Saldırgan `POST /api/auth/register` ile **kurbanın adresini** kullanarak kaydolur.
   Org + kullanıcı (`role:"owner"`, **saldırganın** `passwordHash`'i) + 14 günlük
   trial tek transaction'da yazılır; doğrulama linki **kurbanın** kutusuna gider.
   → `src/app/api/auth/register/route.ts:108-155`, `:169-173`
2. Saldırgan istediği an `POST /api/auth/resend-verification` çağırır — **rota
   kimliksiz ve public**, hiçbir guard yok; adres başına 4/15 dk. Her çağrı **TAZE**
   bir token basıp kurbana yollar.
   → `src/app/api/auth/resend-verification/route.ts:23` (guard yok), `:35-42`
3. Kurban "e-postanı doğrula" mailine tıklar → hesap `verified` olur ve **oturum
   açılır**. Kurban ürünü kullanmaya başlar: mülkler, Hospitable token'ı, bilgi
   tabanındaki kapı kodları, misafir PII'si.
   → `src/app/api/auth/verify-email/route.ts:66-84`
4. Saldırgan `POST /api/auth/login` → `{kurban@x.com, KENDİ ŞİFRESİ}`. Parola hiç
   değişmediği için hâlâ geçerli; doğrulama kapısı artık geçiyor → **owner erişimi**.
   → `src/app/api/auth/login/route.ts:97-106`

**Zincirin kilit taşı:** `verify-email` `emailVerifiedAt`'i yazar ve token'ı null'lar,
ama **`passwordHash`'e DOKUNMAZ ve `sessionEpoch`'u ARTTIRMAZ** (`route.ts:66-70`).
Yani posta kutusu sahipliği kanıtı, **parolasını bir yabancının seçtiği** hesabı
terfi ettiriyor.

---

## Zinciri kırabilecek adaylar — hepsi elendi (kod-doğrulandı)

| Aday | Neden kırmıyor |
|---|---|
| Token 24 saatlik TTL | `resend` her çağrıda YENİ token + yeni son kullanma basıyor (`resend-verification/route.ts:41-42`). "Aylar sonra" öncülü ayakta. |
| `needsEmailVerification` yaş penceresi | **YOK.** Tek koşul `createdAt >= 2026-06-15 && emailVerifiedAt == null` (`email-verify.ts:29`). Doğrulanmamış hesap SÜRESİZ resend'e uygun. |
| Kurbanın kaydı eskiyi ezer mi | HAYIR — dal hiçbir şey yazmaz (`register/route.ts:86-90`) ve bu davranış `register-enumeration.test.ts:61-74`'te PİNLİ. |
| Bayat doğrulanmamış hesap süpürgesi | **YOK.** `emailVerifiedAt` `data-retention.ts`'te hiç geçmiyor. |
| Giriş sayfasındaki resend düğmesi | İkinci vektör DEĞİL — yalnız `needsVerification` gelince görünür, o da ancak DOĞRU parolayla (`login/route.ts:97`). |
| Trial e-postaları | Zayıf sinyal; ~14 gün sonra "denemeniz bitti" gelir. Kontrol değil. |

**Tek gerçek çıkış yolu — ama bir kontrol değil, şanslı sıralama:** kurban
**önce** "şifremi unuttum" yaparsa `passwordHash` ezilir + `sessionEpoch` artar
(`forgot-password/route.ts:339,346`) → saldırgan düşer. Ama ürün kurbanı **yanlış
sıralamaya itiyor**: kayıt ekranındaki düğme *resend*'dir, sıfırlama değil
(`register-form.tsx:147-181`).

---

## Kapatma seçenekleri (hiçbiri enumeration kararını bozmuyor)

⚠️ 08-01'de alınan "register enumeration-güvenli olsun" kararı bu açığı
YARATMADI — resend rotası yaş kapısız olduğu sürece zaten vardı. Kararı geri
almak GEREKMİYOR ve tavsiye EDİLMİYOR.

### S1 — Doğrulama tüketimi PAROLA istesin *(en küçük gerçek kapatma)*
`verify-email` gövdesi `{token, password}` alsın, `verifyPassword` ile kontrol
edilsin. Kurban saldırganın parolasını bilmediği için 3. halka kırılır.
- ✅ Enumeration kararına sıfır dokunuş
- ✅ Kurtarma yolu var (önce forgot-password, sonra doğrula)
- ❌ "Maildeki butona tıklayın; giriş otomatik tamamlanır" vaadi biter
  (`register-form.tsx:154`, mail metni `email-verify.ts:170-171`)
- ❌ `tests/integration/email-verify.test.ts`'te **4 test + 1 helper** güncellenir
  (ölçüldü: `:265`, `:287`, `:418`, `:447` + `verifyReq` helper'ı. Bu satır bir
  dönem "5 pin" deyip `:356`'yı sayıyordu — YANLIŞTI, o test `verifyEmail`'i hiç
  çağırmıyor, `emailVerifiedAt`'i doğrudan Prisma ile yazıyor.)
- ❌ Rotaya 1 bcrypt (20/saat limitli — önemsiz)

### S2 — Doğrulama, oturum basmak yerine PAROLA BELİRLETSİN (davet akışı)
Token yalnız posta kutusunu kanıtlar; kullanıcı parolayı o anda kurar →
saldırganın hash'i ezilir + `sessionEpoch` artar. UX sürtünmesi S1'den az; ama
değişiklik yüzeyi daha büyük (rota sözleşmesi + sayfa + kayıt akışının anlamı).

### S3 — Bayat doğrulanmamış hesap süpürgesi *(mitigasyon, KAPATMA DEĞİL)*
`emailVerifiedAt=null && createdAt < now-N gün && org tek kullanıcılı && ücretli
abonelik yok` → sil. Deep-sync pass'ine bağlanır, **migration istemez**, UX
değişmez, test kırmaz. Ama saldırganın **aynı gün** resend tetiklediği pencereyi
KAPATMAZ.

### Yetersiz olduğu için önerilmeyenler
- `verify-email`'de oturum basmayı kaldırmak → hesap yine `verified` olur,
  saldırgan yine kendi parolasıyla girer.
- `resend`'e yaş penceresi koymak (S3'süz) → geç doğrulayan MEŞRU kullanıcı
  kalıcı çıkmazda kalır (register onun adresine sonsuza dek sessiz 201 döner).
- "Zaten hesabınız var" e-postası → kurbanı güvenli yola *iter* ama kayıt
  ekranındaki resend düğmesi ve ham API yerinde durduğu için zinciri KAPATMAZ.
  (Bu zaten `docs/MIGRATION-BEKLEYEN-ISLER.md`'de açık soru olarak kayıtlı.)

---

## Bugünkü risk

- `REGISTRATION_OPEN=1` **canlı** → saldırı bugün ulaşılabilir.
- Saldırganın hesabı kurban tıklayana kadar **atıl**: `login/route.ts:97` onu
  403'le durduruyor ve oturum basan başka yol yok (`setSessionCookie` çağıranları:
  login · verify-email · impersonation).
- Yani saldırının **tüm bedeli kurbanın tıklamasıyla** ödeniyor — kapıyı kurban,
  saldırgan adına açıyor.
- Tek gerçek müşteri kurucunun kendisi olduğu için **bugün pratik risk düşük**;
  geniş açılışta **yüksek** (hedef listesi = harvest edilmiş Türk host adresleri).
