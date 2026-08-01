"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * KVKK right-to-erasure: lets the OWNER permanently delete the whole account +
 * all data. Re-authenticates with the password; the server route (owner-only,
 * impersonation-blocked) does the cascade delete and clears the session.
 */
export function DeleteAccountCard() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!password) {
      setError("Onaylamak için şifrenizi girin.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.push("/");
        router.refresh();
        return;
      }
      const data = await res.json().catch(() => null);
      setError(data?.fields?.password ?? data?.error ?? "Hesap silinemedi. Lütfen tekrar deneyin.");
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Hesabınızı ve <strong>tüm verilerinizi</strong> kalıcı olarak siler. Bu işlem{" "}
        <strong>geri alınamaz</strong>.
      </p>

      <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs">
        <p className="font-medium text-foreground">Kalıcı olarak silinir</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
          <li>Daireler ve rezervasyonlar (misafir adı, telefon, e-posta dâhil)</li>
          <li>Tüm misafir konuşmaları ve mesajları, görevler</li>
          <li>Bilgi tabanı, şablonlar, takvim bağlantıları, otomasyon kuralları</li>
          <li>Kullanıcı hesapları (şifre, 2FA, onay kayıtları), denetim kayıtları</li>
          <li>Abonelik kaydı ve fatura geçmişi, Hospitable bağlantı bilgileri</li>
        </ul>
        {/* "Tüm verileriniz silinir" vaadinin TEK istisnası fatura mevzuatının
            saklattığı kişisel-verisiz finansal özet — bunu söylememek üstteki
            cümleyi yalancı çıkarır (dürüst-kopya kuralı). Kullanıcı isteğiyle
            başlıklı bloktan tek satıra indirildi; ayrıntı gizlilik sayfasında. */}
        <p className="mt-2 text-muted-foreground">
          İstisna: ödeme kayıtlarının kişisel bilgilerden arındırılmış finansal özeti, fatura
          mevzuatı gereği saklanır.
        </p>
        {/* ⚠️ DÜRÜSTLÜK DÜZELTMESİ (denetim, 08-01 — beşinci tur, ajan bulgusu).
            Liste "Abonelik ve faturalar" diyordu ve bu, aboneliğin de iptal
            edildiği izlenimini veriyordu — oysa silme yolunda Paddle'a HİÇBİR
            iptal çağrısı yok (`deleteAccountData` yalnız webhook redaksiyonu +
            org silme yapar). Sonuç: hesabını silen ödeyen host kartından çekilmeye
            DEVAM ediyor ve iptalin tek yolu olan düğme artık giremediği hesabın
            içinde kalıyordu. Otomatik iptal para hot-path'idir → ürün kararı;
            burada en azından gerçeği söylüyoruz. */}
        <p className="mt-2 font-medium text-amber-700">
          Önce aboneliğinizi iptal edin: hesabı silmek ödeme aboneliğinizi
          <strong> durdurmaz</strong>. Bu yüzden aktif bir aboneliğiniz varken silme
          <strong> yapılamaz</strong> — Faturalandırma → &quot;Aboneliği yönet&quot; bölümünden
          iptal ettikten sonra tekrar deneyin.
        </p>
      </div>

      {!open ? (
        <Button
          variant="outline"
          className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => {
            setOpen(true);
            setError(null);
          }}
        >
          <Trash2 className="size-4" /> Hesabımı kalıcı olarak sil
        </Button>
      ) : (
        <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <p className="flex items-start gap-2 text-sm font-medium text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            Emin misiniz? Onaylamak için şifrenizi girin — hesap ve tüm veriler kalıcı silinecek.
          </p>
          <Input
            type="password"
            value={password}
            placeholder="Şifreniz"
            aria-label="Şifreniz"
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
          />
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="destructive" onClick={remove} disabled={busy || !password}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Evet, kalıcı olarak sil
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
                setPassword("");
                setError(null);
              }}
            >
              Vazgeç
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
