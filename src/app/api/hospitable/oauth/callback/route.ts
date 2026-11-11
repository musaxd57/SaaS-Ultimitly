import { isImpersonating } from "@/lib/auth/impersonation";
import { type NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { isSuperAdmin } from "@/lib/admin";
import { verifyToken, HospitableError } from "@/lib/hospitable";
import { consumeOAuthConnectIntent, setOrgHospitableOAuthTokens } from "@/lib/hospitable-credentials";
import { writeAudit } from "@/lib/audit";
import { baseUrlFromHost } from "@/lib/auth/email-verify";
import {
  getHospitableOAuthConfig,
  exchangeCodeForToken,
  HospitableOAuthError,
  parseOAuthStateCookie,
  OAUTH_STATE_COOKIE,
} from "@/lib/hospitable-oauth";

// Completes the OAuth round-trip: verifies the CSRF state, exchanges the code
// for a token set, validates the access token (same verifyToken call the
// manual-PAT flow uses), then stores access+refresh+expiry via
// setOrgHospitableOAuthTokens(). getOrgHospitableToken() transparently
// refreshes it going forward — sync/send never see a difference from a PAT.
export async function GET(req: NextRequest) {
  // Behind Railway, req.url's origin is the INTERNAL container address
  // (localhost:xxxx) — every redirect back to OUR OWN site must be built from
  // the Host header instead, or the browser gets sent to an unreachable
  // localhost URL (see lib/auth/email-verify.ts for the same, earlier fix).
  const base = baseUrlFromHost(req.headers.get("host"));
  const session = await requireSession();
  if (!session) return NextResponse.redirect(`${base}/login`);
  // K8 (kurucu kararı 09-28): bürünmüşken (salt-okunur destek görünümü) kanal bağlantısı kurulamaz — akış sonunda YAZAR.
  if (isImpersonating(session)) return NextResponse.redirect(`${base}/settings?hospitable=forbidden`);
  if (!(session.role === "owner" || isSuperAdmin(session))) {
    return NextResponse.redirect(`${base}/settings?hospitable=forbidden`);
  }

  const config = getHospitableOAuthConfig();
  if (!config) {
    return NextResponse.redirect(`${base}/settings?hospitable=not_configured`);
  }

  const url = new URL(req.url);
  const err = url.searchParams.get("error");
  if (err) {
    // The host declined the authorization screen — not a failure to log loudly.
    return NextResponse.redirect(`${base}/settings?hospitable=denied`);
  }

  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get(OAUTH_STATE_COOKIE)?.value;
  const code = url.searchParams.get("code");
  const clearStateCookie = (res: NextResponse) => {
    res.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  };

  const bound = parseOAuthStateCookie(cookieState);
  if (!code || !state || !bound || state !== bound.state) {
    return clearStateCookie(
      NextResponse.redirect(`${base}/settings?hospitable=state_mismatch`),
    );
  }

  // The flow must FINISH in the exact org+user context it STARTED in (Codex
  // #13). If the session drifted between authorize and callback — operator
  // exited impersonation, switched to another customer, or a different user is
  // signed in on this browser — saving here would bind the host's Hospitable
  // tokens to the WRONG tenant. Reject BEFORE the code exchange so no token is
  // ever minted for a mismatched context.
  if (bound.organizationId !== session.organizationId || bound.userId !== session.userId) {
    return clearStateCookie(
      NextResponse.redirect(`${base}/settings?hospitable=context_changed`),
    );
  }

  // 🚨 TEK KULLANIMLIK NİYET (OAuth O2 + O5, Codex 11-10): bu akış işletmenin bekleyen niyeti olarak kayıtlı mı? Tüketilir — aynı dönüş
  // adresi ikinci kez çağrılırsa (tekrar / geri tuşu / kopyalanmış bağlantı), akış yeniden başlatıldıysa ya da ev sahibi bu arada bağlantıyı
  // kaldırıp / elle anahtar girdiyse burada durur: sağlayıcıya yetki kodu GÖNDERİLMEZ, hiçbir şey yazılmaz.
  let intent: Awaited<ReturnType<typeof consumeOAuthConnectIntent>>;
  try {
    intent = await consumeOAuthConnectIntent(session.organizationId, state);
  } catch (err) {
    // Niyet kaydı okunamadı (veritabanı arızası): ham 500 yerine bilinen "bağlantı kurulamadı" sonucu + operatöre bildirim; durum çerezi
    // de temizlenir. Yetki kodu sağlayıcıya GÖNDERİLMEDİ — ev sahibi akışı yeniden başlatır (Haiku incelemesi 11-11).
    const { reportError } = await import("@/lib/report-error");
    void reportError("hospitable.oauth.callback.intent", err).catch(() => {});
    return clearStateCookie(NextResponse.redirect(`${base}/settings?hospitable=exchange_failed`));
  }
  if (!intent) {
    return clearStateCookie(NextResponse.redirect(`${base}/settings?hospitable=state_mismatch`));
  }

  try {
    const tokens = await exchangeCodeForToken(config, code);
    const info = await verifyToken(tokens.accessToken);
    // Yetki kodu anahtara çevrilirken bağlantı değiştiyse (kaldırıldı / başka anahtar bağlandı) geç gelen sonuç yazılmaz (O2).
    const saved = await setOrgHospitableOAuthTokens(session.organizationId, tokens, `${info.properties} mülk`, intent);
    if (!saved) {
      return clearStateCookie(NextResponse.redirect(`${base}/settings?hospitable=context_changed`));
    }
    await writeAudit({
      organizationId: session.organizationId,
      actorUserId: session.actorUserId ?? session.userId,
      action: "hospitable.connect",
      metadata: { via: "oauth", properties: info.properties },
    });
    return clearStateCookie(NextResponse.redirect(`${base}/settings?hospitable=connected`));
  } catch (err) {
    // 🚨 SAĞLAYICI REDDİ ≠ İÇ ARIZA (09-23, alarm ajanı — kodda doğrulandı): kod değişimi
    // `HospitableOAuthError` fırlatır ve o `HospitableError` DEĞİLDİR → sağlayıcının kodu
    // REDDETMESİ (süresi dolmuş/tekrar kullanılmış kod = OAuth `invalid_grant`, 4xx,
    // `authFailure`) "iç arıza" sayılıp her seferinde operatöre alarm e-postası
    // düşüyordu, kullanıcıya da "bağlantı kurulamadı" yerine anlamsız bir sebep. Beklenen
    // bir dış olaydır: kullanıcı yeniden dener, alarm GİTMEZ. Geçici sağlayıcı sorunu
    // (5xx/429/ağ) ve yapılandırma hatası `authFailure:false` ile gelir ve alarm vermeye
    // DEVAM eder — sistemik kırılma görünür kalmalı.
    // 🚨 KESİNTİ ≠ GEÇERSİZ ANAHTAR (OAuth O4, Codex 11-10): doğrulama çağrısının (`verifyToken`) HER hatası "sağlayıcı reddetti"
    // sayılıyordu — hız sınırı (429), sağlayıcı arızası (5xx), ağ / zaman aşımı da ev sahibine "anahtar geçersiz" diye gösteriliyor ve
    // operatöre alarm gitmiyordu. Ret yalnız sağlayıcının anahtarı / hesabı GERÇEKTEN reddettiği durumlardır (401 / 402 / 403); gerisi
    // geçici ya da iç arızadır → "bağlantı kurulamadı" + alarm.
    const verifyStatus = err instanceof HospitableError ? err.status : undefined;
    const providerRejected =
      (err instanceof HospitableOAuthError && err.authFailure) || (verifyStatus !== undefined && [401, 402, 403].includes(verifyStatus));
    const reason = providerRejected ? "invalid_token" : "exchange_failed";
    // A non-provider-rejection is an INTERNAL or transient fault (encryptSecret / the DB
    // write in setOrgHospitableOAuthTokens / provider 5xx) — surface it so a systemic
    // ENCRYPTION_KEY/DB failure that breaks "Hospitable ile Bağlan" for every host pages
    // ops. (The sibling PAT-connect route already reportErrors this.)
    if (!providerRejected) {
      const { reportError } = await import("@/lib/report-error");
      void reportError("hospitable.oauth.callback", err).catch(() => {});
    }
    return clearStateCookie(
      NextResponse.redirect(`${base}/settings?hospitable=${reason}`),
    );
  }
}
