"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { FactorAssign } from "@/lib/readiness-list/evaluate";
import { toast } from "@/lib/toast";

// ---------------------------------------------------------------------------
// UX-10 D3 (kurucu 11-13: "ilk 2'si kesinlikle olur"): Girişler satırından görevi doğrudan atama. Önce kişi seçilir, sonra "Atayın" düğmesi
// atar (Opus 11-13 P2-7: seçimde hemen yazan kapalı açılır liste, klavyede ok tuşu / harf yazmakla YANLIŞ kişiyi atayıp e-posta
// gönderiyordu — WCAG 3.2.2; seçim ile eylem ayrıldı). Atanan kişiye panodan atamayla AYNI "Yeni Görev" e-postası gider (sunucunun var olan yan etkisi). Sunucuya satırın
// gördüğü atanan ön şart olarak gider (`expectAssignedToId`): sayfa telefonda saatlerce açık kalır; bu arada görev başkasına atandıysa ya da
// iş başladıysa yazma OLMAZ, liste yenilenir. Yazma sonrası liste sunucuda yeniden değerlendirilir (iyimser güncelleme yok — atamak hazırlık
// kanıtı değildir). Tasarım: scratchpad/handoff/UX-10-girisler-tasarim.md §1.2 E1.
// ---------------------------------------------------------------------------

export const ASSIGN_LABEL: Record<FactorAssign["mode"], string> = {
  assign: "Birini atayın",
  reassign: "Başkasına atayın",
  change: "Değiştirin",
};

export const ASSIGN_ERROR = {
  assignee_changed: "Bu görev bu arada başka birine atandı. Liste yenilendi.",
  task_moved_on: "Bu iş bu arada başladı ya da bitti. Liste yenilendi.",
  task_gone: "Bu görev silinmiş. Liste yenilendi.",
  member_gone: "Bu kişi artık ekibinizde değil.",
  network: "Bağlantı hatası. Lütfen tekrar deneyin.",
  generic: "Görev atanamadı. Lütfen tekrar deneyin.",
} as const;

/** Sunucu cevabından kullanıcıya gidecek cümle + liste yenilensin mi (saf; testli). */
export function assignErrorOf(status: number, body: { code?: string; error?: string; fields?: Record<string, string> } | null): {
  message: string;
  refresh: boolean;
} {
  if (status === 409 && body?.code === "assignee_changed") return { message: ASSIGN_ERROR.assignee_changed, refresh: true };
  if (status === 409 && body?.code === "task_moved_on") return { message: ASSIGN_ERROR.task_moved_on, refresh: true };
  if (status === 400 && body?.fields?.assignedToId) return { message: ASSIGN_ERROR.member_gone, refresh: true };
  // Görev başka sekmede silinmiş (Opus P3-6): liste yenilenir, ölü görev sunulmaya devam etmez.
  if (status === 404) return { message: ASSIGN_ERROR.task_gone, refresh: true };
  // Yetki / bürünme: sunucunun sade cümlesi (ör. "Destek görünümü salt okunurdur…").
  if ((status === 403 || status === 401) && body?.error) return { message: body.error, refresh: false };
  return { message: ASSIGN_ERROR.generic, refresh: false };
}

export function AssignTask({
  assign,
  members,
  context,
}: {
  assign: FactorAssign;
  members: { id: string; name: string }[];
  /** Satırın kısa durumu — ekran okuyucuda hangi görev olduğu belli olsun (bir satırda birden çok kutu olabilir; Opus P3-8). */
  context?: string;
}) {
  const router = useRouter();
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const id = useId();
  const options = members.filter((m) => m.id !== assign.expectAssigneeId);

  async function choose(assignedToId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(assign.taskId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // "Atanmadı" = boş kimlik (pano ile aynı sözleşme); ön şartta boş dize = "atanmamış bekliyorum".
        body: JSON.stringify({ assignedToId, expectAssignedToId: assign.expectAssigneeId ?? "" }),
      });
      if (res.ok) {
        setChoice("");
        startTransition(() => router.refresh());
        return;
      }
      const body = (await res.json().catch(() => null)) as { code?: string; error?: string; fields?: Record<string, string> } | null;
      const out = assignErrorOf(res.status, body);
      if (out.refresh) {
        // Yenilenen satırda bu kutu kalmayabilir (iş başladı / görev silindi) → uyarı satıra değil bildirime gider (Opus P3-5: satırın
        // altındaki cümle yenilemeyle ya kayboluyor ya başka satırın altına kayıyordu).
        toast.error(out.message);
        setChoice("");
        startTransition(() => router.refresh());
      } else {
        setError(out.message);
      }
    } catch {
      setError(ASSIGN_ERROR.network);
    } finally {
      setBusy(false);
    }
  }

  if (options.length === 0 && assign.mode !== "change") return null;
  const label = ASSIGN_LABEL[assign.mode];
  return (
    <span className="inline-flex flex-col" data-assign-task={assign.mode}>
      <span className="inline-flex flex-wrap items-center gap-1">
      <label htmlFor={id} className="sr-only">
        {context ? `${label} — ${context}` : label}
      </label>
      <select
        id={id}
        value={choice}
        disabled={busy}
        aria-describedby={error ? `${id}-error` : undefined}
        // Seçim yalnız durumu değiştirir; atama "Atayın" düğmesinde (klavyede ok tuşu kimseyi atamaz).
        onChange={(e) => {
          setChoice(e.target.value);
          setError(null);
        }}
        className="inline-flex min-h-10 cursor-pointer appearance-none rounded-md border border-input bg-card px-2 text-sm font-medium text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 sm:min-h-8"
      >
        <option value="" disabled hidden>
          {label}
        </option>
        {options.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
        {assign.mode === "change" ? <option value="__none">Atanmadı</option> : null}
      </select>
      {choice ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void choose(choice === "__none" ? "" : choice)}
          className="inline-flex min-h-10 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 sm:min-h-8"
        >
          {busy ? "Atanıyor…" : "Atayın"}
        </button>
      ) : null}
      </span>
      {error ? (
        <span id={`${id}-error`} role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </span>
  );
}
