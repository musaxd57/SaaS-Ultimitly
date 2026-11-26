/**
 * Authoritative image-type check: inspect the real leading bytes rather than
 * trusting a client-supplied Content-Type (which is trivially forged). Returns
 * the canonical extension, or null if the bytes are not a JPEG/PNG/WebP. Callers
 * derive the stored file's extension from THIS, so attacker bytes can't be saved
 * under an image name in a public web root.
 */
export function sniffImageExt(buf: Buffer): "jpg" | "png" | "webp" | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  )
    return "png";
  // WebP: "RIFF"...."WEBP"
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  )
    return "webp";
  return null;
}

// ---------------------------------------------------------------------------
// 🚨 K27-K11 (Codex 11-25 ikinci rapor): YAPISAL DOĞRULAMA — bağımlılıksız, çözmeden (decode yok).
//
// `sniffImageExt` yalnız ilk baytlara bakıyordu: doğru başlık + çöp gövde (bozuk / kesik dosya, görsel kılığında başka içerik) saklanıp
// `image/*` olarak sunuluyordu. Burada biçimin KABUĞU yürünür — piksel verisi çözülmez:
//   · JPEG: SOI → uzunluklu bölümler (SOF boyutları > 0, en az bir SOS) → sıkıştırılmış veri (FF00 dolgusu, RST) → EOI. İlerlemeli
//     (birden çok SOS), EXIF / MPF (APPn), CMYK, yeniden başlatma aralığı kabul. İLK EOI'dan sonraki baytlar (telefonların eklediği ikinci
//     görüntü / üretici kuyruğu) kabul edilir — tarayıcılar da yok sayar.
//   · PNG: imza → İLK parça IHDR (13 bayt, boyut > 0, geçerli bit derinliği / renk türü) → parçalar dosya içinde → en az bir IDAT, palet
//     türünde PLTE → IEND. KRİTİK parçaların (adı büyük harfle başlayan) CRC'si denetlenir — libpng'nin varsayılanı da budur (yardımcı
//     parçada CRC hatası tarayıcıda yalnız uyarı). IEND sonrası baytlar kabul.
//   · WebP: RIFF boyutu dosyaya sığar → ilk parça VP8 / VP8L / VP8X → parçalar RIFF içinde → en az bir görüntü (VP8 anahtar kare başlangıç
//     kodu / VP8L imzası / ANMF kare) ve boyut > 0.
// Piksel tavanı (`MAX_IMAGE_PIXELS`): başlıktaki boyutlar çarpılır; 5 MB'lık dosya 30.000 × 30.000 piksel ilan edip açan sekmeyi
// çökertebilir (10-01 S12). Tavan 16384 × 16384 ≈ 268 MP — bugün satılan en yüksek çözünürlüklü telefon kamerası (≈200 MP) altında kalır.
// Hata metni yüklemenin VAR OLAN "geçerli bir görsel değil" metnidir (yeni metin yok).
// Bilinen sınırlar: sıkıştırılmış veri çözülmez (kabuğu sağlam ama içi bozuk dosya geçer); EXIF / GPS SAKLANAN baytta durur (silmek
// baytı değiştirir — kurucu sorusu, `docs/INCELEME-2026-11-25-k27-C1.md`).
// ---------------------------------------------------------------------------

/** Başlıkta ilan edilen en çok piksel (genişlik × yükseklik). */
export const MAX_IMAGE_PIXELS = 16384 * 16384;

export type ImageStructure =
  | { ok: true; width: number; height: number }
  | { ok: false; reason: string };

const fail = (reason: string): ImageStructure => ({ ok: false, reason });

function withDims(width: number, height: number): ImageStructure {
  if (!(width > 0) || !(height > 0)) return fail("zero_dimension");
  if (width * height > MAX_IMAGE_PIXELS) return fail("too_many_pixels");
  return { ok: true, width, height };
}

/** Biçimin kabuğunu yürür; `ext` `sniffImageExt`in verdiği değerdir. */
export function validateImageStructure(buf: Buffer, ext: "jpg" | "png" | "webp"): ImageStructure {
  if (ext === "jpg") return validateJpeg(buf);
  if (ext === "png") return validatePng(buf);
  return validateWebp(buf);
}

// SOFn: C0–C3, C5–C7, C9–CB, CD–CF (C4 = DHT, C8 = JPG, CC = DAC değildir).
function isSofMarker(m: number): boolean {
  return m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
}

function validateJpeg(buf: Buffer): ImageStructure {
  const len = buf.length;
  if (len < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return fail("jpeg_soi");
  let pos = 2;
  let width = 0;
  let height = 0;
  let sawSof = false;
  let sawSos = false;
  for (;;) {
    if (pos >= len || buf[pos] !== 0xff) return fail("jpeg_marker");
    while (pos < len && buf[pos] === 0xff) pos++; // dolgu baytları
    if (pos >= len) return fail("jpeg_truncated");
    const m = buf[pos++];
    if (m === 0xd9) {
      if (!sawSof || !sawSos) return fail("jpeg_no_image");
      return withDims(width, height); // İLK EOI — arkasındaki baytlar (MPF ikinci görüntü, üretici kuyruğu) kabul
    }
    if (m === 0x00 || m === 0xd8) return fail("jpeg_marker");
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) continue; // uzunluksuz işaretler
    if (pos + 2 > len) return fail("jpeg_truncated");
    const segLen = buf.readUInt16BE(pos);
    if (segLen < 2 || pos + segLen > len) return fail("jpeg_segment");
    if (isSofMarker(m) && !sawSof) {
      // İlk SOF boyutu belirler (hiyerarşik JPEG'in sonraki SOF'ları reddedilmez — kabuk yeter).
      if (segLen < 8) return fail("jpeg_sof");
      height = buf.readUInt16BE(pos + 3);
      width = buf.readUInt16BE(pos + 5);
      const comps = buf[pos + 7];
      if (comps === 0 || segLen < 8 + 3 * comps) return fail("jpeg_sof");
      sawSof = true;
    }
    if (m === 0xda) {
      if (!sawSof) return fail("jpeg_sos_before_sof");
      if (segLen < 6) return fail("jpeg_sos");
      sawSos = true;
      pos += segLen;
      // Sıkıştırılmış veri: bir sonraki GERÇEK işarete kadar (FF00 dolgu, FFD0–D7 yeniden başlatma, FFFF dolgu veri içinde kalır).
      for (;;) {
        const ff = buf.indexOf(0xff, pos);
        if (ff < 0 || ff + 1 >= len) return fail("jpeg_no_eoi");
        const next = buf[ff + 1];
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
          pos = ff + 2;
          continue;
        }
        if (next === 0xff) {
          pos = ff + 1;
          continue;
        }
        pos = ff; // işaret — dış döngü okur
        break;
      }
      continue;
    }
    pos += segLen;
  }
}

