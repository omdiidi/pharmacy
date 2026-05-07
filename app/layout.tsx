import type { Metadata } from 'next';
import { Inter } from 'next/font/google';

import { Sidebar } from '@/components/nav/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';

import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'PharmaDash',
  description: 'Pharmacy OTC arbitrage automation for Kaleem',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans antialiased">
        <TooltipProvider delayDuration={150}>
          <div className="flex h-screen overflow-hidden bg-background">
            <Sidebar />
            <main className="flex-1 overflow-y-auto pb-16 md:pb-0">{children}</main>
          </div>
        </TooltipProvider>
      </body>
    </html>
  );
}
