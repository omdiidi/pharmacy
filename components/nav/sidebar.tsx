'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, Inbox, LayoutGrid, MessagesSquare, Settings } from 'lucide-react';

import { cn } from '@/lib/utils';

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

const navItems: NavItem[] = [
  { href: '/', label: 'Inbox', icon: Inbox },
  { href: '/chat', label: 'Chat', icon: MessagesSquare },
  { href: '/preview', label: 'Preview', icon: LayoutGrid },
];

export function Sidebar() {
  const pathname = usePathname();

  // Hide sidebar entirely on the sign-in route — it has no place there.
  if (pathname?.startsWith('/sign-in')) return null;

  return (
    <aside className="hidden md:flex h-screen w-60 shrink-0 flex-col border-r bg-card">
      <div className="flex items-center justify-between px-4 h-14 border-b">
        <span className="text-base font-semibold tracking-tight text-foreground">
          PharmaDash
        </span>
        <button
          type="button"
          aria-label="Notifications"
          className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <Bell className="h-4 w-4" />
        </button>
      </div>

      <nav className="flex-1 px-2 py-4 space-y-1">
        {navItems.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname?.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t p-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
            K
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-foreground truncate">Kaleem</div>
            <div className="text-xs text-muted-foreground truncate">Pharmacist</div>
          </div>
          <button
            type="button"
            aria-label="Settings"
            className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
