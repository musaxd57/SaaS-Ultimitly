"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { KB_CATEGORY } from "@/lib/constants";
import { toast } from "@/lib/toast";

/**
 * GEÇMİŞTEN ÖĞREN (migration 65; anahtar `HISTORY_LEARN_ENABLED`). Ev sahibinin geçmiş cevaplarından bilgi tabanı TASLAĞI (müşteri
 * özelliği) + daire için HAZIR yapay zekâ tercihleri (kurucu 10-15: "müşteri hazır seçeneklerden seçsin"). Cevap karşılaştırma ve SERBEST
 * talimat şimdilik yalnız operatör (`canCompare` / `canInstruct` sunucudan).
 * Taslak ev sahibi onaylamadan yapay zekâya GİTMEZ. İşaretli / çelişkili taslakta "Kontrol ettim" işaretlenmeden Onayla kapalıdır (sunucu
 * da `confirmFlags` ister). Müşteri metni sade (kurucu 09-23): ne olduğu + ne yapılacağı.
 */
type Flag =
  | "payment"
  | "needs_edit"
  | "one_off"
  | "ungrounded"
  | "guest_name"
  | "sensitive"
  | "door_mention"
  | "outdated"
  | "time_bound"
  | "tentative"
  | "no_info"
  | "single_source";
export const FLAG_TEXT: Record<Flag, string> = {
  payment: "Ödeme yöntemi ya da platform dışı ödeme / rezervasyon geçiyor. Kontrol edin.",
  needs_edit: "Gizlenmiş bir bilgi var (telefon, kod ya da ad). Metni düzenleyin.",
  one_off: "Tek seferlik bir karar gibi görünüyor (indirim, geç çıkış vb.). Herkes için geçerliyse onaylayın, değilse reddedin.",
  ungrounded: "Bir değer cevaplarınızda birebir bulunamadı. Doğruluğunu kontrol edin.",
  guest_name: "Bir misafir adı geçiyor olabilir. Adı metinden çıkarın.",
  sensitive: "Kişisel bilgi (telefon, e-posta, IBAN) geçiyor olabilir. Gerekmiyorsa metinden çıkarın.",
  door_mention: "Kapı ya da anahtar kutusu kodundan söz ediyor. Kodun kendisinin yazılmadığından emin olun.",
  outdated: "Daha yeni bir cevabınız farklı. Bu bilgi eskimişse reddedin.",
  time_bound: "Belirli bir güne ya da geçici bir duruma bağlı görünüyor (yarın, bu hafta, şu an). Her zaman geçerliyse onaylayın, değilse reddedin.",
  tentative: "Kesin bir çözüm değil, bir deneme gibi görünüyor (belki, deneyin). Doğrulanmış değilse reddedin.",
  no_info: "Bilginin olmadığını söylüyor. Bu kayıt misafire yardım etmez; reddedin ya da bilgiyi yazın.",
  single_source: "Yalnız bir misafirle konuşmanızda geçti ve o misafire özel görünüyor. Herkes için geçerliyse onaylayın, değilse reddedin.",
};

/** Hata gövdesinden gösterilecek metin: alan mesajı ÖNCE (`badRequest` genel "Doğrulama hatası" + `fields` döner). */
function errorText(body: { error?: string; fields?: Record<string, string> }, fallback: string): string {
  return Object.values(body.fields ?? {})[0] ?? body.error ?? fallback;
}

