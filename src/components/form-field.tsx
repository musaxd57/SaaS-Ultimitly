import * as React from "react";
import { Label } from "@/components/ui/label";

interface FieldProps {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Etiket + kontrol + (hata | ipucu) üçlüsü.
 *
 * ERİŞİLEBİLİRLİK (Codex): eskiden hata/ipucu metni yalnız GÖRSEL olarak
 * basılıyordu — kontrolle hiçbir programatik bağı yoktu. Ekran okuyucu
 * kullanıcısı alana odaklandığında ne hatayı duyuyor ne de alanın geçersiz
 * olduğunu biliyordu. Artık:
 *   • hata/ipucu `aria-describedby` ile kontrole bağlanır,
 *   • hata varken `aria-invalid` işaretlenir (ipucu varken KONMAZ — geçerli bir
 *     alan geçersiz görünmemeli),
 *   • hata `role="alert"` taşır, yani sonradan belirdiğinde DUYURULUR.
 *
 * id'ler `htmlFor`dan TÜRETİLİR, `useId` ile değil: bu bileşen sunucuda da
 * render edilebilmeli ve hook onu client'a mahkûm ederdi. 55 çağıranın 54'ü
 * zaten `htmlFor` veriyor; vermeyen tek çağıranda bağlama yapılamaz ama hata
 * yine duyurulur (sessizce bozulmaz).
 */
export function Field({ label, htmlFor, error, hint, children, className }: FieldProps) {
  const errorId = htmlFor ? `${htmlFor}-error` : undefined;
  const hintId = htmlFor ? `${htmlFor}-hint` : undefined;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  // Tek bir element çocuğa aria bağlarını enjekte et. Birden fazla çocuk /
  // fragment durumunda kime bağlanacağı belirsizdir → dokunulmaz.
  const child =
    describedBy && React.isValidElement(children)
      ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
          // Çocuğun KENDİ describedby'ı varsa ezilmez, birleştirilir.
          "aria-describedby":
            [(children.props as Record<string, unknown>)["aria-describedby"], describedBy]
              .filter(Boolean)
              .join(" ") || undefined,
          ...(error ? { "aria-invalid": true } : {}),
        })
      : children;

  return (
    <div className={className ?? "space-y-2"}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {child}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
