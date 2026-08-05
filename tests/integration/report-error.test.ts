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
  it("JSON tırnaklı BİLEŞİK anahtarların değeri de maskelenir", () => {
    const cases: [string, string][] = [
      ['{"senderName":"Ayse Yilmaz"}', "Ayse Yilmaz"],
      ['{"chatToken":"abc123secretvalue"}', "abc123secretvalue"],
      ['{"guestName":"Mehmet Demir"}', "Mehmet Demir"],
      ['{"accessToken":"tok_live_xyz789"}', "tok_live_xyz789"],
      ['{"a":{"b":{"senderName":"Ayse"}}}', "Ayse"], // iç içe
      ['{"guestPhone":"05321234567"}', "05321234567"],
    ];
    for (const [input, secret] of cases) {
      expect(redactSensitive(input), `sızdı: ${input}`).not.toContain(secret);
    }
    // Tırnaksız biçimle PARİTE (eskiden yalnız bu çalışıyordu).
    expect(redactSensitive("senderName=Ayse Yilmaz")).not.toContain("Ayse Yilmaz");
  });

  it("SERBEST METİN alanları (content/body) maskelenir — misafir metni taşırlar", () => {
    // `content` = OpenAI mesaj alanı, `body` = MessageOutbox gövdesi; ikisi de
    // misafir metni taşır ve SCRUB KAPSAMI KURALI gereği korunmalı.
    expect(redactSensitive('{"content":"wifi sifresi Ev12345"}')).not.toContain("wifi sifresi");
    expect(redactSensitive('{"body":"dairede hirsizlik oldu"}')).not.toContain("hirsizlik");
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

  it("TAM-TOKEN eşleşme: Content-Type ve bodySnippet KORUNUR", () => {
    // `content`/`body` yalnız TAM token olarak eşleşir; önek/sonek taşıyan
    // teşhis alanları etkilenmez.
    expect(redactSensitive("HTTP 400 Content-Type: application/json")).toContain("application/json");
    expect(redactSensitive("bodySnippet: HTTP 402 subscription inactive")).toContain(
      "subscription inactive",
    );
    expect(redactSensitive("hasContent: true")).toContain("true");
  });

  it("YIĞIN İZİ satır numaraları KORUNUR (dosya adı duyarlı kelime içerse bile)", () => {
    // ⚠️ Bu, önerilen ilk düzeltmenin YAN ETKİSİYDİ ve ölçülerek yakalandı:
    // anahtar kelime-içinde eşleştiği için `/app/.../email-core.ts:101:7`
    // yolundaki satır numarası maskeleniyordu — tam da hata ayıklarken en çok
    // istenen güvenlik dosyalarında. Token-başı lookbehind bunu kapatır.
    expect(redactSensitive("at send (/app/src/lib/email-core.ts:101:7)")).toContain(":101:7");
    expect(redactSensitive("at hash (/app/src/lib/auth/password.ts:12:3)")).toContain(":12:3");
  });

  it("anahtar adı bir DEĞERİN içinde geçerse dokunulmaz", () => {
    // Redakte edilen şey ANAHTARIN değeridir, metnin içindeki anahtar adı değil.
    expect(redactSensitive('{"detail":"the field guestName is required"}')).toContain("guestName");
  });

  // ── ReDoS SINIRLARI ──────────────────────────────────────────────────────
  // Ulaşılabilir: `quality-audit.ts:65` ve `shadow-ai.ts:264` misafir metnini
  // uzunluk tavanından ÖNCE redakte ediyor; QR sohbet gövde kapısı 64KB. Node
  // tek iş parçacıklı → saniyelerce CPU, TÜM instance'ı bloke eder.
  it("düşman girdide sınırlı sürede biter (ReDoS)", () => {
    const measure = (s: string) => {
      const t0 = process.hrtime.bigint();
      redactSensitive(s);
      return Number(process.hrtime.bigint() - t0) / 1e6;
    };
    // E-posta deseni — sınırsız hâlde ÖLÇÜLDÜ: 40KB → 1906 ms, 80KB → 7118 ms.
    expect(measure("x@" + "a.".repeat(20000))).toBeLessThan(500);
    // Alan deseni — sınırsız hâlde ÖLÇÜLDÜ: 20KB → 221 ms, 80KB → 3495 ms.
    // ⚠️ GİRDİ BOYUTU KASTEN 60KB: ilk sürümde 20KB kullanmıştım ve sınırları
    // kaldıran mutasyon 221 ms ile eşiğin ALTINDA kalıp testten GEÇMİŞTİ —
    // yani koruma pinsizdi. Büyüme karesel; 60KB gerçekçi tavana yakın
    // (`readJsonCappedOrNull` gövde kapısı 64KB).
    expect(measure("namea".repeat(12000))).toBeLessThan(500);
    // Gerçekçi girdide de hızlı kalmalı (regresyon değil, sağlık kontrolü).
    expect(measure("at drain (/app/src/lib/outbox/worker.ts:97:11)\n".repeat(180))).toBeLessThan(500);
  });
});
