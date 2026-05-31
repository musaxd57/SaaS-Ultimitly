// Centralized "enum" definitions. Stored as String in SQLite and validated in
// the app layer. Keeps labels (Turkish) and badge styling in one place.

export type BadgeTone =
  | "default"
  | "secondary"
  | "success"
  | "warning"
  | "destructive"
  | "muted";

type Option<T extends string> = {
  value: T;
  label: string;
  tone: BadgeTone;
};

function optionMap<T extends string>(options: Option<T>[]) {
  const byValue = Object.fromEntries(options.map((o) => [o.value, o])) as Record<string, Option<T>>;
  return {
    options,
    values: options.map((o) => o.value) as [T, ...T[]],
    // Accept `string` so values read from the DB don't require casts at call sites.
    label: (v: string) => byValue[v]?.label ?? v,
    tone: (v: string): BadgeTone => byValue[v]?.tone ?? "default",
  };
}

// --- Reservations -----------------------------------------------------------
export type ReservationStatus = "pending" | "confirmed" | "cancelled" | "completed";
export const RESERVATION_STATUS = optionMap<ReservationStatus>([
  { value: "pending", label: "Beklemede", tone: "warning" },
  { value: "confirmed", label: "Onaylı", tone: "success" },
  { value: "cancelled", label: "İptal", tone: "destructive" },
  { value: "completed", label: "Tamamlandı", tone: "muted" },
]);

export type ReservationChannel = "manual" | "airbnb" | "booking" | "direct" | "other";
export const RESERVATION_CHANNEL = optionMap<ReservationChannel>([
  { value: "manual", label: "Manuel", tone: "secondary" },
  { value: "airbnb", label: "Airbnb", tone: "destructive" },
  { value: "booking", label: "Booking", tone: "default" },
  { value: "direct", label: "Doğrudan", tone: "success" },
  { value: "other", label: "Diğer", tone: "muted" },
]);

// --- Conversations ----------------------------------------------------------
export type ConversationStatus = "new" | "waiting" | "answered" | "problem" | "closed";
export const CONVERSATION_STATUS = optionMap<ConversationStatus>([
  { value: "new", label: "Yeni", tone: "default" },
  { value: "waiting", label: "Beklemede", tone: "warning" },
  { value: "answered", label: "Cevaplandı", tone: "success" },
  { value: "problem", label: "Sorunlu", tone: "destructive" },
  { value: "closed", label: "Tamamlandı", tone: "muted" },
]);

export type Priority = "urgent" | "standard" | "low";
export const PRIORITY = optionMap<Priority>([
  { value: "urgent", label: "Acil", tone: "destructive" },
  { value: "standard", label: "Standart", tone: "secondary" },
  { value: "low", label: "Düşük", tone: "muted" },
]);

export type MessageDirection = "inbound" | "outbound";

// --- Tasks ------------------------------------------------------------------
export type TaskStatus = "todo" | "in_progress" | "awaiting_review" | "done";
export const TASK_STATUS = optionMap<TaskStatus>([
  { value: "todo", label: "Yapılacak", tone: "secondary" },
  { value: "in_progress", label: "Devam ediyor", tone: "default" },
  { value: "awaiting_review", label: "Onay bekliyor", tone: "warning" },
  { value: "done", label: "Tamamlandı", tone: "success" },
]);

export type TaskType =
  | "cleaning"
  | "laundry"
  | "restock"
  | "checkin_prep"
  | "checkout_review"
  | "maintenance";
export const TASK_TYPE = optionMap<TaskType>([
  { value: "cleaning", label: "Temizlik", tone: "default" },
  { value: "laundry", label: "Çamaşır", tone: "secondary" },
  { value: "restock", label: "Eksik Eşya", tone: "warning" },
  { value: "checkin_prep", label: "Check-in Hazırlık", tone: "success" },
  { value: "checkout_review", label: "Check-out Kontrol", tone: "muted" },
  { value: "maintenance", label: "Bakım", tone: "destructive" },
]);

// --- Knowledge Base ---------------------------------------------------------
export type KbCategory =
  | "location"
  | "checkin"
  | "wifi"
  | "rules"
  | "parking"
  | "trash"
  | "cleaning"
  | "faq"
  | "local_tips"
  | "general";
export const KB_CATEGORY = optionMap<KbCategory>([
  { value: "location", label: "Konum", tone: "default" },
  { value: "checkin", label: "Giriş Talimatı", tone: "success" },
  { value: "wifi", label: "Wi-Fi", tone: "secondary" },
  { value: "rules", label: "Ev Kuralları", tone: "warning" },
  { value: "parking", label: "Otopark", tone: "muted" },
  { value: "trash", label: "Çöp", tone: "muted" },
  { value: "cleaning", label: "Temizlik", tone: "secondary" },
  { value: "faq", label: "Sık Sorulanlar", tone: "default" },
  { value: "local_tips", label: "Yerel Tavsiye", tone: "success" },
  { value: "general", label: "Genel", tone: "muted" },
]);

// --- Roles ------------------------------------------------------------------
export type UserRole = "owner" | "manager" | "staff";
export const USER_ROLE = optionMap<UserRole>([
  { value: "owner", label: "Sahip", tone: "default" },
  { value: "manager", label: "Yönetici", tone: "secondary" },
  { value: "staff", label: "Personel", tone: "muted" },
]);

// --- AI Tone ----------------------------------------------------------------
export type ReplyTone = "formal" | "warm" | "short" | "luxury";
export const REPLY_TONE = optionMap<ReplyTone>([
  { value: "warm", label: "Sıcak", tone: "success" },
  { value: "formal", label: "Resmi", tone: "secondary" },
  { value: "short", label: "Kısa", tone: "muted" },
  { value: "luxury", label: "Lüks", tone: "default" },
]);

// --- Message Templates ------------------------------------------------------
export type TemplateCategory =
  | "checkin"
  | "checkout"
  | "welcome"
  | "complaint_response"
  | "rules"
  | "wifi"
  | "general";

export const TEMPLATE_CATEGORY = optionMap<TemplateCategory>([
  { value: "checkin", label: "Giriş Talimatı", tone: "success" },
  { value: "checkout", label: "Çıkış Hatırlatması", tone: "secondary" },
  { value: "welcome", label: "Hoş Geldiniz", tone: "default" },
  { value: "complaint_response", label: "Şikayet Yanıtı", tone: "destructive" },
  { value: "rules", label: "Ev Kuralları", tone: "warning" },
  { value: "wifi", label: "Wi-Fi Bilgisi", tone: "muted" },
  { value: "general", label: "Genel", tone: "muted" },
]);

// --- Automation triggers ----------------------------------------------------
export type AutomationTrigger =
  | "reservation_created"
  | "checkout_completed"
  | "message_received"
  | "complaint_detected";
export const AUTOMATION_TRIGGER = optionMap<AutomationTrigger>([
  { value: "reservation_created", label: "Rezervasyon oluşturuldu", tone: "success" },
  { value: "checkout_completed", label: "Check-out tamamlandı", tone: "secondary" },
  { value: "message_received", label: "Mesaj alındı", tone: "default" },
  { value: "complaint_detected", label: "Şikayet algılandı", tone: "destructive" },
]);
