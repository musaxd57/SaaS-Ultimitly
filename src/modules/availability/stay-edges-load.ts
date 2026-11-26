import "server-only";

import { addNights, calendarDateOf, statusClassOf } from "./core";
import { loadAvailabilityInputs } from "./load";
import { describeStayEdges, summarizeStayEdges, STAY_EDGE_LOOKAHEAD_NIGHTS, type StayEdgeSummary } from "./stay-edges";

// ---------------------------------------------------------------------------
// Konuşma sayfası için konaklama kenarları (host görünümü). Kiracı kapalı: yükleyici yalnız
// `organizationId`nin mülklerini döndürür; başka org'un mülkü haritada YOKTUR → `null` (kart
// gizlenir, "boş" DENMEZ). Hata sayfayı düşürmez: panel yardımcıdır, ürünün kendisi değil.
// ---------------------------------------------------------------------------

export async function loadStayEdgeSummary(
  organizationId: string,
  propertyId: string,
  stay: { id: string; arrival: Date; departure: Date; status: string },
  opts: { timeZone: string; now?: Date },
): Promise<StayEdgeSummary | null> {
  // İptal edilmiş konaklamanın kenarları sorulmaz (misafir artık gelmiyor).
  if (statusClassOf(stay.status) === "ignored") return null;
  const now = opts.now ?? new Date();
  const arrival = calendarDateOf(stay.arrival, opts.timeZone).key;
  const departure = calendarDateOf(stay.departure, opts.timeZone).key;
  if (!(arrival < departure)) return null;
  try {
    const loaded = await loadAvailabilityInputs(organizationId, {
      propertyIds: [propertyId],
      range: { from: addNights(arrival, -1), to: addNights(departure, STAY_EDGE_LOOKAHEAD_NIGHTS) },
      now,
    });
    const input = loaded?.inputs.get(propertyId);
    if (!input) return null;
    const edges = describeStayEdges(input, stay);
    return edges ? summarizeStayEdges(edges) : null;
  } catch {
    return null;
  }
}
