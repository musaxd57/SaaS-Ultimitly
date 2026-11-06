import { describe, it, expect, afterEach, vi } from "vitest";
import {
  splitStayCookie,
  stayCookieValue,
  verifyDevicePass,
  readDevicePass,
  devicePassConfirmed,
  devicePassAvailable,
  deviceLaneKey,
  secretTagOf,
} from "@/lib/guest-chat-pass";
import { signAlertEmailToken } from "@/lib/alert-email-verify";

// ---------------------------------------------------------------------------
// K-5 (kurucu / Codex 11-06): QR cihaz çerezinin imzalı geçişi. Veritabanına gitmeden doğrulanır; erişim VERMEZ (bağ ayrıca denetlenir).
// Süresi dolmuş / başka QR anahtarına ait / imzası tutmayan geçiş yok sayılır. Eski biçimli çerez (yalnız sır) aynen çalışır.
// ---------------------------------------------------------------------------

const SECRET = "a".repeat(64);
const TOKEN = "t".repeat(64);
const future = () => new Date(Date.now() + 3_600_000);

afterEach(() => vi.unstubAllEnvs());

function passOf(value: string): string {
  return splitStayCookie(value).pass!;
}

describe("imzalı cihaz geçişi", () => {
  it("çerez değeri = sır + geçiş; geçiş doğrulanır, sır kısmı AYNEN kalır (veritabanı bağı değişmez)", () => {
    const value = stayCookieValue(SECRET, "res_1", TOKEN, future());
    expect(splitStayCookie(value).secret).toBe(SECRET);
    expect(verifyDevicePass(passOf(value), TOKEN)).toMatchObject({ reservationId: "res_1", secretTag: secretTagOf(SECRET) });
  });

  it("🚨 imza tutmazsa (gövde ya da imza değiştirilmiş) geçiş YOK sayılır", () => {
    const value = stayCookieValue(SECRET, "res_1", TOKEN, future());
    const [body, sig] = passOf(value).split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), r: "res_2" })).toString("base64url");
    expect(verifyDevicePass(`${forged}.${sig}`, TOKEN)).toBeNull();
    expect(verifyDevicePass(`${body}.${sig.slice(0, -2)}xx`, TOKEN)).toBeNull();
  });

  it("🚨 süresi dolmuş geçiş YOK sayılır", () => {
    const value = stayCookieValue(SECRET, "res_1", TOKEN, new Date(Date.now() - 1000));
    expect(verifyDevicePass(passOf(value), TOKEN)).toBeNull();
  });

  it("🚨 başka QR anahtarının geçişi bu anahtarda geçmez", () => {
    const value = stayCookieValue(SECRET, "res_1", TOKEN, future());
    expect(verifyDevicePass(passOf(value), "u".repeat(64))).toBeNull();
  });

  it("aynı sırla imzalanmış BAŞKA belirteç (uyarı adresi bağlantısı) geçiş sayılmaz — imza alanı ayrı", () => {
    const other = signAlertEmailToken({ organizationId: "o1", email: "a@b.test", previous: null, generation: 1 })!;
    expect(other).toBeTruthy();
    expect(verifyDevicePass(other, TOKEN)).toBeNull();
  });

  it("sır tanımlı değilse geçiş ÜRETİLMEZ (çerez eski biçim) ve hiçbir geçiş kabul edilmez", () => {
    const signed = stayCookieValue(SECRET, "res_1", TOKEN, future());
    vi.stubEnv("AUTH_SECRET", "");
    expect(devicePassAvailable()).toBe(false);
    expect(stayCookieValue(SECRET, "res_1", TOKEN, future())).toBe(SECRET);
    expect(verifyDevicePass(passOf(signed), TOKEN)).toBeNull();
    expect(readDevicePass(`gcs_p1=${signed}`, TOKEN)).toBeNull();
  });

  it("eski biçim (noktasız) ve bozuk biçim (iki parça) sır olarak okunur, geçişsiz", () => {
    expect(splitStayCookie(SECRET)).toEqual({ secret: SECRET, pass: null });
    expect(splitStayCookie(`${SECRET}.x`)).toEqual({ secret: `${SECRET}.x`, pass: null });
    expect(splitStayCookie(null)).toEqual({ secret: null, pass: null });
  });

  it("istek çerezleri: yalnız `gcs_` çerezleri denenir; bu anahtarın geçişi bulunur, öteki dairenin çerezi engel olmaz", () => {
    const mine = stayCookieValue(SECRET, "res_1", TOKEN, future());
    const other = stayCookieValue("b".repeat(64), "res_9", "u".repeat(64), future());
    const header = `theme=dark; gcs_p9=${other}; gcs_p1=${mine}`;
    expect(readDevicePass(header, TOKEN)?.reservationId).toBe("res_1");
    expect(readDevicePass(`x_p1=${mine}`, TOKEN)).toBeNull();
  });

  it("uzun çerez başlığıyla işlemci harcatılamaz: en çok 6 `gcs_` çerezi denenir", () => {
    const mine = stayCookieValue(SECRET, "res_1", TOKEN, future());
    const junk = Array.from({ length: 6 }, (_, i) => `gcs_j${i}=x.y.z`).join("; ");
    expect(readDevicePass(`${junk}; gcs_p1=${mine}`, TOKEN)).toBeNull();
    expect(readDevicePass(`gcs_p1=${mine}; ${junk}`, TOKEN)?.reservationId).toBe("res_1");
  });

  it("bağ doğrulaması: yalnız AYNI konaklama + AYNI sır geçişi onaylar", () => {
    const pass = verifyDevicePass(passOf(stayCookieValue(SECRET, "res_1", TOKEN, future())), TOKEN);
    expect(devicePassConfirmed(pass, "res_1", SECRET)).toBe(true);
    expect(devicePassConfirmed(pass, "res_2", SECRET)).toBe(false);
    expect(devicePassConfirmed(pass, "res_1", "c".repeat(64))).toBe(false);
    expect(devicePassConfirmed(pass, "res_1", null)).toBe(false);
    expect(devicePassConfirmed(null, "res_1", SECRET)).toBe(false);
  });

  it("cihaz kovası anahtarı konaklama + bağ (sırrın kendisi anahtara girmez)", () => {
    const key = deviceLaneKey("guestchat-get-d", "res_1", secretTagOf(SECRET));
    expect(key).toBe(`guestchat-get-d:res_1:${secretTagOf(SECRET)}`);
    expect(key).not.toContain(SECRET);
  });
});
