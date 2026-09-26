"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { registerConfirmHandler, type ConfirmOptions } from "@/lib/confirm";

type Pending = {
  id: number;
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
  /** Bu soru sorulduğunda odakta olan öğe — kapanışta oraya dönülür. */
  restore: HTMLElement | null;
};

/** Diyalog içinde Tab ile gezilebilecek öğeler (panelin kendisi tabIndex -1). */
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let sequence = 0;

/**
 * Onay diyaloğunu ekrana basan tek yüzey. Kök layout'ta mount edilir.
 *
 * SÖZ (promise) DİSİPLİNİ — bu bileşenin en kritik özelliği:
 *   • Çözülmeyen bir söz, çağrı yerinde sessizce asılı kalan bir "sil" akışı
 *     demektir (kullanıcı düğmeye bastı, hiçbir şey olmadı, hata da yok).
 *   • Bu yüzden bekleyen sorular bir KUYRUKTA tutulur: ikinci bir çağrı
 *     birincinin resolver'ını EZEMEZ (tek bir `pending` state'i tutulsaydı
 *     birinci söz sonsuza dek asılı kalırdı).
 *   • Host unmount olursa kuyruktaki HER söz `false` ile kapatılır — yıkıcı
 *     işlemde güvenli yön REDDETMEKTİR.
 *   • `resolve` state güncelleyicisinin İÇİNDE çağrılmaz (güncelleyici saf
 *     kalmalı; React onu iki kez çalıştırabilir).
 *
 * Erişilebilirlik: role="dialog" + aria-modal, adlandırılmış başlık, Escape ile
 * vazgeçme, odak içeri alınır, Tab ile İÇERİDE HAPSOLUR ve kapanınca çağıran
 * öğeye döner.
 */
export function ConfirmHost() {
  const [queue, setQueue] = useState<Pending[]>([]);
  /** Kuyruğun senkron aynası: unmount temizliğinde ve settle'da bayat state okumamak için. */
  const queueRef = useRef<Pending[]>([]);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const bodyId = useId();

  const current = queue[0] ?? null;

  useEffect(() => {
    const unregister = registerConfirmHandler(
      (options) =>
        new Promise<boolean>((resolve) => {
          const item: Pending = {
            id: ++sequence,
            options,
            resolve,
            restore:
              document.activeElement instanceof HTMLElement ? document.activeElement : null,
          };
          queueRef.current = [...queueRef.current, item];
          setQueue(queueRef.current);
        }),
    );
    return () => {
      unregister();
      // Ekrandan kalkıyoruz: bekleyen hiçbir soruyu ASILI BIRAKMA.
      const stranded = queueRef.current;
      queueRef.current = [];
      for (const item of stranded) item.resolve(false);
    };
  }, []);

  const settle = useCallback((value: boolean) => {
    const [head, ...rest] = queueRef.current;
    if (!head) return; // çift tıklama / yarış: ikinci çağrı sessiz no-op
    queueRef.current = rest;
    setQueue(rest);
    head.resolve(value); // güncelleyicinin DIŞINDA → yan etkisiz state güncellemesi
    // Sırada başka soru varsa odağı ona bırak; kuyruk boşaldıysa çağırana dön.
    if (rest.length === 0 && head.restore?.isConnected) head.restore.focus();
  }, []);

  useEffect(() => {
    if (!current) return;
    panelRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        settle(false); // Escape = vazgeç (yıkıcı işlemde güvenli yön)
        return;
      }
      if (e.key !== "Tab") return;
      // ODAK HAPSİ: aria-modal="true" demek yetmez, Tab gerçekten dışarı
      // çıkabiliyorsa bu beyan yalan olur.
      const panel = panelRef.current;
      if (!panel) return;
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      const active = document.activeElement as HTMLElement | null;
      if (nodes.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!active || !panel.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [current, settle]);

  if (!current) return null;

  const { title, body, confirmLabel, cancelLabel, destructive } = current.options;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 dark:bg-black/60 p-4">
      <div
        // key: sıradaki soruya geçerken panel gerçekten yeniden monte olsun
        // (odak efekti tetiklensin, eski içerik yapışıp kalmasın).
        key={current.id}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={body ? bodyId : undefined}
        tabIndex={-1}
        className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-xl outline-none"
      >
        <h2 id={titleId} className="text-base font-semibold">
          {title}
        </h2>
        {body ? (
          <p id={bodyId} className="mt-1.5 text-sm text-muted-foreground">
            {body}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => settle(false)}>
            {cancelLabel ?? "Vazgeç"}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            size="sm"
            onClick={() => settle(true)}
          >
            {confirmLabel ?? "Onayla"}
          </Button>
        </div>
      </div>
    </div>
  );
}
