/**
 * Ortak bildirim yayını.
 *
 * Panel 33 ayrı yerde `window.alert()` çağırıyordu: markasız sistem kutusu,
 * sayfayı bloklar, ve arka arkaya basıldığında tarayıcı "bu sayfanın başka
 * pencere açmasını engelle" seçeneği sunar — kabul edilirse SONRAKİ HATALAR
 * SESSİZCE KAYBOLUR. Tek bir yüzeye taşındı.
 *
 * React context DEĞİL, modül seviyesinde bir yayın: bileşenin ağaçta nerede
 * durduğu önemli olmadan (provider'sız da) çağrılabilir.
 *
 * FAIL-SAFE: hiç dinleyici (mount edilmiş <Toaster/>) yoksa mesaj YUTULMAZ,
 * native alert'e düşer. "Sessiz hata" bu dosyada yapısal olarak imkânsız.
 */

export type ToastVariant = "error" | "success" | "info";

export type ToastMessage = {
  id: number;
  text: string;
  variant: ToastVariant;
};

type Listener = (message: ToastMessage) => void;

const listeners = new Set<Listener>();
let sequence = 0;

function emit(text: string, variant: ToastVariant): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  if (listeners.size === 0) {
    // Ekranda gösterecek kimse yok → sessiz kalmaktansa eski davranışa dön.
    if (typeof window !== "undefined" && typeof window.alert === "function") {
      window.alert(trimmed);
    }
    return;
  }
  const message: ToastMessage = { id: ++sequence, text: trimmed, variant };
  for (const listener of listeners) listener(message);
}

function toastFn(text: string, variant: ToastVariant = "info"): void {
  emit(text, variant);
}

export const toast = Object.assign(toastFn, {
  error: (text: string) => emit(text, "error"),
  success: (text: string) => emit(text, "success"),
  info: (text: string) => emit(text, "info"),
});

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Yalnız testler için: dinleyici kaydını ve sayacı sıfırlar. */
export function __resetToastsForTest(): void {
  listeners.clear();
  sequence = 0;
}
