"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
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
// değiştirebilir, ücreti / notu çıkarabilir, metni düzenleyebilir. Gönderim sunucuda yeniden doğrulanır (çift tık, misafir yeniden
// yazdı, iptal, gün geçti, kontrol listesi değişti).
//  · Ev sahibinin GÖRDÜĞÜ değerler düzenleyici açılınca sabitlenir (son misafir mesajı + kontrol listesinin izi); sayfa arka planda
//    yenilenip yeni bir mesaj / değişen kontrol listesi gelirse gönderim "Okudum" denmeden yapılamaz — görmediği bilgiyle karar gitmez.
//  · Destek görünümünde (bürünme) yalnız okunur — düğme yok.
//  · Yapay zekâ metni (`aiText`, anahtar `HOST_DECISION_AI_TEXT_ENABLED`; Sabah Kararları 62 h): düzenleyici açılınca onaylı şablon HEMEN
//    görünür, taslak arka planda istenir (`…/draft`); gelince ev sahibi metne dokunmadıysa şablonun yerine geçer. Saat / dil / ücret /
//    not değişince yeniden istenir. Gönderimde sunucu metni karar kaydıyla kıyaslar; uyuşmazsa uyarı + "Yine de gönder".
// ---------------------------------------------------------------------------

export type { DecisionCardData, DecisionLine, ResolvedDecisionRow } from "@/lib/decisions/view-types";

type Mode = { action: DecisionResolution } | null;
type Seen = { later: string | null; hash: string };

