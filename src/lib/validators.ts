import { z } from "zod";
import {
  RESERVATION_STATUS,
  RESERVATION_CHANNEL,
  CONVERSATION_STATUS,
  PRIORITY,
  TASK_STATUS,
  TASK_TYPE,
  KB_CATEGORY,
  REPLY_TONE,
  SUPPLY_ITEM_KEYS,
} from "@/lib/constants";

// --- Marketing lead (public "request a demo" form) -------------------------
export const leadSchema = z.object({
  name: z.string().min(2, "Adınızı girin").max(120),
  email: z.string().email("Geçerli bir e-posta girin").max(254),
  phone: z.string().max(40).optional().or(z.literal("")),
  message: z.string().max(1000).optional().or(z.literal("")),
  // KVKK: explicit, affirmative consent is required to collect contact data.
  consent: z.literal(true, {
    errorMap: () => ({ message: "Devam etmek için onay kutusunu işaretleyin." }),
  }),
});
export type LeadInput = z.infer<typeof leadSchema>;

// --- Billing ----------------------------------------------------------------
// Checkout (Mesafeli Satış) consent record. planCode/priceId are the ONLY client
// inputs; org, user, legal version, IP and User-Agent are all server-derived so
// they can't be forged.
export const checkoutConsentSchema = z.object({
  planCode: z.string().min(1, "Plan gerekli").max(64),
  priceId: z.string().min(1, "Fiyat gerekli").max(128),
});
export type CheckoutConsentInput = z.infer<typeof checkoutConsentSchema>;

