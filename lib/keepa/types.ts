// Keepa API shapes — narrowed to what our agents actually consume.

export type KeepaTokenResponse = {
  timestamp: number;
  tokensLeft: number;
  refillIn: number;
  refillRate: number;
};

export type KeepaDeal = {
  asin: string;
  title?: string;
  current?: number[]; // 8 csv slot prices (-1 = unavailable). cents.
  delta?: number[];
  deltaPercent?: number[];
  salesRanks?: Record<string, number[]>;
  isLowestOffer?: boolean;
  categories?: number[];
};

export type KeepaDealResponse = {
  timestamp: number;
  tokensLeft: number;
  refillIn: number;
  refillRate: number;
  tokensConsumed: number;
  dr?: KeepaDeal[];
  categoryIds?: number[];
  categoryNames?: string[];
  totalDealsFound?: number;
};

export type KeepaProduct = {
  asin: string;
  title?: string;
  domainId?: number;
  // CSV history arrays — unbounded length; we generally only care about
  // current values + the stats summary.
  csv?: Array<number[] | null>;
  stats?: {
    current?: number[]; // index parallel to csv slots
    avg30?: number[];
    avg90?: number[];
    avg180?: number[];
    salesRankDrops30?: number;
    salesRankDrops90?: number;
    salesRankDrops180?: number;
    buyBoxStats?: Record<string, { percentageWon: number }>;
    outOfStockPercentage30?: number[];
    outOfStockPercentage90?: number[];
  };
};

export type KeepaProductResponse = {
  timestamp: number;
  tokensLeft: number;
  refillIn: number;
  refillRate: number;
  tokensConsumed: number;
  products?: KeepaProduct[];
};
