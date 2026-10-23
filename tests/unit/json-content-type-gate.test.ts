import { describe, it, expect } from "vitest";
import {
  readJsonCapped,
  parseJsonBody,
  readJsonCappedOrNull,
  readTextCapped,
  UnsupportedMediaTypeError,
} from "@/lib/api";

// ---------------------------------------------------------------------------
// TARAYICI-BOTNET KAPISI: gövde taşıyan JSON istekleri `application/json`
// İSTER.
//
// TEHDİT (kod-doğrulandı): gövde ayrıştırıcıları `Content-Type`'a hiç bakmıyordu.
// Fetch standardına göre `Content-Type` YALNIZ üç değerde CORS-safelisted:
// `application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain`.
// `application/json` listede YOK → cross-origin bir `fetch` onu set ederse
// preflight tetiklenir; `/api`'de hiçbir CORS başlığı olmadığı için preflight
// cevapsız kalır ve tarayıcı isteği HİÇ göndermez.
//
// Kapı olmadan saldırgan, kendi sitesine koyduğu tek satırla HER ziyaretçinin
// tarayıcısından `text/plain` gövdeli POST attırabiliyordu — ve istekler
// ziyaretçilerin IP'lerinden geldiği için per-IP limitler yapısal olarak
// deliniyordu (lead spam, zorla kayıt, `/api/demo/ai` OpenAI harcaması).
//
// ⚠️ KAPSAM DÜRÜSTLÜĞÜ: bu kapı YALNIZ tarayıcı-botnet vektörünü kapatır.
// curl/script her başlığı set edebilir; onları sınırlayan şey per-IP kovaları.
// ---------------------------------------------------------------------------

const url = "http://localhost/api/x";
const post = (contentType: string | null, body = '{"a":1}') =>
  new Request(url, {
    method: "POST",
    headers: contentType === null ? {} : { "content-type": contentType },
    body,
  });

