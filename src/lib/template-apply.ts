import { guestFirstNameOf, resolveGuestPlaceholder } from "./kb-placeholders";

// ---------------------------------------------------------------------------
// ŞABLON UYGULAMA — inbox yazma alanına doldurulan metin. Saf, DB'siz, ağsız.
//
// Host inbox'ta bir şablon seçtiğinde metin YAZMA ALANINA düşer; gönderme kararı
// host'undur. Bu modül o metni üretir.
//
// 🚨 TEK GEÇİŞ — SIRAYLA `split/join` YAPMA (denetim 08-07 (5), ÖLÇÜLDÜ).
// Eski kod `Object.entries` üzerinde döngüyordu ve her anahtar, ÖNCEKİ
// anahtarların YERİNE KOYDUĞU metni de yeniden tarıyordu. `guestName`
// sağlayıcıdan gelir ve MİSAFİR KONTROLÜNDEDİR (Airbnb görünen adı) → misafir
// adını `{{wifiInfo}}` yapınca, wifi yer tutucusu HİÇ GEÇMEYEN bir şablon bile
// KB'deki wifi kalemini yazma alanına basıyordu.
// ÖLÇÜLDÜ: "Merhaba {{guestName}}, {{propertyName}} …" →
//   "Merhaba SSID: Lale3_5G / Sifre: Yaz2026! - Kapi kodu: 4590, Lale 3 …"
// (varsayılan giriş şablonu host'a kapı kodunu tam da o KB kalemine yazmasını
// söylüyor, yani sızan şey rutin olarak kapı kodudur.)
// Tek geçişte yerine konan metin BİR DAHA taranmaz → enjeksiyon imkânsız.
//
// 🚨 İKİ BELİRTEÇ STİLİ, TEK GEÇİŞ: `{{çiftParantez}}` şablon değişkenleridir
// (`templateVars`), `{tekParantez}` ise host'un her yerde kullandığı ad/daire
// sınıfıdır ve tek kaynağı `kb-placeholders.ts`'tir. İkisi AYRI geçişe
// bölünemez: birinci geçişin yazdığı misafir-kontrollü metin ikinci geçişte
// yeni bir belirteç uydurabilirdi.
// ---------------------------------------------------------------------------

/**
 * Çift parantez ŞABLON değişkeni ya da tek parantez AD/DAİRE belirteci.
 * Alternasyonda çift parantez ÖNCE denenir; `{{guestName}}` tek-parantez
 * dalına düşmez.
 */
const TOKENS = /\{\{(\w+)\}\}|\{\s*(\p{L}+)\s*\}/gu;

/** Doldurulmamış kalan `{{…}}` — misafir ham belirteç GÖRMEMELİ. */
const LEFTOVER_DOUBLE = /\{\{[^}]+\}\}/g;

export function applyTemplateBody(body: string, vars?: Record<string, string>): string {
  let out = body;
  if (vars) {
    // 🚨 TEK-PARANTEZ SINIFI ESKİDEN YARIMDI (ölçüldü 09-11): yalnız
    // `{isim}`/`{ad}` tanınıyordu; `{name}`, `{daire}`, `{apartment}`, `{apt}`
    // hiçbir yerde çözülmüyordu VE aşağıdaki temizlik yalnız `{{…}}` sildiği
    // için ham belirteç yazma alanına düşüyordu — host fark etmezse misafire
    // "Kapı kodu: {daire}" gidiyordu. Diğer üç yüzey (oto-yanıt, QR, ai-suggest)
    // aynı sınıfı `kb-placeholders.ts`ten çözüyor; burada da anahtar çözümü
    // oradan ödünç alınır, geçiş tek kalır.
    const guestFirstName = guestFirstNameOf(vars.guestName) ?? undefined;
    out = out.replace(TOKENS, (match, dblKey?: string, single?: string) => {
      if (dblKey) {
        // 🚨 `hasOwn`: `{{constructor}}` / `{{toString}}` düz indekslemede
        // PROTOTİP üyesine çözülür ve fonksiyon truthy olduğu için yazma alanına
        // `function Object() { … }` basılırdı.
        const value = Object.hasOwn(vars, dblKey) ? vars[dblKey] : undefined;
        return value ? value : match; // eşleşmeyen aşağıdaki temizlikte düşer
      }
      if (!single) return match;
      // Değeri çözülemeyen belirteç (bilinmeyen anahtar, adsız rezervasyon,
      // belirsiz daire numarası) DOKUNULMAZ: uydurma değer yazmaktansa host
      // belirteci görsün ve düzeltsin.
      return resolveGuestPlaceholder(single, { guestFirstName, propertyName: vars.propertyName }) ?? match;
    });
  }
  return out.replace(LEFTOVER_DOUBLE, "").replace(/\n{3,}/g, "\n\n").trim();
}
