"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Success-message state that CLEARS ITSELF after `ms` (default 6 s).
 *
 * Drop-in replacement for `useState<T | null>(null)` in the "işlem başarılı"
 * pattern: a confirmation like "2FA açıldı." used to stay on screen forever,
 * reading as CURRENT status long after it was news (user report, 07-30).
 * Setting a value (re)arms the timer; setting null clears immediately; the
 * timer is dropped on unmount. ERRORS must NOT use this — an error stays until
 * the user fixes it (repo rule: feedback goes stale by user action, not time).
 * One-shot confirmations that REPLACE their form (e.g. lead-form) keep plain
 * state too — auto-hiding the only confirmation would strand the user.
 */
export function useFlash<T>(ms = 6000): [T | null, (value: T | null) => void] {
  const [value, setValue] = useState<T | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  function flash(next: T | null) {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    if (next !== null) timer.current = setTimeout(() => setValue(null), ms);
  }
  return [value, flash];
}
