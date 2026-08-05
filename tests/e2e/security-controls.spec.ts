import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// GÜVENLİK KONTROLLERİNİN ÇALIŞMA-ZAMANI PİNİ.
//
// 🚨 VAR OLMA SEBEBİ (08-05, CANLI ARIZA): `mfa` claim'i eklendi, birim testleri
// yeşil geçti, ve kontrol ÜRETİMDE ÇALIŞMADI — `verifySession` claim'i sessizce
// düşürüyordu. Birim testleri KARARI (`isSuperAdmin`) sınıyordu, TAŞIMAYI değil.
//
// Buradaki her assertion, kaynak taramasının ve birim testinin YAPISAL OLARAK
// göremediği bir şeyi ölçer: gerçek bir HTTP isteğinin gerçek bir sunucudan
// aldığı gerçek cevap. Hepsi hızlı (ağ yok, DB yazımı yok) → e2e job'ına ölçülür
// bir dakika eklemez.
//
// Kural: buraya YALNIZ "yapılandırma doğru bağlanmış mı" soruları girer. İş
// mantığı birim/entegrasyon testlerinde kalır.
// ---------------------------------------------------------------------------

test("/_next/image KAPALI — kullanılmayan optimizer sharp'a besleme yapmasın", async ({ request }) => {
  // Açıkken ölçülmüştü: 200 + 597 bayt (ham dosya 80.283). `next.config.mjs`
  // `images.unoptimized` ile kapatıldı. Kaynak taraması bayrağı görür; bunun
  // gerçekten 404 döndüğünü YALNIZ çalışan sunucu söyleyebilir.
  const res = await request.get("/_next/image?url=%2Flixus-logo.png&w=64&q=75");
  expect(res.status()).toBe(404);
});

test("VDP politikası oturumsuz OKUNABİLİR + security.txt yayında", async ({ request }) => {
  // `security.txt`'in `Policy` alanı /guvenlik'e işaret ediyor. Sayfa
  // middleware'in PUBLIC_PREFIXES listesinden düşerse dış araştırmacı /login'e
  // yönlendirilir ve yayımlanmış bağlantı ölür.
  expect((await request.get("/guvenlik", { maxRedirects: 0 })).status()).toBe(200);

  const txt = await request.get("/.well-known/security.txt");
  expect(txt.status()).toBe(200);
  const body = await txt.text();
  // RFC 9116'da yalnız Contact ve Expires ZORUNLU. §5.3: bayat dosya,
  // dosyasızlıktan kötüdür → alanın varlığı burada da pinli.
  expect(body).toMatch(/^Contact:/m);
  expect(body).toMatch(/^Expires:/m);
});

test("token taşıyan sayfalarda Referrer-Policy: no-referrer (son eşleşen kazanıyor)", async ({ request }) => {
  // Next'te SON eşleşen başlık kazanır. Bu blok global `/(.*)` bloğundan SONRA
  // yazılmazsa SESSİZCE etkisiz kalır — kaynak taraması sırayı okur ama
  // tarayıcının/sunucunun gerçekten hangisini uyguladığını göremez.
  for (const path of ["/sifremi-unuttum", "/e-posta-dogrula"]) {
    const res = await request.get(path);
    expect(res.headers()["referrer-policy"], path).toBe("no-referrer");
  }
  // DAR olduğunun pini: diğer sayfalar global politikada kalmalı. Bu olmadan
  // "her yere no-referrer" gibi bir kaza da testten geçerdi.
  expect((await request.get("/login")).headers()["referrer-policy"]).toBe(
    "strict-origin-when-cross-origin",
  );
});

