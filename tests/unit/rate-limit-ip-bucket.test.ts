import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ipBucketKey, rateLimitClientKey } from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// HIZ SINIRI KOVASI: IPv6 /64 ÖNEKİNE İNDİRGENİR (saldırgan gözüyle giriş turu, 09-23).
//
// Kova anahtarı TAM adresti. IPv4'te doğru, IPv6'da DEĞİL: tek bir VPS ya da ev hattı
// standart olarak bir /64 alır (2^64 adres) ve her adres AYRI kova sayılıyordu →
// "IP başına 10 deneme / 5 dk" sınırı fiilen YOKTU (ajan yerel ölçümle gösterdi: aynı
// /64'ten beş adres → beş ayrı anahtar). /64 sektör standardıdır (tek abonenin en küçük
// ayrılmış bloğu); daha geniş gruplama ilgisiz kullanıcıları tek kovaya düşürürdü.
// ⚠️ Kanıt/iz kayıtları (denetim `ip`, KVKK onay kaydı) TAM adresi yazmaya devam eder —
// indirgeme YALNIZ kova anahtarındadır.
// ---------------------------------------------------------------------------

describe("ipBucketKey", () => {
  it("IPv4 aynen kalır (mevcut kovalar/testler değişmez)", () => {
    expect(ipBucketKey("203.0.113.9")).toBe("203.0.113.9");
  });

  it("aynı /64'teki farklı adresler TEK kovaya düşer", () => {
    const keys = new Set(
      ["2001:db8:abcd:1234::1", "2001:db8:abcd:1234::2", "2001:db8:abcd:1234:ffff:ffff:ffff:ffff", "2001:db8:abcd:1234:1:2:3:4"].map(
        ipBucketKey,
      ),
    );
    expect(keys.size).toBe(1);
  });

  it("KONTROL: farklı /64'ler AYRI kova (aşırı gruplama yok)", () => {
    expect(ipBucketKey("2001:db8:abcd:1234::1")).not.toBe(ipBucketKey("2001:db8:abcd:1235::1"));
  });

  it("yazım farkı kova değiştirmez: sıkıştırılmış / açık / büyük harf / baştaki sıfırlar", () => {
    const a = ipBucketKey("2001:db8:abcd:1234::1");
    expect(ipBucketKey("2001:0db8:abcd:1234:0000:0000:0000:0001")).toBe(a);
    expect(ipBucketKey("2001:DB8:ABCD:1234::1")).toBe(a);
  });

  it("IPv4-eşlemeli IPv6 IPv4 kimliğine döner (yoksa TÜM IPv4 istemcileri tek /64 kovasına düşerdi)", () => {
    expect(ipBucketKey("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(ipBucketKey("::ffff:cb00:7109")).toBe("203.0.113.9");
    expect(ipBucketKey("::ffff:198.51.100.1")).not.toBe(ipBucketKey("::ffff:203.0.113.9"));
  });

  it("bölge eki (%eth0) atılır", () => {
    expect(ipBucketKey("fe80::1%eth0")).toBe(ipBucketKey("fe80::2"));
  });

  it("'unknown' ve IP olmayan değer aynen döner, UZUNLUĞU sınırlı (kova tablosu şişirilemez)", () => {
    expect(ipBucketKey("unknown")).toBe("unknown");
    expect(ipBucketKey("x".repeat(500)).length).toBeLessThanOrEqual(64);
  });
});

describe("rateLimitClientKey — istekten kova anahtarı", () => {
  it("XFF'teki IPv6 istemci /64'e indirgenir; clientIp ile aynı adımı seçer", () => {
    const a = rateLimitClientKey({ headers: new Headers({ "x-forwarded-for": "2001:db8:abcd:1234::7" }) });
    const b = rateLimitClientKey({ headers: new Headers({ "x-forwarded-for": "2001:db8:abcd:1234::8" }) });
    expect(a).toBe(b);
  });

  it("IPv4 istemci için clientIp ile BİREBİR aynı", () => {
    expect(rateLimitClientKey({ headers: new Headers({ "x-forwarded-for": "198.51.100.23" }) })).toBe("198.51.100.23");
  });
});

// ---------------------------------------------------------------------------
// MEKANİK PİN: hiçbir rota IP kovası anahtarını HAM `clientIp`ten kurmaz (09-23). Yeni bir
// rota eski deseni kopyalarsa IPv6 /64 atlatması o rotada sessizce geri gelirdi. Tarama dosya
// sistemi üzerinden (git gerekmez); anti-vakum: tarama gerçekten rota dosyası buluyor ve bilinen
// bir doğru kullanım görülüyor.
// ---------------------------------------------------------------------------

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("MEKANİK PİN — kova anahtarı ham IP'den kurulmaz", () => {
  it("src/ içinde `rateLimit(`…${clientIp(` ya da `…${ip}` deseni YOK", () => {
    const files = walk("src");
    expect(files.length).toBeGreaterThan(100); // anti-vakum
    const offenders = files.filter((f) =>
      /rateLimit(?:Peek)?\(`[^`]*\$\{(?:clientIp\(|ip\})/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
    // anti-vakum: doğru kullanım GERÇEKTEN taranan metinde görülüyor
    expect(files.some((f) => readFileSync(f, "utf8").includes("rateLimit(`login:${rateLimitClientKey(req)}`"))).toBe(true);
  });
});
