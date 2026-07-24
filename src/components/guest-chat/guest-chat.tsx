"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";

type Role = "guest" | "ai" | "host" | "resume";
interface ChatMessage {
  id: string;
  role: Role;
  text: string;
}

// Guest-facing title. Deliberately a FIXED brand string, never the internal
// Property.name — that name is the host's private label (often an owner name or
// informal code, e.g. "Serdar'ı Ekrem 2") and must not leak onto this public,
// unauthenticated QR page. The guest is physically in the unit, so no
// per-property label is needed to orient them.
const GUEST_ASSISTANT_TITLE = "Lixus AI Misafir Asistanı";

/**
 * Public guest concierge chat UI (mobile-first). Two-way: it loads the stay's
 * thread, polls for new messages, and shows three distinct senders —
 *   • Misafir (the guest)        → right, primary
 *   • Lixus AI (the bot)         → left, grey card
 *   • İşletme ekibi (the human host) → left, green (never a personal name)
 * No PII or access codes are shown here; the access codes live in the
 * Airbnb-native check-in flow, never on this public surface.
 */
export function GuestChat({ token }: { token: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [closed, setClosed] = useState(false);
  // The stay's chat is already open on ANOTHER device (per-stay device binding):
  // this device may not read the history or send. Prevents a past guest / cleaner
  // holding the QR photo from reading the current guest's conversation.
  const [boundElsewhere, setBoundElsewhere] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // PIN gate (Faz 5): when the stay requires a host-provided code, the chat is
  // locked behind a PIN entry until this device unlocks it. `pinRequired` drives
  // the entry screen; once unlocked the server binds the device (cookie) and the
  // chat behaves normally.
  const [pinRequired, setPinRequired] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // Monotonic load counter (drop stale snapshots) + a live "sending" flag the
  // poll reads to avoid clobbering the optimistic bubble mid-send.
  const loadSeq = useRef(0);
  const sendingRef = useRef(false);
  // Per-composed-message idempotency id (Codex 07-24 #2, composer parity): a
  // connection-loss retry of the SAME text reuses one id, so the server dedupes
  // instead of recording the guest message + AI reply twice. Editing the text
  // mints a fresh id; a successful send clears it.
  const requestIdRef = useRef<{ id: string; text: string } | null>(null);

  const loadHistory = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const res = await fetch(`/api/chat/${token}`, { method: "GET" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        open?: boolean;
        boundElsewhere?: boolean;
        pinRequired?: boolean;
        messages?: ChatMessage[];
      };
      // Drop a stale snapshot: if a newer load was issued while this one was in
      // flight (e.g. the post-send refresh), applying this older response would
      // wipe the just-sent message / AI reply off-screen for up to a poll cycle.
      if (seq !== loadSeq.current) return;
      if (data.pinRequired) {
        setPinRequired(true);
        return;
      }
      setPinRequired(false);
      if (data.boundElsewhere) {
        setBoundElsewhere(true);
        return;
      }
      setBoundElsewhere(false);
      if (data.open === false) {
        setClosed(true);
        return;
      }
      setClosed(false);
      if (Array.isArray(data.messages)) setMessages(data.messages);
    } catch {
      /* transient — the next poll retries */
    }
  }, [token]);

  useEffect(() => {
    void loadHistory();
    // Skip the poll while a send is in flight so its pre-message snapshot can't
    // overwrite the optimistic bubble; the post-send loadHistory refreshes it.
    const t = setInterval(() => { if (!sendingRef.current) void loadHistory(); }, 5000);
    return () => clearInterval(t);
  }, [loadHistory]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: "smooth" });
  }, [messages, sending]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setError(null);
    // optimistic guest bubble; the server fetch below replaces the list with the
    // authoritative version (guest message + AI reply) keyed by real ids.
    const tmpId = `tmp-${Date.now()}`;
    setMessages((m) => [...m, { id: tmpId, role: "guest", text }]);
    sendingRef.current = true;
    setSending(true);
    // On failure, roll back the optimistic bubble and restore the typed text so the
    // guest isn't left with a "sent"-looking message sitting next to an error.
    const rollback = () => {
      setMessages((m) => m.filter((x) => x.id !== tmpId));
      setInput(text);
    };
    // Same text (a retry after a failure) reuses the id; new/edited text mints
    // a fresh one — a deliberate identical follow-up gets a new id too, because
    // a successful send clears the ref below.
    const cur = requestIdRef.current;
    if (!cur || cur.text !== text) {
      requestIdRef.current = { id: crypto.randomUUID(), text };
    }
    const requestId = (requestIdRef.current as { id: string }).id;
    try {
      const res = await fetch(`/api/chat/${token}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, requestId }),
      });
      if (!res.ok) {
        rollback();
        // error kept in dedicated state so a background poll can't wipe it
        setError("Şu an yanıt veremiyorum. Lütfen biraz sonra tekrar deneyin.");
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        boundElsewhere?: boolean;
        pinRequired?: boolean;
      };
      if (data.pinRequired) {
        // The stay needs the host's code (e.g. the device cookie lapsed) — send
        // nothing, drop back to the PIN entry screen. The id is KEPT: after the
        // unlock, re-sending the restored text is the same composed message.
        rollback();
        setPinRequired(true);
        return;
      }
      if (data.boundElsewhere) {
        // This device isn't the one that claimed the stay — nothing was sent.
        rollback();
        setBoundElsewhere(true);
        return;
      }
      requestIdRef.current = null; // delivered (or deduped) — next message is new
      await loadHistory();
    } catch {
      rollback();
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  async function submitPin() {
    const pin = pinInput.replace(/\D/g, "");
    if (pin.length < 4 || pinBusy) return;
    setPinBusy(true);
    setPinError(null);
    try {
      const res = await fetch(`/api/chat/${token}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        unlocked?: boolean;
        boundElsewhere?: boolean;
        locked?: boolean;
        retryAfter?: number;
        pinError?: boolean;
      };
      if (res.status === 429) {
        setPinError("Çok fazla deneme. Lütfen birkaç dakika sonra tekrar deneyin.");
        return;
      }
      if (data.unlocked) {
        setPinInput("");
        setPinRequired(false);
        await loadHistory();
        return;
      }
      if (data.boundElsewhere) {
        setPinRequired(false);
        setBoundElsewhere(true);
        return;
      }
      if (data.locked) {
        const mins = Math.max(1, Math.ceil((data.retryAfter ?? 0) / 60));
        setPinError(`Çok fazla hatalı deneme. ${mins} dakika sonra tekrar deneyin.`);
        return;
      }
      // pinError or anything else → one generic message (never reveals the code).
      setPinError("Kod hatalı. Ev sahibinizin verdiği giriş kodunu kontrol edin.");
    } catch {
      setPinError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setPinBusy(false);
    }
  }

  // PIN gate screen: shown until this device unlocks the stay with the host's code.
  if (pinRequired && !boundElsewhere && !closed) {
    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <div className="w-full max-w-xs space-y-4 rounded-lg border border-border bg-card p-6">
          <div>
            <p className="text-base font-semibold">{GUEST_ASSISTANT_TITLE}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Sohbeti başlatmak için ev sahibinizin size verdiği giriş kodunu girin.
            </p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitPin();
            }}
            className="space-y-3"
          >
            <input
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="Giriş kodu"
              autoFocus
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-center text-lg tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <button
              type="submit"
              disabled={pinBusy || pinInput.replace(/\D/g, "").length < 4}
              className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {pinBusy ? "Kontrol ediliyor…" : "Sohbeti aç"}
            </button>
          </form>
          {pinError ? <p className="text-sm text-destructive">{pinError}</p> : null}
          <p className="text-[11px] text-muted-foreground">
            Kodu bilmiyorsanız ev sahibinizle iletişime geçin.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col bg-background">
      <header className="border-b border-border bg-card px-4 py-3">
        <p className="text-sm font-semibold">{GUEST_ASSISTANT_TITLE}</p>
        {/* One-time disclosure — shown ONCE here, never repeated under each message. */}
        <p className="text-xs text-muted-foreground">
          Yanıtlar yapay zekâ tarafından hazırlanabilir. Gerektiğinde işletme ekibi görüşmeye katılabilir.
        </p>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !closed && !boundElsewhere ? (
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            Merhaba! 👋 Konaklamanızla ilgili sorularınızı (çöp günü, cihazlar, kurallar, çevre
            önerileri…) buraya yazabilirsiniz.
          </div>
        ) : null}

        {boundElsewhere ? (
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            Bu konaklama için sohbet başka bir cihazda başlatılmış. Güvenliğiniz için sohbet yalnızca ilk
            açılan cihazda görüntülenir. Yardıma ihtiyacınız varsa lütfen ev sahibinizle iletişime geçin.
          </div>
        ) : null}

        {closed ? (
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            Konaklamanız sona erdiği için sohbet kapandı. İyi günler dileriz!
          </div>
        ) : null}

        {messages.map((m, i) => {
          const guest = m.role === "guest";
          const host = m.role === "host";
          const resume = m.role === "resume";
          // Separators mark the handoff transitions: the team joining and the AI
          // being re-enabled. Derived from the sequence — n is tiny so the back-scan
          // is cheap. A host message starts a "team joined" run only when the previous
          // handoff marker was a resume (or there was none); a resume marker is
          // rendered as its own "AI re-enabled" line (no bubble).
          const prevMarker = [...messages.slice(0, i)].reverse().find((x) => x.role === "host" || x.role === "resume");
          const startsHostRun = host && (!prevMarker || prevMarker.role === "resume");
          const separator = resume
            ? "Lixus AI yeniden etkinleştirildi"
            : startsHostRun
              ? "İşletme ekibi görüşmeye katıldı"
              : null;
          return (
            <Fragment key={m.id}>
              {separator ? (
                <div className="my-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="h-px flex-1 bg-border" />
                  {separator}
                  <span className="h-px flex-1 bg-border" />
                </div>
              ) : null}
              {resume ? null : (
                <div className={guest ? "flex justify-end" : "flex justify-start"}>
                  <div
                    className={
                      guest
                        ? "max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground"
                        : host
                          ? "max-w-[85%] rounded-2xl rounded-bl-sm border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
                          : "max-w-[85%] rounded-2xl rounded-bl-sm border border-border bg-card px-3 py-2 text-sm"
                    }
                  >
                    {!guest ? (
                      <p
                        className={
                          host
                            ? "mb-0.5 text-[10px] font-semibold text-emerald-700"
                            : "mb-0.5 text-[10px] font-semibold text-muted-foreground"
                        }
                      >
                        {host ? "👥 İşletme ekibi" : "🤖 Lixus AI"}
                      </p>
                    ) : null}
                    <p className="whitespace-pre-wrap break-words">{m.text}</p>
                  </div>
                </div>
              )}
            </Fragment>
          );
        })}

        {sending ? (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
              🤖 Lixus AI yazıyor…
            </div>
          </div>
        ) : null}
        {error ? (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      {!closed && !boundElsewhere ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          className="flex items-end gap-2 border-t border-border bg-card p-3"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            maxLength={2000}
            placeholder="Sorunuzu yazın…"
            className="max-h-32 min-h-[40px] flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="inline-flex h-10 shrink-0 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            Gönder
          </button>
        </form>
      ) : null}

      <footer className="bg-card px-4 pb-4 text-center text-[11px] text-muted-foreground">
        Otomatik asistan + ev sahibi. Kapı kodu/Wi-Fi gibi bilgiler güvenlik için burada paylaşılmaz.{" "}
        <a href="/gizlilik" className="underline">
          Gizlilik
        </a>
      </footer>
    </div>
  );
}
