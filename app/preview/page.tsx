import {
  BarChart3,
  Boxes,
  ListChecks,
  Package,
  ShoppingCart,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type Tile = {
  title: string;
  icon: LucideIcon;
  blurb: string;
};

const tiles: Tile[] = [
  {
    title: 'Products',
    icon: Package,
    blurb:
      'Catalog of OTC SKUs you sell, with brand authorization status, supplier coverage, and arbitrage signals from the Research Analyst.',
  },
  {
    title: 'Orders',
    icon: ShoppingCart,
    blurb:
      'Live order pipeline from Amazon and eBay with fulfillment status, supplier source, and per-order P&L.',
  },
  {
    title: 'Inventory',
    icon: Boxes,
    blurb:
      'Wholesaler stock snapshots across ABC, McKesson, Cardinal, Parmed, and IPC — refreshed on each Fulfillment Ops run.',
  },
  {
    title: 'Listings',
    icon: ListChecks,
    blurb:
      'Active Amazon + eBay listings, Buy Box state, and the Repricer’s recent decisions with rationale.',
  },
  {
    title: 'Analytics',
    icon: BarChart3,
    blurb:
      'Daily P&L, fee breakdowns, account-health metrics, and weekly portfolio review from the Bookkeeper and Portfolio Manager.',
  },
  {
    title: 'CRM',
    icon: Users,
    blurb:
      'Customer messages, draft replies in your voice from Customer Success, and escalations for medical questions.',
  },
];

export default function PreviewPage() {
  return (
    <div className="px-6 py-8 md:px-10">
      <header className="mx-auto max-w-5xl mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Preview</h1>
        <p className="text-sm text-muted-foreground">
          A peek at the surfaces coming online in Phase 2.
        </p>
      </header>
      <div className="mx-auto max-w-5xl grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <Card key={tile.title}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <div className="rounded-md bg-primary/10 p-2 text-primary">
                      <Icon className="h-4 w-4" />
                    </div>
                    <CardTitle className="text-base">{tile.title}</CardTitle>
                  </div>
                  <Badge variant="secondary" className="shrink-0">
                    Phase 2
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{tile.blurb}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
