// ---------------------------------------------------------------------------
// BELGE NUMARASI + TİCARİ UNVAN NORMALLEŞTİRME (Faz 1a). SAF. Karşılaştırma ve bekçi anahtarı yalnız bu fonksiyonlardan geçer.
//
// · Numara: yalnız rakam / Latin harf + ayraç (boşluk . - /) kabul; ayraçlar atılır ("12.345" = "12345"). Başka her karakter → geçersiz
//   (boş dizi döner; çağıran reddeder).
// · Unvan: Türkçe küçük harf → ASCII, noktalama → boşluk, tek harf dizileri birleşir ("A.Ş." → "as"), bilinen hukuki / ticari kısaltmalar
//   tek biçime iner ("Limited Şirketi" = "Ltd. Şti."). AMAÇ yalnız biçim farkını yok etmek — "benziyor" puanı YOK: normalize hâli tutmuyorsa
//   karar İNSANINDIR (tasarım §3.2).
// · 🚨 Kullanıcı metnine uygulanan kalıplarda karesel iş yok (CLAUDE.md ReDoS kuralı): tek karakter sınıfı + tek niceleyici, sonra
//   doğrusal token eşlemesi.
// ---------------------------------------------------------------------------

const NUMBER_MAX = 40;

/** Normalize belge numarası; geçersizse "". */
export function normalizeLicenseNumber(raw: string): string {
  if (typeof raw !== "string") return "";
  const s = raw.normalize("NFKC").trim().toUpperCase();
  if (!s || s.length > 80) return "";
  let out = "";
  let digits = 0;
  for (const ch of s) {
    if (ch >= "0" && ch <= "9") {
      out += ch;
      digits += 1;
    } else if (ch >= "A" && ch <= "Z") {
      out += ch;
    } else if (ch === " " || ch === "." || ch === "-" || ch === "/") {
      continue;
    } else {
      return "";
    }
  }
  if (!out || digits === 0 || out.length > NUMBER_MAX) return "";
  return out;
}

const TR_TO_ASCII: Record<string, string> = {
  ç: "c",
  ğ: "g",
  ı: "i",
  ö: "o",
  ş: "s",
  ü: "u",
  â: "a",
  î: "i",
  û: "u",
};

// Bilinen hukuki biçim ve sık ticari kısaltmalar → tek biçim. Liste bilerek kısa: kalan farkları operatör ayırır.
const TOKEN_ALIASES: Record<string, string> = {
  limited: "ltd",
  ltd: "ltd",
  sirketi: "sti",
  sirket: "sti",
  sti: "sti",
  anonim: "as",
  as: "as",
  ticaret: "tic",
  tic: "tic",
  sanayi: "san",
  san: "san",
  turizm: "tur",
  tur: "tur",
  insaat: "ins",
  ins: "ins",
  ithalat: "ith",
  ith: "ith",
  ihracat: "ihr",
  ihr: "ihr",
  pazarlama: "paz",
  paz: "paz",
  acentasi: "acenta",
  acentaligi: "acenta",
  acente: "acenta",
  acentesi: "acenta",
  acenta: "acenta",
};

/** Normalize ticari unvan (karşılaştırma anahtarı); boş girişte "". */
export function normalizeLegalName(raw: string): string {
  if (typeof raw !== "string") return "";
  const lower = raw.normalize("NFKC").toLocaleLowerCase("tr-TR");
  let ascii = "";
  // "i̇" (i + birleşik nokta) tr-TR küçük harfte oluşabilir: birleşik işaretler atılır.
  for (const ch of lower.normalize("NFD")) {
    if (ch >= "̀" && ch <= "ͯ") continue;
    ascii += TR_TO_ASCII[ch] ?? ch;
  }
  const raw_tokens = ascii.replace(/[^0-9a-z]+/g, " ").trim().split(" ").filter(Boolean);
  // Tek harf dizilerini birleştir: "a s" → "as", "l t d" → "ltd".
  const merged: string[] = [];
  let run = "";
  for (const t of raw_tokens) {
    if (t.length === 1) {
      run += t;
      continue;
    }
    if (run) {
      merged.push(run);
      run = "";
    }
    merged.push(t);
  }
  if (run) merged.push(run);
  const tokens = merged.map((t) => TOKEN_ALIASES[t] ?? t);
  // "Anonim Şirketi" → "as sti" → "as" (anonim şirketin "şirketi" eki ayrı bir biçim değil).
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i] === "sti" && out[out.length - 1] === "as") continue;
    out.push(tokens[i]);
  }
  return out.join(" ");
}
