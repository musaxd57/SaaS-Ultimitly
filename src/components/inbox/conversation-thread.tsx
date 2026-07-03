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
  CheckCheck,
  Info,
  FileText,
  Languages,
  ChevronDown,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CONVERSATION_STATUS, PRIORITY, REPLY_TONE, type ReplyTone } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { intentLabel, langLabel, displaySenderName, riskTypeLabel, sourceLabel } from "@/lib/ui-labels";

export interface ThreadMessage {
  id: string;
  direction: "inbound" | "outbound";
  senderName: string;
  body: string;
  createdAtLabel: string;
}

interface TemplateItem {
  id: string;
  title: string;
  body: string;
  category: string;
  language: string;
  isDefault?: boolean;
}

interface Suggestion {
  intent: string;
  confidence: number;
  reply: string;
  risk: string | null;
  source: "openai" | "fallback";
  actionSuggestion?: string | null;
  riskLevel?: "none" | "low" | "medium" | "high";
  riskType?: string | null;
  usedSources?: string[];
  missingInfo?: string[];
  detectedLanguage?: string;
}

interface Props {
  conversationId: string;
  messages: ThreadMessage[];
  status: string;
  priority: string;
  propertyId?: string;
  /** Values used to substitute {{placeholders}} in message templates. */
  templateVars?: Record<string, string>;
  /** Owner/manager may send guest replies; staff get a read-only thread. */
  canReply?: boolean;
}

