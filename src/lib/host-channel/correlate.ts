// ---------------------------------------------------------------------------
// Ev sahibinin cevabını doğru soruya bağlama (tasarım §3.4). SAF.
//   1. `contextId` var ("yanıtla" ya da düğme) → sorunun gönderilen mesaj kimliklerinde aranır. Bulunan soru BAŞKA kiracınınsa → yabancı
//      (sessizce yok sayılır, olay günlüğüne yazılır): bir kiracının numarası başka kiracının sorusuna asla işlem yapamaz.
//   2. `contextId` yok → bu bağlantının son 24 saatte bekleyen TEK sorusu varsa ona; birden çoksa "hangi soru?" (en çok 3 aday, fazlası
//      panel); hiç yoksa "bekleyen soru yok".
//   3. Soru kapanmışsa (panelden cevaplandı / süresi geçti / yerine yenisi geldi) → kapalı; misafire hiçbir şey gitmez.
// ---------------------------------------------------------------------------

export type HostQuestionStatus = "waiting" | "answered_elsewhere" | "expired" | "superseded" | "sent";

export interface PendingHostQuestion {
  id: string;
  orgId: string;
  status: HostQuestionStatus;
  createdAt: Date;
  /** Bu soru için ev sahibine giden mesajların sağlayıcı kimlikleri (soru + önizleme). */
  providerMessageIds: readonly string[];
}

export type CorrelationResult =
  | { kind: "matched"; questionId: string }
  | { kind: "ambiguous"; candidates: string[]; overflow: boolean }
  | { kind: "none" }
  | { kind: "closed"; questionId: string; status: Exclude<HostQuestionStatus, "waiting"> }
  | { kind: "foreign" };

export const PLAIN_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MAX_CANDIDATES = 3;

export function correlateHostReply(input: {
  contextId: string | null;
  senderOrgId: string;
  questions: readonly PendingHostQuestion[];
  now: Date;
}): CorrelationResult {
  const { contextId, senderOrgId, questions, now } = input;
  if (contextId) {
    const q = questions.find((x) => x.providerMessageIds.includes(contextId));
    if (q) {
      if (q.orgId !== senderOrgId) return { kind: "foreign" };
      return q.status === "waiting" ? { kind: "matched", questionId: q.id } : { kind: "closed", questionId: q.id, status: q.status };
    }
    // Bilinmeyen bağlam (eski / silinmiş mesaj) düz cevap gibi değerlendirilir — ama yalnız gönderenin kendi kiracısında.
  }
  const waiting = questions
    .filter((q) => q.orgId === senderOrgId && q.status === "waiting" && now.getTime() - q.createdAt.getTime() <= PLAIN_REPLY_WINDOW_MS)
    // En yeni önce; eşit zamanda kimlik sırası (kararlı).
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? -1 : 1));
  if (waiting.length === 0) return { kind: "none" };
  if (waiting.length === 1) return { kind: "matched", questionId: waiting[0].id };
  return { kind: "ambiguous", candidates: waiting.slice(0, MAX_CANDIDATES).map((q) => q.id), overflow: waiting.length > MAX_CANDIDATES };
}
