import { test, expect } from "@playwright/test";
import sharp from "sharp";

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

// Optimizer pininin kullandığı kaynak görsel. İkisi de AYNI yolu istiyor:
// biri BAŞARI yolunu, diğeri kapalı ucu ölçüyor.
const IMAGE_PATH = "/lixus-logo.png";

test("görsel BAŞARI yolu — 200 + doğru içerik türü + ÇÖZÜMLENEBİLİR çıktı", async ({ request }) => {
  // 🚨 BU TEST 2026-09-09'da EKLENDİ (Codex itirazı): aşağıdaki 404 pini TEK
  // BAŞINA "görsel sunumu çalışıyor" demiyordu. Kaynak dosya silinseydi ya da
  // statik sunum bozulsaydı 404 YİNE gelir ve pin YANLIŞ SEBEPLE geçerdi.
  // Burası o boşluğu kapatıyor: aynı yol gerçekten servis ediliyor mu?
  const res = await request.get(IMAGE_PATH);

  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toMatch(/^image\/png/);

  // "Çözümlenebilir çıktı": baytlar gerçekten piksele dönüyor mu? Geçerli bir
  // başlık + çözülemeyen gövde de 200 döner; ham piksele bakmak bunu ayırır.
  const body = await res.body();
  const meta = await sharp(body).metadata();
  expect(meta.format).toBe("png");
  expect(meta.width ?? 0).toBeGreaterThan(0);
  expect(meta.height ?? 0).toBeGreaterThan(0);
  const raw = await sharp(body).raw().toBuffer();
  expect(raw.length).toBe((meta.width ?? 0) * (meta.height ?? 0) * (meta.channels ?? 0));
});

test("/_next/image KAPALI — 404'ün SEBEBİ optimizer, eksik kaynak değil", async ({ request }) => {
  // Açıkken ölçülmüştü: 200 + 597 bayt (ham dosya 80.283). `next.config.mjs`
  // `images.unoptimized` ile kapatıldı. Kaynak taraması bayrağı görür; bunun
  // gerçekten 404 döndüğünü YALNIZ çalışan sunucu söyleyebilir.
  //
  // 🚨 ATFIN KANITI: bir üstteki test aynı yolun 200 + çözümlenebilir PNG
  // döndürdüğünü gösteriyor. Dolayısıyla buradaki 404 "kaynak yok"tan DEĞİL,
  // yalnızca optimizer'ın kapalı olmasından geliyor.
  //
  // 🚨 BURADA 200 BEKLENMEZ ve beklenemez: bu ucun başarı yolunu açmak
  // `images.unoptimized`i kapatmak demektir — hem bir GÜVENLİK KONTROLÜ
  // değişikliğidir, hem de audit baseline'ının sharp gerekçesini (optimizer
  // kapalı olduğu için ULAŞILAMAZ) geçersiz kılar. Kodek'in gerçekten
  // çalıştığı, sentetik görüntüyle `tests/unit/sharp-image-pipeline.test.ts`
  // içinde ölçülüyor.
  const res = await request.get(`/_next/image?url=${encodeURIComponent(IMAGE_PATH)}&w=64&q=75`);
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
  // GET'e YAN ETKİ bağlanırsa e-posta güvenlik tarayıcılarının ön-ısıtma isteği
  // token'ı tüketir ve kullanıcının kendi tıklaması "süresi dolmuş" alır.
  //
  // ⚠️ BU PİN 08-09'da DEĞİŞTİ ve GEVŞEMEDİ. Eskiden `405` bekliyordu, yani
  // "GET handler'ı HİÇ YOK" diye ölçüyordu — bu, korunan değişmezin (yan etki
  // yok) bir VEKİLİYDİ, kendisi değil. 08-05 öncesi gönderilmiş her doğrulama
  // e-postası hâlâ `GET /api/auth/verify-email?token=…` adresine işaret ettiği
  // için 405 tarayıcıda ÇIPLAK "Bu sayfa çalışmıyor" veriyordu (kullanıcı
  // canlıda gördü). Artık YAN ETKİSİZ bir GET o bağlantıları kurtarıyor.
  // Pin, vekil yerine değişmezin KENDİSİNİ ölçüyor:
  const get = await request.get("/api/auth/verify-email?token=x", { maxRedirects: 0 });
  // (1) İŞLEM YAPMIYOR, yönlendiriyor. 200 dönerse token bir yerde işlenmiş
  //     demektir — o an bu satır kırmızı olur.
  expect(get.status()).toBe(302);
  const location = get.headers()["location"] ?? "";
  // (2) Token FRAGMENT'e taşınıyor, query'de BIRAKILMIYOR: sonraki hop'ta istek
  //     satırında token yok (Railway edge log'u / vekiller / ön-ısıtma).
  expect(location).toContain("/e-posta-dogrula#t=x");
  expect(new URL(location, "http://localhost").search).toBe("");
  // (3) OTURUM BASMIYOR. Bu token TEK BAŞINA oturum açabildiği için en kritik
  //     iddia bu: ön-ısıtma isteği asla giriş yapmış olmamalı.
  expect(get.headers()["set-cookie"]).toBeUndefined();

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
