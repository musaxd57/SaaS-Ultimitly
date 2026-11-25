import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { deflateSync } from "zlib";
import { sniffImageExt, validateImageStructure, MAX_IMAGE_PIXELS } from "@/lib/image-validation";

// K27-K11 (Codex 11-25 ikinci rapor): yükleme yalnız başlığa bakıyordu — doğru başlık + çöp gövde kabul ediliyordu. Yapısal doğrulama
// GERÇEK dosyaları (ImageMagick / libjpeg-turbo / libpng / libwebp ile üretilmiş fikstürler: ilerlemeli JPEG + EXIF + GPS, sonda ikinci
// görüntü, CMYK, yeniden başlatma aralığı, RGBA / paletli / taramalı / 16 bit PNG, kayıplı / kayıpsız / saydam / hareketli WebP) REDDETMEMELİ.

const DIR = path.join(process.cwd(), "tests/fixtures/images");
const fixture = (name: string) => readFileSync(path.join(DIR, name));
const check = (buf: Buffer) => {
  const ext = sniffImageExt(buf);
  expect(ext, "başlık").not.toBeNull();
  return validateImageStructure(buf, ext!);
};

/** Tekrarlanabilir çöp (doğrusal eşlik üreteci) — rastgelelik testi kararsız yapmasın. */
function junk(n: number, seed = 7): Buffer {
  const out = Buffer.alloc(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (const byte of b) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function png(width: number, height: number, extra: Buffer[] = []): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit derinliği
  ihdr[9] = 0; // gri
  return Buffer.concat([PNG_SIG, pngChunk("IHDR", ihdr), ...extra, pngChunk("IDAT", deflateSync(Buffer.alloc(2))), pngChunk("IEND", Buffer.alloc(0))]);
}

describe("gerçek dosyalar KABUL (yanlış ret yok)", () => {
  const files = readdirSync(DIR).filter((f) => /\.(jpg|png|webp)$/.test(f));
  it("fikstür kümesi beklenen genişlikte (kör olmasın)", () => {
    expect(files.length).toBeGreaterThanOrEqual(14);
  });
  for (const f of readdirSync(DIR).filter((n) => /\.(jpg|png|webp)$/.test(n))) {
    it(`${f} → kabul, boyut 40×30`, () => {
      expect(check(fixture(f))).toEqual({ ok: true, width: 40, height: 30 });
    });
  }
  it("EXIF + GPS taşıyan ilerlemeli JPEG kabul (GPS baytı yerinde — silme ayrı karar)", () => {
    const buf = fixture("phone-exif-gps-progressive.jpg");
    expect(buf.includes(Buffer.from("Exif\0\0", "latin1"))).toBe(true);
    expect(check(buf).ok).toBe(true);
  });
  it("PNG: IEND sonrası fazladan bayt ve yardımcı parçada bozuk CRC kabul (libpng / tarayıcı da kabul eder)", () => {
    expect(check(Buffer.concat([fixture("rgba.png"), junk(64)])).ok).toBe(true);
    const text = pngChunk("tEXt", Buffer.from("Comment\0x", "latin1"));
    text[text.length - 1] ^= 0xff;
    expect(check(png(4, 4, [text])).ok).toBe(true);
  });
  it("WebP: RIFF sonrası fazladan bayt kabul", () => {
    expect(check(Buffer.concat([fixture("lossy.webp"), junk(32)])).ok).toBe(true);
  });
});

describe("🚨 doğru başlık + çöp gövde RED (Codex iddiası)", () => {
  it("JPEG: FF D8 FF E0 + çöp", () => {
    expect(check(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), junk(4000)])).ok).toBe(false);
  });
  it("PNG: imza + çöp", () => {
    expect(check(Buffer.concat([PNG_SIG, junk(4000)])).ok).toBe(false);
  });
  it("WebP: RIFF + boyut + WEBP + çöp", () => {
    const head = Buffer.from("RIFF\0\0\0\0WEBP", "latin1");
    head.writeUInt32LE(4 + 4000, 4);
    expect(check(Buffer.concat([head, junk(4000)])).ok).toBe(false);
  });
});

