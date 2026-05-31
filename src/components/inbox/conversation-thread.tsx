"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  Send,
  Loader2,
  AlertTriangle,
  Bot,
  Wand2,
  MessageSquarePlus,
  CheckCheck,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CONVERSATION_STATUS, PRIORITY, REPLY_TONE, type ReplyTone } from "@/lib/constants";
import { cn } from "@/lib/utils";

export interface ThreadMessage {
  id: string;
  direction: "inbound" | "outbound";
  senderName: string;
  body: string;
  createdAtLabel: string;
}

interface Suggestion {
  intent: string;
  confidence: number;
  reply: string;
  risk: string | null;
  source: "openai" | "fallback";
  actionSuggestion?: string | null;
  riskLevel?: "none" | "low" | "medium" | "high";
  detectedLanguage?: string;
}

interface Props {
  conversationId: string;
  messages: ThreadMessage[];
  status: string;
  priority: string;
}

function confidenceTone(c: number) {
  if (c >= 0.6) return "bg-success";
  if (c >= 0.4) return "bg-warning";
  return "bg-destructive";
}

export function ConversationThread({ conversationId, messages, status, priority }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [composer, setComposer] = useState("");
  const [tone, setTone] = useState<ReplyTone>("warm");
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showSimulate, setShowSimulate] = useState(false);
  const [simulateText, setSimulateText] = useState("");
  const [simulating, setSimulating] = useState(false);

  const refresh = () => startTransition(() => router.refresh());

  async function handleSuggest() {
    setSuggestLoading(true);
    setSuggestion(null);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/ai-suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tone }),
      });
      const data = await res.json();
      if (res.ok) setSuggestion(data);
    } finally {
      setSuggestLoading(false);
    }
  }

  async function sendReply(body: string) {
    if (!body.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (res.ok) {
        setComposer("");
        setSuggestion(null);
        refresh();
      }
    } finally {
      setSending(false);
    }
  }

  async function changeField(field: "status" | "priority", value: string) {
    setBusy(true);
    await fetch(`/api/conversations/${conversationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    setBusy(false);
    refresh();
  }

  async function simulateInbound() {
    if (!simulateText.trim()) return;
    setSimulating(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: simulateText }),
      });
      if (res.ok) {
        setSimulateText("");
        setShowSimulate(false);
        setSuggestion(null);
        refresh();
      }
    } finally {
      setSimulating(false);
    }
  }

  return (
    <div className="flex flex-col rounded-xl border border-border bg-card">
      {/* Header: status & priority controls */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Durum</span>
          <Select
            value={status}
            disabled={busy}
            onChange={(e) => changeField("status", e.target.value)}
            className="h-8 w-36 text-xs"
          >
            {CONVERSATION_STATUS.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Öncelik</span>
          <Select
            value={priority}
            disabled={busy}
            onChange={(e) => changeField("priority", e.target.value)}
            className="h-8 w-28 text-xs"
          >
            {PRIORITY.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        <Badge tone={CONVERSATION_STATUS.tone(status)} className="ml-auto">
          {CONVERSATION_STATUS.label(status)}
        </Badge>
      </div>

      {/* Messages */}
      <div className="scrollbar-thin max-h-[44vh] space-y-3 overflow-y-auto p-4">
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn("flex flex-col", m.direction === "outbound" ? "items-end" : "items-start")}
          >
            <div
              className={cn(
                "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm",
                m.direction === "outbound"
                  ? "rounded-br-sm bg-primary text-primary-foreground"
                  : "rounded-bl-sm bg-muted text-foreground",
              )}
            >
              {m.body}
            </div>
            <span className="mt-1 px-1 text-[11px] text-muted-foreground">
              {m.senderName} · {m.createdAtLabel}
            </span>
          </div>
        ))}
      </div>

      <Separator />

      {/* AI suggestion */}
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={handleSuggest} disabled={suggestLoading} size="sm">
            {suggestLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            AI cevap öner
          </Button>
          <Select
            value={tone}
            onChange={(e) => setTone(e.target.value as ReplyTone)}
            className="h-9 w-32 text-xs"
            aria-label="Ton"
          >
            {REPLY_TONE.options.map((o) => (
              <option key={o.value} value={o.value}>
                Ton: {o.label}
              </option>
            ))}
          </Select>
          <button
            type="button"
            onClick={() => setShowSimulate((s) => !s)}
            className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <MessageSquarePlus className="size-3.5" />
            Misafir mesajı simüle et
          </button>
        </div>

        {showSimulate ? (
          <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
            <p className="text-xs text-muted-foreground">
              Test amaçlı: gelen bir misafir mesajı ekleyin (AI sınıflandırması/eskalasyon çalışır).
            </p>
            <Textarea
              value={simulateText}
              onChange={(e) => setSimulateText(e.target.value)}
              placeholder="Örn. Klima çalışmıyor, çok sıcak!"
              className="min-h-[60px]"
            />
            <div className="flex justify-end">
              <Button size="sm" variant="secondary" onClick={simulateInbound} disabled={simulating}>
                {simulating ? <Loader2 className="size-4 animate-spin" /> : null}
                Misafir mesajı ekle
              </Button>
            </div>
          </div>
        ) : null}

        {suggestion ? (
          <div className="space-y-3 rounded-lg border border-primary/30 bg-accent/40 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                <Bot className="size-4 text-primary" /> AI Önerisi
              </span>
              <Badge tone={suggestion.source === "openai" ? "default" : "muted"}>
                {suggestion.source === "openai" ? "OpenAI" : "Şablon"}
              </Badge>
              <Badge tone="secondary">{suggestion.intent}</Badge>
              {suggestion.riskLevel && suggestion.riskLevel !== "none" ? (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                    suggestion.riskLevel === "low" && "bg-yellow-100 text-yellow-800",
                    suggestion.riskLevel === "medium" && "bg-orange-100 text-orange-800",
                    suggestion.riskLevel === "high" && "bg-red-100 text-red-800",
                  )}
                >
                  <AlertTriangle className="size-3" />
                  {suggestion.riskLevel === "low" ? "Düşük Risk" : suggestion.riskLevel === "medium" ? "Orta Risk" : "Yüksek Risk"}
                </span>
              ) : null}
              {suggestion.detectedLanguage && suggestion.detectedLanguage !== "tr" ? (
                <span className="text-xs text-muted-foreground">
                  Dil: {suggestion.detectedLanguage.toUpperCase()}
                </span>
              ) : null}
              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  Güven %{Math.round(suggestion.confidence * 100)}
                </span>
                <div className="h-1.5 w-20 overflow-hidden rounded-full bg-border">
                  <div
                    className={cn("h-full", confidenceTone(suggestion.confidence))}
                    style={{ width: `${Math.round(suggestion.confidence * 100)}%` }}
                  />
                </div>
              </div>
            </div>

            {suggestion.risk ? (
              <p className="flex items-start gap-2 rounded-md bg-warning/15 px-2.5 py-2 text-xs text-amber-700">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {suggestion.risk}
              </p>
            ) : null}

            {suggestion.actionSuggestion ? (
              <p className="flex items-start gap-2 rounded-md bg-blue-50 px-2.5 py-2 text-xs text-blue-800">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                <span><span className="font-medium">Operatör için:</span> {suggestion.actionSuggestion}</span>
              </p>
            ) : null}

            <p className="whitespace-pre-wrap rounded-md bg-card p-3 text-sm">{suggestion.reply}</p>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setComposer(suggestion.reply)}>
                <Wand2 className="size-4" /> Taslağı kullan
              </Button>
              <Button size="sm" onClick={() => sendReply(suggestion.reply)} disabled={sending}>
                {sending ? <Loader2 className="size-4 animate-spin" /> : <CheckCheck className="size-4" />}
                Onayla ve gönder
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <Separator />

      {/* Composer */}
      <div className="space-y-2 p-4">
        <Textarea
          value={composer}
          onChange={(e) => setComposer(e.target.value)}
          placeholder="Cevabınızı yazın veya AI önerisini kullanın..."
          className="min-h-[80px]"
        />
        <div className="flex justify-end">
          <Button onClick={() => sendReply(composer)} disabled={sending || !composer.trim()}>
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Gönder
          </Button>
        </div>
      </div>
    </div>
  );
}
