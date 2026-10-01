export type FreshnessState = 'fresh' | 'stale' | 'partial';

export interface DataEnvelope<TData, TFilters> {
  data: TData;
  generatedAt: string;
  dataAsOf: string | null;
  freshness: FreshnessState;
  source: string[];
  appliedFilters: TFilters;
  warnings: string[];
  partial: boolean;
}
