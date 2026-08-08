"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { FormError } from "@/components/form-error";
import { toast } from "@/lib/toast";
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
  PauseCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CONVERSATION_STATUS, PRIORITY, REPLY_TONE, type ReplyTone } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { intentLabel, langLabel, displaySenderName, riskTypeLabel, sourceLabel, displayableSources } from "@/lib/ui-labels";

export interface ThreadMessage {
  id: string;
  direction: "inbound" | "outbound";
  senderName: string;
  /** Reliable author classifier (drives the "Lixus AI" label); senderName is display. */
  authorType?: string | null;
  body: string;
  createdAtLabel: string;
  /**
   * Durable Outbox delivery state for an outbound message (#8/#3). Null when the
   * message was never routed through the outbox (legacy / direct-send path). When
   * set, a PERSISTENT badge is rendered so a queued/sending/unverified reply is
   * never mistaken for a delivered one — even after a page refresh.
   */
  outboxStatus?: string | null;
}

// Persistent, host-facing delivery labels for a message that went through the
// durable outbox. "sent" is the only state that means the guest actually received
// it; every other state must stay visually distinct from a normal delivered bubble.
const OUTBOX_STATUS_UI: Record<string, { label: string; className: string }> = {
  pending: { label: "Sırada — gönderilmeyi bekliyor", className: "bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  sending: { label: "Gönderiliyor…", className: "bg-blue-100 dark:bg-blue-500/15 text-blue-800 dark:text-blue-300" },
  sent: { label: "İletildi", className: "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300" },
  reconciling: { label: "Doğrulanıyor…", className: "bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  ambiguous: { label: "Doğrulanamadı — kontrol edin", className: "bg-orange-100 dark:bg-orange-500/15 text-orange-800 dark:text-orange-300" },
  review: { label: "Doğrulanamadı — inceleyin", className: "bg-orange-100 dark:bg-orange-500/15 text-orange-800 dark:text-orange-300" },
  failed: { label: "Gönderilemedi", className: "bg-red-100 dark:bg-red-500/15 text-red-800 dark:text-red-300" },
  // Hospitable subscription not active (402): parked, NOT lost — sends automatically once the
  // connection is restored (re-sync / reconnect). Distinct amber "paused" tone, not a red failure.
  blocked: { label: "Abonelik pasif — bağlantı gelince gönderilecek", className: "bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  canceled: { label: "İptal edildi — yerine yeni bir gönderim oluşturuldu", className: "bg-muted text-muted-foreground" },
};

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
  // Composed-message idempotency id — see sendReply (Codex 07-23). Payload'a
  // BAĞLI: gövde/aiAssisted değişirse YENİ id üretilir (aynı id + farklı içerik
  // sunucuda 409'dur — Codex r2 #3); aynı payload'ın retry'ı aynı id'yi taşır.
  const requestIdRef = useRef<{ id: string; body: string; aiAssisted: boolean } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [queuedNote, setQueuedNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * İşlem sonucu duyurusu (görünmez canlı bölge). `disabled` olan bir düğme/
   * seçim odağı KAYBETTİRİR (tarayıcı odağı <body>'ye atar), o yüzden hem
   * sonucu duyurmak hem odağı geri vermek gerekiyor — yoksa klavye kullanıcısı
   * "gönderdim mi, oldu mu?" bilmeden sayfanın başına düşüyor.
   * Toast kullanılmadı: durum/öncelik çok sık değişen kontroller, her seferinde
   * görsel bir kutu çıkarmak gürültü olurdu.
   */
  const [liveStatus, setLiveStatus] = useState<{ text: string; seq: number }>({
    text: "",
    seq: 0,
  });
  /**
   * Duyuruyu TETİKLER. Doğrudan `setState(metin)` yetmez: aynı metni tekrar
   * set etmek React'te no-op'tur (Object.is), DOM hiç değişmez ve `aria-live`
   * YALNIZ DOM değişiminde duyurur — yani art arda iki gönderimin ikincisi
   * SESSİZ kalırdı. Artan `seq` her seferinde canlı bölgeye YENİ bir düğüm
   * ekler; düğüm eklenmesi ekran okuyucuda güvenilir bir duyuru tetikleyicisidir.
   */
  const announce = (text: string) => setLiveStatus((p) => ({ text, seq: p.seq + 1 }));
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const statusSelectRef = useRef<HTMLSelectElement | null>(null);
  const prioritySelectRef = useRef<HTMLSelectElement | null>(null);
  /** İstek bitince odağın döneceği öğe. */
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  /** AI-öner: tıklanan tetikleyici. Nudge kartındaki düğme tıklandığı ANDA
   *  unmount olur (kart `!suggestLoading` koşullu) — o durumda yedek hedef
   *  kalıcı "AI cevap öner" düğmesidir. */
  const suggestRestoreRef = useRef<HTMLButtonElement | null>(null);
  const suggestButtonRef = useRef<HTMLButtonElement | null>(null);
  /** Çeviri: tıklanan "Çevir" düğmesi (mesaj başına ayrı düğme var). */
  const translateRestoreRef = useRef<HTMLButtonElement | null>(null);

  // Template picker state
  const [showTemplates, setShowTemplates] = useState(false);
  const templatesWrapRef = useRef<HTMLDivElement | null>(null);
  const templatesPanelRef = useRef<HTMLDivElement | null>(null);
  const templatesTriggerRef = useRef<HTMLButtonElement | null>(null);
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
    setQueuedNote(null);
    // Per-message idempotency id (Codex 07-23): minted for the CURRENT composed
    // payload and kept across error retries/double-clicks of the SAME payload;
    // any body/aiAssisted change mints a fresh id (server 409-guards reuse with
    // different content). Cleared after a SUCCESSFUL send.
    const cur = requestIdRef.current;
    if (!cur || cur.body !== body || cur.aiAssisted !== aiAssisted) {
      requestIdRef.current = { id: crypto.randomUUID(), body, aiAssisted };
    }
    const requestId = (requestIdRef.current as { id: string }).id;
    try {
      const res = await fetch(`/api/conversations/${conversationId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, aiAssisted, requestId }),
      });
      if (res.ok) {
        requestIdRef.current = null;
        setComposer("");
        setSuggestion(null);
        // Durable Outbox (flag ON): a 202 means QUEUED, not yet delivered — say so
        // honestly instead of implying the message already reached the guest.
        if (res.status === 202) {
          const data = await res.json().catch(() => null);
          if (data?.outbox?.status === "queued") {
            setQueuedNote("Mesaj sıraya alındı — birazdan gönderilecek.");
          }
        } else {
          // 200 = TESLİM. Eskiden bu dal tamamen sessizdi: yalnız hata
          // (role="alert") ve 202 kuyruk notu (role="status") duyuluyordu.
          // Kutu temizlenip balon listeye sessizce ekleniyordu.
          announce("Mesaj gönderildi.");
        }
        refresh();
      } else {
        const data = await res.json().catch(() => null);
        setSendError(data?.error ?? "Mesaj gönderilemedi.");
      }
    } catch {
      // 🚨 AĞ HATASI BELİRSİZ TESLİMATTIR — "gönderilemedi" DEMEZ (08-06).
      //
      // `fetch` fırladığında isteğin sunucuya ULAŞMADIĞINI bilmiyoruz: yanıt
      // yolda kaybolmuş da olabilir, yani mesaj misafire GİTMİŞ olabilir.
      // CLAUDE.md'nin kendi kuralı bunu yazıyor ("BELİRSİZ TESLİMAT
      // 'İLETİLEMEDİ' DEMEZ") ve SUNUCU bu kurala uyuyor — belirsiz sağlayıcı
      // cevabında "Gönderim doğrulanamadı — mesaj ulaşmış olabilir" diyor
      // (`conversations/[id]/reply/route.ts`). İstemcinin ağ dalı o kurala
      // uymuyordu: kesin bir başarısızlık iddia ediyor, host da mesajı YENİDEN
      // YAZIYOR. Aynı metni birebir tekrar göndermek `requestId` ile deduplike
      // edilir, ama host metni DEĞİŞTİRİRSE (ya da sayfayı yenilerse) taze bir
      // id üretilir ve misafire İKİNCİ mesaj gider.
      //
      // Metin bilerek sunucununkiyle aynı yönde: önce KONTROL ET, sonra gönder.
      setSendError(
        "Bağlantı koptuğu için gönderim doğrulanamadı — mesaj iletilmiş olabilir. " +
          "Tekrar göndermeden önce konuşmayı kontrol edin.",
      );
    } finally {
      setSending(false);
      // Buton gönderim boyunca `sending`, başarıdan sonra da `!composer.trim()`
      // ile DISABLED kalıyor → odak <body>'ye düşüyordu. Yazma kutusuna dön:
      // konuşmaya devam etmenin (ya da hatada düzeltmenin) doğal yeri orası.
      // FINALLY'de: eskiden try içindeydi, ağ hatası (catch) yolu atlanıyordu.
      // Textarea hiçbir zaman disabled olmadığı için focus güvenle tutar.
      if (composerRef.current?.isConnected) composerRef.current.focus();
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
      if (!res.ok) toast.error("Güncellenemedi. Yetkiniz yoksa yöneticinize danışın.");
      else {
        // BAŞARIDA da haber ver: eskiden yalnız hata duyuluyordu, başarı
        // tamamen sessizdi (kullanıcı durumu çektim mi bilmiyordu).
        announce(field === "status" ? "Durum güncellendi." : "Öncelik güncellendi.");
        refresh();
      }
    } catch {
      toast.error("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      // `disabled={busy}` odağı <body>'ye düşürmüştü — geri ver. Odaklama
      // BURADA yapılamaz: setBusy(false) henüz işlenmediği için öğe hâlâ
      // disabled ve .focus() sessizce hiçbir şey yapmaz. Hedefi işaretle,
      // yeniden render'dan SONRA effect odaklasın.
      restoreFocusRef.current = field === "status" ? statusSelectRef.current : prioritySelectRef.current;
      setBusy(false);
    }
  }

  // Kontroller yeniden etkinleştikten SONRA odağı iade et.
  useEffect(() => {
    if (busy) return;
    const el = restoreFocusRef.current;
    restoreFocusRef.current = null;
    if (el?.isConnected && !(el as HTMLSelectElement).disabled) el.focus();
  }, [busy]);

  // AI-öner bitince odak tetikleyiciye döner; tetikleyici (nudge) unmount
  // olduysa kalıcı öner düğmesine düşer. `clicked` null ise hiç tıklama
  // olmamıştır — ilk mount'ta odak ÇALINMAZ.
  useEffect(() => {
    if (suggestLoading) return;
    const clicked = suggestRestoreRef.current;
    suggestRestoreRef.current = null;
    if (!clicked) return;
    const target = clicked.isConnected && !clicked.disabled ? clicked : suggestButtonRef.current;
    if (target?.isConnected && !target.disabled) target.focus();
  }, [suggestLoading]);

  // Çeviri bitince odak o mesajın "Çevir" düğmesine döner.
  useEffect(() => {
    if (translatingId !== null) return;
    const el = translateRestoreRef.current;
    translateRestoreRef.current = null;
    if (el?.isConnected && !el.disabled) el.focus();
  }, [translatingId]);

  // Açılır yüzey davranışı. Klavye kullanıcısı için kritik: panel açılınca odak
  // içeri girmeli, kapanınca TETİKLEYİCİYE dönmeli (yoksa odak sayfanın başına
  // düşer ve kullanıcı yerini kaybeder). Escape ve dışarı tıklama da kapatır —
  // eskiden yalnız küçük "X" düğmesi vardı.
  useEffect(() => {
    if (!showTemplates) return;
    const panel = templatesPanelRef.current;
    // Odağı panele al (panel programatik odak alabilsin diye tabIndex -1).
    panel?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setShowTemplates(false);
      }
    }
    function onPointerDown(e: MouseEvent | TouchEvent) {
      const wrap = templatesWrapRef.current;
      if (wrap && e.target instanceof Node && !wrap.contains(e.target)) setShowTemplates(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [showTemplates]);

  // Kapanışta odağı tetikleyiciye GERİ ver — yalnız panel gerçekten açıldıysa,
  // yoksa ilk render'da odak çalınırdı.
  const templatesWasOpen = useRef(false);
  useEffect(() => {
    if (showTemplates) templatesWasOpen.current = true;
    else if (templatesWasOpen.current) {
      templatesWasOpen.current = false;
      templatesTriggerRef.current?.focus();
    }
  }, [showTemplates]);

  async function loadTemplates() {
    // Açıksa KAPAT — koşul `templates.length > 0` idi, yani şablon listesi boş
    // kalan bir hesapta (yeni müşteri) ya da yükleme hata verdiğinde tetikleyici
    // tek yönlü bir şaltere dönüyordu: her basış `setShowTemplates(true)`.
    // Paneli aynı düğmeyle kapatmak mümkün değildi.
    if (showTemplates) {
      setShowTemplates(false);
      return;
    }
    if (templates.length > 0) {
      setShowTemplates(true);
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
    // 🚨 TEK GEÇİŞ — SIRAYLA `split/join` YAPMA (denetim 08-07 (5), ÖLÇÜLDÜ).
    // Eski kod `Object.entries` üzerinde döngüyordu ve her anahtar, ÖNCEKİ
    // anahtarların YERİNE KOYDUĞU metni de yeniden tarıyordu. `guestName`
    // sağlayıcıdan gelir ve MİSAFİR KONTROLÜNDEDİR (Airbnb görünen adı) →
    // misafir adını `{{wifiInfo}}` yapınca, wifi yer tutucusu HİÇ GEÇMEYEN bir
    // şablon bile KB'deki wifi kalemini yazma alanına basıyordu.
    // ÖLÇÜLDÜ: "Merhaba {{guestName}}, {{propertyName}} …" →
    //   "Merhaba SSID: Nuve3_5G / Sifre: Yaz2026! - Kapi kodu: 4590, Nuve 3 …"
    // (varsayılan giriş şablonu host'a kapı kodunu tam da o KB kalemine yazmasını
    // söylüyor, yani sızan şey rutin olarak kapı kodudur).
    // Tek geçişte yerine konan metin BİR DAHA taranmaz → enjeksiyon imkânsız.
    if (templateVars) {
      const vars = templateVars;
      body = body.replace(/\{\{(\w+)\}\}|\{(isim|ad)\}/g, (match, dblKey?: string, single?: string) => {
        // `{isim}`/`{ad}`: otomatik mesajların tek-parantez biçimi; host iki ayrı
        // yer tutucu stili öğrenmek zorunda kalmasın diye kabul ediliyor.
        const value = dblKey ? vars[dblKey] : single ? vars.guestName : undefined;
        return value ? value : match; // eşleşmeyen aşağıdaki temizlikte düşer
      });
    }
    // Strip any remaining unfilled placeholders so guests never see raw {{...}}.
    body = body.replace(/\{\{[^}]+\}\}/g, "").replace(/\n{3,}/g, "\n\n").trim();
    setComposer(body);
    setShowTemplates(false);
  }

  async function translateMessage(messageId: string) {
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
        // "Tekrar deneyin" iki gerçek durumda YANLIŞ tavsiyeydi: günlük AI
        // sınırı (429) ve pasif abonelik (402). İkisinde de tekrar denemek asla
        // işe yaramaz; host geçici arıza sanıp basıp duruyordu. Sunucu zaten
        // anlamlı bir metin döndürüyor — aynı dosyadaki "AI öner" düğmesi bunu
        // baştan doğru yapıyordu, çeviri yapmıyordu.
        const data = await res.json().catch(() => ({}));
        toast.error(
          typeof data?.error === "string" && data.error
            ? data.error
            : "Çeviri yapılamadı. Lütfen tekrar deneyin.",
        );
      }
    } catch {
      toast.error("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setTranslatingId(null);
    }
  }

  return (
    <div className="flex flex-col rounded-xl border border-border bg-card">
      {/* Görünmez canlı bölge: gönderim/durum sonuçları buraya yazılır.
          Ekranda yer kaplamaz ama ekran okuyucu okur. */}
      <p role="status" aria-live="polite" className="sr-only">
        {liveStatus.text ? <span key={liveStatus.seq}>{liveStatus.text}</span> : null}
      </p>

      {/* Header: status & priority controls */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
        <div className="flex items-center gap-2">
          {/* Görsel etiket ARTIK gerçek bir <label>: eskiden <span> olduğu için
              kontrolün programatik adı yoktu, ekran okuyucu yalnız "seçim kutusu"
              diyordu. id, konuşmaya bağlı — aynı sayfada iki thread açılırsa
              id'ler çakışmaz. */}
          <label htmlFor={`conv-status-${conversationId}`} className="text-xs text-muted-foreground">
            Durum
          </label>
          <Select
            ref={statusSelectRef}
            id={`conv-status-${conversationId}`}
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
          <label htmlFor={`conv-priority-${conversationId}`} className="text-xs text-muted-foreground">
            Öncelik
          </label>
          <Select
            ref={prioritySelectRef}
            id={`conv-priority-${conversationId}`}
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
      {/* 44vh'de kirpilan kaydirilabilir kutu. Icindeki TEK odaklanabilir oge
          gelen mesajlardaki "Cevir" dugmesi; son gelen mesajdan SONRAKI giden
          yanitlar (host'un/AI'in en son cevabi - en cok okunan satir) hicbir
          odak duraginin altinda kaliyordu, yani klavye kullanicisi kendi son
          cevabini fare olmadan goremiyordu. tabIndex={0} kutuyu ok tuslariyla
          kaydirilabilir yapar. */}
      <div
        tabIndex={0}
        role="group"
        aria-label="Mesaj geçmişi"
        className="scrollbar-thin max-h-[44vh] space-y-3 overflow-y-auto p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
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
                  onClick={(e) => {
                    if (!translations[m.id]) translateRestoreRef.current = e.currentTarget;
                    translateMessage(m.id);
                  }}
                  disabled={translatingId === m.id}
                  // Bu bir aç/kapa yüzeyi: durumu ve neyi açtığını bildirir.
                  aria-expanded={Boolean(translations[m.id])}
                  aria-controls={translations[m.id] ? `msg-translation-${m.id}` : undefined}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary"
                >
                  {translatingId === m.id ? (
                    <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                  ) : (
                    <Languages className="size-3" aria-hidden="true" />
                  )}
                  {translations[m.id] ? "Çeviriyi gizle" : "Çevir"}
                  {/* Konuşmadaki HER misafir mesajının altında aynı düğme var;
                      ekran okuyucunun düğme listesinde/rotorunda hepsi "Çevir"
                      görünüyordu — kullanıcı hangi mesajı çevireceğini
                      seçemiyordu. Bağlam GÖRÜNÜR METNİN ARDINA eklenir, aria-label
                      ile EZİLMEZ: erişilebilir ad hâlâ "Çevir" ile başlar, yani
                      sesle kontrol kullanıcısı "Çevir" diyerek tıklayabilir
                      (SC 2.5.3). Zaman damgası kullanılır, misafir adı DEĞİL. */}
                  <span className="sr-only"> — {m.createdAtLabel} tarihli mesaj</span>
                </button>
                {translations[m.id] ? (
                  <p
                    id={`msg-translation-${m.id}`}
                    // Çeviri SESSİZCE beliriyordu; artık geldiği duyulur.
                    role="status"
                    className="mt-1 rounded-md bg-blue-50 dark:bg-blue-500/10 px-2 py-1 text-xs text-blue-800 dark:text-blue-300"
                  >
                    {translations[m.id]}
                  </p>
                ) : null}
              </div>
            ) : null}
            <span className="mt-1 px-1 text-[11px] text-muted-foreground">
              {displaySenderName(m.senderName, m.authorType)} · {m.createdAtLabel}
            </span>
            {/* Persistent outbox delivery state (#3): survives refresh, so a queued /
                sending / unverified reply never masquerades as delivered. */}
            {m.direction === "outbound" && m.outboxStatus && OUTBOX_STATUS_UI[m.outboxStatus] ? (
              <span
                className={cn(
                  "mt-0.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                  OUTBOX_STATUS_UI[m.outboxStatus].className,
                )}
              >
                {m.outboxStatus === "sent" ? (
                  <CheckCheck className="size-3" />
                ) : m.outboxStatus === "canceled" ? (
                  <X className="size-3" />
                ) : m.outboxStatus === "blocked" ? (
                  <PauseCircle className="size-3" />
                ) : m.outboxStatus === "ambiguous" || m.outboxStatus === "review" || m.outboxStatus === "failed" ? (
                  <AlertTriangle className="size-3" />
                ) : (
                  <Loader2 className="size-3" />
                )}
                {OUTBOX_STATUS_UI[m.outboxStatus].label}
              </span>
            ) : null}
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
            <Button
              onClick={(e) => {
                suggestRestoreRef.current = e.currentTarget;
                handleSuggest();
              }}
              disabled={suggestLoading}
              size="sm"
              className="shrink-0"
            >
              <Sparkles className="size-4" /> AI ile cevapla
            </Button>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {canReply ? (
            <Button
              ref={suggestButtonRef}
              onClick={(e) => {
                suggestRestoreRef.current = e.currentTarget;
                handleSuggest();
              }}
              disabled={suggestLoading}
              size="sm"
            >
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

          {/* Template picker — açılır yüzey sözleşmesi: tetikleyici durumu
              duyurur (aria-expanded/haspopup), panel role="dialog" + adlandırılmış,
              Escape ve dışarı tıklama kapatır, odak içeri alınır ve kapanınca
              TETİKLEYİCİYE geri verilir (uygulamadaki mobil drawer'la aynı sözleşme). */}
          <div className="relative" ref={templatesWrapRef}>
            <Button
              ref={templatesTriggerRef}
              onClick={loadTemplates}
              disabled={templatesLoading}
              size="sm"
              variant="outline"
              aria-haspopup="dialog"
              aria-expanded={showTemplates}
              aria-controls={showTemplates ? `conv-templates-${conversationId}` : undefined}
            >
              {templatesLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FileText className="size-4" />
              )}
              Şablonlar
              <ChevronDown className="size-3.5 opacity-60" />
            </Button>
            {showTemplates ? (
              <div
                id={`conv-templates-${conversationId}`}
                ref={templatesPanelRef}
                role="dialog"
                tabIndex={-1}
                aria-modal="false"
                aria-labelledby={`conv-templates-title-${conversationId}`}
                className="absolute left-0 top-full z-20 mt-1 max-h-80 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-lg"
              >
                <div className="flex items-center justify-between px-2 py-1.5">
                  <span
                    id={`conv-templates-title-${conversationId}`}
                    className="text-xs font-semibold text-muted-foreground"
                  >
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
                {/* YÜKLENİYOR dalı önce gelmeli: panel fetch'ten ÖNCE açılıyor
                    (loadTemplates önce setShowTemplates(true) yapıyor), dolayısıyla
                    bu dal olmadan `templates` hâlâ [] iken ekrana "Şablon
                    bulunamadı" YANLIŞ bilgisi basılıyordu — üstelik odak panele
                    taşındığı için ekran okuyucu açılış metni olarak tam da bu
                    yanlış cümleyi okuyordu. */}
                {templatesLoading ? (
                  <p className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    Şablonlar yükleniyor…
                  </p>
                ) : templatesError ? (
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

        {/* AI öneri hatası SESSİZDİ: aynı dosyada gönderim hatası (sendError)
            doğru şekilde role="alert" taşıyor, yani bu bilinçli bir tercih
            değil atlanmış bir daldı. Kullanıcı "AI cevap öner"e basıyor, istek
            düşüyor, hiçbir geri bildirim almadan tekrar tekrar basıyordu. */}
        <FormError>{suggestError}</FormError>

        {suggestion ? (
          // Öneri, güven rozeti ve "İnsan incelemesi" uyarısı ekrana SESSİZCE
          // geliyordu; artık geldiği duyulur (kesinti YOK — status, alert değil).
          <div role="status" className="space-y-3 rounded-lg border border-primary/30 bg-accent/40 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                <Bot className="size-4 text-primary" /> AI Önerisi
              </span>
              <Badge tone="secondary">{intentLabel(suggestion.intent)}</Badge>
              {suggestion.riskLevel && suggestion.riskLevel !== "none" ? (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                    suggestion.riskLevel === "low" && "bg-yellow-100 dark:bg-yellow-500/15 text-yellow-800 dark:text-yellow-300",
                    suggestion.riskLevel === "medium" && "bg-orange-100 dark:bg-orange-500/15 text-orange-800 dark:text-orange-300",
                    suggestion.riskLevel === "high" && "bg-red-100 dark:bg-red-500/15 text-red-800 dark:text-red-300",
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
                    ? "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300"
                    : "bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300",
                )}
              >
                {suggestion.confidence >= 0.75 ? "AI bu cevaptan emin" : "AI emin değil — gözden geçirin"}
              </span>
            </div>

            {riskTypeLabel(suggestion.riskType) ? (
              <p className="flex items-start gap-2 rounded-md bg-orange-50 dark:bg-orange-500/10 px-2.5 py-2 text-xs text-orange-800 dark:text-orange-300">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span><span className="font-medium">İnsan incelemesi:</span> {riskTypeLabel(suggestion.riskType)}</span>
              </p>
            ) : null}

            {suggestion.usedSources && displayableSources(suggestion.usedSources).length > 0 ? (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">Kullandığı bağlam:</span>{" "}
                {displayableSources(suggestion.usedSources).map(sourceLabel).join(" · ")}
              </p>
            ) : null}
            {suggestion.missingInfo && suggestion.missingInfo.length > 0 ? (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                <span className="font-medium">Eksik bilgi:</span> {suggestion.missingInfo.join(" · ")}
              </p>
            ) : null}

            {suggestion.risk ? (
              <p className="flex items-start gap-2 rounded-md bg-warning/15 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {suggestion.risk}
              </p>
            ) : null}

            {suggestion.actionSuggestion ? (
              <p className="flex items-start gap-2 rounded-md bg-blue-50 dark:bg-blue-500/10 px-2.5 py-2 text-xs text-blue-800 dark:text-blue-300">
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
          {/* Placeholder bir AD DEĞİLDİR (yazmaya başlayınca kaybolur ve bazı
              ekran okuyucular hiç okumaz) → görünmez ama gerçek bir etiket.
              Gönderim hatası hem alana BAĞLI (aria-describedby + aria-invalid)
              hem de DUYURULUR (role="alert"); eskiden yalnız görsel bir satırdı. */}
          <label htmlFor={`conv-composer-${conversationId}`} className="sr-only">
            Misafire cevabınız
          </label>
          <Textarea
            ref={composerRef}
            id={`conv-composer-${conversationId}`}
            value={composer}
            onChange={(e) => setComposer(e.target.value)}
            placeholder="Cevabınızı yazın veya AI önerisini kullanın…"
            className="min-h-[80px]"
            aria-describedby={
              [sendError ? `conv-send-error-${conversationId}` : null,
               queuedNote ? `conv-send-note-${conversationId}` : null]
                .filter(Boolean)
                .join(" ") || undefined
            }
            {...(sendError ? { "aria-invalid": true } : {})}
          />
          {sendError ? (
            <p
              id={`conv-send-error-${conversationId}`}
              role="alert"
              className="flex items-start gap-2 rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive"
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {sendError}
            </p>
          ) : null}
          {queuedNote ? (
            <p
              id={`conv-send-note-${conversationId}`}
              role="status"
              className="rounded-md bg-primary/10 px-2.5 py-2 text-xs text-primary"
            >
              {queuedNote}
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
