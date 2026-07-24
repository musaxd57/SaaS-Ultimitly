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

Hoş geldiniz! Check-in saatimiz {{checkInTime}}. Kapı kodunu ve giriş talimatlarını aşağıda bulabilirsiniz:

{{wifiInfo}}

İyi tatiller!`,
  },
  {
    id: "default-checkin-en-1",
    category: "checkin",
    title: "Check-in Instructions (EN)",
    language: "en",
    isDefault: true,
    body: `Hello {{guestName}},

Welcome! Check-in time is {{checkInTime}}. Please find the door code and arrival instructions below.

{{wifiInfo}}

Enjoy your stay!`,
  },
  {
    id: "default-checkin-tr-2",
    category: "checkin",
    title: "Giriş Yaklaşıyor Hatırlatma",
    language: "tr",
    isDefault: true,
    body: `Merhaba {{guestName}},

{{propertyName}}'e girişinize az kaldı! Sizi {{checkInTime}}'de bekliyoruz.`,
  },

  // --- Check-out ---
  {
    id: "default-checkout-tr-1",
    category: "checkout",
    title: "Çıkış Hatırlatması (TR)",
    language: "tr",
    isDefault: true,
    body: `Merhaba {{guestName}},

Check-out saatimiz {{checkOutTime}}. Çıkışta anahtarı/kartı kapı yanındaki kutuya bırakmanız yeterli.

Konaklamanızın keyifli geçmesini umuyoruz. Görüşmek üzere!`,
  },
  {
    id: "default-checkout-en-1",
    category: "checkout",
    title: "Check-out Reminder (EN)",
    language: "en",
    isDefault: true,
    body: `Hello {{guestName}},

Just a reminder that check-out time is {{checkOutTime}}. Please leave the key/card in the box by the door.

We hope you had a wonderful stay. See you next time!`,
  },
  {
    id: "default-checkout-tr-2",
    category: "checkout",
    title: "Çıkış Günü Mesajı",
    language: "tr",
    isDefault: true,
    body: `Merhaba {{guestName}},

Bugün çıkış günü — umarız {{propertyName}}'de konaklamanız harikaydı! Check-out {{checkOutTime}}'de. Değerlendirmenizi merakla bekliyoruz.`,
  },

  // --- Welcome ---
  {
    id: "default-welcome-tr-1",
    category: "welcome",
    title: "Hoş Geldiniz Mesajı (TR)",
    language: "tr",
    isDefault: true,
    body: `Merhaba {{guestName}}, {{propertyName}}'e hoş geldiniz!

Konaklamanız boyunca her türlü sorunuz için buradayız. Wi-Fi bilgileri:
{{wifiInfo}}

Keyifli günler dileriz!`,
  },
  {
    id: "default-welcome-en-1",
    category: "welcome",
    title: "Welcome Message (EN)",
    language: "en",
    isDefault: true,
    body: `Hello {{guestName}}, welcome to {{propertyName}}!

We're here for any questions during your stay. Wi-Fi details:
{{wifiInfo}}

Enjoy your stay!`,
  },
  {
    id: "default-welcome-tr-2",
    category: "welcome",
    title: "Rezervasyon Onayı",
    language: "tr",
    isDefault: true,
    body: `Merhaba {{guestName}},

Rezervasyonunuz onaylanmıştır. {{propertyName}}'de sizi ağırlamaktan büyük mutluluk duyacağız. Check-in: {{checkInTime}}, Check-out: {{checkOutTime}}.

Giriş öncesinde detaylı bilgi paylaşacağız.`,
  },

  // --- Complaint Response ---
  {
    id: "default-complaint-tr-1",
    category: "complaint_response",
    title: "Şikayet Yanıtı — Özür (TR)",
    language: "tr",
    isDefault: true,
    body: `Merhaba {{guestName}},

Yaşadığınız sorun için içtenlikle özür dileriz. Bu durumu kabul edilemez buluyoruz ve derhal çözüm üretiyoruz.

Ekibimiz en kısa sürede sizinle iletişime geçecek.`,
  },
  {
    id: "default-complaint-en-1",
    category: "complaint_response",
    title: "Complaint Response — Apology (EN)",
    language: "en",
    isDefault: true,
    body: `Hello {{guestName}},

We sincerely apologize for the inconvenience you experienced. Our team is on it and will be in touch shortly to resolve the issue.`,
  },

  // --- Rules ---
  {
    id: "default-rules-tr-1",
    category: "rules",
    title: "Ev Kuralları Hatırlatması (TR)",
    language: "tr",
    isDefault: true,
    body: `Merhaba {{guestName}},

{{propertyName}} için ev kurallarını hatırlatmak istedik:
• Gece 23:00'dan sonra sessizlik saatleri geçerlidir.
• Evcil hayvan ve sigara yasaktır.
• Parti ve etkinlik organizasyonu yasaktır.

Anlayışınız için teşekkürler. Keyifli konaklamalar!`,
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

Let us know if you have any connection issues!`,
  },

  // --- General ---
  {
    id: "default-general-tr-1",
    category: "general",
    title: "Genel Yanıt (TR)",
    language: "tr",
    isDefault: true,
    body: `Merhaba {{guestName}},

Mesajınız için teşekkürler. Talebinizi aldık ve en kısa sürede size dönüş yapacağız.`,
  },
  {
    id: "default-general-en-1",
    category: "general",
    title: "General Response (EN)",
    language: "en",
    isDefault: true,
    body: `Hello {{guestName}},

Thank you for your message. We've received your request and will get back to you as soon as possible.`,
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
