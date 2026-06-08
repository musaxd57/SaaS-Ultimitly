import { Hotel, MessageSquare, ListChecks, BarChart3 } from "lucide-react";

const VALUE_PROPS = [
  { icon: MessageSquare, text: "Misafir mesajlarına AI destekli hızlı cevap" },
  { icon: ListChecks, text: "Temizlik ve check-in görevleri otomatik akışta" },
  { icon: BarChart3, text: "Doluluk, performans ve operasyon tek panelde" },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between bg-primary p-10 text-primary-foreground lg:flex">
        <div className="flex items-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-lg bg-white/15">
            <Hotel className="size-5" />
          </div>
          <span className="text-lg font-semibold tracking-tight">
            Lixus <span className="text-white/70">AI</span>
          </span>
        </div>

        <div className="space-y-6">
          <h2 className="max-w-md text-2xl font-semibold leading-snug">
            Operasyonunuz kendi kendine yürüsün.
          </h2>
          <ul className="space-y-3">
            {VALUE_PROPS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-primary-foreground/85">
                <span className="flex size-8 items-center justify-center rounded-md bg-white/10">
                  <Icon className="size-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-primary-foreground/60">
          Kurallara uygun, sağlam, uzun ömürlü operasyon platformu.
        </p>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
