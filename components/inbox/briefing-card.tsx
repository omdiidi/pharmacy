'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import type { BriefingItem } from './timeline';
import { UndoBanner } from './undo-banner';

const urgencyColors: Record<number, string> = {
  1: 'bg-slate-300',
  2: 'bg-emerald-400',
  3: 'bg-amber-400',
  4: 'bg-orange-500',
  5: 'bg-red-500',
};

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function BriefingCard({ item }: { item: BriefingItem }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pendingAudit, setPendingAudit] = useState<{
    id: string;
    expiresAt: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const urgency = Math.max(1, Math.min(5, item.urgency ?? 1));
  const confidencePct = Math.round((item.confidence ?? 0) * 100);
  const created = item.created_at ? new Date(item.created_at) : null;

  async function approve(actionIndex: number) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/actions/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inbox_item_id: item.id, action_index: actionIndex }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? `approve failed (${res.status})`);
        setBusy(false);
        return;
      }
      const body = await res.json();
      setPendingAudit({ id: body.audit_log_id, expiresAt: body.undo_window_expires_at });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/actions/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inbox_item_id: item.id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? `reject failed (${res.status})`);
        setBusy(false);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // UI state branching:
  //   pending → action buttons + Reject
  //   acted + undone → "Reverted at HH:MM"
  //   acted + window unexpired (and not undone) → UndoBanner
  //   acted + window expired → "Approved at HH:MM"
  const isActed = item.state === 'acted';
  const undoExpiry = item.undo_window_expires_at
    ? new Date(item.undo_window_expires_at).getTime()
    : 0;
  const undoActive = isActed && !item.undone_at && undoExpiry > Date.now() && !!item.audit_log_id;
  const undone = isActed && !!item.undone_at;
  const expiredApproved = isActed && !undone && !undoActive;

  // Optimistic "just-approved" banner (before SSR refresh propagates).
  const showOptimisticUndo =
    pendingAudit && new Date(pendingAudit.expiresAt).getTime() > Date.now();

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base">{item.title}</CardTitle>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={cn('h-2.5 w-2.5 rounded-full mt-1.5 shrink-0', urgencyColors[urgency])}
                aria-label={`Urgency ${urgency}`}
              />
            </TooltipTrigger>
            <TooltipContent>Urgency {urgency} of 5</TooltipContent>
          </Tooltip>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {item.summary ? (
          item.rationale ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <p className="text-sm text-muted-foreground line-clamp-3 cursor-help">
                  {item.summary}
                </p>
              </TooltipTrigger>
              <TooltipContent className="max-w-sm">
                <span className="block whitespace-pre-wrap">
                  {item.rationale.slice(0, 400)}
                  {item.rationale.length > 400 ? '…' : ''}
                </span>
              </TooltipContent>
            </Tooltip>
          ) : (
            <p className="text-sm text-muted-foreground line-clamp-3">{item.summary}</p>
          )
        ) : null}

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {item.briefing_type ? (
            <Badge variant="secondary">{item.briefing_type}</Badge>
          ) : null}
          {item.source_agent ? <Badge variant="outline">{item.source_agent}</Badge> : null}
          <span className="text-muted-foreground">{confidencePct}% confidence</span>
          {created ? (
            <span className="text-muted-foreground">
              · {formatDistanceToNow(created, { addSuffix: true })}
            </span>
          ) : null}
        </div>

        {error ? <p className="text-xs text-red-600">{error}</p> : null}

        {showOptimisticUndo ? (
          <UndoBanner
            auditLogId={pendingAudit!.id}
            expiresAt={pendingAudit!.expiresAt}
          />
        ) : undoActive ? (
          <UndoBanner
            auditLogId={item.audit_log_id!}
            expiresAt={item.undo_window_expires_at!}
          />
        ) : undone ? (
          <p className="text-xs text-muted-foreground italic">
            Reverted at {fmtTime(item.acted_at)}
          </p>
        ) : expiredApproved ? (
          <p className="text-xs text-muted-foreground italic">
            Approved at {fmtTime(item.acted_at)}
          </p>
        ) : item.state === 'pending' && item.proposed_actions && item.proposed_actions.length > 0 ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {item.proposed_actions.map((action, i) => (
              <Button
                key={i}
                size="sm"
                variant={action.variant === 'primary' ? 'default' : 'outline'}
                onClick={() => approve(i)}
                disabled={busy}
              >
                {action.label}
              </Button>
            ))}
            <Button
              key="reject"
              size="sm"
              variant="ghost"
              onClick={reject}
              disabled={busy}
            >
              Reject
            </Button>
          </div>
        ) : item.state === 'pending' ? (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={reject} disabled={busy}>
              {(() => {
                const isReportOnly =
                  item.source_agent === 'bookkeeper' ||
                  item.source_agent === 'reflector' ||
                  (item.source_agent === 'portfolio_manager' &&
                    (!item.proposed_actions || item.proposed_actions.length === 0));
                return isReportOnly ? 'Acknowledge' : 'Dismiss';
              })()}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
