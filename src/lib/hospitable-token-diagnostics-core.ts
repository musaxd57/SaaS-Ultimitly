import { createDecipheriv, scryptSync } from "crypto";
import { decryptSecret } from "./crypto-core";
import type { PrismaClient } from "@prisma/client";

// ---------------------------------------------------------------------------
// SALT-OKUMA teşhis: "hospitable-token-undecryptable" alarmının kapsamı.
//
// Sorulan soru (Codex, 08-02): prod log'unda bir org için
//   Error: Unsupported state or unable to authenticate data
// düşüyor. Bu, AES-GCM'in kimlik doğrulama hatasıdır. İki BAMBAŞKA nedeni
// olabilir ve ikisinin MÜDAHALESİ de bambaşkadır:
//
//   (a) TEK SATIR bozuk / eski bir anahtarla yazılmış  → o kiracı yeniden bağlanır
//   (b) ENCRYPTION_KEY GENEL olarak uyuşmuyor          → HİÇBİR kiracı bağlanamaz,
//                                                         anahtar geri getirilmeli
//
// Sayım tek başına (a)/(b) ayrımını yapamaz: ayrım "başarılı çözülen BAŞKA satır
// var mı" sorusudur. Bu yüzden her satır tek tek AÇILIR (değeri ASLA döndürülmez)
// ve BAĞIMSIZ bir sonda olarak `User.twoFactorSecret` de sayılır — aynı şifreleme
// kutusunu kullanır, yani anahtar genel olarak yanlışsa O DA komple düşer.
//
// 🚨 ÇIKTI SÖZLEŞMESİ: bu modül YALNIZ SAYI döndürür. Token, ciphertext, hash,
// e-posta, kullanıcı ya da org kimliği DÖNDÜRMEZ — çağıran bir şeyi yanlışlıkla
// loglayamaz çünkü elinde basacak bir şey yoktur. Test bunu pinler.
//
// 🚨 HİÇBİR ŞEY YAZMAZ. Sorgular yalnız `select` ile şifreli kolonları çeker;
// isim/e-posta/adres process'e HİÇ girmez.
// ---------------------------------------------------------------------------

/** Bir şifreli değerin tek satırlık teşhis sonucu. */
export type DecryptOutcome =
  /** Mevcut anahtarla açıldı. */
  | "ok"
  /** GCM kimlik doğrulaması düştü: yanlış ANAHTAR ya da bozulmuş veri. */
  | "auth_failed"
  /** "v1.iv.tag.data" biçimine hiç uymuyor (kısmi yazma / eski format). */
  | "malformed";

export interface FieldCounts {
  /** Kolonu dolu olan satır sayısı. */
  present: number;
  ok: number;
  authFailed: number;
  malformed: number;
  /**
   * `auth_failed` olan satırlardan kaçı ALTERNATİF anahtarla açıldı.
   * Yalnız çağıran bir alternatif anahtar verdiyse anlamlıdır (↓`altKeySecret`).
   */
  okUnderAltKey: number;
}

export interface TokenDiagnostics {
  organizations: number;
  accessToken: FieldCounts;
  refreshToken: FieldCounts;
  /**
   * AKTİF ikinci faktör (`twoFactorEnabledAt` DOLU). Burada çözülememek GERÇEK
   * ve ACİL bir arızadır: kullanıcı giriş yapamaz.
   */
  twoFactorActive: FieldCounts;
  /**
   * BAYAT kayıt (`twoFactorSecret` dolu ama `twoFactorEnabledAt` NULL) — yarım
   * kalmış kurulum. Çözülememesi OPERASYONEL bir arıza DEĞİLDİR: hiçbir kod yolu
   * bu değeri ikinci faktör saymaz (↓`verdictFor` gerekçesi).
   */
  twoFactorStale: FieldCounts;
  /** Çağıran alternatif anahtar verdi mi (rapor metnini buna göre yazmak için). */
  altKeyTried: boolean;
}