describe("JSON gövde kapısı — content-type", () => {
  it("KABUL: parametreli / farklı harfli / boşluklu geçerli biçimler", async () => {
    // Hepsi meşru. Ham string eşitliği (`=== "application/json"`) bunları
    // REDDEDERDİ — bugün kendi istemcimiz düz küçük harf gönderdiği için
    // fark edilmez, sonra bir istemci charset ekleyince üretimde patlardı.
    for (const ct of [
      "application/json",
      "application/json; charset=utf-8",
      "application/json;charset=UTF-8",
      "Application/JSON",
      "  application/json  ",
      "application/json ;charset=utf-8",
    ]) {
      await expect(readJsonCapped(post(ct)), `reddedildi: ${ct}`).resolves.toEqual({ a: 1 });
    }
  });

  it("RED: safelisted content-type'larla gövde geçemez (asıl saldırı)", async () => {
    // `text/plain` = cross-origin fetch'in preflight'sız gönderebildiği tip.
    for (const ct of ["text/plain", "text/plain;charset=UTF-8", "application/x-www-form-urlencoded"]) {
      await expect(readJsonCapped(post(ct)), `geçti: ${ct}`).rejects.toThrow(UnsupportedMediaTypeError);
    }
  });

  it("RED: content-type YOKKEN gövde geçemez (Blob kaçışı)", async () => {
    // ⚠️ Bu testin İLK hâli BOŞUNA GEÇİYORDU: `headers:{}` + STRING gövde
    // verince undici `text/plain;charset=UTF-8`'i KENDİ ekliyor, yani test
    // başlıksız yolu değil `text/plain`i tekrar sınıyordu (düşmanca doğrulama
    // ölçtü). Gerçekten başlıksız istek üretmenin yolu boş tipli bir `Blob`:
    // `fetch(url,{body:new Blob([json],{type:""})})` başlığı HİÇ göndermez ve
    // başlıksız istek zaten "simple" sayılır → "başlık yoksa geçir" kuralı
    // kapıyı tam buradan delerdi.
    const headerless = new Request(url, {
      method: "POST",
      body: new Blob(['{"a":1}'], { type: "" }),
    });
    // Varsayımın kendisi pinli: bu gerçekten başlıksız mı?
    expect(headerless.headers.get("content-type")).toBeNull();
    await expect(readJsonCapped(headerless)).rejects.toThrow(UnsupportedMediaTypeError);
  });

  it("RED: virgüllü (birleşmiş yinelenen) başlık geçemez", async () => {
    // Bir medya tipi virgül içeremez; virgüllü değer yinelenmiş başlıkların
    // birleşmiş hâlidir ve hangi değerin geçerli olduğu taraflar arasında
    // ayrışabilir (Node ilkini tutar, bir vekil sonuncuyu seçebilir).
    // ⚠️ `;`ten kesme TEK BAŞINA yetmiyordu: aşağıdaki ilk iki değer kesme
    // sonrası `application/json` olup KABUL ediliyordu.
    for (const ct of [
      "application/json;charset=utf-8, text/plain",
      "application/json;x, text/plain",
      "application/json, text/plain",
      "text/plain, application/json",
    ]) {
      await expect(readJsonCapped(post(ct)), `geçti: ${ct}`).rejects.toThrow(
        UnsupportedMediaTypeError,
      );
    }
  });

  it("RED: naif kontrolleri delen biçimler (asıl uygulama tuzağı)", async () => {
    // `includes("application/json")` ÖLÜMCÜL: bu değer CORS-safelisted
    // (unsafe bayt yok, <128 karakter) → preflight YOK → kapıdan geçerdi.
    await expect(readJsonCapped(post("text/plain; x=application/json"))).rejects.toThrow(UnsupportedMediaTypeError);
    await expect(readJsonCapped(post("text/plain, application/json"))).rejects.toThrow(UnsupportedMediaTypeError);
    // `startsWith` de yetmez:
    for (const ct of ["application/json+evil", "application/jsonp", "application/json-seq"]) {
      await expect(readJsonCapped(post(ct)), `geçti: ${ct}`).rejects.toThrow(UnsupportedMediaTypeError);
    }
  });

  it("DEĞİŞMEDİ: gövdesiz istek eski yolunda kalır (415 değil, mevcut 400)", async () => {
    // ⚠️ Kapı YALNIZ gövde varken çalışır. Gövdesiz bir istek hiçbir şey
    // kaçırmıyor; onu reddetmek "boş gövde → SyntaxError → çağıranın 400'ü"
    // sözleşmesini bozar ve 44 rotanın catch bloğuna ÜÇÜNCÜ bir dal ekletirdi.
    const bodyless = new Request(url, { method: "POST" });
    expect(bodyless.body).toBeNull(); // varsayımın kendisi de pinli
    await expect(readJsonCapped(bodyless)).rejects.toThrow(SyntaxError);
  });

  it("DOKUNULMADI: readTextCapped (Paddle HMAC yolu) content-type'a bakmaz", async () => {
    // 🚨 Kapı buraya KONULMAZ. Paddle ham gövdeyi imza için buradan okuyor ve
    // reddetme, `WebhookEvent` satırı yazılmadan ÖNCE olurdu → Paddle aynı
    // event_id ile yeniden dener, uyuşmazlık deterministik olduğu için
    // denemeler tükenir ve ÖDEME OLAYI KALICI KAYBOLUR.
    // Ayrıca Paddle'ın gerçek başlığı repodan KANITLANAMIYOR (resmî doküman
    // 403; testimizdeki değer bizim testimiz, Paddle'ın tel formatı değil).
    // ⚠️ İki iddia da GERÇEKTEN farklı olmalı: ilk hâlde `post(null, …)` da
    // `text/plain` üretiyordu (undici string gövdeye başlığı kendi ekliyor),
    // yani aynı durum iki kez sınanıyordu.
    await expect(readTextCapped(post("text/plain", "ham gövde"))).resolves.toBe("ham gövde");
    const headerless = new Request(url, { method: "POST", body: new Blob(["ham gövde"], { type: "" }) });
    expect(headerless.headers.get("content-type")).toBeNull();
    await expect(readTextCapped(headerless)).resolves.toBe("ham gövde");
  });

  it("SÖZLEŞME KORUNDU: parseJsonBody 'tooLarge:false', OrNull 'null' döner", async () => {
    // Yeni bir hata SINIFI atılıyor ama mevcut çağıranların iki kanalından
    // geçiyor → 44 rotanın hiçbirine dokunmak gerekmiyor. (Semantik olarak
    // 415 daha doğru olurdu; onu dönmek her rotaya yeni bir dal eklemeyi
    // gerektirdiği için BİLİNÇLİ olarak sonraki tura bırakıldı.)
    const r = await parseJsonBody(post("text/plain"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.tooLarge).toBe(false); // → çağıran 400 döner, 413 değil
    expect(await readJsonCappedOrNull(post("text/plain"))).toBeNull();
  });
});