describe("🚨 kesik / bozuk gerçek dosya RED", () => {
  it("JPEG: EOI'dan önce kesik (dosyanın %70'i)", () => {
    const buf = fixture("baseline.jpg");
    expect(check(buf.subarray(0, Math.floor(buf.length * 0.7)))).toMatchObject({ ok: false });
  });
  it("JPEG: SOF yok (bölüm silindi) → görüntü yok", () => {
    const buf = fixture("baseline.jpg");
    const sof = buf.indexOf(Buffer.from([0xff, 0xc0]));
    expect(sof).toBeGreaterThan(0);
    const len = buf.readUInt16BE(sof + 2);
    expect(check(Buffer.concat([buf.subarray(0, sof), buf.subarray(sof + 2 + len)])).ok).toBe(false);
  });
  it("PNG: kesik (IEND yok)", () => {
    const buf = fixture("rgba.png");
    expect(check(buf.subarray(0, buf.length - 12)).ok).toBe(false);
  });
  it("PNG: IDAT içinde tek bayt bozuk → kritik parça CRC'si tutmaz", () => {
    const buf = Buffer.from(fixture("rgba.png"));
    const idat = buf.indexOf(Buffer.from("IDAT", "latin1"));
    buf[idat + 6] ^= 0x55;
    expect(check(buf)).toEqual({ ok: false, reason: "png_crc" });
  });
  it("PNG: paletli türde PLTE yok", () => {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(4, 0);
    ihdr.writeUInt32BE(4, 4);
    ihdr[8] = 8;
    ihdr[9] = 3;
    const buf = Buffer.concat([PNG_SIG, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(Buffer.alloc(2))), pngChunk("IEND", Buffer.alloc(0))]);
    expect(check(buf)).toEqual({ ok: false, reason: "png_no_plte" });
  });
  it("WebP: RIFF boyutu dosyadan büyük (kesik)", () => {
    const buf = fixture("lossy.webp");
    expect(check(buf.subarray(0, buf.length - 20))).toEqual({ ok: false, reason: "webp_riff_size" });
  });
  it("WebP: VP8 başlangıç kodu bozuk", () => {
    const buf = Buffer.from(fixture("lossy.webp"));
    const vp8 = buf.indexOf(Buffer.from("VP8 ", "latin1"));
    buf[vp8 + 8 + 3] = 0x00;
    expect(check(buf)).toEqual({ ok: false, reason: "webp_vp8" });
  });
});

describe("🚨 piksel tavanı (başlıktaki boyut; 10-01 S12)", () => {
  it("PNG 30.000 × 30.000 ilanı RED; tavanın tam sınırı kabul", () => {
    expect(check(png(30000, 30000))).toEqual({ ok: false, reason: "too_many_pixels" });
    expect(check(png(16384, 16384)).ok).toBe(true);
    expect(16384 * 16385).toBeGreaterThan(MAX_IMAGE_PIXELS);
    expect(check(png(16384, 16385))).toEqual({ ok: false, reason: "too_many_pixels" });
  });
  it("JPEG SOF 40000 × 40000 RED; 200 MP telefon boyutu (16320 × 12240) kabul", () => {
    const buf = Buffer.from(fixture("baseline.jpg"));
    const sof = buf.indexOf(Buffer.from([0xff, 0xc0]));
    buf.writeUInt16BE(40000, sof + 5);
    buf.writeUInt16BE(40000, sof + 7);
    expect(check(buf)).toEqual({ ok: false, reason: "too_many_pixels" });
    buf.writeUInt16BE(12240, sof + 5);
    buf.writeUInt16BE(16320, sof + 7);
    expect(check(buf)).toEqual({ ok: true, width: 16320, height: 12240 });
  });
  it("sıfır boyut RED", () => {
    expect(check(png(0, 10))).toEqual({ ok: false, reason: "zero_dimension" });
  });
});

describe("5 MB'lık uç girdiler (doğrusal yürüyüş; süre pini değil — yalnız sonuç)", () => {
  it("SOS sonrası 5 MB FF dolgusu (EOI yok) ve 5 MB çöp PNG → RED", () => {
    const head = fixture("baseline.jpg");
    const sos = head.indexOf(Buffer.from([0xff, 0xda]));
    const ffs = Buffer.alloc(5 * 1024 * 1024, 0xff);
    expect(check(Buffer.concat([head.subarray(0, sos + 2 + head.readUInt16BE(sos + 2)), ffs]))).toEqual({ ok: false, reason: "jpeg_no_eoi" });
    expect(check(Buffer.concat([PNG_SIG, junk(5 * 1024 * 1024)])).ok).toBe(false);
  });
});
