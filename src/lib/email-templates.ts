import "server-only";

// ---------------------------------------------------------------------------
// Lixus AI — Email Templates
// All emails are in Turkish, use inline styles for maximum email client support.
// ---------------------------------------------------------------------------

// Escape user/guest-controlled text before interpolating into email HTML. A
// guest's chat message or display name can contain <, >, &, or markup; without
// this an alert email to the host could carry injected HTML. Static template
// strings are safe — only dynamic values are wrapped with esc().
function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const BRAND_HEADER = `
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
    <tr>
      <td style="background:#1e293b;padding:20px 32px;border-radius:8px 8px 0 0;">
        <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.5px;">
          Lixus <span style="color:#6366f1;">AI</span>
        </span>
      </td>
    </tr>
  </table>
`;

const FOOTER = `
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;border-top:1px solid #e2e8f0;padding-top:16px;">
    <tr>
      <td style="color:#94a3b8;font-size:12px;text-align:center;">
        Lixus AI — Kısa Dönem Kiralama Yönetim Platformu<br/>
        Bu e-posta otomatik olarak oluşturulmuştur. Lütfen yanıtlamayınız.
      </td>
    </tr>
  </table>
`;

function wrapEmail(bodyContent: string): string {
  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Lixus AI</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;border:1px solid #e2e8f0;overflow:hidden;max-width:600px;">
          <tr>
            <td style="padding:0 32px 32px;">
              ${BRAND_HEADER}
              ${bodyContent}
              ${FOOTER}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Template 1: Task Assigned
// ---------------------------------------------------------------------------
export interface TaskEmailData {
  id: string;
  title: string;
  type: string;
  priority: string;
  status: string;
  description?: string | null;
  dueAt?: Date | null;
}

export interface AssigneeEmailData {
  name: string;
  email: string;
}

export interface PropertyEmailData {
  name: string;
  address?: string | null;
  city?: string | null;
}

export function taskAssignedEmail(
  task: TaskEmailData,
  assignee: AssigneeEmailData,
  property: PropertyEmailData,
): string {
  const priorityColor =
    task.priority === "urgent" ? "#ef4444" : task.priority === "standard" ? "#6366f1" : "#94a3b8";
  const priorityLabel =
    task.priority === "urgent" ? "Acil" : task.priority === "standard" ? "Standart" : "Düşük";
  const dueLabel = task.dueAt
    ? new Date(task.dueAt).toLocaleDateString("tr-TR", {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  const body = `
    <h2 style="margin:0 0 8px;color:#0f172a;font-size:22px;font-weight:700;">
      Size yeni bir görev atandı
    </h2>
    <p style="margin:0 0 24px;color:#64748b;font-size:15px;">
      Merhaba ${esc(assignee.name)}, aşağıdaki görev sizinle paylaşıldı.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:24px;">
      <tr>
        <td style="padding:20px 24px;">
          <p style="margin:0 0 4px;color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">GÖREV</p>
          <p style="margin:0 0 16px;color:#0f172a;font-size:18px;font-weight:700;">${esc(task.title)}</p>

          ${
            task.description
              ? `<p style="margin:0 0 16px;color:#475569;font-size:14px;line-height:1.6;">${esc(task.description)}</p>`
              : ""
          }

          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="width:50%;padding-right:8px;">
                <p style="margin:0 0 4px;color:#94a3b8;font-size:11px;font-weight:600;text-transform:uppercase;">MÜLK</p>
                <p style="margin:0;color:#0f172a;font-size:14px;font-weight:600;">${esc(property.name)}</p>
                ${property.city ? `<p style="margin:0;color:#64748b;font-size:12px;">${esc(property.city)}</p>` : ""}
              </td>
              <td style="width:50%;">
                <p style="margin:0 0 4px;color:#94a3b8;font-size:11px;font-weight:600;text-transform:uppercase;">ÖNCELİK</p>
                <span style="display:inline-block;background:${priorityColor};color:#fff;font-size:12px;font-weight:600;padding:2px 10px;border-radius:100px;">${priorityLabel}</span>
              </td>
            </tr>
            ${
              dueLabel
                ? `<tr><td colspan="2" style="padding-top:12px;">
                    <p style="margin:0 0 4px;color:#94a3b8;font-size:11px;font-weight:600;text-transform:uppercase;">SON TARİH</p>
                    <p style="margin:0;color:#0f172a;font-size:14px;font-weight:600;">${dueLabel}</p>
                  </td></tr>`
                : ""
            }
          </table>
        </td>
      </tr>
    </table>

    <p style="color:#64748b;font-size:14px;">
      Lixus AI platformuna giriş yaparak görevin detaylarını görüntüleyebilir ve durumunu güncelleyebilirsiniz.
    </p>
  `;

  return wrapEmail(body);
}

// ---------------------------------------------------------------------------
// Template 2: Complaint Escalation
// ---------------------------------------------------------------------------
export interface ConversationEmailData {
  id: string;
  guestIdentifier: string;
  channel: string;
  priority: string;
}

export function complaintEscalationEmail(
  conversation: ConversationEmailData,
  message: string,
  property: PropertyEmailData,
  orgName: string,
): string {
  const body = `
    <h2 style="margin:0 0 8px;color:#ef4444;font-size:22px;font-weight:700;">
      Şikayet Eskalasyonu
    </h2>
    <p style="margin:0 0 24px;color:#64748b;font-size:15px;">
      <strong>${esc(property.name)}</strong> mülkünüzde bir misafir şikayeti tespit edildi.
      Lütfen en kısa sürede değerlendirin.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff5f5;border:1px solid #fecaca;border-radius:8px;margin-bottom:24px;">
      <tr>
        <td style="padding:16px 20px;">
          <p style="margin:0 0 4px;color:#94a3b8;font-size:11px;font-weight:600;text-transform:uppercase;">MİSAFİR MESAJI</p>
          <p style="margin:0;color:#1e293b;font-size:15px;font-style:italic;line-height:1.6;">"${esc(message.slice(0, 600))}${message.length > 600 ? "…" : ""}"</p>
        </td>
      </tr>
    </table>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:24px;">
      <tr>
        <td style="padding:16px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="width:50%;padding-right:8px;">
                <p style="margin:0 0 2px;color:#94a3b8;font-size:11px;font-weight:600;text-transform:uppercase;">MİSAFİR</p>
                <p style="margin:0;color:#0f172a;font-size:14px;font-weight:600;">${esc(conversation.guestIdentifier)}</p>
              </td>
              <td style="width:50%;">
                <p style="margin:0 0 2px;color:#94a3b8;font-size:11px;font-weight:600;text-transform:uppercase;">MÜLK</p>
                <p style="margin:0;color:#0f172a;font-size:14px;font-weight:600;">${esc(property.name)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding-top:12px;">
                <p style="margin:0 0 2px;color:#94a3b8;font-size:11px;font-weight:600;text-transform:uppercase;">İŞLETME</p>
                <p style="margin:0;color:#0f172a;font-size:14px;">${esc(orgName)}</p>
              </td>
              <td style="padding-top:12px;">
                <p style="margin:0 0 2px;color:#94a3b8;font-size:11px;font-weight:600;text-transform:uppercase;">KANAL</p>
                <p style="margin:0;color:#0f172a;font-size:14px;">${esc(conversation.channel)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <p style="color:#64748b;font-size:14px;">
      Lixus AI'de konuşmayı görüntüleyerek misafire hemen yanıt verebilirsiniz.
    </p>
  `;

  return wrapEmail(body);
}

// ---------------------------------------------------------------------------
// Template 3: Reservation Created
// ---------------------------------------------------------------------------
export interface ReservationEmailData {
  id: string;
  guestName: string;
  guestEmail?: string | null;
  arrivalDate: Date;
  departureDate: Date;
  channel: string;
  status: string;
  totalAmount?: number | null;
  currency?: string | null;
  notes?: string | null;
}

export function reservationCreatedEmail(
  reservation: ReservationEmailData,
  property: PropertyEmailData,
): string {
  const arrivalLabel = new Date(reservation.arrivalDate).toLocaleDateString("tr-TR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const departureLabel = new Date(reservation.departureDate).toLocaleDateString("tr-TR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const nights = Math.round(
    (new Date(reservation.departureDate).getTime() - new Date(reservation.arrivalDate).getTime()) /
      (1000 * 60 * 60 * 24),
  );

  const channelLabels: Record<string, string> = {
    manual: "Manuel",
    airbnb: "Airbnb",
    booking: "Booking.com",
    direct: "Doğrudan",
    other: "Diğer",
  };

  const body = `
    <h2 style="margin:0 0 8px;color:#0f172a;font-size:22px;font-weight:700;">
      Yeni Rezervasyon Oluşturuldu
    </h2>
    <p style="margin:0 0 24px;color:#64748b;font-size:15px;">
      <strong>${esc(property.name)}</strong> mülkünüz için yeni bir rezervasyon kaydedildi.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;margin-bottom:24px;">
      <tr>
        <td style="padding:20px 24px;">
          <p style="margin:0 0 4px;color:#94a3b8;font-size:11px;font-weight:600;text-transform:uppercase;">MİSAFİR</p>
          <p style="margin:0 0 16px;color:#0f172a;font-size:20px;font-weight:700;">${esc(reservation.guestName)}</p>

          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="width:50%;padding-right:8px;">
                <p style="margin:0 0 2px;color:#94a3b8;font-size:11px;font-weight:600;text-transform:uppercase;">GİRİŞ</p>
                <p style="margin:0;color:#0f172a;font-size:14px;font-weight:600;">${arrivalLabel}</p>
              </td>
              <td style="width:50%;">
                <p style="margin:0 0 2px;color:#94a3b8;font-size:11px;font-weight:600;text-transform:uppercase;">ÇIKIŞ</p>
                <p style="margin:0;color:#0f172a;font-size:14px;font-weight:600;">${departureLabel}</p>
              </td>
            </tr>
            <tr>
              <td style="padding-top:12px;">
                <p style="margin:0 0 2px;color:#94a3b8;font-size:11px;font-weight:600;text-transform:uppercase;">SÜRE</p>
                <p style="margin:0;color:#0f172a;font-size:14px;">${nights} gece</p>
              </td>
              <td style="padding-top:12px;">
                <p style="margin:0 0 2px;color:#94a3b8;font-size:11px;font-weight:600;text-transform:uppercase;">KANAL</p>
                <p style="margin:0;color:#0f172a;font-size:14px;">${channelLabels[reservation.channel] ?? esc(reservation.channel)}</p>
              </td>
            </tr>
            ${
              reservation.totalAmount
                ? `<tr><td colspan="2" style="padding-top:12px;">
                    <p style="margin:0 0 2px;color:#94a3b8;font-size:11px;font-weight:600;text-transform:uppercase;">TUTAR</p>
                    <p style="margin:0;color:#0f172a;font-size:14px;font-weight:600;">
                      ${reservation.totalAmount.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${esc(reservation.currency ?? "EUR")}
                    </p>
                  </td></tr>`
                : ""
            }
            ${
              reservation.notes
                ? `<tr><td colspan="2" style="padding-top:12px;">
                    <p style="margin:0 0 2px;color:#94a3b8;font-size:11px;font-weight:600;text-transform:uppercase;">NOTLAR</p>
                    <p style="margin:0;color:#475569;font-size:13px;">${esc(reservation.notes)}</p>
                  </td></tr>`
                : ""
            }
          </table>
        </td>
      </tr>
    </table>

    <p style="color:#64748b;font-size:14px;">
      Lixus AI platformunu ziyaret ederek rezervasyonu yönetebilir, görev atayabilir ve misafirle iletişime geçebilirsiniz.
    </p>
  `;

  return wrapEmail(body);
}

// ---------------------------------------------------------------------------
// Template 4 + 5: Reverse-trial reminders (account owner)
// Sent only while billing is enforced, so the "access pauses" wording is true.
// ---------------------------------------------------------------------------
function ctaButton(href: string, label: string): string {
  return `
    <table cellpadding="0" cellspacing="0" style="margin:8px 0 24px;">
      <tr>
        <td style="background:#1e293b;border-radius:8px;">
          <a href="${esc(href)}" style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">${esc(label)}</a>
        </td>
      </tr>
    </table>`;
}

/** "Your Pro trial ends in N days" — a few days before expiry. */
export function trialEndingSoonEmail(ownerName: string, daysLeft: number, settingsUrl: string): string {
  const gun = daysLeft <= 1 ? "yarın" : `${daysLeft} gün sonra`;
  const body = `
    <h2 style="margin:0 0 8px;color:#0f172a;font-size:22px;font-weight:700;">
      Pro denemeniz ${gun} bitiyor
    </h2>
    <p style="margin:0 0 16px;color:#64748b;font-size:15px;line-height:1.6;">
      Merhaba ${esc(ownerName)},<br/><br/>
      14 günlük ücretsiz Pro denemeniz <strong>${gun}</strong> sona eriyor. Süre dolduğunda
      panelinizi kullanmaya devam edebilirsiniz; ancak <strong>otomatik misafir yanıtları</strong>
      (oto-yanıt, karşılama, giriş/çıkış mesajları ve QR concierge) <strong>kapanır</strong>.
    </p>
    <p style="margin:0 0 8px;color:#64748b;font-size:15px;line-height:1.6;">
      Otomatik mesajlaşmayı kesintisiz sürdürmek için bir plan seçin:
    </p>
    ${ctaButton(settingsUrl, "Planları görün")}
    <p style="margin:0;color:#94a3b8;font-size:13px;">
      Kartınızdan deneme boyunca hiçbir ücret alınmadı. İstediğiniz zaman seçebilirsiniz.
    </p>
  `;
  return wrapEmail(body);
}

/** "Your trial ended — automatic messaging is paused." */
export function trialEndedEmail(ownerName: string, settingsUrl: string): string {
  const body = `
    <h2 style="margin:0 0 8px;color:#0f172a;font-size:22px;font-weight:700;">
      Ücretsiz denemeniz sona erdi
    </h2>
    <p style="margin:0 0 16px;color:#64748b;font-size:15px;line-height:1.6;">
      Merhaba ${esc(ownerName)},<br/><br/>
      14 günlük Pro denemeniz doldu. Hesabınız açık — panelleri kullanmaya, mesajları
      görüntülemeye ve manuel yanıt vermeye devam edebilirsiniz. Ancak
      <strong>otomatik misafir yanıtları şu anda kapalı</strong>.
    </p>
    <p style="margin:0 0 8px;color:#64748b;font-size:15px;line-height:1.6;">
      AI'nın misafirlerinize sizin yerinize, 7/24 yanıt vermesini yeniden açmak için bir plan seçin:
    </p>
    ${ctaButton(settingsUrl, "Plan seç & devam et")}
    <p style="margin:0;color:#94a3b8;font-size:13px;">
      Sorularınız için bize her zaman ulaşabilirsiniz.
    </p>
  `;
  return wrapEmail(body);
}

// ---------------------------------------------------------------------------
// Template: QR guest-chat escalation (Codex #15)
// DELIBERATELY MINIMAL: the recipient is the host, but this mail can sit in a
// third-party inbox/provider log — so it carries NO guest message body, NO
// guest name, NO access code and NO reservation details. Plain reason + a safe
// panel link (built from appBaseUrl(), never the request Host).
// ---------------------------------------------------------------------------
export function qrEscalationEmail(
  propertyName: string,
  reason: "ai_escalated" | "daily_cap",
  panelUrl: string,
): string {
  const reasonText =
    reason === "daily_cap"
      ? "Günlük otomatik yanıt limiti dolduğu için mesaj yapay zekâ tarafından yanıtlanmadı ve size devredildi."
      : "Yapay zekâ, güvenlik kuralları gereği bu mesajı yanıtlamadı ve size devretti.";
  const body = `
    <h2 style="margin:0 0 8px;color:#b45309;font-size:22px;font-weight:700;">
      Misafir sohbetinde size devredilen mesaj
    </h2>
    <p style="margin:0 0 16px;color:#64748b;font-size:15px;">
      <strong>${esc(propertyName)}</strong> dairesinin QR misafir sohbetinde yeni bir mesaj
      insan ilgisi bekliyor.
    </p>
    <p style="margin:0 0 24px;color:#334155;font-size:14px;">${esc(reasonText)}</p>
    <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr>
        <td style="background:#1e293b;border-radius:8px;">
          <a href="${esc(panelUrl)}" style="display:inline-block;padding:12px 24px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">
            Misafir Sohbetleri panelini aç
          </a>
        </td>
      </tr>
    </table>
    <p style="color:#94a3b8;font-size:12px;">
      Gizlilik gereği mesaj içeriği bu e-postada yer almaz; panelde görüntüleyebilirsiniz.
    </p>
  `;
  return wrapEmail(body);
}
