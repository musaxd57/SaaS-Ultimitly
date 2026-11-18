import "server-only";

import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// OTOMATİK MESAJ ADAY TARAMASININ KALICI İLERLEME İMLECİ (Codex 11-17 D2). Şema YOK: durum `SystemLock` satırında (`alert-state.ts`,
// `paddle-replay.ts` emsali). Satır adı `lifecycle-scan:<tür>:<işletme>`; `holder` = kaldığımız aday (`{"at": ISO, "id": …}`) ya da
// boş (tur az önce başa sardı — kayıt yalnız "bekleyen birikim görüldü" işaretidir); `lockedUntil` = son kullanma.
//
// Satırın VARLIĞI da bilgidir: yalnız birikim (okuma sınırını aşan aday kümesi) görülen işletmede satır olur. Sağlıklı işletmede her geçiş
// tek okuma yapar, hiç yazmaz. Okuma / yazma arızası akışı düşürmez: imleç yoksa tarama bugünkü gibi baştan başlar (en kötü sonuç bir
// geçişlik gecikme), yazılamazsa bir sonraki geçiş aynı yeri yeniden okur (kayıp yok, yalnız tekrar).
// ---------------------------------------------------------------------------

/** Taramanın sıralama anahtarı: (tarih, kimlik) ARTAN. */
export type LifecycleScanKey = { at: Date; id: string };

const PREFIX = "lifecycle-scan:";
/** Bu süreden eski imleç yok sayılır (tur baştan başlar; satır işaret olarak kalır). */
export const LIFECYCLE_SCAN_CURSOR_TTL_MS = 24 * 60 * 60_000;

export function lifecycleScanCursorName(kind: string, organizationId: string): string {
  return `${PREFIX}${kind}:${organizationId}`;
}

/** `present` = satır var (birikim görülmüş); `cursor` = geçerli kaldığımız yer (yoksa / bayatsa / bozuksa null). */
export async function readLifecycleScanCursor(
  name: string,
  now: Date,
): Promise<{ present: boolean; cursor: LifecycleScanKey | null }> {
  const row = await prisma.systemLock.findUnique({ where: { name }, select: { holder: true, lockedUntil: true } }).catch(() => null);
  if (!row) return { present: false, cursor: null };
  if (row.lockedUntil.getTime() <= now.getTime() || !row.holder) return { present: true, cursor: null };
  try {
    const h = JSON.parse(row.holder) as { at?: unknown; id?: unknown };
    const at = typeof h.at === "string" ? new Date(h.at) : null;
    if (at && !Number.isNaN(at.getTime()) && typeof h.id === "string" && h.id) return { present: true, cursor: { at, id: h.id } };
  } catch {
    // bozuk kayıt → imleç yok (tur baştan)
  }
  return { present: true, cursor: null };
}

/** İmleci yazar (`cursor` null → "tur başa sardı" işareti). En iyi çaba; asla fırlatmaz. */
export async function writeLifecycleScanCursor(name: string, cursor: LifecycleScanKey | null, now: Date): Promise<void> {
  const holder = cursor ? JSON.stringify({ at: cursor.at.toISOString(), id: cursor.id }) : "";
  const lockedUntil = new Date(now.getTime() + LIFECYCLE_SCAN_CURSOR_TTL_MS);
  await prisma.systemLock.upsert({ where: { name }, create: { name, holder, lockedUntil }, update: { holder, lockedUntil } }).catch(() => {});
}

/** Satırı siler (birikim bitti). Asla fırlatmaz. */
export async function dropLifecycleScanCursor(name: string): Promise<void> {
  await prisma.systemLock.deleteMany({ where: { name } }).catch(() => {});
}
