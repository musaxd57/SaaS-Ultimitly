import { lookup } from "node:dns/promises";

/**
 * Decode an IPv4-mapped/compatible IPv6 literal to its dotted IPv4 string, in
 * BOTH the dotted (`::ffff:1.2.3.4`, `::1.2.3.4`) and the hex (`::ffff:0102:0304`)
 * notations; null when `h` is not such a literal. Needed because a hex-form
 * v4-mapped literal reaches the private-address check unchanged (see caller).
 */
function mappedIpv4(h: string): string | null {
  // Noktalı yazımlar: "::ffff:127.0.0.1" ve IPv4-UYUMLU "::127.0.0.1".
  const dotted = h.match(/^::(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) return dotted[1];

  // ⚠️ WHATWG-NORMALİZE HEX BİÇİMLERİ (Codex denetimi, 08-01 — madde 5).
  // `new URL()` bir IPv6 literalini SIKIŞTIRIR ve küçük harfe indirir:
  // "::ffff:127.0.0.1" → "::ffff:7f00:1". Ampirik olarak ölçüldü — ÜÇ biçim
  // sınıflandırıcıdan GEÇİYORDU (isPrivateAddress=false):
  //   · "::7f00:1"                → 127.0.0.1   (IPv4-UYUMLU, "ffff:" YOK)
  //   · "::a9fe:a9fe"             → 169.254.169.254 (bulut metadata!)
  //   · "0:0:0:0:0:ffff:7f00:1"   → 127.0.0.1   (SIKIŞTIRILMAMIŞ yazım)
  // İlk ikisi yalnız `ffff:` öneki arandığı için, üçüncüsü `::` ile başlama
  // şartı yüzünden kaçıyordu. Üçü de IP-LİTERAL bir besleme URL'iyle doğrudan
  // kullanılabilir ve o yolda pinlenmiş `validatingLookup` HİÇ çalışmaz (Node,
  // host bir IP literali ise custom lookup'ı atlar) → tek savunma burasıdır.
  //
  // `ffff:` artık OPSİYONEL ve sıkıştırılmamış "0:0:0:0:0[:ffff]" öneki de
  // kabul ediliyor. Yalnızca EŞLEŞME EKLER: gerçek bir public IPv6 adresi bu
  // kalıplara uymaz (ilk 80 bitin sıfır olması şartı korunuyor).
  const hex = h.match(
    /^(?:::|0{1,4}(?::0{1,4}){4}:)(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/,
  );
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return null;
}

/**
 * True when a LITERAL address string is loopback / link-local / private / CGNAT /
 * cloud-metadata. Shared by the cheap string gate below and the DNS-resolution
 * gate — one place decides what "private" means.
 */
export function isPrivateAddress(address: string): boolean {
  const h = address.toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 [..] brackets
  if (!h) return true;
  // IPv6 loopback / unspecified / link-local (fe80::/10 — fe80..febf, NOT just
  // fe80:) / site-local (fec0::/10, deprecated but still routable) / unique-local
  // (fc00::/7 = fc/fd). The first hextet spans 0xfe80..0xfeff → "fe8".."fef".
  if (
    h === "::1" || h === "::" ||
    /^fe[89abcdef]/.test(h) || h.startsWith("fc") || h.startsWith("fd")
  ) {
    return true;
  }
  // 🚨 IPv6 MULTICAST (ff00::/8) — ÖLÇÜLMÜŞ BOŞLUK (P1 #8, 08-09 (2)).
  // IPv4 multicast (224.0.0.0/4) engelleniyordu, IPv6 karşılığı GEÇİYORDU:
  // `ff02::1` (tüm-düğümler), `ff02::2` (tüm-yönlendiriciler) ve `ff05::/16`
  // site-yerel grupları bir ağ keşif/amplifikasyon yüzeyi. Bir takvim
  // beslemesi hiçbir zaman meşru olarak bir multicast adresinde yaşamaz.
  if (/^ff[0-9a-f]{2}(:|$)/.test(h)) return true;
  // NAT64 (64:ff9b::/96) embeds an IPv4 in the low 32 bits — on a DNS64/NAT64
  // network "64:ff9b::a9fe:a9fe" reaches 169.254.169.254 (cloud metadata). Treat
  // the whole prefix as private (we never legitimately fetch a feed through it).
  if (h.startsWith("64:ff9b:")) return true;
  // 6to4 (2002::/16) gömülü IPv4'ü taşır — 2002:7f00:1:: = 127.0.0.1.
  if (h.startsWith("2002:")) return true;
  // IPv4, incl. EVERY IPv4-mapped/embedded IPv6 spelling. Node's dns.lookup echoes
  // an isIP()-valid literal VERBATIM (no inet_ntop normalization), and WHATWG URL
  // keeps the hex form too — so "::ffff:a9fe:a9fe" (=169.254.169.254) and
  // "::ffff:7f00:1" (=127.0.0.1) must be decoded here or they slip the octet check.
  const ip = mappedIpv4(h) ?? h;
  const parts = ip.split(".");
  if (parts.length === 4 && parts.every((x) => /^\d+$/.test(x))) {
    const [a, b] = parts.map((n) => Number(n));
    if (a === 0 || a === 127 || a === 10) return true; // this-network, loopback, private
    if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (100.64.0.0/10)
    // ⚠️ EKSİK AYRILMIŞ ARALIKLAR (denetim, 08-01 — beşinci tur, ajan bulgusu).
    // IP-LİTERAL besleme URL'lerinde Node, custom `lookup`'ı ATLAR (ampirik
    // doğrulandı: `hostname:"127.0.0.1"` ile lookup çağrılmıyor, "localhost" ile
    // çağrılıyor) → pinlenmiş DNS doğrulaması devreden çıkar ve TEK savunma bu
    // liste kalır. Yalnızca EŞLEŞME EKLER; meşru bir takvim beslemesi bu
    // aralıklarda barınmaz.
    if (a === 192 && b === 0) return true; // 192.0.0.0/24 IETF protokol tahsisi
    if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 kıyaslama ağı
    if (a >= 224) return true; // 224/4 multicast + 240/4 ayrılmış + 255.255.255.255
  }
  return false;
}

/**
 * True when a hostname is a literal loopback / link-local / private / cloud-
 * metadata target. String-only (no DNS) so it's cheap and can never false-reject
 * a legitimate public feed on a transient DNS hiccup. Used to guard host-supplied
 * fetch targets (iCal calendar-source URLs) against the most direct SSRF vectors
 * (http://127.0.0.1, http://169.254.169.254, http://10.x, localhost, [::1]).
 */
export function isPrivateHost(hostname: string): boolean {
  // ⚠️ SONDAKİ NOKTA KIRPILIR (denetim, 08-01 — beşinci tur, ajan bulgusu).
  // "localhost." ve "foo.railway.internal." tam nitelikli (FQDN) yazımlardır ve
  // aynı adı çözerler, ama sonek karşılaştırmaları onlara UYMUYORDU. Gerçek bir
  // SSRF açığı DEĞİL (sync yolundaki DNS kapısı yine reddeder), ama satır kabul
  // edilip hiç çalışmayan bir kaynak olarak kalıyordu — kafa karıştırıcı.
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) {
    return true;
  }
  return isPrivateAddress(h);
}

/**
 * DNS-resolution gate: true when the hostname resolves to ANY private address —
 * closes the "public hostname pointed at an internal IP" SSRF vector the string
 * check can't see. Checked at FETCH time (records can change after the source
 * was saved). Fail-OPEN on a lookup error (NXDOMAIN/timeout): the fetch will
 * fail on its own, and a transient DNS hiccup must never false-block a real
 * feed. Residual (documented): a TOCTOU rebind between this lookup and the
 * fetch's own lookup — closing that fully needs a pinning dispatcher; combined
 * with redirect:"manual" + the string gate this covers the practical attacks.
 */
export async function resolvesToPrivate(hostname: string): Promise<boolean> {
  try {
    const addrs = await lookup(hostname.replace(/^\[|\]$/g, ""), { all: true, verbatim: true });
    return addrs.some((a) => isPrivateAddress(a.address));
  } catch {
    return false;
  }
}
