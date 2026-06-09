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
} from "@/lib/constants";

// --- Marketing lead (public "request a demo" form) -------------------------
export const leadSchema = z.object({
  name: z.string().min(2, "Adınızı girin").max(120),
  email: z.string().email("Geçerli bir e-posta girin"),
  phone: z.string().max(40).optional().or(z.literal("")),
  message: z.string().max(1000).optional().or(z.literal("")),
});
export type LeadInput = z.infer<typeof leadSchema>;

// --- Auth -------------------------------------------------------------------
export const registerSchema = z.object({
  organizationName: z.string().min(2, "İşletme adı en az 2 karakter olmalı"),
  name: z.string().min(2, "Ad en az 2 karakter olmalı"),
  email: z.string().email("Geçerli bir e-posta girin"),
  password: z.string().min(8, "Şifre en az 8 karakter olmalı").max(200),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email("Geçerli bir e-posta girin"),
  password: z.string().min(1, "Şifre gerekli"),
  // Optional TOTP code, supplied on the second step when the account has 2FA on.
  code: z.string().trim().max(12).optional(),
  // "Bu cihazı 30 gün hatırla": skip the 2FA code on this device for 30 days.
  rememberDevice: z.boolean().optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

// --- Property ---------------------------------------------------------------
export const propertySchema = z.object({
  name: z.string().min(2, "Mülk adı gerekli"),
  address: z.string().optional().or(z.literal("")),
  city: z.string().optional().or(z.literal("")),
  country: z.string().optional().or(z.literal("")),
  checkInTime: z.string().regex(/^\d{2}:\d{2}$/, "SS:DD formatında olmalı").default("15:00"),
  checkOutTime: z.string().regex(/^\d{2}:\d{2}$/, "SS:DD formatında olmalı").default("11:00"),
  cleaningBufferMinutes: z.coerce.number().int().min(0).max(1440).default(120),
  notes: z.string().max(5000).optional().or(z.literal("")),
});
export type PropertyInput = z.infer<typeof propertySchema>;

// --- Reservation ------------------------------------------------------------
export const reservationSchema = z
  .object({
    propertyId: z.string().min(1, "Mülk seçin"),
    guestName: z.string().trim().min(2, "Misafir adı gerekli").max(200),
    guestPhone: z.string().optional().or(z.literal("")),
    guestEmail: z.string().email("Geçerli e-posta girin").optional().or(z.literal("")),
    arrivalDate: z.coerce.date({ message: "Giriş tarihi gerekli" }),
    departureDate: z.coerce.date({ message: "Çıkış tarihi gerekli" }),
    channel: z.enum(RESERVATION_CHANNEL.values).default("manual"),
    status: z.enum(RESERVATION_STATUS.values).default("confirmed"),
    totalAmount: z.coerce.number().min(0).optional().or(z.nan().transform(() => undefined)),
    currency: z.string().max(8).default("EUR"),
    sourceReference: z.string().optional().or(z.literal("")),
    notes: z.string().max(5000).optional().or(z.literal("")),
  })
  .refine((d) => d.departureDate > d.arrivalDate, {
    message: "Çıkış tarihi girişten sonra olmalı",
    path: ["departureDate"],
  });
export type ReservationInput = z.infer<typeof reservationSchema>;

export const reservationUpdateSchema = z.object({
  status: z.enum(RESERVATION_STATUS.values).optional(),
  notes: z.string().optional(),
});

// --- Conversation / Messages ------------------------------------------------
export const conversationReplySchema = z.object({
  body: z.string().min(1, "Mesaj boş olamaz").max(10000),
  senderName: z.string().max(200).optional(),
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
  note: z.string().optional(),
  photoUrl: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  priority: z.enum(PRIORITY.values).optional(),
  dueAt: z.coerce.date().optional(),
});

// --- Knowledge Base ---------------------------------------------------------
export const kbSchema = z.object({
  propertyId: z.string().min(1, "Mülk seçin"),
  category: z.enum(KB_CATEGORY.values).default("general"),
  title: z.string().trim().min(2, "Başlık gerekli").max(300),
  content: z.string().min(2, "İçerik gerekli").max(20000),
  language: z.string().default("tr"),
  isActive: z.coerce.boolean().default(true),
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
