"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

/**
 * Şifre alanı + göz (göster/gizle) düğmesi.
 *
 * Field'in tek-çocuk aria enjeksiyonuyla UYUMLU: Field, aria-invalid /
 * aria-describedby'ı çocuk ELEMENTİN props'una ekler; burada o props'lar
 * {...props} ile iç <Input>'a aynen akar — sarmalayıcı div bağı koparmaz
 * (kayıt formundaki sarmalayıcı-div regresyonunun dersi). `type` bilinçli
 * olarak spread'den SONRA verilir: görünürlüğü yalnız göz düğmesi yönetir.
 */
export function PasswordInput({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = React.useState(false);
  return (
    <div className="relative">
      <Input {...props} type={show ? "text" : "password"} className={cn("pr-10", className)} />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Şifreyi gizle" : "Şifreyi göster"}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground transition-colors hover:text-foreground"
        tabIndex={-1}
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}