export function ConversationThread({ conversationId, messages, status, priority, propertyId, templateVars, canReply = true }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [composer, setComposer] = useState("");
  const [tone, setTone] = useState<ReplyTone>("warm");
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Template picker state
  const [showTemplates, setShowTemplates] = useState(false);
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState(false);

  // Translate state: messageId -> translated text
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [translatingId, setTranslatingId] = useState<string | null>(null);

  const refresh = () => startTransition(() => router.refresh());

  // The guest spoke last and is waiting — the moment to nudge "let AI answer".
  const awaitingReply = messages[messages.length - 1]?.direction === "inbound";

  async function handleSuggest() {
    setSuggestLoading(true);
    setSuggestion(null);
    setSuggestError(null);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/ai-suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tone }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) setSuggestion(data);
      else setSuggestError(data?.error ?? "AI önerisi alınamadı. Lütfen tekrar deneyin.");
    } catch {
      setSuggestError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setSuggestLoading(false);
    }
  }

  async function sendReply(body: string, aiAssisted = false) {
    if (!body.trim()) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, aiAssisted }),
      });
      if (res.ok) {
        setComposer("");
        setSuggestion(null);
        refresh();
      } else {
        const data = await res.json().catch(() => null);
        setSendError(data?.error ?? "Mesaj gönderilemedi.");
      }
    } catch {
      setSendError("Mesaj gönderilemedi.");
    } finally {
      setSending(false);
    }
  }

  async function changeField(field: "status" | "priority", value: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) window.alert("Güncellenemedi. Yetkiniz yoksa yöneticinize danışın.");
      else refresh();
    } catch {
      window.alert("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  async function loadTemplates() {
    if (templates.length > 0) {
      setShowTemplates((s) => !s);
      return;
    }
    setTemplatesLoading(true);
    setTemplatesError(false);
    setShowTemplates(true);
    try {
      const url = propertyId
        ? `/api/templates?propertyId=${propertyId}`
        : "/api/templates";
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setTemplates(Array.isArray(data) ? data : []);
      } else {
        setTemplatesError(true);
      }
    } catch {
      setTemplatesError(true);
    } finally {
      setTemplatesLoading(false);
    }
  }

  function applyTemplate(t: TemplateItem) {
    let body = t.body;
    // Substitute {{placeholders}} with reservation/property values when available.
    if (templateVars) {
      for (const [key, value] of Object.entries(templateVars)) {
        if (value) body = body.split(`{{${key}}}`).join(value);
      }
      // Also accept the single-brace {isim}/{ad} tokens used by the automatic
      // messages, so a host doesn't have to learn two placeholder styles.
      const guest = templateVars.guestName;
      if (guest) body = body.split("{isim}").join(guest).split("{ad}").join(guest);
    }
    // Strip any remaining unfilled placeholders so guests never see raw {{...}}.
    body = body.replace(/\{\{[^}]+\}\}/g, "").replace(/\n{3,}/g, "\n\n").trim();
    setComposer(body);
    setShowTemplates(false);
  }

  async function translateMessage(messageId: string, body: string) {
    if (translations[messageId]) {
      // Toggle off
      setTranslations((prev) => {
        const next = { ...prev };
        delete next[messageId];
        return next;
      });
      return;
    }
    setTranslatingId(messageId);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/translate-message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, targetLanguage: "tr" }),
      });
      if (res.ok) {
        const data = await res.json();
        setTranslations((prev) => ({ ...prev, [messageId]: data.translation }));
      } else {
        window.alert("Çeviri yapılamadı. Lütfen tekrar deneyin.");
      }
    } catch {
      window.alert("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setTranslatingId(null);
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
                "max-w-[90%] sm:max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm",
                m.direction === "outbound"
                  ? "rounded-br-sm bg-primary text-primary-foreground"
                  : "rounded-bl-sm bg-muted text-foreground",
              )}
            >
              {m.body}
            </div>
            {/* Translate button for inbound messages */}
            {m.direction === "inbound" ? (
              <div className="mt-0.5 px-1">
                <button
                  type="button"
                  onClick={() => translateMessage(m.id, m.body)}
                  disabled={translatingId === m.id}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary"
                >
                  {translatingId === m.id ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Languages className="size-3" />
                  )}
                  {translations[m.id] ? "Çeviriyi gizle" : "Çevir"}
                </button>
                {translations[m.id] ? (
                  <p className="mt-1 rounded-md bg-blue-50 px-2 py-1 text-xs text-blue-800">
                    {translations[m.id]}
                  </p>
                ) : null}
              </div>
            ) : null}
            <span className="mt-1 px-1 text-[11px] text-muted-foreground">
              {displaySenderName(m.senderName)} · {m.createdAtLabel}
            </span>
          </div>
        ))}
      </div>

      <Separator />

      {/* AI suggestion */}
      <div className="space-y-3 p-4">
        {/* Nudge: when the guest is waiting and no draft yet, invite one-click AI.
            Only for users who can actually send (owner/manager); staff are read-only. */}
        {canReply && awaitingReply && !suggestion && !suggestLoading ? (
          <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-accent/40 p-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="size-4" />
            </span>
            <p className="flex-1 text-sm">
              <span className="font-medium">Misafir cevap bekliyor.</span>{" "}
              <span className="text-muted-foreground">
                AI saniyeler içinde sizin tonunuzla bir cevap hazırlasın — onaylayın ya da düzenleyin.
              </span>
            </p>
            <Button onClick={handleSuggest} disabled={suggestLoading} size="sm" className="shrink-0">
              <Sparkles className="size-4" /> AI ile cevapla
            </Button>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {canReply ? (
            <Button onClick={handleSuggest} disabled={suggestLoading} size="sm">
              {suggestLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              AI cevap öner
            </Button>
          ) : null}
          <Select
            value={tone}
            onChange={(e) => setTone(e.target.value as ReplyTone)}
            className="h-9 w-full sm:w-32 text-xs"
            aria-label="Ton"
          >
            {REPLY_TONE.options.map((o) => (
              <option key={o.value} value={o.value}>
                Ton: {o.label}
              </option>
            ))}
          </Select>

          {/* Template picker */}
          <div className="relative">
            <Button onClick={loadTemplates} disabled={templatesLoading} size="sm" variant="outline">
              {templatesLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FileText className="size-4" />
              )}
              Şablonlar
              <ChevronDown className="size-3.5 opacity-60" />
            </Button>
            {showTemplates ? (
              <div className="absolute left-0 top-full z-20 mt-1 max-h-80 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-lg">
                <div className="flex items-center justify-between px-2 py-1.5">
                  <span className="text-xs font-semibold text-muted-foreground">
                    Mesaj Şablonları
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowTemplates(false)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Kapat"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
                {templatesError ? (
                  <p className="p-3 text-xs text-destructive">
                    Şablonlar yüklenemedi. Lütfen tekrar deneyin.
                  </p>
                ) : templates.length === 0 ? (
                  <p className="p-3 text-xs text-muted-foreground">
                    Şablon bulunamadı. Şablonlar sayfasından ekleyebilirsiniz.
                  </p>
                ) : (
                  templates.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => applyTemplate(t)}
                      className="block w-full rounded-md px-2.5 py-2 text-left hover:bg-muted"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{t.title}</span>
                        <span className="shrink-0 text-[10px] uppercase text-muted-foreground">
                          {t.language}
                        </span>
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                        {t.body}
                      </span>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>

        </div>

        {suggestError ? (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {suggestError}
          </p>
        ) : null}

        {suggestion ? (
          <div className="space-y-3 rounded-lg border border-primary/30 bg-accent/40 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                <Bot className="size-4 text-primary" /> AI Önerisi
              </span>
              <Badge tone="secondary">{intentLabel(suggestion.intent)}</Badge>
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
                  Dil: {langLabel(suggestion.detectedLanguage)}
                </span>
              ) : null}
              <span
                className={cn(
                  "ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                  suggestion.confidence >= 0.75
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-amber-100 text-amber-800",
                )}
              >
                {suggestion.confidence >= 0.75 ? "AI bundan emin" : "AI emin değil — gözden geçirin"}
              </span>
            </div>

            {riskTypeLabel(suggestion.riskType) ? (
              <p className="flex items-start gap-2 rounded-md bg-orange-50 px-2.5 py-2 text-xs text-orange-800">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span><span className="font-medium">İnsan incelemesi:</span> {riskTypeLabel(suggestion.riskType)}</span>
              </p>
            ) : null}

            {suggestion.usedSources && suggestion.usedSources.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">Dayanak:</span>{" "}
                {suggestion.usedSources.map(sourceLabel).join(" · ")}
              </p>
            ) : null}
            {suggestion.missingInfo && suggestion.missingInfo.length > 0 ? (
              <p className="text-xs text-amber-700">
                <span className="font-medium">Eksik bilgi:</span> {suggestion.missingInfo.join(" · ")}
              </p>
            ) : null}

            {suggestion.risk ? (
              <p className="flex items-start gap-2 rounded-md bg-warning/15 px-2.5 py-2 text-xs text-amber-700">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {suggestion.risk}
              </p>
            ) : null}

            {suggestion.actionSuggestion ? (
              <p className="flex items-start gap-2 rounded-md bg-blue-50 px-2.5 py-2 text-xs text-blue-800">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                <span><span className="font-medium">Sizin için not:</span> {suggestion.actionSuggestion}</span>
              </p>
            ) : null}

            <p className="whitespace-pre-wrap rounded-md bg-card p-3 text-sm">{suggestion.reply}</p>

            {canReply ? (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setComposer(suggestion.reply)}>
                  <Wand2 className="size-4" /> Taslağı kullan
                </Button>
                <Button size="sm" onClick={() => sendReply(suggestion.reply, true)} disabled={sending}>
                  {sending ? <Loader2 className="size-4 animate-spin" /> : <CheckCheck className="size-4" />}
                  Onayla ve gönder
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <Separator />

      {/* Composer — owner/manager only; staff see a read-only thread. */}
      {canReply ? (
        <div className="space-y-2 p-4">
          <Textarea
            value={composer}
            onChange={(e) => setComposer(e.target.value)}
            placeholder="Cevabınızı yazın veya AI önerisini kullanın..."
            className="min-h-[80px]"
          />
          {sendError ? (
            <p className="flex items-start gap-2 rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {sendError}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button onClick={() => sendReply(composer)} disabled={sending || !composer.trim()}>
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Gönder
            </Button>
          </div>
        </div>
      ) : (
        <p className="p-4 text-xs text-muted-foreground">
          Misafire yanıt gönderme yetkisi yalnızca sahip/yönetici rolündedir.
        </p>
      )}
    </div>
  );
}
