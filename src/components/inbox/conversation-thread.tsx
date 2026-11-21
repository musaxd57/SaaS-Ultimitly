"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { newRequestId } from "@/lib/request-id";
import { FormError } from "@/components/form-error";
import { toast } from "@/lib/toast";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { kbPrefillHref, rememberKbPrefillTitle } from "@/lib/kb-prefill";
import {
  Sparkles,
  Send,
  Loader2,
  AlertTriangle,
  Bot,
  Wand2,
  Check,
  CheckCheck,
  Info,
  FileText,
  Languages,
  ChevronDown,
  X,
  PauseCircle,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CONVERSATION_STATUS, PRIORITY, REPLY_TONE, type ReplyTone } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { earlyCheckinPanelLines, type EarlyCheckinPanelData } from "@/lib/early-checkin/panel";
import {
  intentLabel,
  langLabel,
  displaySenderName,
  riskTypeLabel,
  sourceLabel,
  displayableSources,
  NO_AI_SUGGESTION_TEXT,
  FALLBACK_DRAFT_BADGE_TEXT,
} from "@/lib/ui-labels";
import { applyTemplateBody } from "@/lib/template-apply";
import { useLatestRequest } from "@/lib/use-latest-request";
import type { PreparedDraft } from "@/lib/conversation-items/prepared-draft";
import type { AvailabilityVetoReason } from "@/lib/ai/availability-claims";
import { LOCAL_REPLY_RECORDED_TEXT, LOCAL_THREAD_COMPOSER_NOTE, isDeliveryOutcome } from "@/lib/delivery-outcome";

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
// durable outbox. 🚨 "sent" = the CHANNEL PROVIDER ACCEPTED it (Codex 11-05): the provider gives us no delivery / read receipt, so the
// label says "Gönderildi" with a SINGLE tick — never "İletildi" / a double tick, which read as "reached the guest's phone". Every other
// state must stay visually distinct from a sent bubble.
const OUTBOX_STATUS_UI: Record<string, { label: string; className: string }> = {
  pending: { label: "Sırada — gönderilmeyi bekliyor", className: "bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  sending: { label: "Gönderiliyor…", className: "bg-blue-100 dark:bg-blue-500/15 text-blue-800 dark:text-blue-300" },
  sent: { label: "Gönderildi", className: "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300" },
  reconciling: { label: "Doğrulanıyor…", className: "bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  ambiguous: { label: "Doğrulanamadı — kontrol edin", className: "bg-orange-100 dark:bg-orange-500/15 text-orange-800 dark:text-orange-300" },
  review: { label: "Doğrulanamadı — inceleyin", className: "bg-orange-100 dark:bg-orange-500/15 text-orange-800 dark:text-orange-300" },
  failed: { label: "Gönderilemedi", className: "bg-red-100 dark:bg-red-500/15 text-red-800 dark:text-red-300" },
  // Hospitable subscription not active (402): parked, NOT lost — sends automatically once the
  // connection is restored (re-sync / reconnect). Distinct amber "paused" tone, not a red failure.
  blocked: { label: "Abonelik pasif — bağlantı gelince gönderilecek", className: "bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  canceled: { label: "İptal edildi — yerine yeni bir gönderim oluşturuldu", className: "bg-muted text-muted-foreground" },
};

/**
 * Tur 7 T7-OB-4: engellenen YAPAY ZEKÂ cevabı abonelik dönünce gönderilmez, iptal edilir (W7 kararı) — "bağlantı gelince gönderilecek"
 * yalnız ev sahibinin kendi (manuel) mesajı ve otomatik mesajlar için doğrudur.
 */
const BLOCKED_AI_LABEL = "Abonelik pasif — bu cevap gönderilmeyecek";

/** Seçici listesindeki kalem: tam gövde YOK, kısa önizleme var (tam metin seçilince `GET /api/templates/[id]`). */
interface TemplateItem {
  id: string;
  title: string;
  preview: string;
  category: string;
  language: string;
  isDefault?: boolean;
}

/** Tam şablon okunamadığında (sunucu iletisi yoksa) panelde gösterilen metin. */
const TEMPLATE_LOAD_FAILED_TEXT = "Şablon yüklenemedi. Lütfen tekrar deneyin.";

/** `GET /api/templates` yanıtı — biçim dışı gövde boş sayfa sayılır (eski dizi biçimi dahil). */
function readTemplatePage(data: unknown): { items: TemplateItem[]; page: number; hasMore: boolean } {
  const d = (data && typeof data === "object" ? data : {}) as { items?: unknown; page?: unknown; hasMore?: unknown };
  return {
    items: Array.isArray(d.items) ? (d.items as TemplateItem[]) : [],
    page: typeof d.page === "number" ? d.page : 1,
    hasMore: d.hasMore === true,
  };
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
  /** Müsaitlik vetosu (sunucu yüklemi): taslak takvim iddiası taşıyor ya da isteği ertelemiyor. */
  availabilityCheck?: AvailabilityVetoReason | null;
  /** Doğrulanmış erken giriş kontrolü (09-24): kontrol listesi + uygunsa koddan kurulan hazır cevap. */
  earlyCheckin?: (EarlyCheckinPanelData & { draft: string | null }) | null;
  /** Kurucu 10-22: taslak bilginin kaynağını anlatıyor (sunucu yüklemi `namesInternalSource`). */
  internalSourceCheck?: boolean;
  /** Kayıtlı taslak (sayfa açılınca yüklendi; misafire gitmedi) — güven rozeti yerine "hazır taslak" yazar. */
  prepared?: boolean;
  /** Kayıtlı taslağın ait olduğu misafir mesajı (yalnız `prepared`): sunucu taslağı hâlâ veriyor mu diye bakılır (↓ `handleSuggest`). */
  preparedFor?: string;  /**
   * Önerinin üretildiği andaki konuşma sonu (sunucu verir). "Onayla ve gönder" bunu yollar: gönderim işleminin kimliği olur — iki
   * yönetici aynı öneriyi ayrı sekmelerde onaylarsa tek mesaj gider (S1, kurucu kararı 11-11).
   */
  anchorMessageId?: string;
}

/** Kayıtlı HAZIR TASLAK → panelin öneri biçimi (uyarı sunucuda yeniden hesaplandı). */
function preparedSuggestion(d: PreparedDraft): Suggestion {
  return {
    intent: d.intent,
    confidence: d.confidence,
    reply: d.reply,
    risk: null,
    source: "openai",
    availabilityCheck: d.availabilityCheck,
    internalSourceCheck: d.internalSourceCheck,
    prepared: true,
    preparedFor: d.messageId,
    // Kayıtlı taslak konuşmanın son gerçek mesajına (misafir mesajı) aittir → konuşma sonu odur.
    anchorMessageId: d.messageId,
  };
}

interface Props {
  conversationId: string;
  messages: ThreadMessage[];
  status: string;
  priority: string;
  propertyId?: string;
  /** Misafirin görünen adı — kartın başlık satırında, durum seçiminin SOLUNDA. */
  guestName?: string;
  /** "Daire 5 · Airbnb · 13:00 → 11:00" — önceliğin SAĞINDA. */
  propertyLabel?: string;
  /** Satıra sığmayan tam metin (adres dahil) — `title` ipucu olarak. */
  propertyTitle?: string;
  /** Values used to substitute {{placeholders}} in message templates. */
  templateVars?: Record<string, string>;
  /** Owner/manager may send guest replies; staff get a read-only thread. */
  canReply?: boolean;
  /** Ayarlar'daki yanıt tonu — "AI cevap öner" bununla başlar (UX incelemesi 10-21 P; eskiden hep "Sıcak"tı). */
  defaultTone?: ReplyTone;
  /**
   * Sayfa eylemleri ("← Mesajlar", "Sil") — kartın BAŞLIK SATIRINDA, sağda.
   *
   * 🚨 Kartın DIŞINDA ayrı bir satırdaydılar ve o satır kartı aşağı itiyordu
   * (buton 2rem + `gap-6` 1.5rem = 3.5rem). Kurucu 09-11: "mesaj yeri en üste
   * kadar uzasın". Slot olarak geçilir çünkü `DeleteConversationButton` kendi
   * istemci bileşeni — sunucu sayfasından çocuk olarak verilmesi Next'te doğru
   * desendir (bu bileşen onu yalnız YERLEŞTİRİR, davranışına karışmaz).
   */
  headerActions?: React.ReactNode;
  /**
   * Konuşma açılınca öneri panelinde hazır duran kayıtlı taslak (kurucu 09-26, "Otomatik hazır dursun"). Yalnız en son
   * misafir mesajının taslağı; ondan sonra cevap gittiyse sunucu `null` verir.
   */
  initialDraft?: PreparedDraft | null;
  /**
   * Konuşma bir kanala bağlı DEĞİL (hedefi yok; iç QR sohbeti de değil) — cevap yalnız burada kaydedilir, misafire gitmez (Codex 11-17 C1).
   * Sunucu rota çözümünden verir (`deliveryOutcomeOfRoute` → `local_only`); yazma alanının üstünde kalıcı not gösterilir.
   */
  localOnly?: boolean;
}

export function ConversationThread({
  conversationId,
  messages,
  status,
  priority,
  propertyId,
  guestName,
  propertyLabel,
  propertyTitle,
  templateVars,
  canReply = true,
  defaultTone = "warm",
  headerActions,
  initialDraft = null,
  localOnly = false,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [composer, setComposer] = useState("");
  /**
   * Yazma alanının KAYNAĞI (kurucu 11-13, taslak ↔ gönderilen metin bağı): "Taslağı kullan" → `seeded` (yapay zekâ taslağından başlandı),
   * doğrulanmış erken giriş cevabı → `code` (kodun kurduğu cevap; yapay zekâ taslağıyla kıyaslanmaz). Sunucuya yalnız İPUCU olarak gider; metin
   * farkı sunucuda ölçülür. Alan boşaltılınca / şablon uygulanınca / gönderilince sıfırlanır.
   */
  const [composerSource, setComposerSource] = useState<"seeded" | "code" | null>(null);
  const [tone, setTone] = useState<ReplyTone>(defaultTone);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(() => (initialDraft ? preparedSuggestion(initialDraft) : null));
  // Hangi mesajın taslağı panele zaten geldi: sayfa 30 sn'de bir yenilenir — kapatılan taslak geri gelmesin, "AI öner"in
  // zengin sonucu (kaynaklar, erken giriş kontrolü) aynı mesajın kayıtlı özetiyle EZİLMESİN. Yeni bir misafir mesajının
  // taslağı gelirse panel onu gösterir.
  const seenDraftRef = useRef<string | null>(initialDraft?.messageId ?? null);
  // Paneldeki önerinin son hâli (etkiler eski kapanışı okumasın).
  const suggestionRef = useRef(suggestion);
  suggestionRef.current = suggestion;
  // Sunucunun ŞU AN verdiği kayıtlı taslak (istek sürerken değişebilir — ↓ `handleSuggest` geri koymadan önce buna bakar).
  const initialDraftRef = useRef(initialDraft);
  initialDraftRef.current = initialDraft;
  useEffect(() => {
    if (initialDraft && initialDraft.messageId !== seenDraftRef.current) {
      seenDraftRef.current = initialDraft.messageId;
      setSuggestion(preparedSuggestion(initialDraft));
      return;
    }
    // 🚨 GEÇERSİZLEŞEN HAZIR TASLAK PANELDE KALMAZ (mesaj M5, Codex 11-10): sunucu taslağı artık vermiyorsa (o misafir mesajına cevap gitti /
    // taslak iptal edildi) panelde duran HAZIR taslak "Onayla ve gönder" ile hâlâ gönderilebiliyordu — cevaplanmış soruya ikinci, bayat
    // cevap. Yalnız kayıtlı taslaktan gelen öneri kalkar; ev sahibinin kendi "AI cevap öner" sonucu bu yoldan silinmez (↓ ayrı kural).
    // Taslağı BİZ kaldırdıysak "görüldü" işareti de düşer: sunucu aynı taslağı yeniden verirse (geçici boşluk) panel onu yine gösterir.
    // Ev sahibinin elle kapattığı taslakta işaret durur (kapatılan taslak yenilemede geri gelmez).
    if (!initialDraft && suggestionRef.current?.prepared) {
      seenDraftRef.current = null;
      setSuggestion(null);
    }
  }, [initialDraft]);
  // Konuşmanın SONUNA yeni bir cevap geldiyse (başka bir ekip üyesi / yapay zekâ / ev sahibi başka sekmeden yazdı) eldeki öneri — hazır
  // taslak da "AI cevap öner" sonucu da — cevaplanmış mesaja aittir → kalkar (M5). Otomatik şablon mesajı (karşılama / giriş / çıkış) cevap
  // değildir; yeni misafir mesajı da öneriyi silmez (ev sahibi yine kullanmak isteyebilir, yeni taslak gelirse panel onu gösterir).
  const lastMessage = messages[messages.length - 1];
  const lastMessageId = lastMessage?.id ?? null;
  /** Konuşmanın sonundaki mesaj bir CEVAP mı (giden ve otomatik şablon değil). */
  const lastIsReply = Boolean(lastMessage && lastMessage.direction === "outbound" && lastMessage.authorType !== "automation");
  // "AI cevap öner" isteği sürerken gelen cevabı da görebilmek için son durumun aynası (↓ `handleSuggest`).
  const threadEndRef = useRef({ id: lastMessageId, isReply: lastIsReply });
  threadEndRef.current = { id: lastMessageId, isReply: lastIsReply };
  const lastSeenMessageRef = useRef<string | null>(lastMessageId);
  useEffect(() => {
    if (lastMessageId === lastSeenMessageRef.current) return;
    lastSeenMessageRef.current = lastMessageId;
    if (lastIsReply) setSuggestion(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yalnız son mesajın kimliği değişince
  }, [lastMessageId]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  /** Model yokken taslak üretilemedi (3d, kurucu 11-11) — hata değil bilgi: söz veren hazır cümle yerine kutu boş kalır. */
  const [noAiSuggestion, setNoAiSuggestion] = useState(false);
  const [sending, setSending] = useState(false);
  // Composed-message idempotency id — see sendReply (Codex 07-23). Payload'a
  // BAĞLI: gövde/aiAssisted değişirse YENİ id üretilir (aynı id + farklı içerik
  // sunucuda 409'dur — Codex r2 #3); aynı payload'ın retry'ı aynı id'yi taşır.
  const requestIdRef = useRef<{ id: string; body: string; aiAssisted: boolean; source: "composer" | "suggestion" } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  // Opus 11-05 F9: yazma kutusundan çıkan bekleyen kimlik, kutu o metinden UZAKLAŞINCA (silindi / değişti) düşer — saatler sonra aynı kısa
  // metni ("Tamam") bilerek yeniden yazmak YENİ mesajdır (eski kimlik 24 saat "az önce gönderildi" der ya da kuyrukta eski satıra
  // tekilleşirdi). Kutu aynı metni tutuyorsa (yanıtı kaybolan gönderimin tekrarı) kimlik korunur. Öneri gönderimi kutudan bağımsızdır.
  useEffect(() => {
    const cur = requestIdRef.current;
    if (cur && cur.source === "composer" && composer.trim() !== cur.body.trim()) requestIdRef.current = null;
  }, [composer]);
  // Opus 11-05 N3: öneriden çıkan bekleyen kimlik ÖNERİ NESNESİNE bağlıdır — panel yeni bir taslağa / yeni "AI öner" sonucuna geçince
  // (ya da kapanınca) düşer: aynı metinli YENİ taslak yeni mesajdır (eski kimlik kuyrukta eski satıra tekilleşip "gönderildi" der ya da
  // 24 saat "az önce gönderildi" derdi). Aynı panel nesnesi duruyorsa (yanıtı kaybolan onayın tekrarı) kimlik korunur; sayfa yenilemesi
  // aynı taslağı yeniden kurmaz (`seenDraftRef`).
  useEffect(() => {
    const cur = requestIdRef.current;
    if (cur && cur.source === "suggestion") requestIdRef.current = null;
  }, [suggestion]);
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
  /** AI-öner: tıklanan tetikleyici (istek bitince odak buraya döner).
   *  ⚠️ Davet kartı 09-11'de kaldırıldı; tek tetikleyici kalıcı "AI cevap öner"
   *  düğmesi ve o istek boyunca `disabled` olur ama DOM'dan KALKMAZ. Yedek
   *  hedef (`suggestButtonRef`) yine de duruyor: `null` bir hedefe odak
   *  vermek, klavye kullanıcısını sayfanın başına düşürür. */
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
  // Kurucu 11-19 akşam madde 1: liste sunucuda sayfalı (en çok 30) + arama sunucuda + tam metin seçilince ayrı istekle.
  const [templateQuery, setTemplateQuery] = useState("");
  const [templatesPage, setTemplatesPage] = useState(1);
  const [templatesHasMore, setTemplatesHasMore] = useState(false);
  const [templatesMoreLoading, setTemplatesMoreLoading] = useState(false);
  const [applyingTemplateId, setApplyingTemplateId] = useState<string | null>(null);
  /** Liste görünürken çıkan hata (devamı / tam metin okunamadı) — listeyi silmeden panelde duyurulur. */
  const [templatesNotice, setTemplatesNotice] = useState<string | null>(null);
  /** Son başlatılan liste isteğinin sırası: yavaş dönen eski arama yenisinin sonucunu ezmesin. */
  const templatesRequestSeq = useRef(0);
  /**
   * Seçilen şablonun tam metni okunurken panel kapanırsa (Esc, dışarı tıklama, tetikleyici) geç dönen okuma mesaj kutusuna YAZMAZ — ev sahibi
   * bu arada kendi cevabını yazmış olabilir (Opus 11-20 gece; eskiden tam metin listede olduğu için seçim beklemesizdi). Her seçim ve her
   * kapanış geçersiz kılar; okuma yalnız başladığı bilet hâlâ geçerliyse kutuyu doldurur (ortak yardımcı `useLatestRequest`, F-2).
   */
  const templateApply = useLatestRequest();
  /** Ekrandaki listeyi üreten arama ("Daha fazla göster" aynı aramanın sonraki sayfasını ister; kutuda yazılan henüz aranmamış olabilir). */
  const [templatesListQuery, setTemplatesListQuery] = useState("");
  const templateSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (templateSearchTimer.current) clearTimeout(templateSearchTimer.current);
    },
    [],
  );

  // Translate state: messageId -> translated text
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [translatingId, setTranslatingId] = useState<string | null>(null);

  const refresh = () => startTransition(() => router.refresh());

  async function handleSuggest() {
    setSuggestLoading(true);
    // Önceki öneri saklanır: model yokken yeni taslak gelmezse ev sahibinin elindeki taslak kaybolmasın (3d).
    const previous = suggestionRef.current;
    setSuggestion(null);
    setSuggestError(null);
    setNoAiSuggestion(false);
    const askedAt = threadEndRef.current.id;
    const answeredMeanwhile = () => threadEndRef.current.id !== askedAt && threadEndRef.current.isReply;
    // Yeni öneri ALINAMADIYSA (istek reddedildi / bağlantı koptu) eldeki öneri de kaybolmasın: hata mesajı görünür, önceki taslak yerinde
    // kalır. İstek sürerken konuşma cevaplandıysa geri konmaz — o öneri cevaplanmış mesaja aittir (M5).
    // Geri konmayan iki durum daha (Haiku incelemesi 11-11): (1) önceki öneri kayıtlı HAZIR taslaktı ve sunucu onu artık vermiyor
    // (yeni misafir mesajı geldi / taslak kalktı) — geri koymak geçersiz taslağı "Onayla ve gönder"e açardı; (2) istek sürerken panele
    // başka bir öneri geldi (yeni mesajın hazır taslağı) — üstüne eskisi yazılmaz.
    const keepPrevious = () => {
      if (!previous || answeredMeanwhile()) return;
      if (previous.prepared && initialDraftRef.current?.messageId !== previous.preparedFor) return;
      setSuggestion((current) => current ?? previous);
    };
    try {
      const res = await fetch(`/api/conversations/${conversationId}/ai-suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tone }),
      });
      const data = await res.json().catch(() => null);
      // İstek sürerken konuşmaya bir CEVAP geldiyse (ev sahibi bu arada yazıp gönderdi / başka biri cevapladı) gelen öneri cevaplanmış
      // mesaja aittir → panele konmaz (Haiku incelemesi 11-11; M5 ile aynı kural).
      if (res.ok && answeredMeanwhile()) return;
      if (res.ok && data?.source !== "openai" && !String(data?.reply ?? "").trim()) {
        // Yapay zekâya ulaşılamadı ve kayıtlı bilgiden kurulabilecek somut bir taslak da yok → söz veren hazır cümle YOK; not gösterilir,
        // önceki öneri (varsa) yerinde kalır.
        setNoAiSuggestion(true);
        keepPrevious();
      } else if (res.ok) {
        setSuggestion(data);
        // Sunucu bu öneriyi son misafir mesajına da kaydetti → yenilemede kayıtlı hâli bunun üstüne yazılmasın.
        seenDraftRef.current = [...messages].reverse().find((m) => m.direction === "inbound")?.id ?? seenDraftRef.current;
      } else {
        setSuggestError(data?.error ?? "AI önerisi alınamadı. Lütfen tekrar deneyin.");
        keepPrevious();
      }
    } catch {
      setSuggestError("Bağlantı hatası. Lütfen tekrar deneyin.");
      keepPrevious();
    } finally {
      setSuggestLoading(false);
    }
  }

  async function sendReply(
    body: string,
    aiAssisted = false,
    source: "composer" | "suggestion" = "composer",
    anchorMessageId?: string,
    draftUse?: "approved" | "seeded" | "code",
  ) {
    if (!body.trim()) return;
    setSending(true);
    setSendError(null);
    setQueuedNote(null);
    // Per-message idempotency id (Codex 07-23): minted for the CURRENT composed
    // payload and kept across error retries/double-clicks of the SAME payload;
    // any body/aiAssisted change mints a fresh id (server 409-guards reuse with
    // different content). Cleared after a SUCCESSFUL send.
    const cur = requestIdRef.current;
    if (!cur || cur.body !== body || cur.aiAssisted !== aiAssisted || cur.source !== source) {
      requestIdRef.current = { id: newRequestId(), body, aiAssisted, source };
    }
    const requestId = (requestIdRef.current as { id: string }).id;
    try {
      const res = await fetch(`/api/conversations/${conversationId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Öneri onayında konuşma sonu da gider (S1): sunucu gönderim işlemini ona bağlar. Elle yazılan cevap bu değeri hiç vermez
        // (yalnız "Onayla ve gönder" verir); sunucu da yapay zekâ destekli olmayan gönderimde yok sayar.
        body: JSON.stringify({ body, aiAssisted, requestId, ...(anchorMessageId ? { anchorMessageId } : {}), ...(draftUse ? { draftUse } : {}) }),
      });
      if (res.ok) {
        requestIdRef.current = null;
        // Durable Outbox (flag ON): kuyruğa alınan mesaj henüz TESLİM DEĞİL — dürüstçe söylenir. 🚨 Codex 11-05: karar HTTP kodundan
        // değil AÇIK durumdan: tekilleşen tekrar (aynı istek kimliği) 200 döner ama satır hâlâ sırada / başarısız olabilir — eskiden 200
        // "Mesaj gönderildi." duyuruluyordu. Metinler mevcut olanlar (kuyruk notu + mesaj balonunun durum etiketi).
        const data = (await res.json().catch(() => null)) as { delivery?: unknown; outbox?: { status?: string; delivery?: string } } | null;
        // Codex 11-17 C1: sunucunun gönderim sonucu (kapalı küme). Yoksa (eski yanıt) bugünkü davranış.
        const rawOutcome = data?.delivery;
        const outcome = isDeliveryOutcome(rawOutcome) ? rawOutcome : null;
        const outbox = data?.outbox;
        const delivery = outbox?.status === "queued" ? (outbox.delivery ?? "pending") : null;
        if (delivery === "failed" || delivery === "canceled") {
          // Opus 11-05 F6: tekilleşen tekrarın satırı GÖNDERİLEMEDİ / iptal edildi → yazılan metin ve öneri KORUNUR (teslim edilmiş gibi
          // silinmez), sebep görünür (mesaj balonunun mevcut etiketi). Kimlik sıfırlandı: bir sonraki basış YENİ mesajdır.
          setSendError(OUTBOX_STATUS_UI[delivery].label);
          refresh();
          return;
        }
        // Y10 (Codex 10-07): yalnız GÖNDERİLEN metin hâlâ yazma alanındaysa temizlenir — gönderim sürerken yazılan yeni taslak
        // ve "Onayla ve gönder" ile öneri giderken alanda ayrıca duran taslak silinmez.
        setComposer((cur) => (cur.trim() === body.trim() ? "" : cur));
        if (source === "composer") setComposerSource(null);
        setSuggestion(null);
        if (delivery !== null) {
          if (delivery === "sent") announce("Mesaj gönderildi.");
          else if (delivery === "pending" || delivery === "sending") setQueuedNote("Mesaj sıraya alındı — birazdan gönderilecek.");
          else announce(OUTBOX_STATUS_UI[delivery]?.label ?? "Mesaj sıraya alındı — birazdan gönderilecek.");
        } else if (outcome === "local_only") {
          // Codex 11-17 C1: kanala bağlı olmayan konuşma — cevap yalnız kaydedildi, misafire HİÇBİR kanaldan gitmedi ("gönderildi" denmez).
          announce(LOCAL_REPLY_RECORDED_TEXT);
        } else {
          // Doğrudan yol (201): kanal kabul etti (`channel_accepted`) ya da iç QR sohbeti (`qr_visible` — misafir sohbet sayfasında görür).
          // Alan yoksa (eski yanıt) bugünkü gibi. Eskiden bu dal tamamen sessizdi: yalnız hata (role="alert") ve 202 kuyruk notu
          // (role="status") duyuluyordu; kutu temizlenip balon listeye sessizce ekleniyordu.
          announce("Mesaj gönderildi.");
        }
        refresh();
      } else {
        const data = await res.json().catch(() => null);
        setSendError(data?.error ?? "Mesaj gönderilemedi.");
        // S1: öneri onayı "zaten gönderildi / gönderiliyor" ile reddedildiyse konuşma yenilenir — başka birinin gönderdiği cevap görünsün
        // (konuşmanın sonu cevap olunca eldeki öneri kendiliğinden kalkar).
        if (res.status === 409 && source === "suggestion") refresh();
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

  // ── TAM EKRAN (kurucu 09-11: "tam ekran tuşu bile olabilir") ───────────────
  // Kart görünür alanı DOLDURUR; tam ekranda ise sağ rayı ve kabuğu da kaplar.
  // ⚠️ Yalnız GÖRÜNÜM: hiçbir veri/gönderim yolu değişmez, kalıcı da değil
  // (sayfa yenilenince kapanır — kalıcı tercih ayrı bir karar).
  const [fullscreen, setFullscreen] = useState(false);

  // ── OKUMA SÜTUNU (kurucu 09-12: "tam ekranda mesajlar arası mesafe çok
  // uzak, adam gözünü sağa sola çekmeli") ───────────────────────────────────
  //
  // 🚨 MEKANİZMA: balonlar kabın YÜZDESİ (`max-w-[90%] sm:max-w-[85%]`), kap
  // ise tam ekranda VIEWPORT'un tamamı (`fixed inset-0`). 1920px bir monitörde
  // bu ~1630px demektir: gelen balon en solda, giden balon en sağda başlar ve
  // aradaki boşluk ~1000px olur. Göz her mesajda bir uçtan öteki uca gider.
  //
  // Sınır YÜZDEYE değil KABA konur — yüzdeyi düşürmek (ör. %50) dar ekranlarda
  // balonları gereksiz sıkıştırırdı; sütun tavanı ise yalnız GENİŞ ekranda
  // devreye girer ve dar ekranda hiçbir şeyi değiştirmez.
  //
  // ⚠️ YALNIZ TAM EKRAN: kart modunda kap zaten grid içinde dar; orada tavan
  // koymak var olan genişliği boşa harcardı (kart modunda `""`, test-pinli).
  // ⚠️ KAP DEĞİL İÇERİK sınırlanır: kaydırma kabı tam genişlikte kalmalı ki
  // kaydırma çubuğu ekranın kenarında dursun; `mx-auto` İÇ sarmalayıcıdadır.
  const readingColumnCn = fullscreen ? "mx-auto w-full max-w-4xl" : "";

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      // Esc ÇIKIŞ olmalı: tam ekranda "geri" düğmesi görünmüyorsa kullanıcı
      // kilitlenmiş hisseder. Şablon menüsü açıkken o kendi Esc'ini yiyor
      // (stopPropagation), yani sıralama doğru: önce menü kapanır, sonra kart.
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

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
    else {
      // Panel kapandı: süren tam metin okuması artık kutuya yazmaz (↑`templateApply`).
      templateApply.invalidate();
      if (templatesWasOpen.current) {
        templatesWasOpen.current = false;
        templatesTriggerRef.current?.focus();
      }
    }
  }, [showTemplates, templateApply]);

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
      setTemplatesNotice(null);
      setShowTemplates(true);
      return;
    }
    setShowTemplates(true);
    await searchTemplates(templateQuery.trim());
  }

  /** Şablon listesinin bir sayfası (sunucu en çok 30 kalem döner; arama sunucuda, işletmenin bütün şablonlarında). */
  async function fetchTemplatePage(query: string, page: number) {
    const params = new URLSearchParams();
    if (propertyId) params.set("propertyId", propertyId);
    if (query) params.set("q", query);
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    const res = await fetch(qs ? `/api/templates?${qs}` : "/api/templates");
    return res.ok ? readTemplatePage(await res.json()) : null;
  }

  /** Listeyi verilen aramanın ilk sayfasıyla değiştirir. */
  async function searchTemplates(query: string) {
    const seq = ++templatesRequestSeq.current;
    setTemplatesLoading(true);
    setTemplatesError(false);
    setTemplatesNotice(null);
    try {
      const page = await fetchTemplatePage(query, 1);
      if (seq !== templatesRequestSeq.current) return;
      if (!page) {
        setTemplatesError(true);
        return;
      }
      setTemplatesListQuery(query);
      setTemplates(page.items);
      setTemplatesPage(page.page);
      setTemplatesHasMore(page.hasMore);
    } catch {
      if (seq === templatesRequestSeq.current) setTemplatesError(true);
    } finally {
      if (seq === templatesRequestSeq.current) setTemplatesLoading(false);
    }
  }

  /** Arama kutusu: yazmayı bitirince (300 ms) sunucuya sorar. */
  function onTemplateQueryChange(value: string) {
    setTemplateQuery(value);
    if (templateSearchTimer.current) clearTimeout(templateSearchTimer.current);
    templateSearchTimer.current = setTimeout(() => void searchTemplates(value.trim()), 300);
  }

  /** Aynı aramanın sonraki sayfası listeye eklenir (arada eklenen şablon iki kez görünmesin diye kimlikle tekilleştirilir). */
  async function loadMoreTemplates() {
    const seq = templatesRequestSeq.current;
    setTemplatesMoreLoading(true);
    setTemplatesNotice(null);
    try {
      const next = await fetchTemplatePage(templatesListQuery, templatesPage + 1);
      if (seq !== templatesRequestSeq.current) return;
      if (!next) {
        setTemplatesNotice("Şablonlar yüklenemedi. Lütfen tekrar deneyin.");
        return;
      }
      setTemplates((prev) => {
        const seen = new Set(prev.map((t) => t.id));
        return [...prev, ...next.items.filter((t) => !seen.has(t.id))];
      });
      setTemplatesPage(next.page);
      setTemplatesHasMore(next.hasMore);
    } catch {
      if (seq === templatesRequestSeq.current) setTemplatesNotice("Şablonlar yüklenemedi. Lütfen tekrar deneyin.");
    } finally {
      setTemplatesMoreLoading(false);
    }
  }

  /**
   * Liste yalnız önizleme taşır; TAM metin seçilince ayrı istekle alınır (kurucu 11-19 akşam madde 1). Okunamazsa mesaj kutusuna dokunulmaz,
   * panel açık kalır ve sebep duyurulur; şablon arada silindiyse (404) listeden de düşer.
   */
  async function applyTemplate(item: TemplateItem) {
    if (applyingTemplateId) return;
    setApplyingTemplateId(item.id);
    setTemplatesNotice(null);
    const ticket = templateApply.begin();
    try {
      const res = await fetch(`/api/templates/${encodeURIComponent(item.id)}`);
      const t = (await res.json().catch(() => null)) as { body?: unknown; error?: unknown } | null;
      // Panel bu arada kapandıysa kutuya da listeye de dokunulmaz.
      if (!templateApply.isCurrent(ticket)) return;
      if (!res.ok || typeof t?.body !== "string") {
        if (res.status === 404) setTemplates((prev) => prev.filter((x) => x.id !== item.id));
        setTemplatesNotice(typeof t?.error === "string" ? t.error : TEMPLATE_LOAD_FAILED_TEXT);
        return;
      }
      // Kural + gerekçeler `@/lib/template-apply` içinde (saf ve test edilebilir;
      // bu bileşenin içindeyken tek geçiş/belirteç sözleşmesi pinlenemiyordu).
      setComposer(applyTemplateBody(t.body, templateVars));
      setComposerSource(null);
      setShowTemplates(false);
    } catch {
      if (templateApply.isCurrent(ticket)) setTemplatesNotice(TEMPLATE_LOAD_FAILED_TEXT);
    } finally {
      setApplyingTemplateId(null);
    }
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
    // 🚨 KART EKRANI DOLDURUR, MESAJ LİSTESİ ARTANI ALIR (kurucu 09-11: "panel
    // burada aşağı gidemesin, mesajların göründüğü yerin uzunluğunu arttır").
    // Eski `max-h-[52vh]` SABİT bir tavandı: uzun konuşmada liste erken kesilip
    // altında ölü boşluk kalıyordu, kısa konuşmada da aynı boşluk. Artık yükseklik
    // GÖRÜNÜR ALANA bağlı ve liste `flex-1 min-h-0` ile artanı yutuyor.
    // 🚨 SİHİRLİ SAYI KALDIRILDI (09-11, ölçüldü). Yükseklik `calc(100vh/0.95 -
    // 11rem)` idi; o `11rem` başlık + dolgu + eylem satırının SABİT toplamıydı ve
    // aradaki BANDLARI ("Otomatik yanıt beklemede", deneme/limit) saymıyordu —
    // ölçüm: tek bandda `<main>` 46 px, iki bandda 109 px taşıyor, yani yazma
    // kutusunun altı katlanın altına iniyor. Ayrıca `11rem`in kendisi 1rem fazlaydı
    // (gerçek toplam 10rem: 3.5 + 3 + 2 + 1.5) ve `100vh` × `zoom` etkileşimi
    // tarayıcı sürümüne göre değişiyor.
    // Artık ölçüyü GRID SATIRI verir: kabuk bu yolda dikey flex kurar, sayfadaki
    // grid `lg:flex-1 lg:min-h-0` ile artanı alır, kart da `lg:h-full` ile onu
    // doldurur. Hesap yok → yeni bir band eklense de bozulmaz.
    // `min-h` tabanı: kısa ekranda liste okunamayacak kadar ezilmesin.
    // Mobilde (tek sütun, sayfa kayar) yükseklik DAYATILMAZ.
    <div
      className={cn(
        "flex flex-col border border-border bg-card",
        fullscreen
          ? // Tam ekran: kabuğu da kaplar. `fixed inset-0` zoom'dan BAĞIMSIZ
            // olarak tam viewport'tur (kabukta ölçüldü). Köşe yuvarlaması ve
            // `min-h` burada anlamsız — kart zaten ekranın tamamı.
            "fixed inset-0 z-50 rounded-none"
          : "rounded-xl lg:h-full lg:min-h-[26rem]",
      )}
    >
      {/* Görünmez canlı bölge: gönderim/durum sonuçları buraya yazılır.
          Ekranda yer kaplamaz ama ekran okuyucu okur. */}
      <p role="status" aria-live="polite" className="sr-only">
        {liveStatus.text ? <span key={liveStatus.seq}>{liveStatus.text}</span> : null}
      </p>

      {/* Başlık satırı: MİSAFİR ADI · durum · öncelik · MÜLK.
          Kurucu 09-11: "isim yerlerini kutunun içine al, durum yerinin soluna;
          'daire · Airbnb' de önceliğin sağında yazsın". Eskiden ad ve mülk
          kartın DIŞINDAKİ sayfa başlığındaydı ve kartın kendi başlık satırı
          yarı boştu; ikisi birleşince mesaj kutusuna bir satır yer açıldı. */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border p-4">
        {guestName ? (
          <h2 className="mr-1 min-w-0 max-w-[16rem] truncate text-base font-semibold tracking-tight" title={guestName}>
            {guestName}
          </h2>
        ) : null}
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
            className="h-10 w-36 py-0 text-xs sm:h-8 sm:text-xs"
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
            className="h-10 w-28 py-0 text-xs sm:h-8 sm:text-xs"
          >
            {PRIORITY.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        {propertyLabel ? (
          <span className="min-w-0 truncate text-xs text-muted-foreground" title={propertyTitle ?? propertyLabel}>
            {propertyLabel}
          </span>
        ) : null}
        {/* 🚨 DURUM ROZETİ KALDIRILDI (kurucu 09-11): aynı satırda, seçim
            kutusundan 30 piksel ötede, BİREBİR AYNI değeri ikinci kez yazıyordu
            ("Durum: Yeni … [Yeni]"). Seçim kutusu hem gösterir hem değiştirir;
            rozet yalnız gösteriyordu. Durum/öncelik kutuları KALIYOR: durum
            gelen kutusu filtresini ve oto-yanıt yaşam döngüsünü sürer
            ("Sorunlu" oto-yanıtı KİLİTLER), öncelik ise liste sıralamasını. */}

        {/* Sağ uç: tam ekran + sayfa eylemleri ("← Mesajlar", "Sil").
            Eylemler kartın DIŞINDA ayrı bir satırdaydı ve kartı 3.5rem aşağı
            itiyordu (kurucu: "mesaj yeri en üste kadar uzasın"). */}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="hidden lg:inline-flex"
            onClick={() => setFullscreen((v) => !v)}
            aria-pressed={fullscreen}
            title={fullscreen ? "Tam ekrandan çık (Esc)" : "Tam ekran"}
          >
            {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            <span className="hidden xl:inline">{fullscreen ? "Küçült" : "Tam ekran"}</span>
          </Button>
          {headerActions}
        </div>
        {/* UX inceleme 10-21 (F): "Sorunlu" yapay zekâyı bu konuşmada KALICI durdurur (`automation.ts` status === "problem") — ev sahibi
            not olsun diye seçip misafirin sonraki mesajlarının cevapsız kaldığını fark etmiyordu. */}
        {status === "problem" ? (
          <p className="basis-full text-xs text-amber-700 dark:text-amber-400">
            Sorunlu konuşmada yapay zekâ cevap göndermez. Sorun çözülünce durumu “Cevaplandı” yapın.
          </p>
        ) : null}
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
        // 🚨 SABİT TAVAN YOK (kurucu 09-11): `lg`de liste kartın ARTAN alanını
        // alır (`flex-1 min-h-0`), yani başlık + AI paneli + yazma kutusu ne
        // kadar yer bırakırsa o kadar. `min-h-0` ŞART: flex çocuğunun varsayılan
        // `min-height:auto`su içeriğin tamamı kadar büyür ve `overflow-y` hiç
        // devreye girmez — liste taşar, kart uzar, yazma kutusu ekrandan çıkar.
        // Mobilde eski davranış: sayfa kaydığı için bir tavan gerekir.
        // KAYDIRMA HİSSİ (kurucu 09-11: "öküz gibi sert olmasın"):
        //  · `overscroll-contain` — listenin sonuna gelince kaydırma SAYFAYA
        //    zincirlenmez. Kart artık görünür alana sabit olduğu için sayfa da
        //    kaymıyor; o yüzden zincirleme "duvara toslama" hissi veriyordu.
        //  · `scroll-smooth` — klavye (PageDown/ok tuşları, kutu `tabIndex={0}`)
        //    ve programatik atlamalar yumuşak akar.
        // ⚠️ DÜRÜST SINIR: CSS FARE TEKERLEĞİNE ATALET EKLEYEMEZ. Tekerlek adımı
        //    tarayıcının/işletim sisteminin kararıdır; JS ile ele geçirmek
        //    (wheel hijack) trackpad'i ve erişilebilirliği BOZAR — yapılmadı.
        className="scrollbar-thin max-h-[52vh] overflow-y-auto overscroll-contain scroll-smooth p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring lg:max-h-none lg:min-h-0 lg:flex-1"
      >
        {/* İç sarmalayıcı: okuma sütunu. `space-y-3` KABI DEĞİL bunu süsler —
            kap tam genişlikte kalmalı (kaydırma çubuğu ekranın kenarında). */}
        <div className={cn("space-y-3", readingColumnCn)}>
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
                  // UX 10-21 R: 10 px / ~14 px yükseklik telefonda basılmıyordu (yabancı misafir mesajında en sık düğme).
                  className="flex min-h-8 items-center gap-1 px-1 text-xs text-muted-foreground hover:text-primary"
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
                  <Check className="size-3" />
                ) : m.outboxStatus === "canceled" ? (
                  <X className="size-3" />
                ) : m.outboxStatus === "blocked" ? (
                  <PauseCircle className="size-3" />
                ) : m.outboxStatus === "ambiguous" || m.outboxStatus === "review" || m.outboxStatus === "failed" ? (
                  <AlertTriangle className="size-3" />
                ) : (
                  <Loader2 className="size-3" />
                )}
                {m.outboxStatus === "blocked" && m.authorType === "ai" ? BLOCKED_AI_LABEL : OUTBOX_STATUS_UI[m.outboxStatus].label}
              </span>
            ) : null}
          </div>
        ))}
        </div>
      </div>

      <Separator />

      {/* AI suggestion */}
      {/* Dikey dolgu 4 → 2.5 ve ton kutusu 9 → 8: bu satır yazma alanından ve
          mesaj listesinden yer çalıyordu (kurucu 09-11: "AI cevap öner satırı da
          biraz küçülebilir"). İşlev aynı, yalnız yükseklik düştü. */}
      <div className={cn("shrink-0 space-y-3 px-4 py-2.5", readingColumnCn)}>
        {/* 🚨 "Misafir cevap bekliyor / AI ile cevapla" DAVET KARTI KALDIRILDI
            (kurucu 09-11). Düğmesi hemen altındaki kalıcı "AI cevap öner" ile
            AYNI `handleSuggest()`i çağırıyordu — iki farklı isim, tek eylem.
            Yazma alanının üstünde üç satır yer kaplıyor ve host'a yeni bir şey
            söylemiyordu (misafirin beklediği zaten konuşmanın kendisinden ve
            durum rozetinden belli). */}
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
            className="h-10 w-full py-0 text-xs sm:h-8 sm:w-32 sm:text-xs"
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
                // 🚨 `lg`de YUKARI AÇILIR. Tetikleyici AI satırındadır ve kart artık
                // görünür alana sabit olduğu için aşağı açılan menü ÖLÇÜLDÜ: alt
                // kenarı ~92 px taşıyor, `main` kaydırılmadan alt üçte biri
                // görünmüyordu. Yukarıda mesaj listesi kadar yer var.
                // Mobilde AŞAĞI kalır: orada sayfa kayar ve kart sabit değil.
                className="absolute left-0 top-full z-20 mt-1 max-h-80 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-lg lg:bottom-full lg:top-auto lg:mb-1 lg:mt-0"
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
                {/* Arama sunucuda, işletmenin BÜTÜN şablonlarında (liste yalnız ilk 30'u taşır — kurucu 11-19 akşam madde 1). */}
                <div className="px-1 pb-1">
                  <label htmlFor={`conv-templates-search-${conversationId}`} className="sr-only">
                    Şablonlarda ara
                  </label>
                  <input
                    id={`conv-templates-search-${conversationId}`}
                    type="search"
                    value={templateQuery}
                    onChange={(e) => onTemplateQueryChange(e.target.value)}
                    maxLength={100}
                    placeholder="Şablonlarda ara…"
                    className="h-10 w-full rounded-md border border-border bg-background px-2.5 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8"
                  />
                </div>
                {templatesNotice ? (
                  <p role="alert" className="px-2.5 py-1.5 text-xs text-destructive">
                    {templatesNotice}
                  </p>
                ) : null}
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
                  <p role="alert" className="p-3 text-xs text-destructive">
                    Şablonlar yüklenemedi. Lütfen tekrar deneyin.
                  </p>
                ) : templates.length === 0 ? (
                  <p className="p-3 text-xs text-muted-foreground">
                    {/* Aramada "sayfadan ekleyebilirsiniz" yanıltır: şablon var, yalnız aranan ifadeyle eşleşmiyor. */}
                    {templatesListQuery
                      ? "Şablon bulunamadı."
                      : "Şablon bulunamadı. Şablonlar sayfasından ekleyebilirsiniz."}
                  </p>
                ) : (
                  <>
                    {templates.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => applyTemplate(t)}
                        disabled={applyingTemplateId !== null}
                        aria-busy={applyingTemplateId === t.id}
                        className="block w-full rounded-md px-2.5 py-2 text-left hover:bg-muted disabled:opacity-60"
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium">{t.title}</span>
                          <span className="flex shrink-0 items-center gap-1 text-[10px] uppercase text-muted-foreground">
                            {applyingTemplateId === t.id ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : null}
                            {t.language}
                          </span>
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                          {t.preview}
                        </span>
                      </button>
                    ))}
                    {templatesHasMore ? (
                      <button
                        type="button"
                        onClick={() => void loadMoreTemplates()}
                        disabled={templatesMoreLoading}
                        className="mt-1 flex min-h-10 w-full items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60 sm:min-h-8"
                      >
                        {templatesMoreLoading ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
                        Daha fazla göster
                      </button>
                    ) : null}
                  </>
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
        {noAiSuggestion ? (
          <p role="status" data-testid="no-ai-suggestion" className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
            {NO_AI_SUGGESTION_TEXT}
          </p>
        ) : null}

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
              {suggestion.prepared ? (
                <span
                  data-testid="prepared-draft-badge"
                  className="ml-auto inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                >
                  Hazır taslak · gönderilmedi
                </span>
              ) : suggestion.source === "fallback" ? (
                // Yapay zekâ olmadan, yalnız kayıtlı bilgiden kurulan taslak: "AI emin" rozeti yanıltıcı olurdu (3d).
                <span
                  data-testid="fallback-draft-badge"
                  className="ml-auto inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                >
                  {FALLBACK_DRAFT_BADGE_TEXT}
                </span>
              ) : (
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
              )}
              {/* ÇIKMAZ (kullanıcı gözlemi, 08-09): panelin KAPATMA yolu YOKTU.
                  `setSuggestion(null)` yalnız İKİ yerde çağrılıyordu — yeni öneri
                  istenince ve mesaj BAŞARIYLA gönderilince. Yani öneriyi beğenmeyen
                  host'un tek çıkışı ya mesaj göndermek ya da sayfadan ayrılmaktı;
                  öneri, konuşmanın geri kalanını okurken ekranda asılı kalıyordu.
                  Aynı dosyadaki şablon paneli (↑`Mesaj Şablonları`) bu düğmeye
                  ZATEN sahip — eksik olan tutarlılıktı. Yalnız istemci durumu
                  temizlenir: sunucuya İSTEK GİTMEZ, hiçbir şey kaydedilmez,
                  "AI öner" düğmesi anında geri gelir (koşulu `!suggestion`). */}
              <button
                type="button"
                onClick={() => setSuggestion(null)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="AI önerisini kapat"
              >
                <X className="size-3.5" />
              </button>
            </div>

            {suggestion.prepared ? (
              <p className="text-xs text-muted-foreground">
                AI bu taslağı sizin için hazırladı; misafire gönderilmedi. Göndermeden önce okuyun.
              </p>
            ) : null}

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
                {/* B1 (kurucu 10-11, "ev sahibi döngüsü"): bilgi tabanı formu mülk / kategori / başlık ön dolu açılır; ev sahibi
                    içeriği yazıp kendisi kaydeder. Mülkü bilinen konuşmada. Öneri paneli zaten yalnız yöneticiye çizilir; bilgi tabanı
                    sayfasının kendi yönetici kapısı da var (`requireManagerSession`). */}
                {propertyId ? (
                  <>
                    {" "}
                    <Link
                      href={kbPrefillHref(propertyId, suggestion.missingInfo[0])}
                      onClick={() => rememberKbPrefillTitle(propertyId, suggestion.missingInfo?.[0] ?? "")}
                      className="font-medium text-primary underline-offset-2 hover:underline"
                    >
                      Bilgi tabanına ekle
                    </Link>
                  </>
                ) : null}
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

            {suggestion.availabilityCheck ? (
              <p
                data-testid="availability-warning"
                className="flex items-start gap-2 rounded-md bg-orange-50 dark:bg-orange-500/10 px-2.5 py-2 text-xs text-orange-800 dark:text-orange-300"
              >
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  <span className="font-medium">Müsaitlik:</span>{" "}
                  {/* Kayıtlı taslakta uyarı modelin beyanı OLMADAN yeniden hesaplandı (kelime ağı + niyet etiketi) → hangi
                      tarafın (misafirin isteği mi, taslağın iddiası mı) tetiklediği ayrılamaz; iki durumda da doğru olan cümle. */}
                  {suggestion.prepared
                    ? "Bu konuşmada tarih, saat ya da müsaitlik konusu var. Misafire söz vermeden önce kanal takviminden kontrol edin."
                    : suggestion.availabilityCheck === "availability_claim"
                    ? "Bu taslak takvim hakkında kesin bir şey söylüyor. Göndermeden önce kanal takviminden kontrol edin."
                    : "Misafir tarih ya da saat değişikliği istiyor. Misafire söz vermeden önce kanal takviminden kontrol edin."}
                </span>
              </p>
            ) : null}

            {suggestion.internalSourceCheck ? (
              <p
                data-testid="internal-source-warning"
                className="flex items-start gap-2 rounded-md bg-orange-50 dark:bg-orange-500/10 px-2.5 py-2 text-xs text-orange-800 dark:text-orange-300"
              >
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  <span className="font-medium">Kaynak cümlesi:</span> Bu taslak bilgiyi nereden aldığını anlatıyor (bilgi tabanı, kayıtlar,
                  notlar gibi). Göndermeden önce o cümleyi çıkarın; misafire yalnız bilginin kendisini yazın.
                </span>
              </p>
            ) : null}

            {suggestion.earlyCheckin && suggestion.earlyCheckin.status !== "not_early" ? (
              <div data-testid="early-checkin-panel" className="space-y-2 rounded-md border border-border bg-card px-3 py-2 text-xs">
                <p className="font-medium">Erken giriş kontrolü</p>
                <ul className="space-y-1">
                  {earlyCheckinPanelLines(suggestion.earlyCheckin).map((line) => (
                    <li
                      key={line.text}
                      className={cn(
                        "flex items-start gap-2",
                        line.info ? "text-muted-foreground" : line.ok ? "text-foreground" : "text-orange-800 dark:text-orange-300",
                      )}
                    >
                      {line.info ? (
                        <Info className="mt-0.5 size-3.5 shrink-0" />
                      ) : line.ok ? (
                        <CheckCheck className="mt-0.5 size-3.5 shrink-0" />
                      ) : (
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      )}
                      <span>{line.text}</span>
                    </li>
                  ))}
                </ul>
                {suggestion.earlyCheckin.draft ? (
                  <div className="space-y-2" data-testid="early-checkin-draft">
                    <p className="text-muted-foreground">
                      {suggestion.earlyCheckin.failed.length === 0
                        ? "Kontroller uygun. Erken giriş için hazır cevap:"
                        : "Erken giriş için hazır cevap (yukarıdaki uyarıları kontrol edip gönderin):"}
                    </p>
                    <p className="whitespace-pre-wrap break-words rounded-md bg-muted p-2 text-sm">{suggestion.earlyCheckin.draft}</p>
                    {canReply ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setComposer(suggestion.earlyCheckin?.draft ?? "");
                          setComposerSource("code");
                        }}
                      >
                        <Wand2 className="size-4" /> Bu cevabı kullan
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            <p className="whitespace-pre-wrap break-words rounded-md bg-card p-3 text-sm">{suggestion.reply}</p>

            {canReply ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setComposer(suggestion.reply);
                    setComposerSource("seeded");
                  }}
                >
                  <Wand2 className="size-4" /> Taslağı kullan
                </Button>
                <Button size="sm" onClick={() => sendReply(suggestion.reply, true, "suggestion", suggestion.anchorMessageId, "approved")} disabled={sending}>
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
      {/* UX-4 (kurucu 11-13: "Gönder tabii ki gözüksün, en iyisini yap"): telefonda (lg altı) sayfa pencereyle kayıyor ve yazma alanı
          kartın en altındaydı — Gönder ilk ekranda yarımdı. İki parça:
          (1) telefonda yazma alanı YAPIŞKAN (`sticky bottom-0`): sayfa nereye kaysa ekranın altında kalır; zemin + üst gölge altından geçen
              içeriği örter, köşe kartın yuvarlamasını izler;
          (2) telefonda Gönder yazma kutusunun YANINDA (iki sütunlu ızgara): klavye açıkken tarayıcı odaktaki kutuyu görünür tutar, aynı
              satırdaki düğme de görünür kalır (alt satırdaki düğme klavyenin altında kalabilirdi).
          lg ve üstünde (masaüstü) yerleşim AYNI: blok akış, düğme altta sağda, kutu 104 px. Hata / kuyruk notu iki sütunu da kaplar. */}
      {canReply ? (
        <div
          data-composer
          className={cn(
            "sticky bottom-0 z-10 grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-2 rounded-b-xl bg-card p-4 shadow-[0_-6px_12px_-8px_rgb(0_0_0/0.25)]",
            "lg:static lg:z-auto lg:block lg:space-y-2 lg:rounded-none lg:shadow-none",
            readingColumnCn,
          )}
        >
          {/* Placeholder bir AD DEĞİLDİR (yazmaya başlayınca kaybolur ve bazı
              ekran okuyucular hiç okumaz) → görünmez ama gerçek bir etiket.
              Gönderim hatası hem alana BAĞLI (aria-describedby + aria-invalid)
              hem de DUYURULUR (role="alert"); eskiden yalnız görsel bir satırdı. */}
          <label htmlFor={`conv-composer-${conversationId}`} className="sr-only">
            Misafire cevabınız
          </label>
          {localOnly ? (
            <p
              id={`conv-local-note-${conversationId}`}
              className="col-span-2 flex items-start gap-2 rounded-md bg-muted px-2.5 py-2 text-xs text-muted-foreground"
            >
              <Info className="mt-0.5 size-3.5 shrink-0" />
              {LOCAL_THREAD_COMPOSER_NOTE}
            </p>
          ) : null}
          <Textarea
            ref={composerRef}
            id={`conv-composer-${conversationId}`}
            value={composer}
            onChange={(e) => {
              setComposer(e.target.value);
              if (!e.target.value.trim()) setComposerSource(null);
            }}
            placeholder="Cevabınızı yazın veya AI önerisini kullanın…"
            // 80 → 160 → 104px. 160 FAZLAYDI: kart artık görünür alana sabit
            // olduğu için yazma kutusunun her fazladan pikseli MESAJ LİSTESİNDEN
            // çalınıyordu (kurucu ölçtü: "mesajlar yeri büyümemiş"). 104px üç
            // satır gösterir; `resize-y` KALIR, uzun cevapta host kendisi büyütür
            // ve büyüttüğünde liste küçülür — tercih host'un.
            // Telefonda 72 px (yapışkan alan ekranın altını az kaplasın); masaüstünde 104 px (aşağıdaki gerekçe).
            className="min-h-[72px] resize-y lg:min-h-[104px]"
            aria-describedby={
              [localOnly ? `conv-local-note-${conversationId}` : null,
               sendError ? `conv-send-error-${conversationId}` : null,
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
              className="col-span-2 flex items-start gap-2 rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive"
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {sendError}
            </p>
          ) : null}
          {queuedNote ? (
            <p
              id={`conv-send-note-${conversationId}`}
              role="status"
              className="col-span-2 rounded-md bg-primary/10 px-2.5 py-2 text-xs text-primary"
            >
              {queuedNote}
            </p>
          ) : null}
          {/* Telefonda ızgaranın 1. satırı, 2. sütunu (kutunun yanı); masaüstünde blok akışta en altta sağda (eskisi gibi). */}
          {/* Kanala bağlı olmayan konuşmada üstte not satırı var → düğme kutuyla aynı (2.) satıra iner. */}
          <div className={cn("col-start-2 flex justify-end", localOnly ? "row-start-2" : "row-start-1")}>
            <Button onClick={() => sendReply(composer, false, "composer", undefined, composerSource ?? undefined)} disabled={sending || !composer.trim()}>
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
