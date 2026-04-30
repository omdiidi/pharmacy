import { cn } from '@/lib/utils';

export type ChatRole = 'user' | 'assistant';

export function Message({ role, content }: { role: ChatRole; content: string }) {
  const isUser = role === 'user';
  return (
    <div className={cn('flex w-full', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap',
          isUser
            ? 'bg-primary text-primary-foreground rounded-br-sm'
            : 'bg-card text-card-foreground border rounded-bl-sm',
        )}
      >
        {content || (isUser ? '' : <span className="text-muted-foreground">…</span>)}
      </div>
    </div>
  );
}
