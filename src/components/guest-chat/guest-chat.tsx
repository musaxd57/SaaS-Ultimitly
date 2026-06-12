"use client";

import { useEffect, useRef, useState } from "react";

interface ChatMessage {
  role: "guest" | "ai";
  text: string;
  escalated?: boolean;
}

/**
 * Public guest concierge chat UI. Mobile-first (guests are on phones in the
 * apartment). Posts to /api/chat/[token]; the server decides whether to answer
 * or escalate. No PII is collected here and no secrets are shown — access codes
 * live in the Airbnb-native check-in flow, never on this public surface.
 */
export function GuestChat({ token, propertyName }: { token: string; propertyName: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Optional call — scrollIntoView is absent in some environments (e.g. jsdom).
    endRef.current?.scrollIntoView?.({ behavior: "smooth" });
  }, [messages, loading]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setMessages((m) => [...m, { role: "guest", text }]);
    setLoading(true);
    try {
      const res = await fetch(`/api/chat/${token}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok) {
        setMessages((m) => [
          ...m,
          { role: "ai", text: "Şu an yanıt veremiyorum. Lütfen biraz sonra tekrar deneyin." },
        ]);
        return;
      }
      const data = (await res.json()) as { reply?: string; escalated?: boolean };
      setMessages((m) => [
        ...m,
        { role: "ai", text: data.reply ?? "Anlayamadım, tekrar yazar mısınız?", escalated: data.escalated },
      ]);
    } catch {
      setMessages((m) => [...m, { role: "ai", text: "Bağlantı hatası. Lütfen tekrar deneyin." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col bg-background">
      <header className="border-b border-border bg-card px-4 py-3">
        <p className="text-sm font-semibold">{propertyName}</p>
        <p className="text-xs text-muted-foreground">Misafir yardımı · yapay zekâ asistanı</p>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            Merhaba! 👋 Konaklamanızla ilgili sorularınızı (çöp günü, cihazlar, kurallar, çevre
            önerileri…) buraya yazabilirsiniz. Yanıtlayamadığımız bir şey olursa ev sahibine iletiriz.
          </div>
        ) : null}

        {messages.map((m, i) => (
          <div key={i} className={m.role === "guest" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                m.role === "guest"
                  ? "max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground"
                  : "max-w-[85%] rounded-2xl rounded-bl-sm border border-border bg-card px-3 py-2 text-sm"
              }
            >
              <p className="whitespace-pre-wrap break-words">{m.text}</p>
              {m.escalated ? (
                <p className="mt-1 text-[11px] text-muted-foreground">Ev sahibine iletildi ✓</p>
              ) : null}
            </div>
          </div>
        ))}

        {loading ? (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
              yazıyor…
            </div>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

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
          disabled={loading || !input.trim()}
          className="inline-flex h-10 shrink-0 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          Gönder
        </button>
      </form>

      <footer className="bg-card px-4 pb-4 text-center text-[11px] text-muted-foreground">
        Otomatik asistan. Kapı kodu/Wi-Fi gibi bilgiler güvenlik için burada paylaşılmaz.{" "}
        <a href="/gizlilik" className="underline">
          Gizlilik
        </a>
      </footer>
    </div>
  );
}
