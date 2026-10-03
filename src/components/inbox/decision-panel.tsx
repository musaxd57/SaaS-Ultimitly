"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronDown, ChevronUp, Circle, Clock, History, Loader2, MessageSquareWarning, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  DECISION_LANGS,
  DECISION_LANG_LABELS_TR,
  decisionMessageText,
  decisionTimeOptions,
  parseHostTime,
  timeOnRightSide,
  type DecisionLang,
  type DecisionResolution,
} from "@/lib/decisions/core";
import type { DecisionCardData, DecisionLine, ResolvedDecisionRow } from "@/lib/decisions/view-types";

// ---------------------------------------------------------------------------
// HOST KARAR MOTORU — "KARAR BEKLİYOR" PANELİ (Faz 1; kurucu: "panelde '13:00 erken giriş — karar bekliyor' açık kalır … host
// onaylayınca veya reddedince talep sonuçlanır"). Konuşma sayfasının EN ÜSTÜNDE (telefonda da ilk görünen). Onay / ret metnini
// KOD kurar (misafirin dilinde, günü adlandırır, ücret yalnız kayıtlı kuraldan); ev sahibi gönderMEDEN önce görür, saati / dili
// değiştirebilir, ücreti çıkarabilir, metni düzenleyebilir. Gönderim sunucuda yeniden doğrulanır (çift tık, misafir yeniden
// yazdı, iptal, gün geçti). Destek görünümünde (bürünme) yalnız okunur — düğme yok.
// ---------------------------------------------------------------------------

export type { DecisionCardData, DecisionLine, ResolvedDecisionRow } from "@/lib/decisions/view-types";

type Mode = { action: DecisionResolution } | null;

export function DecisionPanel({
  conversationId,
  decisions,
  resolved = [],
  readOnly = false,
}: {
  conversationId: string;
  decisions: DecisionCardData[];
  resolved?: ResolvedDecisionRow[];
  readOnly?: boolean;
}) {
  if (decisions.length === 0 && resolved.length === 0) return null;
  return (
    <section aria-label="Karar bekleyen talepler" className="space-y-2" data-testid="decision-panel">
      {decisions.map((d) => (
        <DecisionCard key={d.id} conversationId={conversationId} d={d} readOnly={readOnly} />
      ))}
      {resolved.length > 0 ? <ResolvedList rows={resolved} /> : null}
    </section>
  );
}

