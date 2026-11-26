import "server-only";

import type { HostInboundEvent } from "@/lib/host-channel/types";
import { extractStaffCode } from "./core";
import { confirmStaffBindingFromInbound } from "./service";

// ---------------------------------------------------------------------------
// Temizlikçi numarasına gelen mesajlar (T3). Bu dilim YALNIZ bağlama kodunu işler: kişinin kendi telefonundan gönderdiği `EKIP-XXXXXX` →
// bağ etkin. Kodsuz metin, düğme, medya ve sistem olayı bugün işlenmez (T5: "bitti" / fotoğraf / [Gelemem]) — saklanmaz, cevaplanmaz.
// Cevap mesajı da GİTMEZ (giden temizlikçi numarası T5'te; ev sahibi bağın durumunu Ayarlar'da görür). Yinelenen teslimat zararsızdır:
// doğrulanmış kodun özeti silinir, ikinci kez satır bulmaz. Günlüğe numara / metin yazılmaz.
// ---------------------------------------------------------------------------

/** Tek teslimatta en çok bu kadar mesaj işlenir (imzalı ama olağandışı büyük teslimat). */
const MAX_EVENTS = 50;

export async function handleStaffInbound(input: {
  provider: string;
  events: readonly HostInboundEvent[];
  now?: Date;
}): Promise<{ bound: number; organizationIds: string[] }> {
  let bound = 0;
  const orgs = new Set<string>();
  for (const ev of input.events.slice(0, MAX_EVENTS)) {
    if (ev.kind !== "text") continue;
    const code = extractStaffCode(ev.text);
    if (!code) continue;
    const r = await confirmStaffBindingFromInbound({ provider: input.provider, fromRaw: ev.from, code, now: input.now });
    if (r.ok) {
      bound++;
      orgs.add(r.organizationId);
    }
  }
  return { bound, organizationIds: [...orgs] };
}