test("e-posta doğrulama GET DEĞİL POST (ön-ısıtma tek-kullanımlık token'ı yakmasın)", async ({ request }) => {
  // GET geri gelirse e-posta güvenlik tarayıcılarının ön-ısıtma isteği token'ı
  // tüketir ve kullanıcının kendi tıklaması "süresi dolmuş" alır. Ayrıca token
  // istek satırına geri döner (log'lar/vekiller görür).
  expect((await request.get("/api/auth/verify-email?token=x")).status()).toBe(405);

  const res = await request.post("/api/auth/verify-email", {
    headers: { "content-type": "application/json" },
    data: JSON.stringify({ token: "gecersiz" }),
  });
  expect(res.status()).toBe(400);
  // Sunucu SEBEP KODU döner, serbest metin değil (metni istemci yazar).
  expect((await res.json()).reason).toBe("expired");
});

test("JSON gövdeli POST `application/json` İSTİYOR (tarayıcı-botnet kapısı)", async ({ request }) => {
  // ⚠️ PROB OLARAK `/api/auth/login` KULLANMA (denendi, FLAKY ÇIKTI): orada limit
  // IP başına 10 deneme / 5 dk ve smoke testi de bir giriş harcıyor → altı
  // varyant eklenince kova 7/10'a çıkıyor, bir Playwright retry'ı 429'a
  // düşürüyordu. 429 rate-limit kontrolünden GELİYOR ve gövde okumasının
  // ÖNÜNDE olduğu için test "ölçemedim"i "kırıldı" diye raporluyordu.
  //
  // `verify-email` hem daha bol (20/saat) hem de DAHA KESİN bir ayrım veriyor:
  // durum kodu ikisinde de 400, ama SEBEP KODU gövdenin okunup okunmadığını
  // birebir söylüyor —
  //   · gövde okundu   → token bulundu, DB'de yok  → reason "expired"
  //   · gövde DÜŞÜRÜLDÜ → token boş                → reason "missing"
  // (`readJsonCappedOrNull` medya tipi hatasını `null`'a çeviriyor.)
  const body = JSON.stringify({ token: "gecersiz" });
  const reasonFor = async (ct: string) => {
    const res = await request.post("/api/auth/verify-email", { headers: { "content-type": ct }, data: body });
    // 🚨 429 = "ÖLÇEMEDİM", "kontrol bozuk" DEĞİL. Ayrı ve AÇIK bir mesajla
    // düşer, çünkü bu ayrımı yapmayan bir hata (`Expected "missing", got
    // undefined`) okuyanı saatlerce yanlış yere bakmaya iter — bu dosyayı
    // yazarken tam olarak o oldu.
    if (res.status() === 429) {
      throw new Error(
        `Hız limiti (429), Content-Type="${ct}". Bu test ÖLÇEMEDİ; kontrolün bozuk ` +
          `olduğu anlamına GELMEZ. Her koşum 7 istek harcıyor, sınır 20/saat/IP. ` +
          `CI'da veritabanı her koşuda taze olduğu için sorun çıkmaz (2 retry payı da var). ` +
          `Yerelde arka arkaya koştuysan: psql -c 'TRUNCATE "RateLimitCounter";' ya da 1 saat bekle.`,
      );
    }
    expect(res.status(), ct).toBe(400);
    return (await res.json()).reason;
  };

  // MEŞRU istek kapıya TAKILMAMALI — gövdesi okunmalı. Bu assertion olmadan
  // kapı "her şeyi reddet"e dönse bile test yeşil kalırdı.
  for (const ct of ["application/json", "application/json; charset=utf-8"]) {
    expect(await reasonFor(ct), ct).toBe("expired");
  }

  // Üç MIME CORS-safelisted'dır; onlarla gelen istek preflight'sız
  // gönderilebilir → gövde REDDEDİLMELİ. Aradaki iki satır naif uygulamaların
  // delindiği tam biçimler: `includes()` ilkini, `startsWith()` ikincisini
  // kabul ederdi. Virgüllü biçim ÖZDE değil HAM değerde yakalanmak zorunda.
  for (const ct of [
    "text/plain",
    "text/plain; x=application/json",
    "application/json+evil",
    "application/json;charset=utf-8, text/plain",
  ]) {
    expect(await reasonFor(ct), ct).toBe("missing");
  }
});