const ALG = "aes-256-gcm";
/**
 * ⚠️ `crypto-core.ts`'teki SALT'ın KOPYASI (orada export EDİLMİYOR ve teşhis
 * uğruna üretim kriptosunun yüzeyini genişletmek istemedim). Yalnız ALTERNATİF
 * anahtar sondasında kullanılır — ASIL yol üretim `decryptSecret`'ini çağırır,
 * yani ölçüm sürüklenemez. Kopyanın gerçekten aynı kutuyu ürettiği testle
 * pinlidir (crypto-core ile şifrele → buradaki fonksiyonla çöz).
 */
const SALT = "lixus-secret-box-v1";

/**
 * Verilen ham sırdan türetilmiş anahtarla v1 kutusunu açmayı dener.
 *
 * Yalnız `boolean` döner — düz metin ÇAĞIRANA HİÇ ULAŞMAZ, yani yanlışlıkla
 * loglanamaz. Test edilebilsin diye export edilir (kutu paritesi pini).
 */
export function decryptsUnderKey(payload: string, secret: string): boolean {
  try {
    const [v, ivb, tagb, datab] = payload.split(".");
    if (v !== "v1" || !ivb || !tagb || !datab) return false;
    const d = createDecipheriv(ALG, scryptSync(secret, SALT, 32), Buffer.from(ivb, "base64"));
    d.setAuthTag(Buffer.from(tagb, "base64"));
    // Sonuç ATILIR — yalnız "açıldı mı" bilgisi taşınır.
    Buffer.concat([d.update(Buffer.from(datab, "base64")), d.final()]);
    return true;
  } catch {
    return false;
  }
}

/** Tek bir şifreli değeri sınıflandır. Düz metni DÖNDÜRMEZ. */
export function classifyCiphertext(payload: string): DecryptOutcome {
  const [v, ivb, tagb, datab] = payload.split(".");
  if (v !== "v1" || !ivb || !tagb || !datab) return "malformed";
  try {
    // ⚠️ Dönüş değeri BİLEREK kullanılmıyor: yalnız "açıldı mı" sorusu var.
    decryptSecret(payload);
    return "ok";
  } catch {
    // Biçim v1 olduğu hâlde düşüyorsa neden GCM doğrulamasıdır (yanlış anahtar
    // veya bozuk bayt) — üretimde görülen "Unsupported state or unable to
    // authenticate data" tam olarak budur.
    return "auth_failed";
  }
}

function tally(values: string[], altKeySecret?: string): FieldCounts {
  const c: FieldCounts = { present: values.length, ok: 0, authFailed: 0, malformed: 0, okUnderAltKey: 0 };
  for (const v of values) {
    const outcome = classifyCiphertext(v);
    if (outcome === "ok") c.ok++;
    else if (outcome === "malformed") c.malformed++;
    else {
      c.authFailed++;
      if (altKeySecret && decryptsUnderKey(v, altKeySecret)) c.okUnderAltKey++;
    }
  }
  return c;
}

/**
 * Teşhisi çalıştır. SALT-OKUMA.
 *
 * @param altKeySecret Opsiyonel ALTERNATİF ham sır (ör. `AUTH_SECRET`). Verilirse
 *   yalnız `auth_failed` satırlarda denenir. Gerekçe: `crypto-core.key()`
 *   `ENCRYPTION_KEY || AUTH_SECRET` sırasını kullanır → `ENCRYPTION_KEY` HENÜZ
 *   SET DEĞİLKEN yazılmış bir satır, anahtar sonradan eklendiğinde tam da bu
 *   hatayı verir. Bu sonda o hipotezi TEK ÖLÇÜMLE doğrular ya da çürütür.
 */
