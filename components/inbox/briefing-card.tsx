'use client';

import { formatDistanceToNow } from 'date-fns';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import type { BriefingItem, ProposedAction } from './timeline';

const urgencyColors: Record<number, string> = {
  1: 'bg-slate-300',
  2: 'bg-emerald-400',
  3: 'bg-amber-400',
  4: 'bg-orange-500',
  5: 'bg-red-500',
};

export function BriefingCard({ item }: { item: BriefingItem }) {
  const urgency = Math.max(1, Math.min(5, item.urgency ?? 1));
  const confidencePct = Math.round((item.confidence ?? 0) * 100);
  const created = item.created_at ? new Date(item.created_at) : null;

  const onAction = (action: ProposedAction) => {
    // Phase 1 placeholder — executor wiring lands in Phase 2.
    if (typeof window !== 'undefined') {
      window.alert(`Phase 2: action approval — ${action.label}`);
    }
  };

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

        {item.proposed_actions && item.proposed_actions.length > 0 ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {item.proposed_actions.map((action, i) => (
              <Button
                key={i}
                size="sm"
                variant={action.kind === 'primary' ? 'default' : 'outline'}
                onClick={() => onAction(action)}
              >
                {action.label}
              </Button>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
