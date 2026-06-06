import "server-only";

// ---------------------------------------------------------------------------
// EmailService — sends transactional emails.
//
// Preferred path: RESEND (HTTP API over port 443) — works on hosts like Railway
// that BLOCK outbound SMTP ports (25/465/587). Set RESEND_API_KEY to enable.
// Fallback: SMTP via Nodemailer (EMAIL_HOST/USER/PASS) where SMTP is allowed.
// If neither is configured, logs to the console (dev mode). Never throws.
// ---------------------------------------------------------------------------

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

class EmailService {
  private isConfigured(): boolean {
    return Boolean(process.env.RESEND_API_KEY || process.env.EMAIL_HOST);
  }

  /** Send via Resend's HTTP API. Reports the outcome. */
  private async viaResend(
    to: string,
    subject: string,
    html: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const key = process.env.RESEND_API_KEY;
    if (!key) return { ok: false, error: "RESEND_API_KEY tanımlı değil." };
    // Resend requires a verified-domain (or its test domain) sender. EMAIL_FROM
    // may be a gmail address which Resend rejects, so prefer RESEND_FROM.
    const from = process.env.RESEND_FROM || "Lixus AI <onboarding@resend.dev>";
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ from, to, subject, html }),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) return { ok: true };
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Resend HTTP ${res.status}${body ? ` — ${body.slice(0, 200)}` : ""}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Send via SMTP (Nodemailer). Reports the outcome. */
  private async viaSmtp(
    to: string,
    subject: string,
    html: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!process.env.EMAIL_HOST) return { ok: false, error: "SMTP ayarlı değil (EMAIL_HOST eksik)." };
    try {
      const nodemailer = await import("nodemailer");
      const transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: Number(process.env.EMAIL_PORT ?? 587),
        secure: Number(process.env.EMAIL_PORT ?? 587) === 465,
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
        // Fail fast instead of hanging when the SMTP port is blocked/unreachable.
        connectionTimeout: 12000,
        greetingTimeout: 12000,
        socketTimeout: 12000,
      });
      await transporter.sendMail({
        from: process.env.EMAIL_FROM ?? "Lixus AI <noreply@lixusai.com>",
        to,
        subject,
        html,
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Fire-and-forget send (alerts etc.). Never throws; errors are logged. */
  async send(to: string, subject: string, html: string): Promise<void> {
    if (!to || !subject || !html) {
      console.warn("[EmailService] send() called with missing arguments — skipping.");
      return;
    }
    if (!this.isConfigured()) {
      console.log(
        `\n[EmailService DEV] ─────────────────────────────────────\n` +
          `To:      ${to}\n` +
          `Subject: ${subject}\n` +
          `Body (HTML stripped): ${html.replace(/<[^>]+>/g, "").slice(0, 300)}\n` +
          `────────────────────────────────────────────────────────\n`,
      );
      return;
    }
    const result = await this.sendReporting(to, subject, html);
    if (!result.ok) console.error("[EmailService] Failed to send email:", result.error);
  }

  /**
   * Send and REPORT the outcome (success or the exact error) — used by the
   * "test email" button. Prefers Resend, falls back to SMTP. Never throws.
   */
  async sendReporting(
    to: string,
    subject: string,
    html: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (process.env.RESEND_API_KEY) return this.viaResend(to, subject, html);
    if (process.env.EMAIL_HOST) return this.viaSmtp(to, subject, html);
    return { ok: false, error: "E-posta ayarlı değil (RESEND_API_KEY veya EMAIL_HOST gerekli)." };
  }
}

export const emailService = new EmailService();
