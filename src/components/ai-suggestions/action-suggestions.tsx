"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { COMMITMENT_TOPIC_LABELS, isCommitmentTopic } from "@/lib/guest-commitments-core";

// Yapay zekâ EYLEM ÖNERİLERİ (⑤ ilk dilim, kurucu 10-12: "öner + tek tıkla onay"). Yalnız sahip / yönetici görür; misafire hiçbir şey
// gitmez. Söz önerisinde gün / saat onaydan önce değiştirilebilir. Görünen metin sade (teknik terim yok).
export interface ActionSuggestionItem {
  key: string;
  kind: "task" | "kb_wifi" | "commitment";
  title: string;
  detail: string;
  evidenceAt: string;
  proposal: Record<string, unknown>;
}

export function ActionSuggestions({ items }: { items: ActionSuggestionItem[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, { day: string; time: string }>>({});
  // Q1-b (kurucu 10-17): aynı saatte birden çok söze uyan konusuz öneride seçim (konu ya da "new" = yeni söz).
  const [attach, setAttach] = useState<Record<string, string>>({});
  // Söz önerisi mevcut söze bağlandıysa kısa bilgi (öneri listeden kalkınca da görünür — kurucu Q1 "a", 10-17).
  const [notice, setNotice] = useState<string | null>(null);
  if (items.length === 0 && !notice) return null;

  async function decide(item: ActionSuggestionItem, decision: "approve" | "dismiss") {
    setBusy(item.key);
    setError(null);
    setNotice(null);
    try {
      const edit = edits[item.key];
      const choice = attach[item.key];
      const res = await fetch("/api/ai-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: item.key,
          decision,
          // Taşıma seçiliyse an seçeneğin kendisidir — gün / saat gönderilmez (Opus gece-4 F9).
          ...(edit && !choice?.startsWith("move:") ? { day: edit.day, time: edit.time } : {}),
          ...(choice && decision === "approve" ? { attach: choice } : {}),
        }),
      });
      if (res.status === 409) {
        startTransition(() => router.refresh()); // öneri artık geçerli değil / başkası karar verdi
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { fields?: Record<string, string> } | null;
        setError(body?.fields ? Object.values(body.fields)[0] : "İşlem yapılamadı. Tekrar deneyin.");
        // Saat geçmişte kaldıysa (sayfa uzun süre açık kaldı) liste yenilensin — öneri artık gösterilmiyorsa kalkar (Haiku 10-17).
        // Seçim gerekli hâle geldiyse (liste ile onay arasında başka bir söz açıldı — Opus 10-17 Q1b-B) de yenilenir: seçenekler görünür.
        if (body?.fields?.time || body?.fields?.attach) startTransition(() => router.refresh());
        return;
      }
      const done = (await res.json().catch(() => null)) as { created?: { merged?: boolean; topicAttached?: boolean; attachedTopic?: unknown } } | null;
      if (done?.created?.merged) {
        const topic = isCommitmentTopic(done.created.attachedTopic) ? done.created.attachedTopic : (item.proposal as { topic?: unknown }).topic;
        setNotice(
          (done.created.topicAttached || done.created.attachedTopic) && isCommitmentTopic(topic)
            ? `Aynı saatte kaydettiğiniz söze bağlandı (${COMMITMENT_TOPIC_LABELS[topic]}); yeni görev açılmadı.`
            : "Aynı saatte kaydettiğiniz söze bağlandı; yeni görev açılmadı.",
        );
      }
      startTransition(() => router.refresh());
    } catch {
      setError("İnternet bağlantınızda sorun var gibi görünüyor. Kontrol edip tekrar deneyin.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2" data-testid="action-suggestions">
      {items.map((s) => {
        const p = s.proposal as {
          day?: string;
          time?: string;
          precision?: string;
          attachTopics?: unknown;
          moveOptions?: unknown;
          dayUnclear?: unknown;
          timeChoices?: unknown;
        };
        // Kurucu T5: saat öğleden önce mi sonra mı belli değil — iki seçenek; seçilmeden onay yok.
        const timeChoices = s.kind === "commitment" && Array.isArray(p.timeChoices) ? p.timeChoices.filter((t): t is string => typeof t === "string") : [];
        // Sözün günü mesajdan okunamadı (D3) — gün önceden seçili gelmez; seçilmeden onay yok.
        const dayUnclear = s.kind === "commitment" && p.dayUnclear === true;
        const attachTopics = Array.isArray(p.attachTopics) ? p.attachTopics.filter(isCommitmentTopic) : [];
        // Bağlamla saat güncellemesi BELİRSİZ (kurucu 10-17 gece: "başka bir şeyi değiştirmemeli"): yeni saat hangi sözün? — seçim zorunlu.
        const moveOptions = Array.isArray(p.moveOptions)
          ? p.moveOptions.filter(
              (o): o is { commitmentId: string; label: string } =>
                typeof o === "object" && o !== null && typeof (o as { commitmentId?: unknown }).commitmentId === "string" && typeof (o as { label?: unknown }).label === "string",
            )
          : [];
        const needsChoice = s.kind === "commitment" && (attachTopics.length >= 2 || moveOptions.length > 0);
        // Taşıma seçildiyse an seçeneğin kendisidir (etikette yazar) — gün seçimi kullanılmaz (sunucu da yok sayar).
        const moving = attach[s.key]?.startsWith("move:") === true;
        const edit = edits[s.key] ?? (s.kind === "commitment" ? { day: dayUnclear ? "" : (p.day ?? "today"), time: p.time ?? "" } : undefined);
        return (
          <div key={s.key} className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-200">
            <div className="flex items-start gap-2">
              <Sparkles className="mt-0.5 size-4 shrink-0" />
              <div className="flex-1">
                <p className="font-medium">{s.title}</p>
                <p className="text-xs opacity-80">{s.detail}</p>
              </div>
            </div>
            {s.kind === "commitment" && edit ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <select
                  aria-label="Gün"
                  className="rounded border bg-background px-1.5 py-1"
                  disabled={moving}
                  value={edit.day}
                  onChange={(e) => setEdits({ ...edits, [s.key]: { ...edit, day: e.target.value } })}
                >
                  {dayUnclear ? (
                    <option value="" disabled>
                      Gün seçin
                    </option>
                  ) : null}
                  <option value="today">Bugün</option>
                  <option value="tomorrow">Yarın</option>
                </select>
                <input
                  aria-label="Saat"
                  type="time"
                  className="rounded border bg-background px-1.5 py-1"
                  disabled={moving}
                  value={edit.time}
                  onChange={(e) => setEdits({ ...edits, [s.key]: { ...edit, time: e.target.value } })}
                />
                {timeChoices.map((t) => (
                  <Button
                    key={t}
                    size="sm"
                    variant={edit.time === t ? "default" : "outline"}
                    onClick={() => setEdits({ ...edits, [s.key]: { ...edit, time: t } })}
                  >
                    {t}
                  </Button>
                ))}
                {/* Saat yazılmamış söz (kurucu 10-17: saat uydurulmaz) — boş bırakılırsa gün / dilim olarak kaydedilir. */}
                {p.precision && p.precision !== "time" && edit.time === "" ? (
                  <span className="opacity-80" data-testid="no-time-hint">Saat belirtilmedi — isterseniz ekleyin</span>
                ) : null}
              </div>
            ) : null}
            {s.kind === "commitment" && moveOptions.length > 0 ? (
              <fieldset className="mt-2 space-y-1 text-xs" data-testid="move-choice">
                <legend className="mb-1 font-medium">Bu saat hangi söze ait?</legend>
                {[...moveOptions.map((o) => [`move:${o.commitmentId}`, `Saatini güncelle: ${o.label}`] as const), ["new", "Ayrı söz olarak kaydet"] as const].map(
                  ([value, label]) => (
                    <label key={value} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`move-${s.key}`}
                        value={value}
                        checked={attach[s.key] === value}
                        onChange={() => setAttach({ ...attach, [s.key]: value })}
                      />
                      {label}
                    </label>
                  ),
                )}
              </fieldset>
            ) : null}
            {s.kind === "commitment" && attachTopics.length >= 2 ? (
              <fieldset className="mt-2 space-y-1 text-xs" data-testid="attach-choice">
                <legend className="mb-1 font-medium">Hangi söze bağlansın?</legend>
                {[...attachTopics.map((t) => [t, `${COMMITMENT_TOPIC_LABELS[t]} sözüne bağla`] as const), ["new", "Yeni söz olarak kaydet"] as const].map(
                  ([value, label]) => (
                    <label key={value} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`attach-${s.key}`}
                        value={value}
                        checked={attach[s.key] === value}
                        onChange={() => setAttach({ ...attach, [s.key]: value })}
                      />
                      {label}
                    </label>
                  ),
                )}
              </fieldset>
            ) : null}
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                disabled={
                  busy !== null || (needsChoice && !attach[s.key]) || (dayUnclear && !moving && !edit?.day) || (timeChoices.length > 0 && !edit?.time)
                }
                onClick={() => decide(s, "approve")}
              >
                Onayla
              </Button>
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => decide(s, "dismiss")}>
                Yok say
              </Button>
            </div>
          </div>
        );
      })}
      {notice ? (
        <p role="status" className="text-xs text-muted-foreground" data-testid="action-suggestion-notice">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
