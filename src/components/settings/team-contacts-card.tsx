"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Ayarlar › Ekip kişileri (T3; tasarım docs/TASARIM-2026-11-13-temizlikci-akisi-whatsapp-yedek.md §9 İ3 / İ5). Hesabı olmayan temizlikçi /
 * personel yalnız adıyla eklenir; görev atamasında ve dairenin temizlikçisi listesinde görünür. WhatsApp bağı kişinin KENDİ telefonundan:
 * ev sahibi kodu / bağlantıyı kişiye verir, kişi kodu gönderir. Sunucu 404 derse (anahtar kapalı) kart HİÇ görünmez. Metinler sade.
 */

type Binding = { status: "active"; masked: string; verifiedAt: string } | { status: "pending"; expiresAt: string } | { status: "none" };
type Contact = { userId: string; name: string; binding: Binding };
type Data = { whatsapp: boolean; contacts: Contact[] };
type Issued = { userId: string; code: string; link: string | null; expiresAt: string };

const NETWORK = "İnternet bağlantınızda sorun var gibi görünüyor. Kontrol edip tekrar deneyin.";
const GENERIC = "Şu anda yapılamadı. Biraz sonra tekrar deneyin.";

async function firstError(res: Response): Promise<string> {
  if (res.status === 429) return "Çok fazla deneme yaptınız. Biraz sonra tekrar deneyin.";
  try {
    const body = (await res.json()) as { error?: unknown; fields?: Record<string, unknown> };
    const fromFields = body.fields ? Object.values(body.fields).find((v) => typeof v === "string") : undefined;
    if (typeof fromFields === "string") return fromFields;
    if (typeof body.error === "string") return body.error;
  } catch {
    // gövde yok
  }
  return GENERIC;
}

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "long" });
}

export function TeamContactsCard() {
  const [data, setData] = useState<Data | null>(null);
  const [hidden, setHidden] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/team-contacts", { cache: "no-store" });
      if (res.status === 404 || res.status === 403) {
        setHidden(true);
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as Data);
    } catch {
      setError(NETWORK);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (hidden) return null;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy("add");
    setError(null);
    try {
      const res = await fetch("/api/team-contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        setError(await firstError(res));
        return;
      }
      setName("");
      await load();
    } catch {
      setError(NETWORK);
    } finally {
      setBusy(null);
    }
  }

  async function issueCode(userId: string) {
    if (busy) return;
    setBusy(userId);
    setError(null);
    try {
      const res = await fetch(`/api/team-contacts/${encodeURIComponent(userId)}/binding`, { method: "POST" });
      if (!res.ok) {
        setError(await firstError(res));
        return;
      }
      const body = (await res.json()) as { code: string; link: string | null; expiresAt: string };
      setIssued({ userId, ...body });
      await load();
    } catch {
      setError(NETWORK);
    } finally {
      setBusy(null);
    }
  }

  async function unlink(userId: string) {
    if (busy) return;
    setBusy(userId);
    setError(null);
    try {
      const res = await fetch(`/api/team-contacts/${encodeURIComponent(userId)}/binding`, { method: "DELETE" });
      if (!res.ok) {
        setError(await firstError(res));
        return;
      }
      if (issued?.userId === userId) setIssued(null);
      await load();
    } catch {
      setError(NETWORK);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Ekip kişileri</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Hesabı olmayan temizlikçinizi adıyla ekleyin. Görev atarken ve dairenin temizlikçisini seçerken listede görünür; uygulamaya giriş yapmaz.
        </p>

        <form onSubmit={add} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1">
            <Label htmlFor="team-contact-name">Ad</Label>
            <Input
              id="team-contact-name"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ör. Ayşe"
              autoComplete="off"
            />
          </div>
          <Button type="submit" disabled={busy !== null || !name.trim()}>
            {busy === "add" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Ekle
          </Button>
        </form>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {data === null && !error ? <p className="text-sm text-muted-foreground">Yükleniyor…</p> : null}

        {data && data.contacts.length > 0 ? (
          <ul className="divide-y rounded-md border">
            {data.contacts.map((c) => (
              <li key={c.userId} className="space-y-2 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 break-words font-medium">{c.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {c.binding.status === "active"
                      ? `WhatsApp bağlı (${c.binding.masked})`
                      : c.binding.status === "pending"
                        ? `Kod bekleniyor (${dayLabel(c.binding.expiresAt)} tarihine kadar)`
                        : data.whatsapp
                          ? "WhatsApp bağlı değil"
                          : null}
                  </span>
                </div>
                {data.whatsapp ? (
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => void issueCode(c.userId)}>
                      {busy === c.userId ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                      {c.binding.status === "active" ? "Numarayı değiştir" : "WhatsApp kodu oluştur"}
                    </Button>
                    {c.binding.status !== "none" ? (
                      <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={() => void unlink(c.userId)}>
                        WhatsApp bağını kaldır
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {issued?.userId === c.userId ? (
                  <div className="space-y-1 rounded-md bg-muted p-3 text-sm">
                    <p>
                      Bu kodu {c.name} kendi telefonundan WhatsApp ile göndersin: <strong className="font-mono">{issued.code}</strong>
                    </p>
                    {issued.link ? (
                      <p>
                        Ya da bu bağlantıyı ona iletin:{" "}
                        <a href={issued.link} target="_blank" rel="noopener noreferrer" className="break-all text-primary hover:underline">
                          {issued.link}
                        </a>
                      </p>
                    ) : null}
                    <p className="text-muted-foreground">Kod {dayLabel(issued.expiresAt)} tarihine kadar geçerli.</p>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
