'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';

type Props = {
  auditLogId: string;
  expiresAt: string;
};

function fmtRemaining(ms: number): string {
  if (ms <= 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function UndoBanner({ auditLogId, expiresAt }: Props) {
  const router = useRouter();
  // Hydration-safe: don't compute remainingMs from Date.now() during SSR or
  // initial client render — initialize to null and populate after mount.
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => {
      const ms = new Date(expiresAt).getTime() - Date.now();
      setRemainingMs(ms);
      if (ms <= 0) {
        clearInterval(id);
        // Once the window expires, the SSR re-render on next refresh will
        // replace this banner with the "Approved at HH:MM" muted-text branch.
        router.refresh();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt, router]);

  if (remainingMs !== null && remainingMs <= 0) return null;

  async function handleUndo() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/actions/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audit_log_id: auditLogId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? `undo failed (${res.status})`);
        setBusy(false);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <span suppressHydrationWarning>
        Approved · undo available for {remainingMs === null ? '—:—' : fmtRemaining(remainingMs)}
        {error ? <span className="ml-2 text-red-700">({error})</span> : null}
      </span>
      <Button size="sm" variant="outline" onClick={handleUndo} disabled={busy}>
        {busy ? 'Undoing…' : 'Undo'}
      </Button>
    </div>
  );
}
