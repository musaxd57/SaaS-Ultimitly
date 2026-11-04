import "server-only";

import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/event-log";
import { BLOCK_KINDS, type ActiveBlock, type BlockKind } from "./decision";

// ---------------------------------------------------------------------------
// KONUŞMA KONTROLÜ — ENGEL KAYDI (G0 gölge; tasarım `docs/TASARIM-2026-11-04-konusma-kontrolu.md` §3 / §11).
//
// Bugün `problem` yazan yollar (model · kelime · doğrulanamayan tehlike · QR tehlikesi) yanında bir engel satırı da açar. G0'da hiçbir karar
// bu satıra bakmaz; yalnız gölge kıyasının girdisidir. Bu yüzden yazıcı EN İYİ ÇABADIR: asla fırlatmaz, bugünkü akışı düşüremez; yazılamayan
// satır ölçüm boşluğu olarak SAYILIR (olay günlüğü). Kanıt kısa kapalı-küme koddur — misafir metni taşımaz (KVKK).
// Tekrar güvenli: `(conversationId, kind, sourceMessageId)` tekil → aynı mesajın yeniden işlenmesi ikinci satır açmaz; yeni tehlike mesajı
// (konuşma zaten `problem` olsa da) yeni satırdır.
// ---------------------------------------------------------------------------

/** Kanıt kodu: `kaynak:etiket` (ör. `model:safety_emergency`), en çok 64 karakter, yalnız güvenli karakterler. */
const EVIDENCE_RE = /^[a-z_]{1,24}:[a-z0-9_]{1,39}$/;

export interface OpenBlockInput {
  organizationId: string;
  conversationId: string;
  kind: BlockKind;
  /** Tetikleyen misafir mesajı. */
  sourceMessageId: string;
  evidence: string;
  scope?: "conversation" | "item";
  itemId?: string | null;
}

/** Engel satırı açar (yoksa). Döner: `true` yazıldı · `false` zaten vardı · `null` yazılamadı (sayıldı). Asla fırlatmaz. */
export async function openBlockBestEffort(input: OpenBlockInput): Promise<boolean | null> {
  try {
    if (!(BLOCK_KINDS as readonly string[]).includes(input.kind)) return null;
    const scope = input.scope ?? "conversation";
    const res = await prisma.conversationBlock.createMany({
      data: [
        {
          organizationId: input.organizationId,
          conversationId: input.conversationId,
          kind: input.kind,
          scope,
          itemId: scope === "item" ? (input.itemId ?? null) : null,
          sourceMessageId: input.sourceMessageId,
          evidence: EVIDENCE_RE.test(input.evidence) ? input.evidence : null,
        },
      ],
      skipDuplicates: true,
    });
    return res.count === 1;
  } catch {
    await logEvent("conversation_control.block_write_failed", { reason: input.kind }, { organizationId: input.organizationId }).catch(() => null);
    return null;
  }
}

/** Konuşmanın AKTİF engelleri (gölge kıyasın girdisi). Okunamazsa `null` (kıyas o turda yapılmaz — sahte ayrışma sayılmaz). */
export async function activeBlocksOf(conversationId: string): Promise<ActiveBlock[] | null> {
  try {
    const rows = await prisma.conversationBlock.findMany({
      where: { conversationId, status: "active" },
      select: { kind: true, scope: true, itemId: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 50,
    });
    const out: ActiveBlock[] = [];
    for (const r of rows) {
      if (!(BLOCK_KINDS as readonly string[]).includes(r.kind)) continue;
      out.push({ kind: r.kind as BlockKind, scope: r.scope === "item" ? "item" : "conversation", itemId: r.itemId });
    }
    return out;
  } catch {
    return null;
  }
}
