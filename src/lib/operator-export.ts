// ---------------------------------------------------------------------------
// OPERATÖR VERİ DIŞA AKTARIMI — İSTEK KURALI (kurucu kararı 09-30). Saf; rota ve yönetici paneli aynı kümeyi kullanır.
// Amaç KAPALI KÜME (serbest metin kayda girmez: kişisel veri taşıyabilir); talep numarası isteğe bağlı ve dar biçimli.
// ---------------------------------------------------------------------------

export const OPERATOR_EXPORT_PURPOSES = {
  kvkk_request: "KVKK veri erişim talebi",
  support_request: "Destek talebi",
  legal_request: "Hukuki / resmî talep",
} as const;

export type OperatorExportPurpose = keyof typeof OPERATOR_EXPORT_PURPOSES;

const TICKET_RE = /^[A-Za-z0-9#_-]{1,40}$/;

export function parseOperatorExportRequest(
  params: URLSearchParams,
): { ok: true; orgId: string; purpose: OperatorExportPurpose; ticket: string | null } | { ok: false; errors: Record<string, string> } {
  const orgId = params.get("orgId")?.trim() ?? "";
  const purpose = params.get("purpose")?.trim() ?? "";
  const ticketRaw = params.get("ticket")?.trim() ?? "";
  const errors: Record<string, string> = {};
  if (!orgId) errors.orgId = "orgId gerekli";
  if (!Object.hasOwn(OPERATOR_EXPORT_PURPOSES, purpose)) errors.purpose = "Dışa aktarma amacını seçin.";
  if (ticketRaw && !TICKET_RE.test(ticketRaw)) errors.ticket = "Talep numarası yalnız harf, rakam ve tire içerebilir.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, orgId, purpose: purpose as OperatorExportPurpose, ticket: ticketRaw || null };
}
