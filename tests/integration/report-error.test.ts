import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// report-error-core imports "./email-core" DIRECTLY (tsx/server-only split) —
// the mock must target that module, not the "@/lib/email" wrapper.
// ⚠️ `send` DEĞİL `sendReporting` (denetim, 08-01): `send` sonucu YUTAR ve `void`
// döner — raportörün kendisi CLAUDE.md'nin "bildirim yollarında `send`
// KULLANILMAZ" kuralını ihlal ediyordu. Artık sonuç okunuyor ve DÖNDÜRÜLÜYOR.
vi.mock("@/lib/email-core", () => ({ emailService: { sendReporting: vi.fn() } }));

import { emailService } from "@/lib/email-core";
import { reportError, redactSensitive, __resetReportThrottle } from "@/lib/report-error";

const mockSend = vi.mocked(emailService.sendReporting);

describe("reportError", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetReportThrottle();
    mockSend.mockResolvedValue({ ok: true });
    // `configured` artık HEM alıcı HEM sağlayıcı ister (aksi hâlde çağıranlar
    // yapılandırma eksikliğini "geçici arıza" sanıp pencerelerini sonsuza kadar
    // geri alırdı).
    vi.stubEnv("RESEND_API_KEY", "re_test");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("never throws and logs without email when ERROR/ALERT email is unset", async () => {
    vi.stubEnv("ERROR_ALERT_EMAIL", "");
    vi.stubEnv("ALERT_EMAIL", "");
    await expect(reportError("ctx", new Error("boom"))).resolves.toEqual({
      notified: false,
      throttled: false,
      configured: false,
    });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("SAĞLAYICI yoksa configured:false döner (yapılandırma eksikliği ≠ arıza)", async () => {
    vi.stubEnv("ERROR_ALERT_EMAIL", "ops@example.com");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_HOST", "");
    await expect(reportError("ctx", new Error("boom"))).resolves.toEqual({
      notified: false,
      throttled: false,
      configured: false,
    });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("SONUCU DÖNDÜRÜR: gönderim başarısızsa notified:false, damga ~1 dk GERİYE çekilir", async () => {
    // ⚠️ Damga SİLİNMEZ, GERİYE ÇEKİLİR (denetim 08-01, üçüncü tur — ajan bulgusu).
    // Silmek 10 dakikalık kovayı tam da SAĞLAYICI BOZUKKEN devre dışı bırakıyordu;
    // oysa kovanın var olma sebebi bu. Kanıt: `outbox/worker.ts signalOutboxStuck`
    // SABİT bir context kullanır ("outbox-blocked") ve tek drain 20 satıra kadar
    // çıkar → damga her başarısızlıkta silinseydi TEK drain 20 e-posta denemesi
    // üretir, her biri 12-15 sn timeout ile senkron içinde bloklardı.
    // Geri çekme hem tekrarı korur hem tavanı ≤1/dk yapar.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-01T10:00:00Z"));
      vi.stubEnv("ERROR_ALERT_EMAIL", "ops@example.com");
      mockSend.mockResolvedValue({ ok: false, error: "provider 500" });
      await expect(reportError("ctx-fail", new Error("boom"))).resolves.toEqual({
        notified: false,
        throttled: false,
        configured: true,
      });

      // HEMEN ardından gelen hata SEL ÜRETMEZ (kova hâlâ çalışıyor).
      await expect(reportError("ctx-fail", new Error("boom2"))).resolves.toMatchObject({
        throttled: true,
      });
      expect(mockSend).toHaveBeenCalledTimes(1);

      // ~1 dakika sonra yeniden denenir (sessiz kayıp yok).
      vi.setSystemTime(new Date("2026-08-01T10:01:01Z"));
      mockSend.mockResolvedValue({ ok: true });
      await expect(reportError("ctx-fail", new Error("boom3"))).resolves.toMatchObject({
        notified: true,
      });
      expect(mockSend).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("throttled hâli AYRI raporlanır (çağıran kendi penceresini geri almamalı)", async () => {
    vi.stubEnv("ERROR_ALERT_EMAIL", "ops@example.com");
    await reportError("ctx-thr", new Error("first"));
    await expect(reportError("ctx-thr", new Error("second"))).resolves.toEqual({
      notified: false,
      throttled: true,
      configured: true,
    });
  });

  it("emails the operator when configured, then throttles repeats", async () => {
    vi.stubEnv("ERROR_ALERT_EMAIL", "ops@example.com");
    await reportError("sync", new Error("first"));
    expect(mockSend).toHaveBeenCalledTimes(1);
    const [to, subject] = mockSend.mock.calls[0];
    expect(to).toBe("ops@example.com");
    expect(subject).toContain("sync");

    // A second error immediately after is throttled (no flood).
    await reportError("sync", new Error("second"));
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("swallows email failures (reporting must not throw)", async () => {
    vi.stubEnv("ERROR_ALERT_EMAIL", "ops@example.com");
    mockSend.mockRejectedValueOnce(new Error("smtp down"));
    await expect(reportError("ctx", "weird")).resolves.toEqual({
      notified: false,
      throttled: false,
      configured: true,
    });
  });

  it("posts a Sentry envelope when SENTRY_DSN is set, and skips when unset", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("ERROR_ALERT_EMAIL", "");
    vi.stubEnv("ALERT_EMAIL", "");

    // Unset → no Sentry call.
    vi.stubEnv("SENTRY_DSN", "");
    await reportError("ctx", new Error("x"));
    expect(fetchMock).not.toHaveBeenCalled();

    // Set → one envelope POST to the derived ingest endpoint.
    vi.stubEnv("SENTRY_DSN", "https://pubkey@o123.ingest.sentry.io/456");
    await reportError("sync-fail", new Error("kaboom"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://o123.ingest.sentry.io/api/456/envelope/");
    expect(String((init as RequestInit).body)).toContain("kaboom");
  });

  it("redacts PII/secrets from BOTH the Sentry envelope and the alert email", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("SENTRY_DSN", "https://pubkey@o123.ingest.sentry.io/456");
    vi.stubEnv("ERROR_ALERT_EMAIL", "ops@example.com");

    const leaky = new Error(
      'HospitableError: HTTP 500: {"full_name":"John Smith","email":"guest@x.com","phone":"+90 555 123 4567","door_code":"482913"} Authorization: Bearer sk-abc123def456ghi Cookie: s=zzz whsec_xyz',
    );
    await reportError("hospitable-sync", leaky);

    const sentryBody = String((fetchMock.mock.calls[0][1] as RequestInit).body);
    const emailHtml = String(mockSend.mock.calls[0][2]);
    for (const s of [sentryBody, emailHtml]) {
      expect(s).not.toContain("John Smith");
      expect(s).not.toContain("guest@x.com");
      expect(s).not.toContain("555 123");
      expect(s).not.toContain("482913");
      expect(s).not.toContain("sk-abc123def456ghi");
      expect(s).not.toContain("whsec_xyz");
      expect(s).not.toContain("s=zzz");
      // Debuggable parts SURVIVE:
      expect(s).toContain("HospitableError");
      expect(s).toContain("HTTP 500");
    }
    expect(sentryBody).toContain("hospitable-sync"); // context/transaction preserved for grouping
  });
});

describe("redactSensitive", () => {
  it("masks secret/PII values, keeps status codes + error types/codes + stack shape", () => {
    expect(redactSensitive("contact guest@x.com now")).not.toContain("guest@x.com"); // unlabeled email
    expect(redactSensitive("Bearer sk-abc123def456ghijk")).not.toContain("sk-abc123def456ghijk");
    expect(redactSensitive("whsec_abcdef")).toBe("whsec_[REDACTED]");
    expect(redactSensitive("call +905551112233 please")).not.toContain("905551112233"); // unlabeled phone
    expect(redactSensitive('{"door_code":"482913"}')).not.toContain("482913");
    // preserved:
    expect(redactSensitive("PrismaClientKnownRequestError P2002 on field")).toContain("P2002");
    expect(redactSensitive("HTTP 429 Too Many Requests")).toContain("429");
    expect(redactSensitive("invalid_grant")).toBe("invalid_grant");
    expect(redactSensitive("")).toBe("");
  });

  it("redacts quoted PII values that CONTAIN commas (address/full_name/guest_name)", () => {
    // Regression for the FIELD_RE comma-leak: the value matcher used to stop at the
    // first comma, so a quoted address/name leaked the rest of its value to the
    // US-hosted Sentry / alert email / retained logs.
    expect(redactSensitive('{"address":"Istanbul, Turkey"}')).not.toContain("Istanbul");
    expect(redactSensitive('{"address":"Istanbul, Turkey"}')).not.toContain("Turkey");
    expect(redactSensitive('{"full_name":"Yılmaz, Ahmet"}')).not.toContain("Yılmaz");
    const multi = redactSensitive('{"guest_name":"Mehmet, Demir","address":"Beşiktaş, İstanbul"}');
    expect(multi).not.toContain("Mehmet");
    expect(multi).not.toContain("Beşiktaş");
    // a bare unquoted sensitive value still redacts; an error code after it survives
    expect(redactSensitive("address: Ataturk Cad No 5, P2002")).toContain("P2002");
  });

  it("strips PII/keys from an OpenAI-style error body but keeps the error type/code", () => {
    // Mirrors what ai/index.ts feeds reportError: the OpenAI API error RESPONSE
    // body (which may echo an offending value) plus the request's auth header.
    const openai = redactSensitive(
      '{"error":{"message":"Invalid value for input: guest@x.com","type":"invalid_request_error",' +
        '"code":"invalid_value"}} Authorization: Bearer sk-live-abc123def456ghi',
    );
    expect(openai).not.toContain("guest@x.com"); // echoed PII gone
    expect(openai).not.toContain("sk-live-abc123def456ghi"); // API key gone
    expect(openai).toContain("invalid_request_error"); // error type kept (debuggable)
    expect(openai).toContain("invalid_value"); // error code kept
  });

  // ── 08-05: JSON TIRNAKLI BİLEŞİK ANAHTAR DELİĞİ ──────────────────────────
  // Ölçülen kusur: `("?)(KEY)\1` yapısı tırnaklama ile kelime-içi eşleşmeyi
  // BİRBİRİNİ DIŞLAYAN hâle getiriyordu. `senderName=` (tırnaksız) redakte
  // oluyordu ama `{"senderName":...}` (JSON) OLMUYORDU — yani misafirin adı ve
  // QR sohbet token'ı ABD'de barındırılan Sentry'ye AÇIK gidiyordu.
  //
  // 07-30'daki canlı Sentry testi yeşil geçmişti çünkü yalnız KAPSANAN
  // biçimleri ekmişti (`sk-`, çıplak e-posta, telefon). Test gerçekti, kapsamı
  // dardı; çıkardığımız "tüm PII maskeli gider" sonucu ise genişti.
  // 🚨 AÇIK KALDI — bir düzeltme DENENDİ ve GERİ ALINDI (↓kaynaktaki uzun not).
  // Bu iki satır bilerek `todo`: kırmızı bırakmak paketi bozar, silmek açığı
  // görünmez yapardı. Çözülmesi gereken kısıtlar aşağıdaki KORUMA testlerinde.
  it("🚨 KAPANDI: JSON tırnaklı BİLEŞİK anahtar artık maskeleniyor", () => {
    // Ölçülmüş sızıntı: misafirin ADI ve QR sohbet TOKEN'ı ABD'de barındırılan
    // Sentry'ye AÇIK gidiyordu. Çözüm regex yaması DEĞİL — JSON gerçekten
    // ayrıştırılıp anahtar politikasıyla geziliyor.
    const out = redactSensitive('{"senderName":"Ayşe Yılmaz","chatToken":"qr_S3CRET_TOKEN"}');
    expect(out).not.toContain("Ayşe Yılmaz");
    expect(out).not.toContain("qr_S3CRET_TOKEN");
    // Tırnaksız biçim de çalışmaya DEVAM ediyor (eski yol kaybolmadı).
    expect(redactSensitive("senderName=Ayşe Yılmaz")).not.toContain("Ayşe Yılmaz");
  });

  it("🚨 KAPANDI: İÇ İÇE ve DİZİ içindeki hassas anahtarlar da maskeleniyor", () => {
    const nested = redactSensitive('{"meta":{"guest":{"guestName":"Ayşe Yılmaz"}}}');
    expect(nested).not.toContain("Ayşe Yılmaz");
    // 🚨 DİZİ VAKASINDA DEĞER-BİÇİMLİ REGEX'E YAKALANMAYAN BİR ŞEY KULLAN.
    // İlk yazımımda `email`/`phone` koymuştum ve dizi gezinmesini SİLEN mutasyon
    // YEŞİL geçti — çünkü e-posta/telefon zaten (C) grubu regex'lerine takılıyor,
    // yani test yapısal gezinmeyi hiç izole etmiyordu. Bir AD hiçbir değer-biçimli
    // kurala takılmaz: dizi dalını gerçekten sınayan tek girdi budur.
    const inArray = redactSensitive('[{"guestName":"Ayşe Yılmaz"},{"senderName":"Mehmet Demir"}]');
    expect(inArray).not.toContain("Ayşe Yılmaz");
    expect(inArray).not.toContain("Mehmet Demir");
    // Dizi İÇİNDE dizi — özyineleme tek seviyede durmamalı.
    expect(redactSensitive('{"rows":[[{"guestName":"Zeynep Kara"}]]}')).not.toContain("Zeynep Kara");
  });

  it("aşırı derin yapı ne fırlatır ne sızdırır", () => {
    // ⚠️ DÜRÜST KAYIT: `MAX_DEPTH` bu testi GEÇİREN şey DEĞİL — ölçüldü (08-09 (2)).
    // Tavanı tamamen kaldıran mutasyon bu testi YEŞİL bırakıyor, çünkü aday
    // parçası zaten 64KB ile sınırlı (`MAX_JSON_CANDIDATE`) ve o sınır derinliği
    // ~32.000'e çiviliyor; V8 o kadar çerçeveyi taşırmadan kaldırıyor (8k/16k/32k
    // üçünde de ölçüldü). Yani `MAX_DEPTH` BUGÜN ULAŞILAMAZ bir savunma katmanı:
    // ucuz sigorta olarak duruyor ve ancak `MAX_JSON_CANDIDATE` büyütülürse yük
    // taşımaya başlar. Test yine de değerli — "derin gövde raporlamayı öldürmez"
    // ve "derinden PII sızmaz" iddialarını tutuyor.
    const deep = '{"a":'.repeat(300) + '{"guestName":"Ayşe Yılmaz"}' + "}".repeat(300);
    let out = "";
    expect(() => { out = redactSensitive(deep); }).not.toThrow();
    expect(out).not.toContain("Ayşe Yılmaz");
  });

  // 🚨 SENKRON CPU YANMASI TEST ZAMAN AŞIMIYLA KESİLEMEZ — ÖLÇÜLDÜ (08-09 (2)).
  //
  // Önce `it(ad, { timeout: 3000 }, fn)` yazdım: bu vitest sürümü nesne biçimini
  // SESSİZCE yok sayıyor. Sonra konumsal `it(ad, fn, 3000)`e geçtim: O DA
  // TUTMADI. Sebep yapısal — zaman aşımı bir zamanlayıcıdır ve zamanlayıcının
  // ateşlenmesi için olay döngüsünün BOŞ olması gerekir; senkron bir döngü tam
  // da onu bloke ediyor. Mutasyonlu koşum **46.887 ms** sürdü ve YİNE DE YEŞİL
  // geçti. Yani iki farklı "pin" yazdım ve ikisi de hiçbir şey tutmuyordu.
  //
  // ⚠️ BU YÜZDEN BURADA SÜRE ÖLÇÜLÜYOR — ve bu, deponun "pinler SÜRE ÖLÇMEZ"
  // kuralına aykırı DEĞİL, o kuralın gerekçesine sadık. Kural bcrypt paritesi
  // için kondu: orada ayırt edilecek fark 362 ms'ti ve CI gürültüsü onu yutardı.
  // Buradaki fark 20 ms ↔ 47.000 ms, yani ~2000 KAT. 5 sn'lik tavan ancak makine
  // benimkinden 250 kat yavaşsa flake verir — o hâlde süitin tamamı zaten çöker.
  it("🚨 patolojik girdi CPU'yu YAKMAZ — tarama bütçesi yük taşıyor", () => {
    // ÖLÇÜLDÜ: bütçe kaldırılınca `"{".repeat(50_000)` 8850 ms, 100_000 ise
    // 30_510 ms; bütçeliyken 22 ms ve 18 ms. Node TEK İŞ PARÇACIKLI → o süre
    // boyunca TÜM instance bloke: ulaşılabilir bir DoS. Kaynak da ulaşılabilir —
    // `Message.body`nin uzunluk tavanı YOK ve shadow-ai / quality-audit onu
    // redaksiyondan geçiriyor.
    const t0 = Date.now();
    for (const evil of ["{".repeat(50_000), "[".repeat(50_000), "{".repeat(100_000)]) {
      expect(() => redactSensitive(evil)).not.toThrow();
    }
    expect(Date.now() - t0, "tarama bütçesi kalkmış olabilir").toBeLessThan(5000);
  });

  it("bütçe kancası KODDA duruyor (süre iddiasının yapısal kardeşi)", async () => {
    // Süre iddiası makineye bağlı; bu satır değil. İkisi birlikte, korumanın
    // hem VARLIĞINI hem ETKİSİNİ tutuyor.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/report-error-core.ts", "utf8")
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
      .join("\n");
    expect(src).toContain("SCAN_BUDGET");
    expect(src).toMatch(/--budget\.left\s*<=\s*0/);
  });

  // ── DENENEN DÜZELTMENİN KIRDIĞI ŞEYLER — KISIT LİSTESİ ───────────────────
  // Aşağıdakiler BUGÜN YEŞİL. Affix-pencereli deneme HEPSİNİ kırmıştı; bir
  // sonraki tasarım bunları koruyarak yukarıdaki iki `todo`yu kapatmalı.
  it("KISIT: yol önekli anahtarlar (`/api/...`) maskelenmeye DEVAM eder", () => {
    // Token-başı lookbehind `/`yi dışladığı için bu ÜÇÜ de sızmıştı — yani
    // sızıntı kapatan değişiklik yeni bir SIR sızıntısı açmıştı.
    expect(redactSensitive("POST /api/calendar/token=SECRETFEEDTOKEN123 500")).not.toContain(
      "SECRETFEEDTOKEN123",
    );
    expect(redactSensitive("POST /auth/password=hunter2 -> 400")).not.toContain("hunter2");
  });

  // 🚨 AÇIK — VE BU TESTİN İLK HÂLİ BOŞUNA GEÇİYORDU (denetim ajanı ölçtü).
  // `body` anahtarı `SENSITIVE_KEY` listesinde DEĞİL, dolayısıyla girdiye hiç
  // dokunulmuyordu: bir kimlik fonksiyonu bile testi geçerdi. Listede OLAN bir
  // anahtarla (`guestName`) ölçünce kusur GÖRÜNÜYOR:
  //   {"errors":{"guestName":["Ayse Yilmaz wifi Ev12345"]}}
  //   → {"errors":{"guestName": [REDACTED]"Ayse Yilmaz wifi Ev12345"]}}
  // Damga basılı, PII duruyor — hiç maskelememekten KÖTÜ, çünkü log'a bakan
  // "temizlenmiş" sanıyor. Hospitable 422 ve OpenAI çok-parçalı içerik tam bu
  // şekilde geliyor.
  //
  // ⚠️ ÖNEMLİ DÜZELTME: bu kusur benim geri aldığım tasarımın GETİRDİĞİ bir şey
  // DEĞİL — mevcut kodda ZATEN var. Geri alma onu kötüleştirmekten kaçındı,
  // düzeltmedi. Çözümü değer dalının `[...]`/`{...}` bloklarını TAM tüketmesi;
  // bu da tırnaklı-bileşik-anahtar açığıyla aynı tasarım turuna ait.
  it("🚨 KAPANDI: dizi/obje değerde YARIM DAMGA yok — alt ağaç TAMAMEN gider", () => {
    // Eski kusur: `"guestName": [REDACTED]"Ayse Yilmaz wifi Ev12345"]` — damga
    // basılı, PII duruyor. Hiç maskelememekten KÖTÜ, çünkü log'a bakan
    // "temizlenmiş" sanıyor. Hospitable 422 ve OpenAI çok-parçalı içerik tam
    // bu şekilde geliyor.
    const out = redactSensitive('{"errors":{"guestName":["Ayse Yilmaz wifi Ev12345"]}}');
    expect(out).not.toContain("Ayse Yilmaz");
    expect(out).not.toContain("Ev12345");
    // Damga TEK ve alt ağaç yok — "yarım" bir sonuç imkânsız.
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("["+"REDACTED]\"");

    const objValue = redactSensitive('{"password":{"old":"hunter2","new":"hunter3"}}');
    expect(objValue).not.toContain("hunter2");
    expect(objValue).not.toContain("hunter3");
  });

  it("KISIT: teşhis anahtarları KORUNUR (host/file/path/user/model/error+Name)", () => {
    // Gece 3'te arıza bakarken lazım olan tam olarak bunlar.
    expect(redactSensitive('{"hostname":"api.hospitable.com"}')).toContain("api.hospitable.com");
    expect(redactSensitive('{"filename":"/app/src/lib/outbox/worker.ts"}')).toContain("worker.ts");
    expect(redactSensitive('{"pathname":"/api/webhooks/paddle"}')).toContain("webhooks/paddle");
    expect(redactSensitive('{"meta":{"modelName":"User"}}')).toContain("User");
    expect(redactSensitive('{"errorName":"AbortError"}')).toContain("AbortError");
  });

  // ── TEŞHİS KORUMALARI — bu testler BUGÜN YEŞİL ve YEŞİL KALMALI ──────────
  // Aşırı-redaksiyon, sızıntıdan DAHA KÖTÜ bir sonuçtur: her uyarı
  // "[REDACTED]" olursa operasyon körelir ve araç gerçek arızada işe yaramaz.
  // Aşağıdaki her satır, anahtar listesine eklenmesi CAZİP ama YIKICI olan bir
  // ismi yasaklar.
  it("hata metninin kendisi KORUNUR (error/message/detail/note anahtar DEĞİL)", () => {
    // `reportError:50-51` detail'i `${err.name}: ${err.message}` ile kurar →
    // dize LİTERAL olarak "Error: …" ile başlar. `error`ı anahtar yapmak her
    // yığın izinin ilk satırını yok ederdi.
    expect(redactSensitive("Error: connect ECONNREFUSED 10.0.0.1:5432")).toContain("ECONNREFUSED");
    expect(redactSensitive("TypeError: x is not a function")).toContain("not a function");
    // Sağlayıcı arıza sebebi — teşhisteki en yararlı tek alan.
    expect(redactSensitive('{"error":{"message":"model not found"}}')).toContain("model not found");
    // `note` misafir metnini MODEL GİRDİSİ olarak da taşıyor (shadow-ai /
    // quality-audit); anahtar yapmak gölge pilotun kıyasını bozar.
    expect(redactSensitive("Note: we arrive late, room is cold")).toContain("we arrive late");
  });

  it("KISIT: teşhis alanları KORUNUR — ama eşleşme KELİME-İÇİ, dikkat", () => {
    // ⚠️ Bu testin adı önce "TAM-TOKEN eşleşme"ydi ve YANLIŞTI: `FIELD_RE`'de
    // hiçbir `\b` yok, eşleşme kelime-İÇİ. Üstelik `content`/`body` şu an
    // anahtar listesinde DEĞİL (EXACT_KEY geri alındı), yani üç iddia da
    // redaktörün hiç dokunmadığı dizeler üzerindeydi — kimlik fonksiyonu bile
    // geçerdi (denetim ajanı ölçtü).
    //
    // Aşağıdakiler LİSTEDEKİ bir kelimeyi (`name`) İÇEREN gerçek anahtarlar,
    // yani mekanizma gerçekten çalışıyor. Tırnaklı biçimde korunuyorlar çünkü
    // `("?)(KEY)\1` tırnağı anahtarın hemen önünde arıyor.
    expect(redactSensitive('{"hostname":"api.hospitable.com"}')).toContain("api.hospitable.com");
    expect(redactSensitive('{"filename":"worker.ts"}')).toContain("worker.ts");
    // ⚠️ ASİMETRİ, bilerek pinli: aynı anahtar TIRNAKSIZ hâlde REDAKTE OLUR
    // (kelime-içi eşleşme + `=`). Gelecekteki tasarım bu asimetriyi bilerek
    // ele almalı; bugünkü davranışı belgelemek onu görünür tutar.
    expect(redactSensitive("filename=worker.ts")).not.toContain("worker.ts");
  });

  it("YIĞIN İZİ satır numaraları KORUNUR (dosya adı duyarlı kelime içerse bile)", () => {
    // ⚠️ Bu, önerilen ilk düzeltmenin YAN ETKİSİYDİ ve ölçülerek yakalandı:
    // anahtar kelime-içinde eşleştiği için `/app/.../email-core.ts:101:7`
    // yolundaki satır numarası maskeleniyordu — tam da hata ayıklarken en çok
    // istenen güvenlik dosyalarında. Token-başı lookbehind bunu kapatır.
    expect(redactSensitive("at send (/app/src/lib/email-core.ts:101:7)")).toContain(":101:7");
    expect(redactSensitive("at hash (/app/src/lib/auth/password.ts:12:3)")).toContain(":12:3");
  });

  it("anahtar adı bir DEĞERİN içinde geçerse dokunulmaz — AMA `:` gelirse olmaz", () => {
    // Redakte edilen şey ANAHTARIN değeridir, metnin içindeki anahtar adı değil.
    expect(redactSensitive('{"detail":"the field guestName is required"}')).toContain("guestName");
    // ⚠️ Bu korumanın TEK dayanağı `[:=]` zorunluluğu — iki nokta gelirse metnin
    // ORTASINDAKİ anahtar adı da redaksiyonu tetikler. Denetim ajanı ölçtü;
    // "değer içindeki anahtar adına dokunulmaz" ifadesi bu kadar geniş DEĞİL.
    expect(redactSensitive('{"detail":"field guestName: required"}')).toContain("[REDACTED]");
  });

  // ── ReDoS DÜZELTMELERİNİN YAN ETKİLERİ ───────────────────────────────────
  // ⚠️ İKİSİ DE BENİM AÇTIĞIM REGRESYONDU (denetim ajanı ölçtü, ben doğruladım).
  // ReDoS'u kapatırken sızıntı açmak, kapatılan şeyden kötü olabilir.
  it("ReDoS sınırı FAIL-CLOSED: çok uzun JWT segmenti de maskelenir", () => {
    // İlk düzeltmem segment başına `{1,1024}` koyuyordu ve 1024'ten uzun
    // segmentli bir token HİÇ maskelenmiyordu — eskiden `[JWT]` oluyordu.
    // Yani ReDoS'u kapatırken bir SIR SIZINTISI açmıştım. Şimdiki biçim tek
    // karakter sınıfı: geri-izleme yok VE uzun segment de yakalanıyor.
    const longSegment = "eyJ" + "a".repeat(1100) + "." + "b".repeat(20) + "." + "c".repeat(20);
    expect(redactSensitive(longSegment)).toBe("[JWT]");
    // Gerçek JWT de maskelenmeye devam ediyor (parite).
    expect(
      redactSensitive("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.dBjftJeZ4CVP-mB92K"),
    ).toBe("[JWT]");
    // Çıplak "eyJ" kelimesi teşhis için korunur (eşik: 20+ karakter).
    expect(redactSensitive("eyJ kisa")).toBe("eyJ kisa");
  });

  it("ReDoS sınırı KISMİ SIZINTI üretmez: uzun local-part'lı adres TAM maskelenir", () => {
    // İlk düzeltmem local-part'ı RFC'nin 64'üne sınırlıyordu; 72 karakterlik
    // bir local-part'ta eşleşme dizenin ORTASINDAN başlayıp `kirlendi[EMAIL]`
    // üretiyordu — ilk 8 karakter açıkta. Bu metin `shadow-ai`/`quality-audit`'te
    // MODEL GİRDİSİ olduğu için sessiz bir davranış değişikliği de demekti.
    const long =
      "kirlendi.temizlik.gerekiyor.acilen.lutfen.bakin.hemen.tesekkurler.gunler@mail.com";
    expect(long.split("@")[0].length).toBeGreaterThan(64); // önkoşul pinli
    expect(redactSensitive(long)).toBe("[EMAIL]");
    // Normal adres davranışı değişmedi.
    expect(redactSensitive("a.b+c@x-y.co.uk")).toBe("[EMAIL]");
  });

  // ── ReDoS SINIRLARI ──────────────────────────────────────────────────────
  // Ulaşılabilir: `quality-audit.ts:65` ve `shadow-ai.ts:264` misafir metnini
  // uzunluk tavanından ÖNCE redakte ediyor. ⚠️ Önce buraya "QR sohbet gövde
  // kapısı 64KB" yazmıştım — YANLIŞ, `chat/[token]/route.ts:47,379` mesajı 2000
  // karakterde kesiyor. Gerçek kapsız yol `Message.body` (import/sync.ts'te
  // slice yok) ve `ai/index.ts:139`. Node tek iş parçacıklı → saniyelerce CPU,
  // TÜM instance'ı bloke eder.
  it("düşman girdide sınırlı sürede biter (ReDoS)", () => {
    const measure = (s: string) => {
      const t0 = process.hrtime.bigint();
      redactSensitive(s);
      return Number(process.hrtime.bigint() - t0) / 1e6;
    };
    // ⚠️ GİRDİ BOYUTU: e-posta girdisi 40KB, JWT girdisi 64KB (ilk yorumumda
    // "hepsi 64KB'a yakın" yazmıştım, e-posta için yanlıştı). İlk sürümde 20KB
    // kullanmıştım ve sınırı kaldıran mutasyon eşiğin ALTINDA kalıp testten
    // GEÇMİŞTİ — yani koruma pinsizdi. Büyüme karesel; pin gerçekçi tavanda.
    //
    // E-posta deseni — sınırsız hâlde ÖLÇÜLDÜ: 40KB → ~1900 ms, 80KB → ~7100 ms.
    expect(measure("x@" + "a.".repeat(20000))).toBeLessThan(500);
    // JWT deseni — ESKİ (alternasyonlu) hâlde ÖLÇÜLDÜ: 31KB → 224-291 ms,
    // 62KB → 888-912 ms (üç koşumun aralığı). Şimdiki tek-karakter-sınıfı
    // biçiminde geri-izleme YOK: 64KB → ~2 ms, yani marj ~250×.
    expect(measure("eyJa-".repeat(12800))).toBeLessThan(500);
    // Gerçekçi girdide de hızlı kalmalı (regresyon değil, sağlık kontrolü).
    expect(measure("at drain (/app/src/lib/outbox/worker.ts:97:11)\n".repeat(180))).toBeLessThan(500);
  });
});
