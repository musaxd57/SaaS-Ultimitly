"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Role = "guest" | "ai" | "host";
interface ChatMessage {
  id: string;
  role: Role;
  text: string;
}

/**
 * Public guest concierge chat UI (mobile-first). Two-way: it loads the stay's
 * thread, polls for new messages, and shows three distinct senders —
 *   • Misafir (the guest)        → right, primary
 *   • Lixus AI (the bot)         → left, grey card
 *   • Ev sahibiniz (the human)   → left, green
 * No PII or access codes are shown here; the access codes live in the
 * Airbnb-native check-in flow, never on this public surface.
 */
export function GuestChat({ token, propertyName }: { token: string; propertyName: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [closed, setClosed] = useState(false);
  // The stay's chat is already open on ANOTHER device (per-stay device binding):
  // this device may not read the history or send. Prevents a past guest / cleaner
  // holding the QR photo from reading the current guest's conversation.
  const [boundElsewhere, setBoundElsewhere] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // Monotonic load counter (drop stale snapshots) + a live "sending" flag the
  // poll reads to avoid clobbering the optimistic bubble mid-send.
  const loadSeq = useRef(0);
  const sendingRef = useRef(false);

  const loadHistory = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const res = await fetch(`/api/chat/${token}`, { method: "GET" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        open?: boolean;
        boundElsewhere?: boolean;
        messages?: ChatMessage[];
      };
      // Drop a stale snapshot: if a newer load was issued while this one was in
      // flight (e.g. the post-send refresh), applying this older response would
      // wipe the just-sent message / AI reply off-screen for up to a poll cycle.
      if (seq !== loadSeq.current) return;
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
    try {
      const res = await fetch(`/api/chat/${token}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok) {
        rollback();
        // error kept in dedicated state so a background poll can't wipe it
        setError("Şu an yanıt veremiyorum. Lütfen biraz sonra tekrar deneyin.");
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { boundElsewhere?: boolean };
      if (data.boundElsewhere) {
        // This device isn't the one that claimed the stay — nothing was sent.
        rollback();
        setBoundElsewhere(true);
        return;
      }
      await loadHistory();
    } catch {
      rollback();
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col bg-background">
      <header className="border-b border-border bg-card px-4 py-3">
        <p className="text-sm font-semibold">{propertyName}</p>
        <p className="text-xs text-muted-foreground">Misafir yardımı · yapay zekâ + ev sahibi</p>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !closed && !boundElsewhere ? (
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            Merhaba! 👋 Konaklamanızla ilgili sorularınızı (çöp günü, cihazlar, kurallar, çevre
            önerileri…) buraya yazabilirsiniz. Yapay zekâ yanıtlar; gerekirse ev sahibiniz devreye girer.
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

        {messages.map((m) => {
          const guest = m.role === "guest";
          const host = m.role === "host";
          return (
            <div key={m.id} className={guest ? "flex justify-end" : "flex justify-start"}>
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
                    {host ? "👤 Ev sahibiniz" : "🤖 Lixus AI"}
                  </p>
                ) : null}
                <p className="whitespace-pre-wrap break-words">{m.text}</p>
              </div>
            </div>
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
