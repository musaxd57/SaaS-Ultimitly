import "server-only";
import { prisma } from "@/lib/db";
import type { TemplateCategory } from "@/lib/constants";

// ---------------------------------------------------------------------------
// Message Template Library
// Placeholders: {{guestName}}, {{checkInTime}}, {{checkOutTime}},
//               {{propertyName}}, {{wifiInfo}}
// ---------------------------------------------------------------------------

export interface MessageTemplate {
  id: string;
  category: TemplateCategory;
  title: string;
  body: string;
  language: string;
  isDefault: boolean;
}

export const DEFAULT_TEMPLATES: MessageTemplate[] = [
  // --- Check-in ---
  {
    id: "default-checkin-tr-1",
    category: "checkin",
    title: "Giriş Talimatları (TR)",
    language: "tr",
    isDefault: true,
    body: `Merhaba {{guestName}},

Hoş geldiniz. Giriş saatimiz {{checkInTime}}. Kapı kodunu ve giriş talimatlarını aşağıda bulabilirsiniz:

{{wifiInfo}}

Giriş sırasında bir aksilik olursa bana yazmanız yeterli.`,
  },
  {
    id: "default-checkin-en-1",
    category: "checkin",
    title: "Check-in Instructions (EN)",
    language: "en",
    isDefault: true,
    body: `Hello {{guestName}},

Welcome. Check-in time is {{checkInTime}}. Please find the door code and arrival instructions below.

{{wifiInfo}}

If anything comes up during check-in, just message me.`,
  },
  {
    id: "default-checkin-tr-2",
    category: "checkin",
    title: "Giriş Yaklaşıyor Hatırlatma",
    language: "tr",
    isDefault: true,
    body: `Merhaba {{guestName}},

Girişinize az kaldı. Konaklayacağınız daire: {{propertyName}}. Giriş saatimiz {{checkInTime}}, sizi bekliyorum.`,
  },

  // --- Check-out ---
  {
    id: "default-checkout-tr-1",
    category: "checkout",
    title: "Çıkış Hatırlatması (TR)",
    language: "tr",
    isDefault: true,
    body: `Merhaba {{guestName}},

Çıkış saatimiz {{checkOutTime}}. Anahtarı/kartı nereye bırakacağınızı çıkıştan önce ayrıca yazacağım.

Bizi tercih ettiğiniz için teşekkür ederim. Görüşmek üzere.`,
  },
  {
    id: "default-checkout-en-1",
    category: "checkout",
    title: "Check-out Reminder (EN)",
    language: "en",
    isDefault: true,
    body: `Hello {{guestName}},

Just a reminder that check-out time is {{checkOutTime}}. I'll confirm where to leave the key/card before you go.

Thank you for staying with us. See you next time.`,
  },
  {
    id: "default-checkout-tr-2",
    category: "checkout",
    title: "Çıkış Günü Mesajı",
    language: "tr",
    isDefault: true,
    body: `Merhaba {{guestName}},

Bugün çıkış günü. Çıkış saatimiz {{checkOutTime}}. Bizi tercih ettiğiniz için teşekkür ederim.`,
  },

  // --- Welcome ---
  {
    id: "default-welcome-tr-1",
    category: "welcome",
    title: "Hoş Geldiniz Mesajı (TR)",
    language: "tr",
    isDefault: true,
    body: `Merhaba {{guestName}}, hoş geldiniz.

Konaklayacağınız daire: {{propertyName}}. Konaklamanız boyunca her türlü sorunuz için buradayım. Wi-Fi bilgileri:
{{wifiInfo}}

Keyifli günler dileriz.`,
  },
  {
    id: "default-welcome-en-1",
    category: "welcome",
    title: "Welcome Message (EN)",
    language: "en",
    isDefault: true,
    body: `Hello {{guestName}}, welcome to {{propertyName}}.

I'm here for any questions during your stay. Wi-Fi details:
{{wifiInfo}}

Just message me if you need anything.`,
  },
  {
    id: "default-welcome-tr-2",
    category: "welcome",
    title: "Rezervasyon Bilgileri",
    language: "tr",
    isDefault: true,
    body: `Merhaba {{guestName}},

Rezervasyonunuz için teşekkür ederim. Konaklayacağınız daire: {{propertyName}}. Giriş saati {{checkInTime}}, çıkış saati {{checkOutTime}}.

Giriş öncesinde detaylı bilgi paylaşacağım.`,
  },

  // --- Complaint Response ---
  {
    id: "default-complaint-tr-1",
    category: "complaint_response",
    title: "Şikayet Yanıtı — Özür (TR)",
    language: "tr",
    isDefault: true,
    body: `Merhaba {{guestName}},

Yaşadığınız sorun için özür dilerim. Konuyu hemen inceliyorum.

En kısa sürede size dönüş yapacağım.`,
  },
  {
    id: "default-complaint-en-1",
    category: "complaint_response",
    title: "Complaint Response — Apology (EN)",
    language: "en",
    isDefault: true,
    body: `Hello {{guestName}},

I'm sorry about the problem you've run into. I'm looking into it now and will get back to you shortly.`,
  },

  // --- Rules ---
  {
    id: "default-rules-tr-1",
    category: "rules",
    title: "Ev Kuralları Hatırlatması (TR)",
    language: "tr",
    isDefault: true,
    body: `Merhaba {{guestName}},

{{propertyName}} için ev kurallarını hatırlatmak istiyorum:
• Saat 22:00'den sonra lütfen gürültü yapmayınız (bina sakinleri için).
• Evcil hayvan ve sigara yasaktır.
• Parti ve etkinlik organizasyonu yasaktır.

Anlayışınız için teşekkür ederim.`,
  },

  // --- Wi-Fi ---
  {
    id: "default-wifi-tr-1",
    category: "wifi",
    title: "Wi-Fi Bilgisi (TR)",
    language: "tr",
    isDefault: true,
    body: `Merhaba {{guestName}},

{{propertyName}} Wi-Fi bilgileriniz:
{{wifiInfo}}

Bağlantıyla ilgili sorun yaşarsanız hemen yazabilirsiniz.`,
  },
  {
    id: "default-wifi-en-1",
    category: "wifi",
    title: "Wi-Fi Information (EN)",
    language: "en",
    isDefault: true,
    body: `Hello {{guestName}},

Here are your Wi-Fi details for {{propertyName}}:
{{wifiInfo}}

Let me know if you have any connection issues.`,
  },

  // --- General ---
  {
    id: "default-general-tr-1",
    category: "general",
    title: "Genel Yanıt (TR)",
    language: "tr",
    isDefault: true,
    body: `Merhaba {{guestName}},

Mesajınız için teşekkürler. Talebinizi aldım ve en kısa sürede size dönüş yapacağım.`,
  },
  {
    id: "default-general-en-1",
    category: "general",
    title: "General Response (EN)",
    language: "en",
    isDefault: true,
    body: `Hello {{guestName}},

Thank you for your message. I've received your request and will get back to you as soon as possible.`,
  },
];

