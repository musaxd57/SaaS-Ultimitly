import "server-only";

// ---------------------------------------------------------------------------
// EmailService — sends transactional emails via Nodemailer SMTP.
// If EMAIL_HOST is not configured, falls back to console logging (dev mode).
// Never throws — errors are logged and swallowed.
// ---------------------------------------------------------------------------

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

class EmailService {
  private isConfigured(): boolean {
    return Boolean(process.env.EMAIL_HOST);
  }

  async send(to: string, subject: string, html: string): Promise<void> {
    if (!to || !subject || !html) {
      console.warn("[EmailService] send() called with missing arguments — skipping.");
      return;
    }

    if (!this.isConfigured()) {
      // Dev mode: log the email to the console instead of sending.
      console.log(
        `\n[EmailService DEV] ─────────────────────────────────────\n` +
          `To:      ${to}\n` +
          `Subject: ${subject}\n` +
          `Body (HTML stripped): ${html.replace(/<[^>]+>/g, "").slice(0, 300)}\n` +
          `────────────────────────────────────────────────────────\n`,
      );
      return;
    }

    try {
      // Dynamic import so the module is only loaded at runtime on the server.
      const nodemailer = await import("nodemailer");

      const transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: Number(process.env.EMAIL_PORT ?? 587),
        secure: Number(process.env.EMAIL_PORT ?? 587) === 465,
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
        // Fail fast instead of hanging when the SMTP port is blocked/unreachable.
        connectionTimeout: 12000,
        greetingTimeout: 12000,
        socketTimeout: 12000,
      });

      await transporter.sendMail({
        from: process.env.EMAIL_FROM ?? "GuestOps AI <noreply@guestops.ai>",
        to,
        subject,
        html,
      });
    } catch (err) {
      // Never crash the caller — log and continue.
      console.error("[EmailService] Failed to send email:", err);
    }
  }

  /**
   * Like send(), but REPORTS the outcome so a "test email" button can show
   * success or the exact SMTP error (wrong app password, host, etc.). Still
   * never throws.
   */
  async sendReporting(
    to: string,
    subject: string,
    html: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!this.isConfigured()) {
      return { ok: false, error: "SMTP ayarlı değil (EMAIL_HOST eksik) — e-posta gönderilemez." };
    }
    try {
      const nodemailer = await import("nodemailer");
      const transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: Number(process.env.EMAIL_PORT ?? 587),
        secure: Number(process.env.EMAIL_PORT ?? 587) === 465,
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
        // Fail fast (~12s) instead of hanging if the SMTP port is blocked.
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
}

export const emailService = new EmailService();
