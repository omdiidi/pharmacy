import { Wrench } from 'lucide-react';

export function ToolCall({ name }: { name: string }) {
  return (
    <div className="flex w-full justify-start">
      <div className="inline-flex items-center gap-2 rounded-md border bg-secondary/60 px-3 py-1.5 text-xs text-muted-foreground">
        <Wrench className="h-3.5 w-3.5" />
        <span>
          Calling <span className="font-mono text-foreground">{name}</span>(…)
        </span>
      </div>
    </div>
  );
}
