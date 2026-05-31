import "server-only";

// ---------------------------------------------------------------------------
// GuestOps AI — Email Templates
// All emails are in Turkish, use inline styles for maximum email client support.
// ---------------------------------------------------------------------------

const BRAND_HEADER = `
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
    <tr>
      <td style="background:#1e293b;padding:20px 32px;border-radius:8px 8px 0 0;">
        <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.5px;">
          GuestOps <span style="color:#6366f1;">AI</span>
        </span>
      </td>
    </tr>
  </table>
`;

const FOOTER = `
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;border-top:1px solid #e2e8f0;padding-top:16px;">
    <tr>
      <td style="color:#94a3b8;font-size:12px;text-align:center;">
        GuestOps AI — Kısa Dönem Kiralama Yönetim Platformu<br/>
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
  <title>GuestOps AI</title>
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
      Merhaba ${assignee.name}, aşağıdaki görev sizinle paylaşıldı.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:24px;">
      <tr>
        <td style="padding:20px 24px;">
          <p style="margin:0 0 4px;color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">GÖREV</p>
          <p style="margin:0 0 16px;color:#0f172a;font-size:18px;font-weight:700;">${task.title}</p>

          ${
            task.description
              ? `<p style="margin:0 0 16px;color:#475569;font-size:14px;line-height:1.6;">${task.description}</p>`
              : ""
          }

          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="width:50%;padding-right:8px;">
                <p style="margin:0 0 4px;color:#94a3b8;font-size:11px;font-weight:600;text-transform:uppercase;">MÜL K</p>
                <p style="margin:0;color:#0f172a;font-size:14px;font-weight:600;">${property.name}</p>
                ${property.city ? `<p style="margin:0;color:#64748b;font-size:12px;">${property.city}</p>` : ""}
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
      GuestOps AI platformuna giriş yaparak görevin detaylarını görüntüleyebilir ve durumunu güncelleyebilirsiniz.
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
      <strong>${property.name}</strong> mülkünüzde bir misafir şikayeti tespit edildi.
      Lütfen en kısa sürede değerlendirin.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff5f5;border:1px solid #fecaca;border-radius:8px;margin-bottom:24px;">
      <tr>
        <td style="padding:16px 20px;">
          <p style="margin:0 0 4px;color:#94a3b8;font-size:11px;font-weight:600;text-transform:uppercase;">MİSAFİR MESAJI</p>
          <p style="margin:0;color:#1e293b;font-size:15px;font-style:italic;line-height:1.6;">"${message.slice(0, 600)}${message.length > 600 ? "…" : ""}"</p>
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
                <p style="margin:0;color:#0f172a;font-size:14px;font-weight:600;">${conversation.guestIdentifier}</p>
              </td>
              <td style="width:50%;">
                <p style="margin:0 0 2px;color:#94a3b8;font-size:11px;font-weight:600;text-transform:uppercase;">MÜLK</p>
                <p style="margin:0;color:#0f172a;font-size:14px;font-weight:600;">${property.name}</p>
              </td>
            </tr>
            <tr>
              <td style="padding-top:12px;">
                <p style="margin:0 0 2px;color:#94a3b8;font-size:11px;font-weight:600;text-transform:uppercase;">İŞLETME</p>
                <p style="margin:0;color:#0f172a;font-size:14px;">${orgName}</p>
              </td>
              <td style="padding-top:12px;">
                <p style="margin:0 0 2px;color:#94a3b8;font-size:11px;font-weight:600;text-transform:uppercase;">KANAL</p>
                <p style="margin:0;color:#0f172a;font-size:14px;">${conversation.channel}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <p style="color:#64748b;font-size:14px;">
      GuestOps AI'de konuşmayı görüntüleyerek misafire hemen yanıt verebilirsiniz.
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
  orgName: string,
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
      <strong>${property.name}</strong> mülkünüz için yeni bir rezervasyon kaydedildi.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;margin-bottom:24px;">
      <tr>
        <td style="padding:20px 24px;">
          <p style="margin:0 0 4px;color:#94a3b8;font-size:11px;font-weight:600;text-transform:uppercase;">MİSAFİR</p>
          <p style="margin:0 0 16px;color:#0f172a;font-size:20px;font-weight:700;">${reservation.guestName}</p>

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
                <p style="margin:0;color:#0f172a;font-size:14px;">${channelLabels[reservation.channel] ?? reservation.channel}</p>
              </td>
            </tr>
            ${
              reservation.totalAmount
                ? `<tr><td colspan="2" style="padding-top:12px;">
                    <p style="margin:0 0 2px;color:#94a3b8;font-size:11px;font-weight:600;text-transform:uppercase;">TUTAR</p>
                    <p style="margin:0;color:#0f172a;font-size:14px;font-weight:600;">
                      ${reservation.totalAmount.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${reservation.currency ?? "EUR"}
                    </p>
                  </td></tr>`
                : ""
            }
            ${
              reservation.notes
                ? `<tr><td colspan="2" style="padding-top:12px;">
                    <p style="margin:0 0 2px;color:#94a3b8;font-size:11px;font-weight:600;text-transform:uppercase;">NOTLAR</p>
                    <p style="margin:0;color:#475569;font-size:13px;">${reservation.notes}</p>
                  </td></tr>`
                : ""
            }
          </table>
        </td>
      </tr>
    </table>

    <p style="color:#64748b;font-size:14px;">
      GuestOps AI platformunu ziyaret ederek rezervasyonu yönetebilir, görev atayabilir ve misafirle iletişime geçebilirsiniz.
    </p>
  `;

  return wrapEmail(body);
}