/**
 * Fetch custom templates from DB and merge with defaults.
 * Custom templates are listed first if they are active.
 */
export async function getTemplatesForProperty(
  propertyId: string | null,
  orgId: string,
): Promise<MessageTemplate[]> {
  const dbTemplates = await prisma.messageTemplate.findMany({
    where: {
      organizationId: orgId,
      isActive: true,
      // When a property is given, include both its property-specific templates
      // and org-wide (propertyId: null) ones. Otherwise only org-wide.
      OR: propertyId ? [{ propertyId }, { propertyId: null }] : [{ propertyId: null }],
    },
    orderBy: { createdAt: "asc" },
  });

  const custom: MessageTemplate[] = dbTemplates.map((t) => ({
    id: t.id,
    category: t.category as TemplateCategory,
    title: t.title,
    body: t.body,
    language: t.language,
    isDefault: false,
  }));

  return [...custom, ...DEFAULT_TEMPLATES];
}

export interface TemplateVars {
  guestName?: string;
  checkInTime?: string;
  checkOutTime?: string;
  propertyName?: string;
  wifiInfo?: string;
}

/**
 * Substitute {{placeholder}} tokens with actual values.
 * Unknown tokens are left as-is.
 */
export function applyTemplate(template: MessageTemplate, vars: TemplateVars): string {
  return template.body
    .replace(/\{\{guestName\}\}/g, vars.guestName ?? "Misafir")
    .replace(/\{\{checkInTime\}\}/g, vars.checkInTime ?? "")
    .replace(/\{\{checkOutTime\}\}/g, vars.checkOutTime ?? "")
    .replace(/\{\{propertyName\}\}/g, vars.propertyName ?? "")
    .replace(/\{\{wifiInfo\}\}/g, vars.wifiInfo ?? "");
}