function ResolvedList({ rows }: { rows: ResolvedDecisionRow[] }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs" data-testid="decision-resolved">
      <p className="mb-1 flex items-center gap-1.5 font-medium text-muted-foreground">
        <History className="size-3.5" aria-hidden="true" /> Önceki kararlar
      </p>
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-baseline gap-x-1.5 text-muted-foreground">
            <span className="text-foreground">{r.title}</span>
            <span aria-hidden="true">—</span>
            <span className={r.tone === "success" ? "font-medium text-emerald-700 dark:text-success" : ""}>{r.outcome}</span>
            <span aria-hidden="true">·</span>
            <span>{r.at}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LineList({ id, lines }: { id?: string; lines: DecisionLine[] }) {
  return (
    <ul id={id} className="space-y-1 text-xs">
      {lines.map((l) => (
        <li key={l.text} className="flex items-start gap-1.5">
          {l.info ? (
            <Circle className="mt-0.5 size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          ) : l.ok ? (
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-success" aria-hidden="true" />
          ) : (
            <XCircle className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden="true" />
          )}
          <span className={l.ok || l.info ? "text-muted-foreground" : ""}>{l.text}</span>
        </li>
      ))}
    </ul>
  );
}

function DecisionCard({ conversationId, d, readOnly }: { conversationId: string; d: DecisionCardData; readOnly: boolean }) {
  const router = useRouter();
  const ids = useId();
  const textCapable = d.kind === "early_checkin" || d.kind === "late_checkout";
  const [mode, setMode] = useState<Mode>(null);
  const [showAll, setShowAll] = useState(false);
  const [time, setTime] = useState(d.requestedTime ?? "");
  const [lang, setLang] = useState<DecisionLang>(d.lang);
  const [includeFee, setIncludeFee] = useState(true);
  const [body, setBody] = useState("");
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  const [notice, setNotice] = useState<{ tone: "warn" | "error"; text: string; seen?: string } | null>(null);
  // Kartın sürümü: sunucu kesin bir gönderim hatasından sonra kartı YENİ sürümle yeniden açar ve sürümü yanıtta döner — yeniden
  // deneme onu kullanır (yoksa her yeniden deneme önce "kart değişti" ile düşerdi). Sayfa yenilenince sunucudaki sürüm esas.
  const [version, setVersion] = useState(d.version);
  useEffect(() => setVersion(d.version), [d.version]);

  const timeOptions = useMemo(() => decisionTimeOptions(d.kind, d.standardTime, [d.requestedTime, time]), [d.kind, d.standardTime, d.requestedTime, time]);

  const draftFor = (action: DecisionResolution, t: string, l: DecisionLang, fee: boolean) =>
    textCapable
      ? (decisionMessageText({
          kind: d.kind,
          resolution: action,
          lang: l,
          dayKey: d.dayKey,
          time: parseHostTime(t),
          standardTime: d.standardTime,
          fee: fee ? d.fee : null,
          note: d.note,
        }) ?? "")
      : "";

  const open = (action: DecisionResolution) => {
    setMode({ action });
    setConfirmDismiss(false);
    setNotice(null);
    setEdited(false);
    setBody(draftFor(action, time, lang, includeFee));
  };

  // Saat / dil / ücret değişince metin yeniden kurulur — ev sahibi metni elle düzenlediyse EZİLMEZ ("yeniden oluştur" düğmesi çıkar).
  const changeTime = (t: string) => {
    setTime(t);
    if (mode && !edited) setBody(draftFor(mode.action, t, lang, includeFee));
  };
  const changeLang = (l: DecisionLang) => {
    setLang(l);
    if (mode && !edited) setBody(draftFor(mode.action, time, l, includeFee));
  };
  const changeFee = (on: boolean) => {
    setIncludeFee(on);
    if (mode && !edited) setBody(draftFor(mode.action, time, lang, on));
  };

  const parsedTime = parseHostTime(time);
  const wrongSide = mode?.action === "approve" && parsedTime ? timeOnRightSide(d.kind, parsedTime, d.standardTime) === false : false;
  const needsTime = mode?.action === "approve" && textCapable && !parsedTime;
  // Kod metni kurulamadı (konaklama günü / standart saat bilinmiyor): ev sahibi yazar — boş ya da tahminli metin önerilmez.
  const noDraft = mode !== null && textCapable && !edited && !body.trim() && !draftFor(mode.action, time, lang, includeFee);

  const statusIcon = d.unverified ? (
    <MessageSquareWarning className="size-4 shrink-0 text-destructive" aria-hidden="true" />
  ) : d.open ? (
    <Clock className="size-4 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden="true" />
  ) : (
    <CheckCircle2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
  );

  async function post(payload: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/decisions/${d.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version, ...payload }),
      });
      const json = (await res.json().catch(() => ({}))) as { code?: string; error?: string; latestMessageId?: string; version?: number };
      if (typeof json.version === "number") setVersion(json.version);
      if (res.ok) return { ok: true as const };
      return { ok: false as const, status: res.status, code: json.code, error: json.error, latestMessageId: json.latestMessageId };
    } catch {
      return { ok: false as const, status: 0, error: "Bağlantı hatası. Lütfen tekrar deneyin." };
    } finally {
      setBusy(false);
    }
  }

  // Sayfa açıldığında görünen sonraki misafir mesajı ev sahibinin GÖZÜ ÖNÜNDEYDİ (kartta uyarı) → "okundu" sayılır; sonradan gelen
  // yeni mesajda sunucu yine durdurur ve ev sahibine okutur.
  async function send(seenMessageId: string | undefined = d.laterGuestMessageId ?? undefined) {
    if (!mode) return;
    const r = await post({
      action: mode.action,
      body,
      factsHash: d.factsHash,
      ...(mode.action === "approve" && parsedTime ? { time: parsedTime } : {}),
      ...(seenMessageId ? { seenMessageId } : {}),
    });
    if (r.ok) {
      toast.success(mode.action === "approve" ? "Onay misafire gönderildi." : "Cevabınız misafire gönderildi.");
      setMode(null);
      router.refresh();
      return;
    }
    if (r.code === "guest_wrote_again" && r.latestMessageId) {
      setNotice({ tone: "warn", text: r.error ?? "Misafir bu talepten sonra yeniden yazdı.", seen: r.latestMessageId });
      // Yeni mesaj konuşmada görünsün (kartın durumu korunur).
      router.refresh();
      return;
    }
    if (r.code === "facts_changed") {
      // Kontrol listesi tazelenir; düzenleyici AÇIK kalır (yazılan metin kaybolmaz) — ev sahibi yeni satırlara bakıp tekrar gönderir.
      setNotice({ tone: "warn", text: r.error ?? "Bu talebin kontrol listesi değişti; güncel hâline bakın." });
      setShowAll(true);
      router.refresh();
      return;
    }
    if (r.code === "stale" || r.code === "expired" || r.code === "reservation_cancelled" || r.code === "send_unverified") {
      toast.error(r.error ?? "Bu kart az önce değişti.");
      setMode(null);
      router.refresh();
      return;
    }
    setNotice({ tone: "error", text: r.error ?? "Gönderilemedi. Lütfen tekrar deneyin." });
  }

  async function dismiss() {
    const r = await post({ action: "dismiss" });
    setConfirmDismiss(false);
    if (r.ok) toast.success("Kart kapatıldı.");
    else toast.error(r.error ?? "Kapatılamadı. Lütfen tekrar deneyin.");
    router.refresh();
  }

  const failing = d.lines.filter((l) => !l.ok && !l.info);
  const titleId = `${ids}-title`;

  return (
    <article
      aria-labelledby={titleId}
      className={cn(
        "rounded-xl border bg-card p-3 shadow-sm sm:p-4",
        d.unverified
          ? "border-destructive/40"
          : d.open
            ? "border-amber-300 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/5"
            : "border-border opacity-90",
      )}
      data-testid="decision-card"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {statusIcon}
            <h3 id={titleId} className="text-sm font-semibold">
              {d.title}
            </h3>
            <Badge tone={d.unverified ? "destructive" : d.open ? "warning" : "muted"} className="shrink-0 whitespace-nowrap">
              {d.statusLabel}
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{[d.dayLabel, `istendi: ${d.askedAt}`].filter(Boolean).join(" · ")}</p>
        </div>
        {readOnly || d.sending ? null : (
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
            {d.unverified ? (
              <Button size="sm" variant="outline" onClick={dismiss} disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                Kontrol ettim, kapat
              </Button>
            ) : textCapable ? (
              <>
                <Button size="sm" onClick={() => open("approve")} disabled={busy} aria-expanded={mode?.action === "approve"}>
                  <CheckCircle2 className="size-4" /> Onayla
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => open("decline")}
                  disabled={busy}
                  aria-expanded={mode?.action === "decline"}
                >
                  <XCircle className="size-4" /> Reddet
                </Button>
              </>
            ) : null}
            {!d.unverified ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setConfirmDismiss(true);
                  setMode(null);
                }}
                disabled={busy}
                aria-expanded={confirmDismiss}
              >
                {textCapable ? "Gerek kalmadı" : "Tamamlandı"}
              </Button>
            ) : null}
          </div>
        )}
      </div>

      {d.requestQuote ? (
        <blockquote className="mt-2 border-l-2 border-amber-300 pl-2 text-xs text-foreground/80 dark:border-amber-500/40">
          <span className="sr-only">Misafirin mesajı: </span>“{d.requestQuote}”
        </blockquote>
      ) : null}

      <div className="mt-2 space-y-1">
        {d.sending ? (
          <p className="text-xs text-muted-foreground">Karar mesajı gönderiliyor; kart birazdan sonuçlanır.</p>
        ) : d.unverified ? (
          <p className="text-xs text-destructive">
            Karar mesajının gönderimi doğrulanamadı — misafire ulaşmış olabilir. Konuşmayı kanal üzerinden kontrol edin.
          </p>
        ) : d.open ? (
          <p className="text-xs text-muted-foreground">Bu talebe henüz cevap verilmedi; karar sizin.</p>
        ) : (
          <p className="text-xs text-muted-foreground">Bu talepten sonra konuşmaya siz yazdınız; talep sonuçlandıysa kartı kapatın.</p>
        )}
        {d.laterGuestMessageId && !d.unverified ? (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Misafir bu talepten sonra yeniden yazdı — göndermeden önce son mesajı okuyun.
          </p>
        ) : null}
        {!textCapable && !d.unverified ? (
          <p className="text-xs text-muted-foreground">
            Bu talep kanalda rezervasyon değişikliği gerektirir: yanıtı aşağıdan siz yazın, değişikliği kanaldan yapın; sonra kartı
            kapatın.
          </p>
        ) : null}
      </div>

      {confirmDismiss && !readOnly ? (
        <div
          className="mt-3 flex flex-col gap-2 rounded-lg border border-border bg-background p-3 text-xs sm:flex-row sm:items-center sm:justify-between"
          role="group"
          aria-label="Kartı kapatma onayı"
        >
          <span>Kart kapatılsın mı? Misafire bir şey gönderilmez.</span>
          <span className="flex gap-2">
            <Button size="sm" variant="outline" onClick={dismiss} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Kartı kapat
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDismiss(false)} disabled={busy}>
              Vazgeç
            </Button>
          </span>
        </div>
      ) : null}

      {d.lines.length > 0 ? (
        <div className="mt-3 space-y-1.5">
          {showAll ? (
            <LineList id={`${ids}-lines`} lines={d.lines} />
          ) : failing.length > 0 ? (
            <>
              <p className="text-xs font-medium">Bakmanız gerekenler</p>
              <LineList lines={failing} />
            </>
          ) : null}
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            onClick={() => setShowAll((v) => !v)}
            aria-expanded={showAll}
            aria-controls={`${ids}-lines`}
          >
            {showAll ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            {showAll
              ? "Kontrol listesini kısalt"
              : failing.length > 0
                ? `Tüm kontrol listesi (${d.lines.length})`
                : `Kontrol listesi · hepsi uygun (${d.lines.length})`}
          </button>
        </div>
      ) : null}

      {mode && !readOnly ? (
        <div className="mt-3 space-y-2 rounded-lg border border-border bg-background p-3" aria-live="polite">
          <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-end">
            {mode.action === "approve" && textCapable ? (
              <label className="space-y-1 text-xs font-medium" htmlFor={`${ids}-time`}>
                <span className="block">{d.kind === "early_checkin" ? "Giriş saati" : "Çıkış saati"}</span>
                <Select id={`${ids}-time`} value={time} onChange={(e) => changeTime(e.target.value)} className="h-9 sm:w-44" required>
                  <option value="" disabled>
                    Saat seçin
                  </option>
                  {timeOptions.map((t) => (
                    <option key={t} value={t}>
                      {t}
                      {t === d.requestedTime ? " (istenen)" : ""}
                    </option>
                  ))}
                </Select>
              </label>
            ) : null}
            <label className="space-y-1 text-xs font-medium" htmlFor={`${ids}-lang`}>
              <span className="block">Mesajın dili</span>
              <Select id={`${ids}-lang`} value={lang} onChange={(e) => changeLang(e.target.value as DecisionLang)} className="h-9 sm:w-40">
                {DECISION_LANGS.map((l) => (
                  <option key={l} value={l}>
                    {DECISION_LANG_LABELS_TR[l]}
                  </option>
                ))}
              </Select>
            </label>
            {mode.action === "approve" && d.kind === "early_checkin" && d.fee ? (
              <label className="flex items-center gap-2 text-xs font-medium sm:pb-2">
                <input
                  type="checkbox"
                  className="size-4 rounded border-input"
                  checked={includeFee}
                  onChange={(e) => changeFee(e.target.checked)}
                />
                Ücreti mesaja ekle
              </label>
            ) : null}
            {edited ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setBody(draftFor(mode.action, time, lang, includeFee));
                  setEdited(false);
                }}
              >
                Metni yeniden oluştur
              </Button>
            ) : null}
          </div>
          {wrongSide ? (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              {d.kind === "early_checkin"
                ? `Bu saat standart giriş saatinizden (${d.standardTime}) erken değil.`
                : `Bu saat standart çıkış saatinizden (${d.standardTime}) geç değil.`}
            </p>
          ) : null}
          <label className="block space-y-1 text-xs font-medium" htmlFor={`${ids}-body`}>
            <span className="block">Misafire gidecek mesaj</span>
            <Textarea
              id={`${ids}-body`}
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                setEdited(true);
              }}
              rows={3}
              maxLength={10000}
              placeholder={noDraft ? "Mesajı siz yazın." : undefined}
            />
          </label>
          {noDraft ? (
            <p className="text-xs text-muted-foreground">
              {needsTime ? "Saati seçtiğinizde metin hazırlanır." : "Bu talep için hazır metin kurulamadı (konaklama günü bilinmiyor); mesajı siz yazın."}
            </p>
          ) : null}
          {mode.action === "approve" && d.kind === "early_checkin" && d.fee && includeFee ? (
            <p className="text-xs text-muted-foreground">Ücret, mülk sayfasındaki erken giriş kuralınızdan.</p>
          ) : null}
          {notice ? (
            <div
              className={cn(
                "rounded-md px-3 py-2 text-xs",
                notice.tone === "warn"
                  ? "border border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300"
                  : "border border-destructive/30 bg-destructive/5 text-destructive",
              )}
              role="alert"
            >
              {notice.text}
              {notice.seen ? (
                <div className="mt-2">
                  <Button size="sm" variant="outline" onClick={() => send(notice.seen)} disabled={busy || !body.trim()}>
                    Okudum, yine de gönder
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => send()} disabled={busy || !body.trim() || needsTime}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Misafire gönder
            </Button>
            <Button size="sm" variant="outline" onClick={() => setMode(null)} disabled={busy}>
              Vazgeç
            </Button>
          </div>
        </div>
      ) : null}

      {readOnly ? <p className="mt-2 text-xs text-muted-foreground">Destek görünümü salt okunur.</p> : null}
    </article>
  );
}
