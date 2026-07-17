import "server-only";

import { prisma } from "@/lib/db";
import { reportError } from "@/lib/report-error";

// Human-readable Turkish labels for the dotted audit actions, so the operator
// panel reads "Başarılı giriş" instead of "auth.login_success". Additive: an
// unknown/new action falls back to its raw string (never blank). Keep in sync
// when a new writeAudit action is introduced.
const AUDIT_ACTION_LABELS: Record<string, string> = {
  "auth.login_success": "Başarılı giriş",
  "auth.login_failed": "Başarısız giriş denemesi",
  "account.password_change": "Şifre değiştirildi",
  "account.password_reset": "Şifre sıfırlandı",
  "account.2fa_enable": "İki adımlı doğrulama açıldı",
  "account.2fa_disable": "İki adımlı doğrulama kapatıldı",
  "account.2fa_recovery_generate": "2FA kurtarma kodları oluşturuldu",
  "account.2fa_recovery_used": "2FA kurtarma koduyla giriş yapıldı",
  "customer.create": "Müşteri hesabı oluşturuldu",
  "data.export": "Veri dışa aktarıldı (operatör)",
  "data.export_self": "Kullanıcı verilerini indirdi",
  "hospitable.connect": "Hospitable bağlandı",
  "hospitable.disconnect": "Hospitable bağlantısı kesildi",
  "guest_chat.enable": "Misafir sohbeti açıldı",
  "guest_chat.disable": "Misafir sohbeti kapatıldı",
  "guest_chat.reset_binding": "Misafir sohbeti cihaz kilidi sıfırlandı",
  "guest_chat.pin_set": "Misafir sohbeti giriş kodu oluşturuldu",
  "guest_chat.pin_clear": "Misafir sohbeti giriş kodu kaldırıldı",
  "billing.plan_change": "Abonelik planı değiştirildi",
  "outbox.manual_retry": "Gönderim yeniden kuyruğa alındı",
  "impersonate.enter": "Müşteri hesabına girildi",
  "impersonate.exit": "Müşteri hesabından çıkıldı",
  "admin.2fa_reset": "2FA operatör tarafından sıfırlandı",
  "admin.quality_audit": "AI kalite denetimi çalıştırıldı (Claude)",
};

/** Turkish label for an audit action; falls back to the raw action if unknown. */
export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

/**
 * Write an audit-log entry. FIRE-AND-FORGET and SWALLOWS errors: auditing must
 * never break or block the action it records. Use for sensitive/privileged
 * operations — above all operator impersonation (an operator entering a customer
 * org sees that customer's guest PII, so every enter/exit must leave a trace).
 *
 *   action  — dotted verb, e.g. "impersonate.enter", "customer.create"
 *   actorUserId — the REAL operator behind the action (not the impersonated user)
 */
export async function writeAudit(entry: {
  organizationId: string;
  actorUserId?: string | null;
  action: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: entry.organizationId,
        actorUserId: entry.actorUserId ?? null,
        action: entry.action,
        metadataJson: entry.metadata ? JSON.stringify(entry.metadata) : null,
      },
    });
  } catch (err) {
    // Never let an audit write affect the real action — but surface the drop.
    // console.error alone is NOT captured anywhere central (no Sentry SDK hooks
    // console); reportError is the only path to the error sink, so a silently
    // dropped security/KVKK audit trail (impersonation, 2FA-reset, plan-change)
    // stays visible to operators. reportError never throws and redacts PII.
    console.error("[audit] dropped entry", entry.action, err);
    void reportError("audit.write", err);
  }
}
