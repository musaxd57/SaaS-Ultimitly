import * as React from "react";
import { AlertTriangle } from "lucide-react";

/**
 * FORM-BAZLI (gönderim) hata bandı.
 *
 * `Field` yalnız ALAN-bazlı hatayı çözüyordu; formun tamamına ait hata
 * ("E-posta veya şifre hatalı", "Bu e-posta zaten kayıtlı") her formda elle
 * `<p className="rounded-md bg-destructive/10 …">` olarak basılıyordu ve
 * hiçbirinde `role="alert"` yoktu. Yani hata sunucudan döndüğünde ekran okuyucu
 * kullanıcısı HİÇBİR ŞEY duymuyordu: form gönderilmiş gibi görünüyor, sayfa
 * sessiz kalıyordu.
 *
 * `role="alert"` sonradan belirdiğinde KESİNTİ ile duyurulur — form hatası tam
 * olarak bunu hak eder (kullanıcı devam edemez).
 */
export function FormError({ children, id }: { children?: React.ReactNode; id?: string }) {
  if (!children) return null;
  return (
    <p
      id={id}
      role="alert"
      className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
