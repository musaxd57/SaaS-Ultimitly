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
}

export const emailService = new EmailService();
