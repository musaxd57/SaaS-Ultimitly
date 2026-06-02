"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/form-field";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { REPLY_TONE } from "@/lib/constants";

export function AiVoiceForm({ tone, signature }: { tone: string; signature: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [aiReplyTone, setTone] = useState(tone);
  const [aiSignature, setSignature] = useState(signature);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiReplyTone, aiSignature }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.fields?.aiSignature ?? data.fields?.aiReplyTone ?? data.error ?? "Kaydedilemedi");
        return;
      }
      setSaved(true);
      startTransition(() => router.refresh());
    } catch {
      setError("Bağlantı hatası.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-muted-foreground" /> AI'nın Sesi
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-4">
          {error ? (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
          ) : null}

          <Field label="Yanıt tonu" htmlFor="ai-tone">
            <Select id="ai-tone" value={aiReplyTone} onChange={(e) => setTone(e.target.value)}>
              {REPLY_TONE.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              AI cevaplarının üslubu. Sıcak = samimi, Resmi = ciddi, Kısa = öz, Lüks = zarif.
            </p>
          </Field>

          <Field label="İmza (her cevabın sonuna eklenir)" htmlFor="ai-signature">
            <Textarea
              id="ai-signature"
              rows={4}
              value={aiSignature}
              onChange={(e) => setSignature(e.target.value)}
              placeholder={"Örn:\nSevgiler,\nİsa Çınar\n📞 +90 5XX XXX XX XX"}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Boş bırakırsan imza eklenmez. İletişim numaranı buraya koyabilirsin — her dairede aynı kalır.
            </p>
          </Field>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Kaydet
            </Button>
            {saved ? (
              <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600">
                <Check className="size-4" /> Kaydedildi
              </span>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
