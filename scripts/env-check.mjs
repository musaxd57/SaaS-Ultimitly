// SINGLE SOURCE OF TRUTH for the production boot env gate.
// Pure: no side effects, never prints a secret VALUE — only field names. Returns
// { errors, warnings }: a non-empty `errors` list means production must NOT start.
// Used by the prestart gate (scripts/verify-env.mjs). Plain ESM so it runs in a
// standalone node process BEFORE `next start`, without the Next/TS runtime.

// The dev default shipped in .env.example — running production with it means every
// session signature (AUTH_SECRET) / stored secret (ENCRYPTION_KEY) is forgeable or
// derivable by anyone who has read the repo.
export const DEV_PLACEHOLDER_SECRET = "dev-secret-change-me-please-32-bytes-min";

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function checkProductionEnv(env) {
  const errors = [];
  const warnings = [];

  // ── TRUSTED_PROXY_HOPS (P1 #7, 08-09 (2)) — UYARI, HATA DEGIL ─────────────
  //
  // Bu deger bir GUVEN SINIRI beyanidir ve yanlis yonde hata etmenin bedeli
  // ASIMETRIKTIR: AZ tahmin guvenli (herkes tek kovaya duser, kimlik secilemez),
  // FAZLA tahmin TEHLIKELI (saldirgan zinciri beklenen uzunluga getirip secilen
  // adimi KENDI yazar).
  //
  // 🚨 BILEREK `errors` DEGIL `warnings`: bu kapi boot'u DURDURMAZ. Deger
  // Railway'de bugun SET (=2) ama bir env kazasinda uretimin ayakta kalmasi,
  // hiz limitinin bir sure global calismasindan daha onemli. "Mevcut prod'u
  // dogrulamadan boot'ta durduracak degisiklik pushlanmaz" (kullanici direktifi).
  //
  // Olcum araci ayri ve mevcut: /admin "Operasyon Teshisi" karti gercek
  // x-forwarded-for zincirini ve her hop degerinin SECECEGI adresi onizler.
  const hopsRaw = (env.TRUSTED_PROXY_HOPS ?? "").trim();
  if (!hopsRaw) {
    warnings.push(
      "TRUSTED_PROXY_HOPS set edilmemis — hiz limitleri KISI BASINA degil GLOBAL " +
        "calisabilir (bir saldirgan tek kovayi doldurup tum musterileri 429'a dusurebilir). " +
        "Dogru degeri /admin > Operasyon Teshisi kartindan OKUYUN, tahmin etmeyin.",
    );
  } else if (!/^\d{1,2}$/.test(hopsRaw) || Number(hopsRaw) < 1 || Number(hopsRaw) > 10) {
    warnings.push(
      `TRUSTED_PROXY_HOPS gecersiz ("${hopsRaw}") — guvenli varsayilana (1) dusuluyor. ` +
        "Yalniz 1-10 arasi duz tam sayi kabul edilir.",
    );
  }

  const authSecret = (env.AUTH_SECRET ?? "").trim();
  if (!authSecret) {
    errors.push("AUTH_SECRET is missing.");
  } else if (authSecret === DEV_PLACEHOLDER_SECRET) {
    errors.push("AUTH_SECRET is still the dev placeholder from .env.example — set a real random secret.");
  } else if (authSecret.length < 32) {
    warnings.push("AUTH_SECRET is shorter than 32 characters — prefer a longer random secret.");
  }

  const encKey = (env.ENCRYPTION_KEY ?? "").trim();
  if (!encKey) {
    // REQUIRED in production, independent of AUTH_SECRET: crypto.ts falls back to
    // AUTH_SECRET when this is unset, so rotating AUTH_SECRET (as happened once)
    // would make every stored 2FA / Hospitable secret undecryptable.
    errors.push("ENCRYPTION_KEY is missing — REQUIRED in production (do not rely on the AUTH_SECRET fallback).");
  } else if (encKey === DEV_PLACEHOLDER_SECRET) {
    errors.push("ENCRYPTION_KEY is the dev placeholder — set a real random key.");
  } else if (encKey === authSecret) {
    errors.push("ENCRYPTION_KEY must be independent of AUTH_SECRET (they are currently equal).");
  } else if (encKey.length < 32) {
    warnings.push("ENCRYPTION_KEY is shorter than 32 characters — prefer a longer random key.");
  }

  // 🚨 BOSLUK TUZAGI — GERI DONUSU YOK (denetim 08-08, kod-dogrulandi).
  // `crypto-core.ts key()` env'i HAM okur (`process.env.ENCRYPTION_KEY`), bu kapi
  // ise `.trim()`liyi dogrular. Deger " abc..." gibiyse: boot GECER ama turetilen
  // anahtar BASKADIR. Sonra biri Railway'de o bosluğu kozmetik olarak temizlerse
  // anahtar degisir ve HER Hospitable PAT'i, HER refresh token'i, HER 2FA sirri ve
  // takvim feed URL'leri KALICI olarak cozulemez hale gelir (rotasyon = ASLA).
  // Depo bu siniftan bir olayi ZATEN yasadi (`hospitable-token-undecryptable`,
  // kok neden hicbir zaman belirlenemedi).
  // ⚠️ BEDELI KUCUMSENMEZ (denetim duzeltmesi): "yalnizca yeni deploy yayinlanmaz,
  // site dusmez" demek YANLIS olurdu. `prestart` HER konteyner acilisinda kosar
  // (Dockerfile CMD → npm run start → prestart), yani deger bugun bosluk tasiyorsa
  // CALISAN servis de bir daha BASLAYAMAZ: platform tasimasi, OOM yeniden baslatma
  // ya da elle restart kalici kesintiye doner. Kapi bu yuzden KACIS KAPILI (asagi).
  // ⚠️ `key()`e `.trim()` EKLEMEK COZUM DEGIL: uretimdeki deger bugun boslukluysa
  // trim eklemek anahtari DEGISTIRIR ve tam da onlemek istedigimiz kaybi yaratir.
  //
  // 🚪 KACIS KAPISI ZORUNLU — VE BU KAPININ VARLIK SEBEBI SU: bu kapinin talep
  // ettigi duzeltme (boslugu sil) ZATEN YAZMIS bir kurulumda YASAKTIR. Kacis
  // kapisi olmasaydi boyle bir kurulumun TEK cikisi kontrolu SILMEK olurdu ve
  // silen kisi hicbir sey ogrenmeden bilgiyi de yok ederdi. Bayrak set etmek ise
  // "evet, anahtarimizda bosluk VAR ve ASLA temizlenmeyecek" beyanini env'de
  // kalici olarak birakir. Depo emsali: ALLOW_PROD_SEED, BILLING_ALLOW_CANCELED_PLAN_CHANGE.
  const encKeyRaw = env.ENCRYPTION_KEY ?? "";
  const whitespaceAcknowledged = (env.ALLOW_ENCRYPTION_KEY_WHITESPACE ?? "").trim() === "1";
  if (encKeyRaw && encKeyRaw !== encKeyRaw.trim() && !whitespaceAcknowledged) {
    errors.push(
      "ENCRYPTION_KEY has leading/trailing whitespace. The key is derived from the RAW value, " +
        "so trimming it later would permanently break every stored token and 2FA secret. " +
        "If NOTHING has been encrypted yet, re-set the key without whitespace. " +
        "If this deployment is already live, do NOT trim it — set ALLOW_ENCRYPTION_KEY_WHITESPACE=1 to record that the whitespace is intentional and permanent.",
    );
  }

  // 🚨 SESSIZ KAPANMA — "24 ay" yazimi retention'i DA yeniden-icea-aktarma
  // korumasini DA kapatir (denetim 08-08, olculdu). `Number("24 ay")` = NaN →
  // `retentionCutoff()` null doner ve `anonymizeOldGuestData` no-op olur; ikisi de
  // AYNI ifadeye bagli (`data-retention.ts:65,76`). Saglik ucu 200 kalir, hicbir
  // alarm cikmaz, KVKK vaadi sessizce tutulmaz olur.
  // ⚠️ AYARLANMAMIS olmasi MESRU (retention varsayilan KAPALI).
  // 🚨 KAPI CALISMA-ZAMANINDAN DAHA SIKI OLAMAZ — ILK YAZIMIM OYLEYDI (denetim,
  // olculdu). Calisma zamani `!Number.isFinite(months) || months <= 0`
  // (`data-retention.ts:66,77`). Yani "0" ve "-1" calisma zamaninda "KAPALI"
  // demektir ve "0" operatorun kapatmak icin yazacagi en olasi degerdir; "24.5"
  // ise calisiyor. Eski kapim ucunu de BOOT'U BLOKLUYORDU — bu dosyanin kendi
  // kuralinin ihlali: "calisma zamaninin kabul ettigi bir degeri reddederse
  // CALISAN bir kurulum bloklanir".
  // Hedeflenen ariza SADECE sudur: operator bir SURE yazmak istedi ama deger
  // sayiya cevrilemiyor ("24 ay", "yirmidort", "Infinity") → `Number()` NaN/sonsuz
  // → `retentionCutoff()` null → HEM anonimlestirme HEM sync'in yeniden-ice-aktarma
  // korumasi SESSIZCE kapanir (ikisi de ayni ifadeye bagli). Kapali-olmak-isteyen
  // degerler ("0", "-1") bilincli olarak SERBEST birakildi.
  const retentionRaw = (env.DATA_RETENTION_MONTHS ?? "").trim();
  if (retentionRaw && !Number.isFinite(Number(retentionRaw))) {
    errors.push(
      `DATA_RETENTION_MONTHS is set but is not a number ("${retentionRaw}"). ` +
        "It would silently disable BOTH guest-data retention AND the sync's re-import guard. " +
        "Use a positive number of months, or leave it empty/0 to disable retention deliberately.",
    );
  }

  // QR PIN pepper (Faz 5, #14). ONLY enforced when the feature is switched on
  // (QR_PIN_ENABLED=1) — with it off the whole PIN system is dormant and no
  // pepper is needed, so an env-off deployment is never blocked. When on, the
  // PIN HMAC must NOT fall back to AUTH_SECRET (guest-chat-pin.ts uses that
  // fallback for dev/test only): a dedicated, independent, ≥32-char pepper is
  // required so rotating AUTH_SECRET can't silently invalidate live PINs and the
  // session secret is never doubled as the PIN key.
  if ((env.QR_PIN_ENABLED ?? "").trim() === "1") {
    const pepper = (env.QR_PIN_PEPPER ?? "").trim();
    if (!pepper) {
      errors.push("QR_PIN_PEPPER is missing — REQUIRED when QR_PIN_ENABLED=1 (do not rely on the AUTH_SECRET fallback).");
    } else if (pepper === DEV_PLACEHOLDER_SECRET) {
      errors.push("QR_PIN_PEPPER is the dev placeholder — set a real random pepper.");
    } else if (pepper === authSecret) {
      errors.push("QR_PIN_PEPPER must be independent of AUTH_SECRET (they are currently equal).");
    } else if (pepper.length < 32) {
      errors.push("QR_PIN_PEPPER must be at least 32 characters.");
    }
  }

  // KVKK guest-erasure tombstone HMAC secret (m40). ONLY enforced when the
  // host-facing surface is switched on (GUEST_ERASURE_ENABLED=1) — with it off no
  // tombstone can be created, the ingress guards are inert on an empty table, and
  // an env-off deployment is never blocked. When on, a DEDICATED secret is
  // required (never the session/crypto secrets doubled up): tombstone matching
  // must survive an AUTH_SECRET/ENCRYPTION_KEY rotation, and a leak of one secret
  // must not let anyone recompute guest-identifier hashes. NEVER rotate it once
  // tombstones exist — matching would silently break (erasure guard goes blind).
  if ((env.GUEST_ERASURE_ENABLED ?? "").trim() === "1") {
    const erasureSecret = (env.ERASURE_HMAC_SECRET ?? "").trim();
    if (!erasureSecret) {
      errors.push("ERASURE_HMAC_SECRET is missing — REQUIRED when GUEST_ERASURE_ENABLED=1 (no fallback in production).");
    } else if (erasureSecret === DEV_PLACEHOLDER_SECRET) {
      errors.push("ERASURE_HMAC_SECRET is the dev placeholder — set a real random secret.");
    } else if (erasureSecret === authSecret) {
      errors.push("ERASURE_HMAC_SECRET must be independent of AUTH_SECRET (they are currently equal).");
    } else if (erasureSecret === encKey) {
      errors.push("ERASURE_HMAC_SECRET must be independent of ENCRYPTION_KEY (they are currently equal).");
    } else if (erasureSecret.length < 32) {
      errors.push("ERASURE_HMAC_SECRET must be at least 32 characters.");
    }
  }

  // Private object storage (S3/R2) — ONLY enforced when the feature is switched
  // on (STORAGE_ENABLED=1/true). With it off the storage system is dormant and
  // none of these are needed, so an env-off deployment is never blocked. When
  // on, every provider credential must be present and the endpoint must be
  // HTTPS (a plaintext endpoint would leak signed URLs and objects). Only field
  // NAMES are ever printed — never a value.
  const storageOn = ["1", "true"].includes((env.STORAGE_ENABLED ?? "").trim().toLowerCase());
  if (storageOn) {
    const endpoint = (env.STORAGE_ENDPOINT ?? "").trim();
    if (!endpoint) {
      errors.push("STORAGE_ENDPOINT is missing — REQUIRED when STORAGE_ENABLED is on.");
    } else if (!/^https:\/\//i.test(endpoint)) {
      errors.push("STORAGE_ENDPOINT must be an https:// URL.");
    }
    // Bucket name is validated to the SAME rule the runtime applies
    // (src/lib/storage/config.ts). Without this the flag can be on while
    // getStorageConfig() quietly returns null — "I switched storage on and
    // nothing happened", with no error anywhere. An uppercase letter is the
    // easy way to hit it: providers hand out names that look fine to a human
    // but are not S3-legal, and uploads keep silently going to local disk.
    const storageBucket = (env.STORAGE_BUCKET ?? "").trim();
    const storagePathStyle = ["1", "true"].includes((env.STORAGE_PATH_STYLE ?? "").trim().toLowerCase());
    if (!storageBucket) {
      errors.push("STORAGE_BUCKET is missing — REQUIRED when STORAGE_ENABLED is on.");
    } else if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(storageBucket)) {
      errors.push(
        "STORAGE_BUCKET is not a valid S3 bucket name (lowercase letters, digits, dots and hyphens; 3-63 chars; must start and end alphanumeric). Copy it exactly as the provider shows it — some append a unique suffix.",
      );
    } else if (!storagePathStyle && storageBucket.includes(".")) {
      // Virtual-hosted puts the bucket in the hostname, where a dot adds a
      // label the provider's wildcard certificate does not cover — TLS fails
      // before the request is even sent.
      errors.push(
        "STORAGE_BUCKET contains a dot, which cannot be addressed virtual-hosted (the provider's wildcard certificate would not match). Use a bucket without dots, or set STORAGE_PATH_STYLE=1 if the provider still supports path-style.",
      );
    }
    if (!(env.STORAGE_ACCESS_KEY_ID ?? "").trim()) {
      errors.push("STORAGE_ACCESS_KEY_ID is missing — REQUIRED when STORAGE_ENABLED is on.");
    }
    const storageSecret = (env.STORAGE_SECRET_ACCESS_KEY ?? "").trim();
    if (!storageSecret) {
      errors.push("STORAGE_SECRET_ACCESS_KEY is missing — REQUIRED when STORAGE_ENABLED is on.");
    } else if (storageSecret === DEV_PLACEHOLDER_SECRET) {
      errors.push("STORAGE_SECRET_ACCESS_KEY is the dev placeholder — set the real provider secret.");
    }
  }

  // Transactional email provider. The app sends account-critical mail — email
  // verification, password-reset codes, operator alerts — so production MUST have a
  // working provider; without one those flows fail OPEN (silently "succeed" while no
  // mail is sent, or the DEV console fallback would echo a verification link). Accept
  // Resend (HTTP API — works where Railway blocks SMTP ports) OR a COMPLETE SMTP set
  // (host + user + pass). A PARTIAL SMTP config is an error (it would fail every send
  // at runtime). Only field NAMES are printed. Enforced in production only (dev/test
  // never blocked — verify-env just warns).
  const hasResend = Boolean((env.RESEND_API_KEY ?? "").trim());
  const smtpHost = (env.EMAIL_HOST ?? "").trim();
  const smtpUser = (env.EMAIL_USER ?? "").trim();
  const smtpPass = (env.EMAIL_PASS ?? "").trim();
  if (!hasResend) {
    if (!smtpHost && !smtpUser && !smtpPass) {
      errors.push(
        "No email provider configured — set RESEND_API_KEY, or a complete SMTP set (EMAIL_HOST + EMAIL_USER + EMAIL_PASS). Verification/password-reset/alert mail fails open without one.",
      );
    } else if (!(smtpHost && smtpUser && smtpPass)) {
      errors.push(
        "SMTP is only PARTIALLY configured — EMAIL_HOST, EMAIL_USER and EMAIL_PASS are ALL required (or set RESEND_API_KEY instead).",
      );
    }
  }

  // HTTPS-pin (P2, Codex). Any env-overridable EXTERNAL service URL that carries a
  // secret in transit — an API key / bearer token / OAuth client_secret — MUST be
  // https:// in production; an http override would send the credential in
  // plaintext. Each is an OPTIONAL override (unset → the code's built-in https
  // default is used → no error); enforced only when SET. A localhost-http endpoint
  // is a dev/test convenience allowed ONLY by the runtime guard (secure-url.ts),
  // never here. DATABASE_URL and Railway-internal service addresses are
  // deliberately NOT included — they are not credential-bearing external HTTP
  // endpoints. Only field NAMES are printed. Mirror of secure-url.ts (same rule,
  // enforced before the TS runtime so a bad override never reaches `next start`).
  const SECRET_BEARING_URL_VARS = [
    "HOSPITABLE_API_BASE_URL", // per-tenant Bearer token → Hospitable API
    "SUPPLY_AI_BASE_URL", // Bearer AI key → OpenAI-compatible endpoint
    "SHADOW_AI_BASE_URL", // Bearer AI key → shadow classifier endpoint (OpenAI-compatible)
    "HOSPITABLE_OAUTH_AUTHORIZE_URL", // OAuth handshake (auth code rides this scheme)
    "HOSPITABLE_OAUTH_TOKEN_URL", // client_secret is POSTed to this URL
  ];
  for (const name of SECRET_BEARING_URL_VARS) {
    const val = (env[name] ?? "").trim();
    if (val && !/^https:\/\//i.test(val)) {
      errors.push(
        `${name} must be an https:// URL in production — it carries a secret in transit; an http endpoint would leak it.`,
      );
    }
  }

  // DEPLOYMENT IDENTITY. APP_URL is the trusted base for OUTBOUND links (e-mail
  // verification links carry the RAW token), and every other domain-derived value
  // — the OAuth callback, canonical/OpenGraph URLs, robots, sitemap — is now
  // derived from it in one place (appCanonicalOrigin in src/lib/app-config.ts).
  //
  // MIRRORS DEPLOYABLE_ORIGINS there — a CLOSED list. Not "any https": a wrong or
  // hostile origin would receive the tokens we mail. Unset → the shipped .com
  // origin → no error. Trailing slash/path tolerated (compared as origins). The
  // PROVIDED value is never printed; only the accepted list (public) is shown.
  const DEPLOYABLE_ORIGINS = ["https://www.lixusai.com", "https://www.lixusai.eu"];
  const toOrigin = (raw) => {
    try {
      const u = new URL(raw);
      if (u.protocol !== "https:" && u.protocol !== "http:") return null;
      return `${u.protocol}//${u.host}`.toLowerCase();
    } catch {
      return null;
    }
  };
  const appUrl = (env.APP_URL ?? "").trim();
  const appUrlOrigin = appUrl ? toOrigin(appUrl) : null;
  const appUrlOk = !appUrl || (appUrlOrigin !== null && DEPLOYABLE_ORIGINS.includes(appUrlOrigin));
  if (!appUrlOk) {
    errors.push(
      `APP_URL must be one of ${DEPLOYABLE_ORIGINS.join(", ")} in production — e-mail verification links are built from it, so the origin must be one we own. Adding an origin is a code change (DEPLOYABLE_ORIGINS).`,
    );
  }
  // Everything below compares against the origin this deployment actually resolves
  // to, so a .eu instance is checked against .eu — not against a hardcoded .com.
  const canonicalOrigin = appUrlOk && appUrlOrigin ? appUrlOrigin : DEPLOYABLE_ORIGINS[0];

  // HOSPITABLE_OAUTH_REDIRECT_URI receives the returned OAuth authorization CODE,
  // so in production it must be EXACTLY this deployment's callback — not merely
  // https, and NOT the other deployment's (handing a .eu customer's code to .com
  // is precisely the cross-domain mistake this catches). Unset → derived default.
  // The PROVIDED value is never printed (it can carry flow parameters).
  const expectedOAuthRedirect = `${canonicalOrigin}/api/hospitable/oauth/callback`;
  const oauthRedirectUri = (env.HOSPITABLE_OAUTH_REDIRECT_URI ?? "").trim();
  if (oauthRedirectUri && oauthRedirectUri !== expectedOAuthRedirect) {
    errors.push(
      `HOSPITABLE_OAUTH_REDIRECT_URI must be exactly ${expectedOAuthRedirect} in production — it receives the OAuth authorization code.`,
    );
  }

  // APP_BASE_URL was a SECOND, ungated source of truth: only the trial-reminder
  // e-mail read it, with its own hardcoded .com fallback, so a .eu deployment
  // would have mailed customers a button to a site where they have no account.
  // The code no longer reads it. A leftover value that disagrees with the
  // canonical origin is a misconfiguration, and it fails LOUDLY here rather than
  // sitting in the environment looking meaningful.
  const appBaseUrl = (env.APP_BASE_URL ?? "").trim();
  if (appBaseUrl && toOrigin(appBaseUrl) !== canonicalOrigin) {
    errors.push(
      `APP_BASE_URL must match the deployment origin (${canonicalOrigin}) or be removed — it is no longer read, and a divergent value means the environment disagrees with itself.`,
    );
  }

  // Automation heartbeat. The 2-min sync + auto-reply + welcome/check-in/checkout
  // engine runs ONLY when CRON_SECRET is set: the internal cron returns early
  // without it and the external /api/cron/sync 401s. Missing it means automation
  // silently stops while /api/health stays 200 — a silent outage. WARN (not error)
  // so a deployment that drives sync by some other means is never blocked, but the
  // most common misconfiguration is surfaced at boot instead of discovered later.
  if (!(env.CRON_SECRET ?? "").trim()) {
    warnings.push(
      "CRON_SECRET is missing — the sync/auto-reply engine will not run (internal cron idle, external cron 401s).",
    );
  }

  // DEPLOYMENT LOCALE / BILLING CURRENCY. Both are OPTIONAL — unset means the
  // shipped .com defaults (tr-TR / TRY) and nothing changes. But a value that IS
  // set and invalid must stop the boot rather than silently fall back: a .eu
  // instance meant to bill in EUR that quietly reverts to TRY would quote and
  // charge the wrong currency. Values are safe to print (not secrets).
  // MIRRORS isValidLocale in src/lib/app-config.ts. `new Intl.NumberFormat(tag)`
  // is NOT the test — it only throws on a malformed tag, so well-formed but
  // data-less tags ("zz-ZZ", "qq", "xx-XX") construct fine and then silently fall
  // back to the default locale. supportedLocalesOf asks whether this runtime
  // actually has data for the tag, and does not over-reject real ones.
  const locale = (env.APP_LOCALE ?? "").trim();
  if (locale) {
    let localeOk = false;
    try {
      localeOk = Intl.NumberFormat.supportedLocalesOf([locale]).length > 0;
    } catch {
      localeOk = false;
    }
    if (!localeOk) {
      errors.push(`APP_LOCALE is not a locale this runtime has data for: ${locale}`);
    }
  }

  // Default IANA timezone for NEW organizations on this deployment. Optional —
  // unset means Europe/Istanbul, the shipped .com answer and the existing column
  // default, so nothing changes. When SET it must be a zone Intl accepts: a
  // deployment that meant Europe/Berlin but typo'd would silently create every
  // new org on the Istanbul calendar, and the damage (wrong day boundaries,
  // messages sent at the wrong local hour) is invisible until a host notices.
  // NOT derived from APP_LOCALE or APP_BILLING_CURRENCY — those say nothing about
  // where a host operates. Values are safe to print (not secrets).
  const defaultTimezone = (env.APP_DEFAULT_TIMEZONE ?? "").trim();
  if (defaultTimezone) {
    let tzOk = false;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: defaultTimezone });
      tzOk = true;
    } catch {
      tzOk = false;
    }
    if (!tzOk) {
      errors.push(`APP_DEFAULT_TIMEZONE is not an IANA time zone Intl accepts: ${defaultTimezone}`);
    }
  }

  // MIRRORS SUPPORTED_BILLING_CURRENCIES in src/lib/app-config.ts — a CLOSED list,
  // not a format check. "Does Intl format it?" was the old test and it was wrong:
  // Intl renders "EUU 1.00" and "ZZZ 1.00" happily, so one mistyped letter used to
  // reach production. Even the full ISO 4217 list would be too loose (XXX is a real
  // code meaning "no currency"). Supporting a currency requires three plan prices
  // AND three Paddle price ids denominated in it, so the list is deliberately a
  // code change. Applies to the SUBSCRIPTION currency only — a guest's booking in
  // USD is a record currency and is never restricted.
  const SUPPORTED_BILLING_CURRENCIES = ["TRY", "EUR"];
  const billingCurrency = (env.APP_BILLING_CURRENCY ?? "").trim();
  const billingCurrencyCode = billingCurrency.toUpperCase();
  let billingCurrencyValid = false;
  if (billingCurrency) {
    billingCurrencyValid = SUPPORTED_BILLING_CURRENCIES.includes(billingCurrencyCode);
    if (!billingCurrencyValid) {
      errors.push(
        `APP_BILLING_CURRENCY must be one of ${SUPPORTED_BILLING_CURRENCIES.join(", ")} (got: ${billingCurrency}). Adding a currency requires plan prices and Paddle price ids in it — it is a code change, not an env value.`,
      );
    }
  }

  // Duplicated from PLAN_PRICE_ENV_KEYS in src/lib/app-config.ts on purpose: this
  // file is plain ESM that runs BEFORE the TS runtime, so it cannot import that
  // module. Keep the two lists in step — the runtime resolver and this gate must
  // agree on what "configured" means, or the gate would pass a deployment the
  // runtime then refuses (or worse, the reverse).
  const PLAN_PRICE_KEYS = ["PLAN_PRICE_BASLANGIC_MINOR", "PLAN_PRICE_PRO_MINOR", "PLAN_PRICE_ISLETME_MINOR"];
  const PADDLE_PRICE_ID_KEYS = ["PADDLE_PRICE_BASLANGIC", "PADDLE_PRICE_PRO", "PADDLE_PRICE_ISLETME"];

  // EXACT MIRROR of explicitPlanPriceMinor in src/lib/app-config.ts. Returns the
  // parsed minor-unit amount, or null when this is not a usable price. The two
  // implementations must agree on every input — if the gate accepted something the
  // runtime refuses, the deployment would boot and then silently fall back to the
  // shipped defaults; if it refused something the runtime accepts, a working
  // deployment would be blocked. A parity test drives the same table through both.
  const parsePlanPrice = (raw) => {
    const v = (raw ?? "").trim();
    if (!v) return null;
    if (!/^\d+$/.test(v)) return null; // no signs, no decimals, no floats
    const n = Number.parseInt(v, 10);
    if (!Number.isSafeInteger(n)) return null; // beyond this the value is not what was written
    return n > 0 ? n : null; // every plan is PAID — 0 is a typo, not a price
  };

  // Plan prices are MINOR-UNIT INTEGERS (kuruş/cent). A float, a signed value, a
  // zero or a beyond-safe-integer amount would all mean charging something other
  // than what was written, so reject rather than fall back.
  for (const key of PLAN_PRICE_KEYS) {
    const raw = (env[key] ?? "").trim();
    if (raw && parsePlanPrice(raw) === null) {
      errors.push(
        `${key} must be a whole number of minor units (kuruş/cent) greater than 0 and within Number.isSafeInteger — no decimals, signs or zero (got: ${raw}).`,
      );
    }
  }

  // A billing currency OTHER than the shipped one (TRY) is only a valid production
  // config when this deployment ALSO supplies, completely:
  //
  //   • all three DISPLAY prices — otherwise the shipped lira numbers would be
  //     printed with a foreign symbol, which is a false price, not a formatting
  //     choice. A PARTIAL set is not "mid-setup, mostly fine": the plans left
  //     unset are exactly the ones that would lie, and the config LOOKS done.
  //
  //   • all three PADDLE price ids — these decide what is actually CHARGED. Prices
  //     shown from PLAN_PRICE_* and money taken via a Paddle price id are two
  //     independent settings, so a deployment can advertise €39 while charging
  //     against a lira price object. Requiring the ids to be re-supplied here
  //     forces that decision to be made deliberately for this deployment.
  //
  // These are ERRORS, not warnings: production must not start.
  //
  // HONEST LIMIT — a Paddle price id is an opaque `pri_...` string, so their
  // PRESENCE is checkable here but their DENOMINATION is not. Nothing in this file
  // can prove `pri_x` is a euro price. A runtime cross-check (compare the currency
  // Paddle quotes in previewSubscriptionUpdate against this setting) was considered
  // and deliberately NOT built: Paddle supports per-country price overrides, so a
  // foreign customer can legitimately be quoted a currency other than the
  // deployment's, and a blocking check would refuse real upgrades on the live .com
  // account. Verifying the ids' denomination stays a MANUAL step of bringing a
  // non-TRY deployment up, against the real Paddle account.
  //
  // Skipped when the code itself is invalid: that error already stops the boot,
  // and the runtime falls back to TRY prices in TRY, so no lie is reachable.
  if (billingCurrencyValid && billingCurrencyCode !== "TRY") {
    // Counts only prices that PARSE — presence is not configuration. A key set to
    // "0" or "abc" looks supplied but yields no usable amount, and treating it as
    // present would let an incomplete non-TRY deployment through the completeness
    // check (the malformed-value error above names it separately).
    const missingPrices = PLAN_PRICE_KEYS.filter((k) => parsePlanPrice(env[k]) === null);
    if (missingPrices.length > 0) {
      errors.push(
        `APP_BILLING_CURRENCY is ${billingCurrencyCode} but these plan prices are missing: ${missingPrices.join(", ")}. All three are REQUIRED for a non-TRY deployment — otherwise the shipped TRY amounts would be displayed with the ${billingCurrencyCode} symbol.`,
      );
    }
    const missingIds = PADDLE_PRICE_ID_KEYS.filter((k) => !(env[k] ?? "").trim());
    if (missingIds.length > 0) {
      errors.push(
        `APP_BILLING_CURRENCY is ${billingCurrencyCode} but these Paddle price ids are missing: ${missingIds.join(", ")}. All three are REQUIRED for a non-TRY deployment — the displayed price and the charged price must be configured together.`,
      );
    }
  }

  return { errors, warnings };
}
