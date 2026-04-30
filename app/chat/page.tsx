import { ChatUI } from '@/components/chat/chat-ui';

export const dynamic = 'force-dynamic';

export default function ChatPage() {
  return (
    <div className="h-full flex flex-col">
      <header className="border-b px-6 py-4 md:px-10">
        <h1 className="text-lg font-semibold tracking-tight">Chat</h1>
        <p className="text-xs text-muted-foreground">Chief of Staff</p>
      </header>
      <div className="flex-1 min-h-0">
        <ChatUI />
      </div>
    </div>
  );
}