export async function diagnoseHospitableTokens(
  db: Pick<PrismaClient, "organization" | "user">,
  altKeySecret?: string,
): Promise<TokenDiagnostics> {
  // Yalnız şifreli kolonlar seçilir: isim/e-posta/adres bu process'e HİÇ girmez.
  const orgs = await db.organization.findMany({
    select: { hospitableTokenEnc: true, hospitableRefreshTokenEnc: true },
  });
  // ⚠️ `twoFactorEnabledAt` DE seçilir — "2FA açık mı" sorusunun TEK doğru
  // cevabı odur (kod-doğrulandı: login/route.ts, account/2fa/route.ts,
  // settings/page.tsx, admin/reset-2fa/route.ts hepsi ona bakar). `secret`in
  // dolu olması TEK BAŞINA hiçbir şeyi etkinleştirmez; `setup` onu yazıp
  // `twoFactorEnabledAt: null` bırakır, yani yarım kalan her kurulum geride
  // bayat bir secret bırakır. İkisini tek kovada saymak, zararsız bir artığı
  // "kullanıcı giremiyor" gibi gösterirdi.
  const twoFa = await db.user.findMany({
    where: { twoFactorSecret: { not: null } },
    select: { twoFactorSecret: true, twoFactorEnabledAt: true },
  });
  const pick = (active: boolean) =>
    twoFa
      .filter((u) => (u.twoFactorEnabledAt !== null) === active)
      .map((u) => u.twoFactorSecret)
      .filter((v): v is string => !!v);

  return {
    organizations: orgs.length,
    accessToken: tally(orgs.map((o) => o.hospitableTokenEnc).filter((v): v is string => !!v), altKeySecret),
    refreshToken: tally(
      orgs.map((o) => o.hospitableRefreshTokenEnc).filter((v): v is string => !!v),
      altKeySecret,
    ),
    twoFactorActive: tally(pick(true), altKeySecret),
    twoFactorStale: tally(pick(false), altKeySecret),
    altKeyTried: !!altKeySecret,
  };
}

export type Verdict = "clean" | "isolated" | "global_key_mismatch" | "inconclusive";

/**
 * "Tek eski token mı, genel anahtar uyumsuzluğu mu?"
 *
 * Ayrımın mantığı: anahtar GENEL olarak yanlışsa aynı kutuyu kullanan HİÇBİR
 * değer açılamaz. Demek ki tek bir başarılı çözüm bile (hangi alanda olursa
 * olsun) "anahtar doğru" kanıtıdır → kalan hatalar İZOLE'dir.
 *
 * ⚠️ Şifreli hiçbir değer yoksa hüküm `inconclusive`: "hata yok" ile "ölçecek
 * bir şey yok" aynı şey değildir ve ikincisini temiz raporlamak yanıltır.
 */
export function verdictFor(d: TokenDiagnostics): Verdict {
  // ⚠️ BAŞARILAR dört alandan da sayılır — BAYAT bir kayıt bile açılıyorsa
  // anahtarın doğru olduğunu kanıtlar (kanıt değeri "kayıt canlı mı"ya bağlı
  // değildir, "bu anahtarla açıldı mı"ya bağlıdır).
  const anyOk = d.accessToken.ok + d.refreshToken.ok + d.twoFactorActive.ok + d.twoFactorStale.ok;
  // ⚠️ HATALAR'a BAYAT kayıtlar DAHİL EDİLMEZ: hiçbir kod yolu onları ikinci
  // faktör saymaz (`login` yalnız `twoFactorEnabledAt`e bakar), yani çözülememeleri
  // kimseyi dışarıda bırakmaz. Saysaydık, terk edilmiş tek bir kurulum yüzünden
  // "çalışan üründe arıza var" hükmü çıkardı. Bayat hatalar AYRICA raporlanır
  // (↓`staleUndecryptable`) — göz ardı edilmezler, yalnız hükmü kirletmezler.
  const anyBad =
    d.accessToken.authFailed +
    d.accessToken.malformed +
    d.refreshToken.authFailed +
    d.refreshToken.malformed +
    d.twoFactorActive.authFailed +
    d.twoFactorActive.malformed;
  if (anyOk === 0 && anyBad === 0) return "inconclusive";
  if (anyBad === 0) return "clean";
  if (anyOk === 0) return "global_key_mismatch";
  return "isolated";
}

/**
 * Çözülemeyen BAYAT 2FA kaydı sayısı — operasyonel arıza DEĞİL, ama iki şey
 * söyler: (1) temizlenecek artık var, (2) o satır yazılırken BAŞKA bir anahtar
 * etkindi, yani aynı dönemde yazılmış diğer sırlar da şüpheli.
 */
export function staleUndecryptable(d: TokenDiagnostics): number {
  return d.twoFactorStale.authFailed + d.twoFactorStale.malformed;
}