// --- Auth -------------------------------------------------------------------
export const registerSchema = z.object({
  organizationName: z.string().min(2, "İşletme adı en az 2 karakter olmalı").max(200),
  name: z.string().min(2, "Ad en az 2 karakter olmalı").max(200),
  email: z.string().email("Geçerli bir e-posta girin").max(254),
  password: z.string().min(8, "Şifre en az 8 karakter olmalı").max(200),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email("Geçerli bir e-posta girin").max(254),
  password: z.string().min(1, "Şifre gerekli").max(200),
  // Optional TOTP code, supplied on the second step when the account has 2FA on.
  code: z.string().trim().max(12).optional(),
  // Alternative second factor: a single-use recovery code ("telefonuma
  // erişemiyorum"). Max 20 covers XXXX-XXXX-XXXX plus stray separators.
  recoveryCode: z.string().trim().max(20).optional(),
  // "Bu cihazı 30 gün hatırla": skip the 2FA code on this device for 30 days.
  rememberDevice: z.boolean().optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

// --- Property ---------------------------------------------------------------
export const propertySchema = z.object({
  name: z.string().min(2, "Mülk adı gerekli").max(200),
  address: z.string().max(300).optional().or(z.literal("")),
  city: z.string().max(120).optional().or(z.literal("")),
  country: z.string().max(120).optional().or(z.literal("")),
  checkInTime: z.string().regex(/^\d{2}:\d{2}$/, "SS:DD formatında olmalı").default("15:00"),
  checkOutTime: z.string().regex(/^\d{2}:\d{2}$/, "SS:DD formatında olmalı").default("11:00"),
  cleaningBufferMinutes: z.coerce.number().int().min(0).max(1440).default(120),
  notes: z.string().max(5000).optional().or(z.literal("")),
  // Supply/linen prep profile: qty-per-arrival for known items only. Partial (any
  // subset of keys), each 0–999. Unknown keys are rejected so a bad client can't
  // stuff arbitrary data into the JSON column.
  supplyProfile: z
    .record(z.enum(SUPPLY_ITEM_KEYS), z.coerce.number().int().min(0).max(999))
    .optional(),
});
export type PropertyInput = z.infer<typeof propertySchema>;

// --- Reservation ------------------------------------------------------------
export const reservationSchema = z
  .object({
    propertyId: z.string().min(1, "Mülk seçin"),
    guestName: z.string().trim().min(2, "Misafir adı gerekli").max(200),
    guestPhone: z.string().max(40).optional().or(z.literal("")),
    guestEmail: z.string().email("Geçerli e-posta girin").max(254).optional().or(z.literal("")),
    arrivalDate: z.coerce.date({ message: "Giriş tarihi gerekli" }),
    departureDate: z.coerce.date({ message: "Çıkış tarihi gerekli" }),
    channel: z.enum(RESERVATION_CHANNEL.values).default("manual"),
    status: z.enum(RESERVATION_STATUS.values).default("confirmed"),
    totalAmount: z.coerce.number().min(0).max(100_000_000).optional().or(z.nan().transform(() => undefined)),
    currency: z.string().max(8).default("EUR"),
    sourceReference: z.string().max(200).optional().or(z.literal("")),
    notes: z.string().max(5000).optional().or(z.literal("")),
  })
  .refine((d) => d.departureDate > d.arrivalDate, {
    message: "Çıkış tarihi girişten sonra olmalı",
    path: ["departureDate"],
  });
export type ReservationInput = z.infer<typeof reservationSchema>;

export const reservationUpdateSchema = z.object({
  status: z.enum(RESERVATION_STATUS.values).optional(),
  notes: z.string().max(5000).optional(),
});

// --- Conversation / Messages ------------------------------------------------
export const conversationReplySchema = z.object({
  body: z.string().min(1, "Mesaj boş olamaz").max(10000),
  // Reserved sender names: "GuestOps AI" is the AI-message classification magic
  // string (reports count on it) and "Lixus AI" is its rendered brand alias — a
  // manual reply claiming either would self-inflate the org's AI metrics or
  // visually impersonate the bot. Only the automation writes them (server-side,
  // never through this schema).
  senderName: z
    .string()
    .max(200)
    .refine((v) => !["guestops ai", "lixus ai"].includes(v.trim().toLowerCase()), {
      message: "Bu gönderen adı sistem için ayrılmıştır.",
    })
    .optional(),
});

export const conversationCreateSchema = z.object({
  propertyId: z.string().min(1, "Mülk seçin"),
  reservationId: z.string().optional().or(z.literal("")),
  guestIdentifier: z.string().trim().min(1, "Misafir bilgisi gerekli").max(200),
  channel: z.string().max(40).default("manual"),
  firstMessage: z.string().min(1, "İlk mesaj gerekli").max(10000),
  priority: z.enum(PRIORITY.values).default("standard"),
});

export const conversationUpdateSchema = z.object({
  status: z.enum(CONVERSATION_STATUS.values).optional(),
  priority: z.enum(PRIORITY.values).optional(),
});

export const aiSuggestSchema = z.object({
  tone: z.enum(REPLY_TONE.values).default("warm"),
});

// --- Tasks ------------------------------------------------------------------
export const taskSchema = z.object({
  propertyId: z.string().min(1, "Mülk seçin"),
  reservationId: z.string().optional().or(z.literal("")),
  type: z.enum(TASK_TYPE.values).default("cleaning"),
  title: z.string().trim().min(2, "Başlık gerekli").max(300),
  description: z.string().max(5000).optional().or(z.literal("")),
  assignedToId: z.string().optional().or(z.literal("")),
  dueAt: z.coerce.date().optional().or(z.literal("").transform(() => undefined)),
  priority: z.enum(PRIORITY.values).default("standard"),
  status: z.enum(TASK_STATUS.values).default("todo"),
});
export type TaskInput = z.infer<typeof taskSchema>;

export const taskUpdateSchema = z.object({
  status: z.enum(TASK_STATUS.values).optional(),
  assignedToId: z.string().optional(),
  note: z.string().max(5000).optional(),
  // Only a same-origin relative path (what /api/upload returns: "/uploads/…") or
  // an explicit https URL (future object storage). This value is rendered as an
  // <a href> AND an <img src> in the task board, so a "javascript:" / "data:" /
  // protocol-relative "//host" value would be stored XSS a same-org staff member
  // could aim at the owner. Reject every other scheme.
  photoUrl: z
    .string()
    .max(2000)
    .refine((v) => /^\/(?!\/)/.test(v) || /^https:\/\//i.test(v), "Geçersiz görsel bağlantısı.")
    .optional(),
  title: z.string().max(300).optional(),
  description: z.string().max(5000).optional(),
  priority: z.enum(PRIORITY.values).optional(),
  dueAt: z.coerce.date().optional(),
  // Checklist items ({label, done}) so the cleaner can tick off "Çarşaf takımı × 2".
  checklist: z
    .array(z.object({ label: z.string().max(300), done: z.boolean() }))
    .max(60)
    .optional(),
});

// --- Knowledge Base ---------------------------------------------------------
export const kbSchema = z.object({
  propertyId: z.string().min(1, "Mülk seçin"),
  category: z.enum(KB_CATEGORY.values).default("general"),
  title: z.string().trim().min(2, "Başlık gerekli").max(300),
  content: z.string().min(2, "İçerik gerekli").max(20000),
  language: z.string().max(10).default("tr"),
  // z.boolean (not z.coerce.boolean): coercion maps the STRING "false" to true
  // (Boolean("false")). Callers send real booleans; a stringy "false" should be
  // rejected, not silently activate the item. default(true) still handles absent.
  isActive: z.boolean().default(true),
});
export type KbInput = z.infer<typeof kbSchema>;

export const kbUpdateSchema = kbSchema.partial().omit({ propertyId: true });

/** Helper to format a ZodError into a flat { field: message } map for the API. */
export function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