interface Draft {
  id: string;
  category: string;
  title: string;
  content: string;
  supportConversations: number;
  newestMonth: string | null;
  oldestMonth: string | null;
  conflict: boolean;
  conflictNote: string | null;
  /** "Böyle yapsın" notundan doğdu (geçmiş cevaplardan değil). */
  fromNote?: boolean;
  flags: Flag[];
  /** Taslağın dayandığı kendi cevabınızdan maskeli örnek + ay (canlı satır; silinmişse yok). */
  sample?: { text: string; month: string } | null;
  /** L2: bilgi tabanında aynı konudaki etkin kalemler (onayda seçim istenir). */
  kbMatches?: KbMatch[];
}
interface KbMatch {
  id: string;
  title: string;
  preview: string;
  kind: "differs" | "same" | "topic";
}
/** L2 eşleşme türü — ev sahibine sade dille (kurucu 09-23). */
const MATCH_KIND_TEXT: Record<KbMatch["kind"], string> = {
  differs: "Kayıtlı değer farklı",
  same: "Bu bilgi zaten kayıtlı",
  topic: "Aynı konu",
};
type Resolution = { mode: "replace"; id: string } | { mode: "separate" } | null;
interface Run {
  id: string;
  kind?: string;
  status: string;
  errorCode: string | null;
  pairCount: number;
  draftCount: number;
}
interface Instruction {
  id: string;
  content: string;
}
interface Preset {
  key: string;
  label: string;
  description: string;
  on: boolean;
}
interface Comparison {
  id: string;
  question: string | null;
  hostAnswer: string | null;
  aiAnswer: string | null;
  wouldAutoSend: boolean | null;
  closing?: boolean;
  verdict: string | null;
  note: string | null;
}

const VERDICTS: { value: "good" | "fix" | "bad"; label: string }[] = [
  { value: "good", label: "İyi" },
  { value: "fix", label: "Düzeltilmeli" },
  { value: "bad", label: "Kötü" },
];

/**
 * Cevap karşılaştırma kartı (F1): sizin o zamanki cevabınız ↔ bugünkü yapay zekânın cevabı (GÖNDERİLMEDİ). Karar + not; "Böyle yapsın"
 * notu HEM bu daire için talimat HEM bilgi tabanı taslağı olur (kurucu 10-15) — taslak yine onayınızı bekler.
 */
