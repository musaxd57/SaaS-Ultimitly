import { Activity, AlertTriangle } from "lucide-react";

export interface ChannelHealthRow {
  id: string;
  text: string;
  /** Uyarı tonu: hata ya da bayat okuma. */
  warn: boolean;
}

/**
 * Kanal bağlantısı sağlığı satırı (V0 §2f, sağlayıcıdan bağımsız — `lib/channels/health.ts`). Ölçüm yoksa hiçbir şey çizilmez (sahte
 * "sağlıklı" yok). Metin sade: ne oldu + ne yapmalı.
 */
export function ChannelHealthLines({ rows }: { rows: ChannelHealthRow[] }) {
  if (rows.length === 0) return null;
  return (
    <ul className="mt-3 space-y-1" data-testid="channel-health">
      {rows.map((r) => (
        <li
          key={r.id}
          className={`flex items-start gap-2 text-xs ${r.warn ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}
        >
          {r.warn ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> : <Activity className="mt-0.5 size-3.5 shrink-0" />}
          <span>{r.text}</span>
        </li>
      ))}
    </ul>
  );
}