export function DecisionPanel({
  conversationId,
  decisions,
  resolved = [],
  readOnly = false,
  aiText = false,
}: {
  conversationId: string;
  decisions: DecisionCardData[];
  resolved?: ResolvedDecisionRow[];
  readOnly?: boolean;
  aiText?: boolean;
}) {
  if (decisions.length === 0 && resolved.length === 0) return null;
  return (
    <section aria-label="Konaklama talepleri" className="space-y-2" data-testid="decision-panel">
      <h2 className="sr-only">Konaklama talepleri</h2>
      {decisions.map((d) => (
        <DecisionCard key={d.id} conversationId={conversationId} d={d} readOnly={readOnly} aiText={aiText} />
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
          <span className={l.ok || l.info ? "text-muted-foreground" : ""}>
            <span className="sr-only">{l.info ? "Bilgi: " : l.ok ? "Uygun: " : "Uyarı: "}</span>
            {l.text}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Ev sahibinin düzenlediği metin seçtiği saati taşıyor mu ("13:00", "13.00", "9:30" yazımları). */
export function bodyMentionsTime(body: string, hhmm: string): boolean {
  const [h, m] = hhmm.split(":");
  const variants = [...new Set([`${h}:${m}`, `${h}.${m}`, `${Number(h)}:${m}`, `${Number(h)}.${m}`])];
  return variants.some((v) => new RegExp(`(^|[^\\d])${v.replace(".", "\\.")}(?!\\d)`).test(body));
}

function DecisionCard({ conversationId, d, readOnly, aiText }: { conversationId: string; d: DecisionCardData; readOnly: boolean; aiText: boolean }) {
  const router = useRouter();
  const ids = useId();
  const editorId = `${ids}-editor`;
  const editorRef = useRef<HTMLDivElement>(null);
  const textCapable = d.kind === "early_checkin" || d.kind === "late_checkout";
  const [mode, setMode] = useState<Mode>(null);
  const [showAll, setShowAll] = useState(false);
  const [time, setTime] = useState(d.requestedTime ?? "");
  const [lang, setLang] = useState<DecisionLang>(d.lang);
  const [includeFee, setIncludeFee] = useState(true);
  const [includeNote, setIncludeNote] = useState(true);
  const [body, setBody] = useState("");
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [seen, setSeen] = useState<Seen | null>(null);
  const [notice, setNotice] = useState<{ tone: "warn" | "error"; text: string; latestMessageId?: string; problems?: string[] } | null>(null);
  // Yapay zekâ taslağı: hangi seçimler için (anahtar) istendi, geldi mi. Gelen metin yalnız AYNI seçimler hâlâ geçerliyse ve ev sahibi
  // metne dokunmadıysa yazılır (eski yanıt yeni seçimi ezmesin).
  const [aiDraft, setAiDraft] = useState<{ key: string; text: string; source: "ai" | "template" } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const aiRequest = useRef(0);
  // Kartın sürümü: sunucu kesin bir gönderim hatasından sonra kartı YENİ sürümle yeniden açar ve sürümü yanıtta döner — yeniden
  // deneme onu kullanır (yoksa her yeniden deneme önce "kart değişti" ile düşerdi). Sayfa yenilenince sunucudaki sürüm esas.
  const [version, setVersion] = useState(d.version);
  useEffect(() => setVersion(d.version), [d.version]);

  const timeOptions = useMemo(() => decisionTimeOptions(d.kind, d.standardTime, [d.requestedTime, time]), [d.kind, d.standardTime, d.requestedTime, time]);

  const draftFor = (action: DecisionResolution, t: string, l: DecisionLang, fee: boolean, note: boolean) =>
    textCapable
      ? (decisionMessageText({
          kind: d.kind,
          resolution: action,
          lang: l,
          dayKey: d.dayKey,
          time: parseHostTime(t),
          standardTime: d.standardTime,
          fee: fee ? d.fee : null,
          note: note ? d.note : null,
        }) ?? "")
      : "";

  const draftKey = (action: DecisionResolution, t: string, l: DecisionLang, fee: boolean, note: boolean) =>
    JSON.stringify([action, action === "approve" ? parseHostTime(t) : null, l, fee, note, d.factsHash]);
  /** Ev sahibinin gördüğü hazır metin: bu seçimler için gelmiş yapay zekâ taslağı, yoksa onaylı şablon. */
  const preparedFor = (action: DecisionResolution, t: string, l: DecisionLang, fee: boolean, note: boolean) =>
    aiDraft && aiDraft.key === draftKey(action, t, l, fee, note) && aiDraft.text ? aiDraft.text : draftFor(action, t, l, fee, note);

  async function requestAiDraft(action: DecisionResolution, t: string, l: DecisionLang, fee: boolean, note: boolean) {
    if (!aiText || !textCapable) return;
    const parsed = parseHostTime(t);
    if (action === "approve" && !parsed) return;
    const key = draftKey(action, t, l, fee, note);
    const ticket = ++aiRequest.current;
    setAiLoading(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/decisions/${d.id}/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, lang: l, includeFee: fee, includeNote: note, ...(parsed ? { time: parsed } : {}) }),
      });
      const json = (await res.json().catch(() => ({}))) as { text?: string | null; source?: string };
      if (ticket !== aiRequest.current || !res.ok || typeof json.text !== "string" || !json.text.trim()) return;
      const text = json.text;
      setAiDraft({ key, text, source: json.source === "ai" ? "ai" : "template" });
      // Ev sahibi o arada yazmaya başladıysa metni EZME (seçimi "Hazır metne dön" ile alabilir).
      setBody((prev) => (editedRef.current ? prev : text));
    } catch {
      // Taslak alınamadı: şablon ekranda kalır.
    } finally {
      if (ticket === aiRequest.current) setAiLoading(false);
    }
  }
  const editedRef = useRef(false);
  useEffect(() => {
    editedRef.current = edited;
  }, [edited]);

  const open = (action: DecisionResolution) => {
    setMode({ action });
    setConfirmDismiss(false);
    setConfirmReset(false);
    setNotice(null);
    setEdited(false);
    setSeen({ later: d.laterGuestMessageId, hash: d.factsHash });
    setBody(preparedFor(action, time, lang, includeFee, includeNote));
    void requestAiDraft(action, time, lang, includeFee, includeNote);
  };

  // Düzenleyici açılınca odak ilk alana (klavye / ekran okuyucu kullanıcısı kartın altına inmek zorunda kalmasın).
  useEffect(() => {
    if (!mode) return;
    editorRef.current?.querySelector<HTMLElement>("select, textarea")?.focus();
  }, [mode]);

  // Kartın olguları arka planda değişti (gün, standart saat, ücret, not): ev sahibi metne dokunmadıysa hazır metin güncellenir.
  useEffect(() => {
    if (mode && !edited) setBody(draftFor(mode.action, time, lang, includeFee, includeNote));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.dayKey, d.standardTime, d.fee?.amount, d.fee?.currency, d.note]);

  // Saat / dil / ücret / not değişince metin yeniden kurulur — ev sahibi metni elle düzenlediyse EZİLMEZ ("Hazır metne dön" çıkar).
  const changeTime = (t: string) => {
    setTime(t);
    if (mode && !edited) {
      setBody(preparedFor(mode.action, t, lang, includeFee, includeNote));
      void requestAiDraft(mode.action, t, lang, includeFee, includeNote);
    }
  };
  const changeLang = (l: DecisionLang) => {
    setLang(l);
    if (mode && !edited) {
      setBody(preparedFor(mode.action, time, l, includeFee, includeNote));
      void requestAiDraft(mode.action, time, l, includeFee, includeNote);
    }
  };
  const changeFee = (on: boolean) => {
    setIncludeFee(on);
    if (mode && !edited) {
      setBody(preparedFor(mode.action, time, lang, on, includeNote));
      void requestAiDraft(mode.action, time, lang, on, includeNote);
    }
  };
  const changeNote = (on: boolean) => {
    setIncludeNote(on);
    if (mode && !edited) {
      setBody(preparedFor(mode.action, time, lang, includeFee, on));
      void requestAiDraft(mode.action, time, lang, includeFee, on);
    }
  };

  const parsedTime = parseHostTime(time);
  const approving = mode?.action === "approve";
  const wrongSide = approving && parsedTime ? timeOnRightSide(d.kind, parsedTime, d.standardTime) === false : false;
  const needsTime = approving && textCapable && !parsedTime;
  // Kod metni kurulamadı (konaklama günü / standart saat bilinmiyor): ev sahibi yazar — boş ya da tahminli metin önerilmez.
  const noDraft = mode !== null && textCapable && !edited && !body.trim() && !draftFor(mode.action, time, lang, includeFee, includeNote);
  const timeMissingInBody = approving && textCapable && edited && parsedTime !== null && body.trim() !== "" && !bodyMentionsTime(body, parsedTime);
  // Ev sahibi düzenleyiciyi açtıktan sonra misafir yeniden yazdı / kontrol listesi değişti (sayfa yenilendi).
  const laterDrift = seen !== null && d.laterGuestMessageId !== seen.later;
  const factsDrift = seen !== null && d.factsHash !== seen.hash;
  const drift = mode !== null && (laterDrift || factsDrift);

  const acknowledge = () => {
    setSeen({ later: notice?.latestMessageId ?? d.laterGuestMessageId, hash: d.factsHash });
    if (factsDrift) setShowAll(true);
    setNotice(null);
    if (mode && !edited) {
      setBody(draftFor(mode.action, time, lang, includeFee, includeNote));
      void requestAiDraft(mode.action, time, lang, includeFee, includeNote);
    }
  };

  const statusIcon = d.unverified ? (
    <MessageSquareWarning className="size-4 shrink-0 text-destructive" aria-hidden="true" />
  ) : d.sending ? (
    <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
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
      const json = (await res.json().catch(() => ({}))) as {
        code?: string;
        error?: string;
        latestMessageId?: string;
        version?: number;
        queued?: boolean;
        problems?: string[];
      };
      if (typeof json.version === "number") setVersion(json.version);
      if (res.ok) return { ok: true as const, queued: json.queued === true };
      return {
        ok: false as const,
        status: res.status,
        code: json.code,
        error: json.error,
        latestMessageId: json.latestMessageId,
        problems: Array.isArray(json.problems) ? json.problems.filter((p): p is string => typeof p === "string") : undefined,
      };
    } catch {
      return { ok: false as const, status: 0, error: "Bağlantı hatası. Lütfen tekrar deneyin." };
    } finally {
      setBusy(false);
    }
  }

  async function send(force = false) {
    if (!mode || !seen) return;
    const r = await post({
      action: mode.action,
      body,
      edited,
      lang,
      includeFee,
      includeNote,
      ...(force ? { force: true } : {}),
      factsHash: seen.hash,
      ...(approving && parsedTime ? { time: parsedTime } : {}),
      ...(seen.later ? { seenMessageId: seen.later } : {}),
    });
    if (r.ok) {
      toast.success(r.queued ? "Mesajınız sıraya alındı — birazdan gönderilecek." : "Mesajınız misafire gönderildi.");
      setMode(null);
      setSeen(null);
      router.refresh();
      return;
    }
    if (r.code === "text_mismatch") {
      // Metin karar kaydıyla uyuşmuyor (saat / gün / ücret…): ev sahibi düzeltir ya da bilerek "Yine de gönder" der.
      setNotice({ tone: "warn", text: r.error ?? "Mesaj karar kaydınızla uyuşmuyor.", problems: r.problems ?? [] });
      return;
    }
    if (r.code === "guest_wrote_again") {
      // Yeni mesaj konuşmada görünsün; "Okudum" sonrası gönderim o mesajı gördüğünü bildirir. Yazılan metin kaybolmaz.
      setNotice({ tone: "warn", text: r.error ?? "Misafir bu talepten sonra yeniden yazdı.", latestMessageId: r.latestMessageId });
      router.refresh();
      return;
    }
    if (r.code === "facts_changed") {
      // Kontrol listesi tazelenir; düzenleyici AÇIK kalır — ev sahibi yeni satırlara bakıp "Okudum" der ve tekrar gönderir.
      setNotice({ tone: "warn", text: r.error ?? "Bu talebin kontrol listesi değişti; güncel hâline bakın." });
      setShowAll(true);
      router.refresh();
      return;
    }
    if (r.code === "stale" || r.code === "expired" || r.code === "reservation_cancelled" || r.code === "send_unverified") {
      toast.error(r.error ?? "Bu kart az önce değişti.");
      setMode(null);
      setSeen(null);
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
  const linesId = `${ids}-lines`;
  const blocked = busy || !body.trim() || needsTime || wrongSide || drift || !!notice?.latestMessageId;

  return (
    <article
      aria-labelledby={titleId}
      aria-busy={busy || d.sending}
      className={cn(
        "rounded-xl border bg-card p-3 shadow-sm sm:p-4",
        d.unverified
          ? "border-destructive/40"
          : d.open
            ? "border-amber-300 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/5"
            : "border-border",
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
          <p className="mt-0.5 text-xs text-muted-foreground">{[d.dayLabel, `talep: ${d.askedAt}`].filter(Boolean).join(" · ")}</p>
        </div>
        {readOnly || d.sending ? null : (
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
            {d.unverified ? (
              <Button size="sm" variant="outline" onClick={dismiss} disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                Kontrol ettim, kapat
              </Button>
            ) : textCapable ? (
              <>
                <Button
                  size="sm"
                  onClick={() => open("approve")}
                  disabled={busy}
                  aria-expanded={mode?.action === "approve"}
                  aria-controls={editorId}
                >
                  <CheckCircle2 className="size-4" aria-hidden="true" /> Onayla
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => open("decline")}
                  disabled={busy}
                  aria-expanded={mode?.action === "decline"}
                  aria-controls={editorId}
                >
                  <XCircle className="size-4" aria-hidden="true" /> Reddet
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
                  setSeen(null);
                }}
                disabled={busy}
                aria-expanded={confirmDismiss}
              >
                Kartı kapat
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
            Karar mesajının gönderimi doğrulanamadı — misafire ulaşmış olabilir. Konuşmayı kanaldan kontrol edin; ulaşmadıysa misafire
            buradan yazın.
          </p>
        ) : d.open ? (
          <p className="text-xs text-muted-foreground">Bu talebe henüz cevap verilmedi; karar sizin.</p>
        ) : (
          <p className="text-xs text-muted-foreground">Bu talepten sonra konuşmaya siz yazdınız; talep sonuçlandıysa kartı kapatın.</p>
        )}
        {d.laterGuestMessageId && !d.unverified && !d.sending ? (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Misafir bu talepten sonra yeniden yazdı — göndermeden önce son mesajı okuyun.
          </p>
        ) : null}
        {!textCapable && !d.unverified && !d.sending ? (
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
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Evet, kapat
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
            <LineList id={linesId} lines={d.lines} />
          ) : failing.length > 0 ? (
            <>
              <p className="text-xs font-medium">Bakmanız gerekenler</p>
              <LineList lines={failing} />
            </>
          ) : null}
          <button
            type="button"
            className="inline-flex min-h-6 items-center gap-1 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            onClick={() => setShowAll((v) => !v)}
            aria-expanded={showAll}
            aria-controls={linesId}
          >
            {showAll ? <ChevronUp className="size-3.5" aria-hidden="true" /> : <ChevronDown className="size-3.5" aria-hidden="true" />}
            {showAll
              ? "Kontrol listesini kısalt"
              : failing.length > 0
                ? `Kontrol listesinin tamamı (${d.lines.length})`
                : `Kontrol listesi: hepsi uygun (${d.lines.length})`}
          </button>
        </div>
      ) : null}

      {mode && !readOnly ? (
        <div id={editorId} ref={editorRef} className="mt-3 space-y-2 rounded-lg border border-border bg-background p-3" aria-live="polite">
          <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-end">
            {approving && textCapable ? (
              <div className="space-y-1 text-xs font-medium">
                <label className="block" htmlFor={`${ids}-time`}>
                  {d.kind === "early_checkin" ? "Giriş saati" : "Çıkış saati"}
                </label>
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
              </div>
            ) : null}
            <div className="space-y-1 text-xs font-medium">
              <label className="block" htmlFor={`${ids}-lang`}>
                Mesajın dili
              </label>
              <Select id={`${ids}-lang`} value={lang} onChange={(e) => changeLang(e.target.value as DecisionLang)} className="h-9 sm:w-40">
                {DECISION_LANGS.map((l) => (
                  <option key={l} value={l}>
                    {DECISION_LANG_LABELS_TR[l]}
                  </option>
                ))}
              </Select>
            </div>
            {approving && d.kind === "early_checkin" && d.fee ? (
              <label className="flex items-center gap-2 text-xs font-medium sm:pb-2">
                <input type="checkbox" className="size-4 rounded border-input" checked={includeFee} onChange={(e) => changeFee(e.target.checked)} />
                Ücreti mesaja ekle
              </label>
            ) : null}
            {approving && d.kind === "early_checkin" && d.note ? (
              <label className="flex items-center gap-2 text-xs font-medium sm:pb-2">
                <input type="checkbox" className="size-4 rounded border-input" checked={includeNote} onChange={(e) => changeNote(e.target.checked)} />
                Notu ekle
              </label>
            ) : null}
          </div>
          {wrongSide ? (
            <p className="text-xs text-amber-700 dark:text-amber-300" role="alert">
              {d.kind === "early_checkin"
                ? `Bu saat standart giriş saatinizden (${d.standardTime}) erken değil; başka bir saat seçin.`
                : `Bu saat standart çıkış saatinizden (${d.standardTime}) geç değil; başka bir saat seçin.`}
            </p>
          ) : null}
          <div className="space-y-1 text-xs font-medium">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor={`${ids}-body`}>Misafire gidecek mesaj</label>
              {edited && textCapable ? (
                confirmReset ? (
                  <span className="flex items-center gap-2 font-normal">
                    <span>Düzenlemeleriniz silinsin mi?</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (!mode) return;
                        setBody(preparedFor(mode.action, time, lang, includeFee, includeNote));
                        setEdited(false);
                        setConfirmReset(false);
                      }}
                    >
                      Evet
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmReset(false)}>
                      Vazgeç
                    </Button>
                  </span>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setConfirmReset(true)}>
                    Hazır metne dön
                  </Button>
                )
              ) : null}
            </div>
            <Textarea
              id={`${ids}-body`}
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                setEdited(true);
                if (notice?.problems) setNotice(null);
              }}
              rows={3}
              maxLength={10000}
              placeholder={noDraft ? "Mesajı siz yazın." : undefined}
            />
          </div>
          {aiText && textCapable && mode && !edited ? (
            <p className="text-xs text-muted-foreground" data-testid="decision-ai-caption">
              {aiLoading
                ? "Yapay zekâ mesajı yazıyor…"
                : aiDraft?.source === "ai" && aiDraft.key === draftKey(mode.action, time, lang, includeFee, includeNote)
                  ? "Mesajı yapay zekâ yazdı; saat, gün ve ücret karar kaydıyla kontrol edildi. Göndermeden önce okuyun."
                  : null}
            </p>
          ) : null}
          {noDraft ? (
            <p className="text-xs text-muted-foreground">
              {needsTime ? "Saati seçtiğinizde metin hazırlanır." : "Bu talep için hazır metin kurulamadı (konaklama günü bilinmiyor); mesajı siz yazın."}
            </p>
          ) : null}
          {timeMissingInBody ? (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Mesajda seçtiğiniz saat ({parsedTime}) geçmiyor; misafir saati yanlış anlamasın.
            </p>
          ) : null}
          {approving && d.kind === "early_checkin" && d.fee && includeFee ? (
            <p className="text-xs text-muted-foreground">Ücret, mülk sayfasındaki erken giriş kuralınızdan alındı.</p>
          ) : null}
          {approving && d.kind === "early_checkin" && d.note && includeNote ? (
            <p className="text-xs text-muted-foreground">Erken giriş kuralınızdaki not olduğu gibi eklenir (çevrilmez).</p>
          ) : null}
          {approving && d.kind === "late_checkout" ? (
            <p className="text-xs text-muted-foreground">Hazır metin ücret içermez; geç çıkış için ücret alıyorsanız mesaja ekleyin.</p>
          ) : null}
          {drift || notice?.latestMessageId ? (
            <div
              className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300"
              role="alert"
            >
              {laterDrift || notice?.latestMessageId
                ? "Misafir bu talepten sonra yeniden yazdı — son mesajı okuyun."
                : "Bu talebin kontrol listesi siz baktıktan sonra değişti — güncel hâline bakın."}
              <div className="mt-2">
                <Button size="sm" variant="outline" onClick={acknowledge} disabled={busy}>
                  Okudum
                </Button>
              </div>
            </div>
          ) : notice ? (
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
              {notice.problems && notice.problems.length > 0 ? (
                <>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {notice.problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                  <div className="mt-2">
                    <Button size="sm" variant="outline" onClick={() => send(true)} disabled={busy || !body.trim()}>
                      Yine de gönder
                    </Button>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => send()} disabled={blocked}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Misafire gönder
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setMode(null);
                setSeen(null);
                setNotice(null);
              }}
              disabled={busy}
            >
              Vazgeç
            </Button>
          </div>
        </div>
      ) : null}

      {readOnly ? <p className="mt-2 text-xs text-muted-foreground">Destek görünümü salt okunur.</p> : null}
    </article>
  );
}