function ComparisonCard({ c, canInstruct, onDone }: { c: Comparison; canInstruct: boolean; onDone: () => void }) {
  const [verdict, setVerdict] = useState(c.verdict);
  const [note, setNote] = useState(c.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(apply: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/history-learn/comparisons/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // Görülen cevap gönderilir: arada yeniden karşılaştırma cevabı değiştirdiyse sunucu kararı yazmaz (409) ve liste yenilenir.
        body: JSON.stringify({ verdict, note: note.trim() || null, apply, seenAnswer: c.aiAnswer }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; fields?: Record<string, string> };
        setError(errorText(body, "Kaydedilemedi."));
        // Kart yenilenecek (yeni cevap) — mesaj kaybolmasın diye bildirim olarak da gösterilir.
        if (res.status === 409 || res.status === 404) {
          toast.error(errorText(body, "Kaydedilemedi."));
          onDone();
        }
        return;
      }
      toast.success(apply ? "Talimat eklendi; bilgi tabanı taslağı onayınızı bekliyor." : "Kaydedildi.");
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border p-3" data-testid="history-learn-comparison">
      <p className="text-xs text-muted-foreground">Misafir sordu</p>
      <p className="whitespace-pre-wrap text-sm">{c.question ?? "Mesaj artık yok."}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Sizin cevabınız</p>
          <p className="whitespace-pre-wrap text-sm">{c.hostAnswer ?? "Mesaj artık yok."}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            Yapay zekâ bugün böyle cevaplardı{" "}
            {c.wouldAutoSend === true ? "(kendiliğinden gönderirdi)" : c.wouldAutoSend === false ? "(size bırakırdı)" : ""}
          </p>
          <p className="whitespace-pre-wrap text-sm">
            {c.closing ? "Cevap gerekmez (misafir konuşmayı kapatıyor)." : (c.aiAnswer ?? "Cevap üretilemedi.")}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {VERDICTS.map((v) => (
          <Button
            key={v.value}
            size="sm"
            variant={verdict === v.value ? "default" : "outline"}
            aria-pressed={verdict === v.value}
            onClick={() => setVerdict(v.value)}
            disabled={busy}
          >
            {v.label}
          </Button>
        ))}
      </div>
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
        rows={2}
        placeholder="Yapay zekâ böyle bir soruda nasıl davranmalı? Örnek: Cevabı kısa tutsun ve otopark sorusunda önce binanın arkasındaki yeri anlatsın."
        aria-label="Not"
        disabled={busy}
      />
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => save(false)} disabled={busy || !verdict}>
          Kaydet
        </Button>
        {/* "Böyle yapsın" serbest metin talimat yazar → yalnız serbest metin yetkisi olana (sunucu da reddeder). */}
        {canInstruct ? (
          <Button size="sm" onClick={() => save(true)} disabled={busy || !note.trim()}>
            {busy ? <Loader2 className="animate-spin" /> : null} Böyle yapsın
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function runLine(run: Run | undefined): string | null {
  if (!run) return null;
  if (run.status === "queued" || run.status === "running")
    return run.kind === "compare" ? "Cevaplar karşılaştırılıyor. Bu birkaç dakika sürebilir." : "Geçmiş mesajlar okunuyor. Bu birkaç dakika sürebilir.";
  if (run.status === "failed") return "İşlem tamamlanamadı. Biraz sonra tekrar deneyin.";
  if (run.kind === "compare") return `Son karşılaştırma: ${run.draftCount} soru karşılaştırıldı.`;
  return `Son okuma: ${run.pairCount} soru okundu, ${run.draftCount} taslak çıktı.`;
}

function DraftCard({ draft, onDone }: { draft: Draft; onDone: () => void }) {
  const [title, setTitle] = useState(draft.title);
  const [content, setContent] = useState(draft.content);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Sunucu düzenlenen metinde YENİ bir işaret bulursa (409 needsConfirm) kutu ve uyarılar onunla açılır — ev sahibi kilitlenmez.
  const [serverFlags, setServerFlags] = useState<Flag[]>([]);
  const flags = [...new Set([...draft.flags, ...serverFlags])];
  const needsCheck = flags.length > 0 || draft.conflict;
  // L2 (kurucu 10-17 "daha güncel olanı seçince o artık doğru olsun"): aynı konudaki kalem varsa seçim — yerine koy / ayrı ekle (vazgeç =
  // onaylamamak). Sunucu onayda eşleşmeleri işlem içinde yeniden hesaplar (409 needsResolution → liste güncellenir).
  const [matches, setMatches] = useState<KbMatch[]>(draft.kbMatches ?? []);
  const [resolution, setResolution] = useState<Resolution>(null);
  const needsResolution = matches.length > 0;

  async function act(action: "approve" | "reject") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/history-learn/drafts/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "approve"
            ? {
                action,
                title,
                content,
                confirmFlags: checked,
                ...(resolution?.mode === "replace" ? { resolution: "replace", replaceKbItemId: resolution.id } : {}),
                ...(resolution?.mode === "separate" ? { resolution: "separate" } : {}),
              }
            : { action },
        ),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          fields?: Record<string, string>;
          needsConfirm?: boolean;
          flags?: Flag[];
          needsResolution?: boolean;
          matches?: KbMatch[];
        };
        if (body.needsConfirm) {
          setServerFlags((body.flags ?? []).filter((f): f is Flag => f in FLAG_TEXT));
          setChecked(false);
        }
        if (body.needsResolution) {
          setMatches(body.matches ?? []);
          setResolution(null);
        }
        setError(errorText(body, "İşlem yapılamadı. Tekrar deneyin."));
        // Taslak başka sekmede işlendi / silindi → liste yenilenir, ölü kart kalmaz (seçim / onay isteyen 409'lar kartta kalır).
        if (res.status === 404 || (res.status === 409 && !body.needsConfirm && !body.needsResolution)) onDone();
        return;
      }
      toast.success(
        action === "approve"
          ? resolution?.mode === "replace"
            ? "Bilgi tabanına eklendi; eski kayıt pasife alındı (Bilgi Tabanı'ndan geri açabilirsiniz)."
            : "Bilgi tabanına eklendi."
          : "Taslak reddedildi.",
      );
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border p-3" data-testid="history-learn-draft">
      <div className="flex items-center justify-between gap-2">
        <Badge tone={KB_CATEGORY.tone(draft.category)}>{KB_CATEGORY.label(draft.category)}</Badge>
        <span className="text-xs text-muted-foreground">
          {draft.fromNote ? "Sizin notunuzdan" : `${draft.supportConversations} konuşmadaki cevaplarınızdan`}
          {!draft.fromNote && draft.newestMonth ? ` · son ${draft.newestMonth}` : ""}
        </span>
      </div>
      <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} aria-label="Başlık" disabled={busy} />
      <Textarea value={content} onChange={(e) => setContent(e.target.value)} maxLength={2000} rows={3} aria-label="İçerik" disabled={busy} />
      {draft.sample ? (
        <p className="rounded-md bg-muted/50 px-2.5 py-2 text-xs text-muted-foreground" data-testid="history-learn-sample">
          {draft.fromNote ? "Karşılaştırılan eski cevabınız" : "Örnek cevabınız"} ({draft.sample.month}):{" "}
          <span className="whitespace-pre-wrap">“{draft.sample.text}”</span>
        </p>
      ) : null}
      {draft.conflict ? (
        <p className="rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          Cevaplarınız bu konuda farklı. {draft.conflictNote ?? ""}
        </p>
      ) : null}
      {flags.length ? (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-800 dark:text-amber-300">
          {flags.map((f) => (
            <li key={f}>{FLAG_TEXT[f]}</li>
          ))}
        </ul>
      ) : null}
      {needsResolution ? (
        <fieldset className="space-y-1.5 rounded-md border border-amber-200 px-2.5 py-2 text-xs dark:border-amber-500/25" data-testid="history-learn-kb-match">
          <legend className="px-1 font-medium">Bilgi tabanınızda bu konuda kayıt var</legend>
          {matches.map((m) => (
            <label key={m.id} className="flex items-start gap-2">
              <input
                type="radio"
                name={`resolution-${draft.id}`}
                checked={resolution?.mode === "replace" && resolution.id === m.id}
                onChange={() => setResolution({ mode: "replace", id: m.id })}
                disabled={busy}
                className="mt-0.5"
              />
              <span>
                <strong>«{m.title}»</strong> kaydının yerine koy <span className="text-muted-foreground">({MATCH_KIND_TEXT[m.kind]})</span>
                <span className="block whitespace-pre-wrap text-muted-foreground">“{m.preview}”</span>
              </span>
            </label>
          ))}
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={`resolution-${draft.id}`}
              checked={resolution?.mode === "separate"}
              onChange={() => setResolution({ mode: "separate" })}
              disabled={busy}
            />
            Ayrı kayıt olarak ekle (ikisi de kalsın)
          </label>
          <p className="text-muted-foreground">Yerine koyarsanız eski kayıt silinmez, pasife alınır; Bilgi Tabanı&apos;ndan geri açabilirsiniz.</p>
        </fieldset>
      ) : null}
      {needsCheck ? (
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} disabled={busy} />
          Kontrol ettim, bilgi doğru.
        </label>
      ) : null}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => act("approve")} disabled={busy || (needsCheck && !checked) || (needsResolution && !resolution)}>
          {busy ? <Loader2 className="animate-spin" /> : null} Onayla
        </Button>
        <Button size="sm" variant="outline" onClick={() => act("reject")} disabled={busy}>
          Reddet
        </Button>
      </div>
    </div>
  );
}

