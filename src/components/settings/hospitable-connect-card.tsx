"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check, Link2, Plug, Unplug, Lock, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form-field";
import type { HospitableConnectionInfo } from "@/lib/hospitable-credentials";

/**
 * Connect THIS organization's own Hospitable account (multi-tenant). The
 * OPERATOR pastes the customer's Personal Access Token once; it is validated and
 * stored ENCRYPTED server-side and never sent back to the browser. Once
 * connected, the token field is hidden behind a locked view — you must click
 * "Değiştir" to enter a new one (nothing is ever displayed or copyable).
 */
// Query-param result codes the OAuth callback route redirects back with.
const OAUTH_RESULT_MESSAGES: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "Hospitable ile bağlandı." },
  forbidden: { ok: false, text: "Bu işlem için yetkiniz yok." },
  not_configured: { ok: false, text: "OAuth bağlantısı henüz hazır değil — token ile bağlanabilirsiniz." },
  denied: { ok: false, text: "Bağlantı izni verilmedi." },
  state_mismatch: { ok: false, text: "Bağlantı isteği doğrulanamadı, lütfen tekrar deneyin." },
  context_changed: {
    ok: false,
    text: "Bağlantı başlatıldığı hesap/organizasyon değişti — güvenlik için kaydedilmedi. Doğru hesaptayken tekrar deneyin.",
  },
  invalid_token: { ok: false, text: "Alınan bağlantı anahtarı geçersiz, lütfen tekrar deneyin." },
  exchange_failed: { ok: false, text: "Hospitable ile bağlantı kurulamadı, lütfen tekrar deneyin." },
};

