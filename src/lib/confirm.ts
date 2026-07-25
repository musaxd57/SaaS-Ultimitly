/**
 * Ortak onay sorusu.
 *
 * Yıkıcı işlemler `window.confirm()` ile soruluyordu: markasız sistem kutusu,
 * tek satır metin (ne silineceğinin bağlamı yok), mobilde sayfayı dondurur.
 *
 * Senkron `if (!confirm()) return;` yapısı asenkron bir diyaloğa taşınırken
 * yapılabilecek EN KÖTÜ hata, işlemin onay beklenmeden çalışmasıdır. Bu yüzden
 * API bilerek çağrı yerindeki şekli birebir korur:
 *
 *     if (!(await confirmDialog({ title: "..." }))) return;
 *
 * FAIL-SAFE ZİNCİRİ (yıkıcı işlem asla sessizce onaylanmaz):
 *   1. <ConfirmHost/> mount edilmişse → uygulama diyaloğu.
 *   2. Değilse → native window.confirm (eski davranış; kullanıcı YİNE sorulur).
 *   3. O da yoksa (SSR/kısıtlı ortam) → false döner, yani REDDEDER.
 */

export type ConfirmOptions = {
  /** Sorunun kendisi; diyaloğun erişilebilir adı olur. */
  title: string;
  /** İsteğe bağlı ikinci satır: sonucu açıklar (native confirm'in veremediği). */
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Onay düğmesi yıkıcı görünsün mü (kırmızı). */
  destructive?: boolean;
};

type Handler = (options: ConfirmOptions) => Promise<boolean>;

let handler: Handler | null = null;

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  if (handler) return handler(options);
  // Host yok → sessizce onaylamak YASAK; eski (native) yola düş.
  if (typeof window !== "undefined" && typeof window.confirm === "function") {
    const text = options.body ? `${options.title}\n\n${options.body}` : options.title;
    return Promise.resolve(window.confirm(text));
  }
  return Promise.resolve(false); // fail-closed
}

export function registerConfirmHandler(next: Handler): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

/** Yalnız testler için. */
export function __resetConfirmForTest(): void {
  handler = null;
}
