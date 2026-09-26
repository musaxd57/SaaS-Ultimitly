// ---------------------------------------------------------------------------
// TEMİZLİKÇİ GÖRÜNÜMÜ (09-24, erken giriş kanıt modeli dilim 3; kurucu: "temizlikçi misafir mesajını, adını,
// iletişimini, fiyatı ASLA görmez"). Görevin personele / temizlikçiye giden HER yüzeyi (görev listesi, görev güncelleme
// cevabı, atama e-postası, WhatsApp temizlik listesi) başlığı ve açıklamayı BURADAN alır — ikinci bir kural yazılmaz.
//
//  · Sistem görevi (rezervasyondan üretilir): başlıkta misafir ADI var ("Çıkış temizliği - Ayşe") → türün sabit adı.
//  · Yapay zekâ görevi (misafir mesajından): açıklama misafirin MESAJIDIR → gösterilmez. Başlık yalnız kendi ürettiğimiz
//    "Tür: konu" biçimindeyse (konu = mesajdan eşleşen cihaz/eşya sözcüğü) kalır; aksi ("Şikayet: <misafir>") → tür adı.
//  · Elle açılmış görev: host personele yazdı → olduğu gibi.
// Saf; istemci bileşeni de içe aktarabilir (DB yok).
// ---------------------------------------------------------------------------

import { TASK_TYPE } from "@/lib/constants";

export interface StaffViewInput {
  title: string;
  type: string;
  origin: string | null;
  description?: string | null;
}

/** Sistem görevlerinin misafir adı taşımayan sabit adları (rezervasyon yaşam döngüsü üretir). */
const SYSTEM_TITLES: Readonly<Record<string, string>> = {
  cleaning: "Çıkış temizliği",
  checkin_prep: "Giriş hazırlığı",
};

/**
 * `buildOperationalTaskData` biçimi: "Bakım: klima" — tür etiketi + kısa konu sözcüğü (mesajdan eşleşen cihaz/eşya
 * sözcüğü; misafir adı olamaz). Konuda rakam YOK: telefon / oda no / kod gibi bir değer başlıktan geçemesin.
 */
const AI_TOPIC_TITLE = /^[\p{L} ]{2,20}: [\p{L} ./-]{1,40}$/u;

function typeLabel(type: string): string {
  return TASK_TYPE.label(type) || "Görev";
}

/** Temizlikçiye / personele gösterilecek başlık. */
export function cleanerTaskTitle(t: StaffViewInput): string {
  if (t.origin === "manual") return t.title;
  if (t.origin === "system") return SYSTEM_TITLES[t.type] ?? typeLabel(t.type);
  if (t.origin === "ai") {
    const label = typeLabel(t.type);
    return t.title.startsWith(`${label}: `) && AI_TOPIC_TITLE.test(t.title) ? t.title : label;
  }
  // Bilinmeyen / eski kaynak: güvenli yön — başlıkta ne olduğu bilinmiyor.
  return typeLabel(t.type);
}

/** Temizlikçiye / personele gösterilecek açıklama: yapay zekâ görevinde (misafir mesajı) ve bilinmeyen kaynakta YOK. */
export function cleanerTaskDescription(t: StaffViewInput): string | null {
  if (t.origin === "manual" || t.origin === "system") return t.description ?? null;
  return null;
}

/** Görev satırının personel izdüşümü: başlık + açıklama değişir, misafir mesajına bağlanan kimlik düşer. */
export function staffTaskProjection<T extends StaffViewInput & { sourceMessageId?: string | null }>(t: T): T {
  return { ...t, title: cleanerTaskTitle(t), description: cleanerTaskDescription(t), sourceMessageId: null };
}
