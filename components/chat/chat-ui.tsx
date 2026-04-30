'use client';

import { useEffect, useRef, useState } from 'react';
import { Send, Square } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';

import { Message, type ChatRole } from './message';
import { ToolCall } from './tool-call';

type ChatBlock =
  | { kind: 'message'; role: ChatRole; content: string }
  | { kind: 'tool'; id: string; name: string };

type ChatMessage = { role: ChatRole; content: string };

type StreamEvent =
  | { type: 'text_delta'; value: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'message_stop' }
  | { type: 'error'; value: string };

export function ChatUI() {
  const [blocks, setBlocks] = useState<ChatBlock[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [blocks]);

  const buildHistory = (): ChatMessage[] => {
    const out: ChatMessage[] = [];
    for (const b of blocks) {
      if (b.kind === 'message' && b.content) out.push({ role: b.role, content: b.content });
    }
    return out;
  };

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setError(null);

    const userBlock: ChatBlock = { kind: 'message', role: 'user', content: text };
    const assistantBlock: ChatBlock = { kind: 'message', role: 'assistant', content: '' };
    const history = [...buildHistory(), { role: 'user' as const, content: text }];

    setBlocks((prev) => [...prev, userBlock, assistantBlock]);
    setInput('');
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const msg = res.status === 429
          ? 'Rate limit reached. Try again in a minute.'
          : `Request failed (${res.status}).`;
        setError(msg);
        setBusy(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let evt: StreamEvent;
          try {
            evt = JSON.parse(trimmed) as StreamEvent;
          } catch {
            continue;
          }
          handleEvent(evt);
        }
      }
      // Flush any final partial line.
      if (buf.trim()) {
        try {
          handleEvent(JSON.parse(buf.trim()) as StreamEvent);
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError('Connection lost. Please retry.');
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function handleEvent(evt: StreamEvent) {
    if (evt.type === 'text_delta') {
      setBlocks((prev) => {
        const next = [...prev];
        // Append to the most recent assistant message; create one if none exists yet.
        for (let i = next.length - 1; i >= 0; i--) {
          const b = next[i];
          if (b.kind === 'message' && b.role === 'assistant') {
            next[i] = { ...b, content: b.content + evt.value };
            return next;
          }
          if (b.kind === 'tool') continue;
          break;
        }
        next.push({ kind: 'message', role: 'assistant', content: evt.value });
        return next;
      });
    } else if (evt.type === 'tool_use_start') {
      // After a tool call Claude will produce a fresh assistant text block.
      setBlocks((prev) => [
        ...prev,
        { kind: 'tool', id: evt.id, name: evt.name },
        { kind: 'message', role: 'assistant', content: '' },
      ]);
    } else if (evt.type === 'error') {
      setError(evt.value || 'Something went wrong.');
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-3xl px-4 py-6 space-y-3">
          {blocks.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-12">
              Ask the Chief of Staff about your products, orders, briefings, or memory.
            </div>
          ) : (
            blocks.map((b, i) =>
              b.kind === 'tool' ? (
                <ToolCall key={`tool-${b.id}-${i}`} name={b.name} />
              ) : (
                <Message key={`msg-${i}`} role={b.role} content={b.content} />
              ),
            )
          )}
          {busy ? (
            <div className="text-xs text-muted-foreground pl-1">thinking…</div>
          ) : null}
          {error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}
          <div ref={scrollEndRef} />
        </div>
      </ScrollArea>

      <div className="border-t bg-card">
        <form
          className="mx-auto max-w-3xl flex items-center gap-2 px-4 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Message PharmaDash"
            disabled={busy}
            autoFocus
          />
          {busy ? (
            <Button type="button" variant="outline" size="icon" onClick={stop} aria-label="Stop">
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button type="submit" size="icon" disabled={!input.trim()} aria-label="Send">
              <Send className="h-4 w-4" />
            </Button>
          )}
        </form>
      </div>
    </div>
  );
}