export function HospitableConnectCard({
  info,
  oauthEnabled = false,
  oauthResult,
}: {
  info: HospitableConnectionInfo;
  /** Whether the "Hospitable ile Bağlan" one-click OAuth button should render. */
  oauthEnabled?: boolean;
  /** Result code the OAuth callback redirected back with (?hospitable=...), if any. */
  oauthResult?: string;
}) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<null | "connect" | "claim" | "disconnect">(null);
  const oauthMessage = oauthResult ? OAUTH_RESULT_MESSAGES[oauthResult] : null;
  const [error, setError] = useState<string | null>(oauthMessage && !oauthMessage.ok ? oauthMessage.text : null);
  const [done, setDone] = useState<string | null>(oauthMessage?.ok ? oauthMessage.text : null);

  async function post(body: object, kind: "connect" | "claim") {
    setBusy(kind);
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/hospitable/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setDone(`Bağlandı — ${data.properties ?? 0} mülk bulundu.`);
        setToken("");
        setEditing(false);
        router.refresh();
      } else {
        setError(data.error ?? "Bağlanılamadı.");
      }
    } catch {
      setError("Bağlantı hatası.");
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    if (!confirm("Bağlantıyı kesmek istediğinize emin misiniz? Misafir mesajları çekme/gönderme durur.")) return;
    setBusy("disconnect");
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/hospitable/connect", { method: "DELETE" });
      if (res.ok) {
        setEditing(false);
        router.refresh();
      } else setError("Bağlantı kesilemedi.");
    } catch {
      setError("Bağlantı hatası.");
    } finally {
      setBusy(null);
    }
  }

  // The token entry form is shown only when NOT connected, or when the operator
  // explicitly chooses to change the token. Otherwise the connection is locked.
  const showForm = !info.connected || editing;
  const claimBlock =
    info.envAvailable && !info.ownToken ? (
      <div className="rounded-md border border-dashed border-muted-foreground/30 p-3">
        <p className="mb-2 text-sm text-muted-foreground">
          Bu sistemde zaten bir bağlantı mevcut. Tek tıkla bu
          hesaba kalıcı olarak aktarabilirsiniz — sonra ortak bağlantıya ihtiyaç kalmaz.
        </p>
        <Button type="button" variant="outline" disabled={busy !== null} onClick={() => post({ claimEnv: true }, "claim")}>
          {busy === "claim" ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
          Mevcut bağlantıyı bu hesaba aktar
        </Button>
      </div>
    ) : null;

  return (
    <div className="space-y-4">
      {/* Status line */}
      {info.connected ? (
        <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <Check className="size-4 shrink-0" />
          <span>
            <strong>Bağlı.</strong>{" "}
            {info.ownToken
              ? `Bu hesabın kendi Hospitable bağlantısı kullanılıyor${info.label ? ` (${info.label})` : ""}.`
              : "Sistemin ortak (env) Hospitable bağlantısı kullanılıyor."}
          </span>
        </div>
      ) : (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <strong>Bağlı değil.</strong> Bu hesabın misafir mesajları çekilemez/gönderilemez.
          Aşağıdan Airbnb / Booking bağlantınızı (Hospitable üzerinden) kurun.
        </div>
      )}

      {/* LOCKED VIEW — connected and not editing: the field is VISIBLE but locked
          (greyed, unclickable) and shows masked dots; the real token is never
          loaded into the browser. "Değiştir" unlocks it to enter a new one. */}
      {info.connected && !editing ? (
        <div className="space-y-3">
          <Field label="Hospitable Personal Access Token" htmlFor="hosp-locked">
            <div className="relative">
              <Input
                id="hosp-locked"
                type="text"
                value={"•".repeat(28)}
                disabled
                readOnly
                className="cursor-not-allowed bg-muted/50 pr-9 tracking-widest"
              />
              <Lock className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            </div>
          </Field>
          <p className="text-xs text-muted-foreground">
            🔒 Bağlı ve kilitli. Token <strong>şifreli</strong> saklanıyor ve arayüzde tekrar
            görüntülenmez. Değiştirmek için &quot;Değiştir&quot;e basın.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={busy !== null} onClick={() => { setEditing(true); setError(null); setDone(null); }}>
              <Pencil className="size-4" /> Değiştir
            </Button>
            {info.ownToken ? (
              <Button type="button" variant="outline" disabled={busy !== null} onClick={disconnect}>
                {busy === "disconnect" ? <Loader2 className="size-4 animate-spin" /> : <Unplug className="size-4" />}
                Bağlantıyı kes
              </Button>
            ) : null}
          </div>
          {!info.ownToken ? claimBlock : null}
        </div>
      ) : null}

      {/* FORM VIEW — not connected, or operator clicked "Değiştir". */}
      {showForm ? (
        <>
          {/* Plan uyarısı EN ÜSTTE — hem "Hospitable ile Bağlan" (OAuth) hem elle
              token yolu bu gerekliliğe tabi. Ücretsiz planda OAuth yetkilendirmesi de
              Hospitable tarafında hata verebilir. */}
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            <strong>Önce:</strong> Airbnb/Booking mesaj ve rezervasyonlarınızı Lixus&apos;a çekebilmek
            için Hospitable hesabınızın <strong>API erişimi içeren (ücretli) bir planda</strong>{" "}
            olması gerekir. Hospitable&apos;ın ücretsiz planı API erişimi içermez — bu planda
            bağlanmayı denerseniz Hospitable tarafında hata alırsınız veya mesajlar çekilemez.
          </div>
          {oauthEnabled ? (
            <div className="space-y-2">
              <a href="/api/hospitable/oauth/authorize">
                <Button type="button" className="w-full sm:w-auto">
                  <Link2 className="size-4" /> Hospitable ile Bağlan
                </Button>
              </a>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <div className="h-px flex-1 bg-border" /> veya elle bağlanın{" "}
                <div className="h-px flex-1 bg-border" />
              </div>
            </div>
          ) : null}
          <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
            <p className="mb-1.5 font-medium text-foreground">Bağlantı anahtarı nasıl alınır? (2 dakika)</p>
            <ol className="list-decimal space-y-1 pl-4">
              <li>
                <strong>my.hospitable.com</strong>&apos;da giriş yapın; kenar menüden{" "}
                <strong>Apps</strong> (veya <strong>Settings → Integrations</strong>) →{" "}
                <strong>API access</strong> → <strong>Access tokens</strong> sekmesine gidin.
              </li>
              <li>
                <strong>&quot;+ Add new&quot;</strong> ile yeni bir anahtar oluşturun, bir isim verin
                ve <strong>Read and Write</strong> (okuma + yazma) iznini seçin — mesaj gönderimi için
                yazma izni gerekir.
              </li>
              <li>
                Anahtarı <strong>kopyalayın</strong> (kopyalarken Hospitable hesap şifreniz
                sorulabilir; anahtar bir daha gösterilmez).
              </li>
              <li>Aşağıdaki kutuya <strong>yapıştırın → Bağla</strong>.</li>
            </ol>
            <p className="mt-1.5 text-xs">
              Not: Anahtarı yalnız hesap sahibi veya tam-yetkili yönetici oluşturabilir; anahtar
              1 yıl geçerlidir.
            </p>
            <p className="mt-1.5 text-xs">
              🔒 Token <strong>uçtan uca şifreli</strong> saklanır ve yalnızca bu işletmenin
              Hospitable mülklerine erişmek için kullanılır; kaydedildikten sonra arayüzde tekrar
              görüntülenmez.
            </p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              post({ token }, "connect");
            }}
            className="flex flex-wrap items-end gap-2"
          >
            <Field label="Hospitable Personal Access Token" htmlFor="hosp-token" className="min-w-[260px] flex-1">
              <Input
                id="hosp-token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Hospitable access token"
                autoComplete="off"
              />
            </Field>
            <Button type="submit" disabled={busy !== null || token.trim().length < 10}>
              {busy === "connect" ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />}
              Bağla
            </Button>
          </form>

          {claimBlock}

          {editing ? (
            <Button type="button" variant="ghost" size="sm" disabled={busy !== null} onClick={() => { setEditing(false); setToken(""); }}>
              Vazgeç
            </Button>
          ) : null}
        </>
      ) : null}

      {done ? (
        <p className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600">
          <Check className="size-4" /> {done}
        </p>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