export function HistoryLearnPanel({
  propertyId,
  canCompare = false,
  canInstruct = false,
  instructionsActive = false,
}: {
  propertyId: string;
  /** Cevap karşılaştırma — şimdilik yalnız operatör (sunucu `historyCompareAllowed`). */
  canCompare?: boolean;
  /** Daire talimatları — şimdilik yalnız operatör (sunucu `propertyInstructionsAllowed`). */
  canInstruct?: boolean;
  /** Talimatlar cevap istemine giriyor mu (`PROPERTY_INSTRUCTIONS_PROMPT_ENABLED`). Kapalıyken ekranda söylenir. */
  instructionsActive?: boolean;
}) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [instructions, setInstructions] = useState<Instruction[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetBusy, setPresetBusy] = useState<ReadonlySet<string>>(new Set());
  const [comparisons, setComparisons] = useState<Comparison[]>([]);
  const [newInstruction, setNewInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Sayfadan çıkınca yoklama durur; aynı anda TEK yoklama zinciri (çift başlatma ve geç dönen istek yeni zamanlayıcı kurmaz).
  const alive = useRef(true);
  const polling = useRef(false);
  // Tercih değişince artar: o anda yolda olan (değişiklikten ÖNCE başlamış) okuma kutucukları eski hâline döndürmez.
  const presetEpoch = useRef(0);
  // Yolda olan tercih yazımı sayısı + yazım sırası: sunucunun döndürdüğü liste yalnız TEK yazım varken uygulanır; birden çok yazım
  // yoldaysa SON yazım dönünce liste sunucudan yeniden okunur (sıra dışı dönen cevap eski durumu geri getirmez — Haiku 10-15).
  const presetInflight = useRef(0);
  const presetOverlap = useRef(false);

  const load = useCallback(async () => {
    const epoch = presetEpoch.current;
    const [a, b] = await Promise.all([
      fetch(`/api/properties/${propertyId}/history-learn`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      // Hazır seçenekler herkese (müşteri dahil); serbest metin listesi sunucuda yalnız operatöre doldurulur.
      fetch(`/api/properties/${propertyId}/instructions`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    if (!alive.current) return undefined;
    if (a) {
      setRuns(a.runs);
      setDrafts(a.drafts);
      setComparisons(a.comparisons ?? []);
    }
    if (b) {
      setInstructions(b.instructions ?? []);
      if (epoch === presetEpoch.current) setPresets(b.presets ?? []);
    }
    return { latest: a?.runs?.[0] as Run | undefined, failed: !a };
  }, [propertyId]);

  const poll = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      for (let failures = 0; alive.current; ) {
        const r = await load();
        if (!r) return;
        failures = r.failed ? failures + 1 : 0;
        const running = r.latest && (r.latest.status === "queued" || r.latest.status === "running");
        // Üst üste 3 okuma hatası → dur ve söyle (sonsuz döngü yok); iş bitti → dur.
        if (failures >= 3) {
          setError("Durum okunamadı. Sayfayı yenileyin.");
          return;
        }
        if (!running && !r.failed) return;
        await new Promise<void>((resolve) => {
          timer.current = setTimeout(resolve, 4000);
        });
      }
    } finally {
      polling.current = false;
    }
  }, [load]);

  useEffect(() => {
    alive.current = true;
    void poll();
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [poll]);

  async function start(kind: "learn" | "compare") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/properties/${propertyId}/history-learn${kind === "compare" ? "/compare" : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questions: 300 }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; fields?: Record<string, string> };
        setError(errorText(body, "Başlatılamadı. Tekrar deneyin."));
        return;
      }
      void poll();
    } finally {
      setBusy(false);
    }
  }

  async function addInstruction() {
    setError(null);
    const res = await fetch(`/api/properties/${propertyId}/instructions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: newInstruction }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; fields?: Record<string, string> };
      setError(errorText(body, "Kaydedilemedi."));
      return;
    }
    setNewInstruction("");
    toast.success("Talimat eklendi.");
    void load();
  }

  async function togglePreset(key: string, on: boolean) {
    setPresetBusy((b) => new Set(b).add(key));
    setError(null);
    presetEpoch.current += 1;
    presetInflight.current += 1;
    if (presetInflight.current > 1) presetOverlap.current = true;
    // İyimser güncelleme; sunucunun döndürdüğü güncel liste ekranı eşitler, hata (ağ dahil) olursa geri alınır.
    setPresets((ps) => ps.map((p) => (p.key === key ? { ...p, on } : p)));
    try {
      const res = await fetch(`/api/properties/${propertyId}/instructions/presets`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, on }),
      });
      const body = res.ok ? ((await res.json().catch(() => null)) as { presets?: Preset[] } | null) : null;
      if (!res.ok) throw new Error(String(res.status));
      presetEpoch.current += 1;
      if (body?.presets && presetInflight.current === 1 && !presetOverlap.current) setPresets(body.presets);
    } catch {
      presetEpoch.current += 1;
      setPresets((ps) => ps.map((p) => (p.key === key ? { ...p, on: !on } : p)));
      setError("Tercih kaydedilemedi. Tekrar deneyin.");
      // Yazım sunucuda tamamlanıp yalnız cevap kaybolmuş olabilir (Haiku 10-15): gerçek durum yeniden okunur.
      presetOverlap.current = true;
    } finally {
      presetInflight.current -= 1;
      if (presetInflight.current === 0 && presetOverlap.current) {
        presetOverlap.current = false;
        void load();
      }
      setPresetBusy((b) => {
        const next = new Set(b);
        next.delete(key);
        return next;
      });
    }
  }

  async function removeInstruction(id: string) {
    const res = await fetch(`/api/properties/${propertyId}/instructions/${id}`, { method: "DELETE" });
    if (res.ok) void load();
    else setError("Talimat kaldırılamadı. Tekrar deneyin.");
  }

  const latest = runs[0];
  const running = latest?.status === "queued" || latest?.status === "running";
  return (
    <div className="space-y-4" data-testid="history-learn-panel">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Misafirlerin geçmişte sorduğu soruları ve sizin cevaplarınızı okur, bilgi tabanı için taslak hazırlar. Taslaklar siz onaylamadan
          kullanılmaz. Okuma genellikle 1–2 dakika sürer.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => start("learn")} disabled={busy || running}>
            {busy || running ? <Loader2 className="animate-spin" /> : null} Geçmişi oku
          </Button>
          {canCompare ? (
            <Button size="sm" variant="outline" onClick={() => start("compare")} disabled={busy || running}>
              Cevapları karşılaştır
            </Button>
          ) : null}
        </div>
        {runLine(latest) ? (
          <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
            {runLine(latest)}
          </p>
        ) : null}
      </div>
      {drafts.length ? (
        <div className="space-y-2">
          {drafts.map((d) => (
            <DraftCard key={d.id} draft={d} onDone={() => void load()} />
          ))}
        </div>
      ) : null}
      {canCompare && comparisons.length ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">Cevap karşılaştırma</p>
          <p className="text-xs text-muted-foreground">Geçmiş sorulara bugünkü yapay zekânın cevabı. Bu cevaplar misafire gönderilmedi.</p>
          {comparisons.map((c) => (
            // Yapay zekâ cevabı değişince sunucu kararı sıfırlar; kart da yeniden kurulur (eski seçim yeni cevaba gönderilmesin — Haiku 10-15).
            <ComparisonCard key={`${c.id}:${c.verdict ?? ""}:${c.aiAnswer ?? ""}`} c={c} canInstruct={canInstruct} onDone={() => void load()} />
          ))}
        </div>
      ) : null}
      {presets.length ? (
        <fieldset className="space-y-2" data-testid="instruction-presets">
          <legend className="text-sm font-medium">Bu daire için yapay zekâ tercihleri</legend>
          <p className="text-xs text-muted-foreground">Yapay zekânın bu dairede nasıl yazacağını seçin. Güvenlik kuralları her zaman önce gelir.</p>
          {/* Müşteri tercihleri yalnız cevaba uygulanırken görür (sunucu `presetsAvailable`); bu uyarı yalnız operatöre. */}
          {canInstruct && !instructionsActive ? (
            <p className="text-xs text-amber-800 dark:text-amber-300">Tercihler şu an cevaplara uygulanmıyor (anahtar kapalı).</p>
          ) : null}
          {presets.map((p) => (
            <label key={p.key} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={p.on}
                disabled={presetBusy.has(p.key)}
                onChange={(e) => togglePreset(p.key, e.target.checked)}
                aria-describedby={`preset-${p.key}-d`}
              />
              <span>
                <span className="font-medium">{p.label}</span>
                <span id={`preset-${p.key}-d`} className="block text-xs text-muted-foreground">
                  {p.description}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}
      {canInstruct ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">Serbest talimat (yalnız operatör)</p>
          <p className="text-xs text-muted-foreground">
            Yapay zekânın bu dairede nasıl cevap vermesini istediğinizi yazın. Güvenlik kuralları her zaman önce gelir.
          </p>
          {instructions.map((i) => (
            <div key={i.id} className="flex items-start justify-between gap-2 text-sm">
              <span>{i.content}</span>
              <Button size="sm" variant="ghost" onClick={() => removeInstruction(i.id)} aria-label={`Talimatı kaldır: ${i.content.slice(0, 40)}`}>
                Kaldır
              </Button>
            </div>
          ))}
          <Textarea
            value={newInstruction}
            onChange={(e) => setNewInstruction(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="Örnek: Cevapları kısa tutsun, emoji kullanmasın."
            aria-label="Yeni talimat"
          />
          <Button size="sm" variant="outline" onClick={addInstruction} disabled={!newInstruction.trim()}>
            Talimat ekle
          </Button>
        </div>
      ) : null}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