let crcTable: Uint32Array | null = null;
function crc32(buf: Buffer, start: number, end: number): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Renk türü → izinli bit derinlikleri (PNG 1.2 §11.2.2).
const PNG_DEPTHS: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };

function validatePng(buf: Buffer): ImageStructure {
  const len = buf.length;
  if (sniffImageExt(buf) !== "png") return fail("png_signature");
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  let sawPlte = false;
  let sawIdat = false;
  let first = true;
  for (;;) {
    if (pos + 12 > len) return fail("png_truncated");
    const dataLen = buf.readUInt32BE(pos);
    if (dataLen > 0x7fffffff || pos + 12 + dataLen > len) return fail("png_chunk_length");
    const type = buf.toString("latin1", pos + 4, pos + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) return fail("png_chunk_type");
    const dataStart = pos + 8;
    const critical = type.charCodeAt(0) >= 0x41 && type.charCodeAt(0) <= 0x5a;
    if (critical && crc32(buf, pos + 4, dataStart + dataLen) !== buf.readUInt32BE(dataStart + dataLen)) return fail("png_crc");
    if (first) {
      if (type !== "IHDR" || dataLen !== 13) return fail("png_ihdr");
      width = buf.readUInt32BE(dataStart);
      height = buf.readUInt32BE(dataStart + 4);
      const depth = buf[dataStart + 8];
      colorType = buf[dataStart + 9];
      if (width > 0x7fffffff || height > 0x7fffffff) return fail("png_ihdr");
      if (!(PNG_DEPTHS[colorType] ?? []).includes(depth)) return fail("png_ihdr");
      if (buf[dataStart + 10] !== 0 || buf[dataStart + 11] !== 0 || buf[dataStart + 12] > 1) return fail("png_ihdr");
      first = false;
    } else if (type === "IHDR") {
      return fail("png_ihdr");
    } else if (type === "PLTE") {
      sawPlte = true;
    } else if (type === "IDAT") {
      sawIdat = true;
    } else if (type === "IEND") {
      if (!sawIdat) return fail("png_no_idat");
      if (colorType === 3 && !sawPlte) return fail("png_no_plte");
      return withDims(width, height); // IEND sonrası baytlar kabul
    }
    pos = dataStart + dataLen + 4;
  }
}

function validateWebp(buf: Buffer): ImageStructure {
  const len = buf.length;
  if (sniffImageExt(buf) !== "webp" || len < 20) return fail("webp_header");
  const end = 8 + buf.readUInt32LE(4);
  if (end > len || end < 20) return fail("webp_riff_size");
  let pos = 12;
  let width = 0;
  let height = 0;
  let canvas = false;
  let sawImage = false;
  let first = true;
  while (pos + 8 <= end) {
    const fourcc = buf.toString("latin1", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const data = pos + 8;
    if (size > end - data) return fail("webp_chunk_size");
    if (first && fourcc !== "VP8 " && fourcc !== "VP8L" && fourcc !== "VP8X") return fail("webp_first_chunk");
    first = false;
    if (fourcc === "VP8X") {
      if (size < 10) return fail("webp_vp8x");
      width = buf.readUIntLE(data + 4, 3) + 1;
      height = buf.readUIntLE(data + 7, 3) + 1;
      canvas = true;
    } else if (fourcc === "VP8 ") {
      // Anahtar kare: çerçeve etiketi bit 0 = 0, başlangıç kodu 9D 01 2A, 14 bit genişlik / yükseklik.
      if (size < 10 || (buf[data] & 1) !== 0 || buf[data + 3] !== 0x9d || buf[data + 4] !== 0x01 || buf[data + 5] !== 0x2a) {
        return fail("webp_vp8");
      }
      const w = buf.readUInt16LE(data + 6) & 0x3fff;
      const h = buf.readUInt16LE(data + 8) & 0x3fff;
      if (w === 0 || h === 0) return fail("webp_vp8");
      if (!canvas) { width = w; height = h; }
      sawImage = true;
    } else if (fourcc === "VP8L") {
      if (size < 5 || buf[data] !== 0x2f) return fail("webp_vp8l");
      const bits = buf.readUInt32LE(data + 1);
      if (bits >>> 29 !== 0) return fail("webp_vp8l"); // sürüm 0
      if (!canvas) { width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1; }
      sawImage = true;
    } else if (fourcc === "ANMF") {
      if (!canvas || size < 16) return fail("webp_anmf");
      sawImage = true;
    }
    pos = data + size + (size & 1);
  }
  if (!sawImage) return fail("webp_no_image");
  return withDims(width, height);
}
