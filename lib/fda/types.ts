// openFDA shapes — only the fields our agents read. The actual API returns
// a much richer envelope; we narrow at parse time.

export type FdaShortageRecord = {
  generic_name?: string;
  proprietary_name?: string;
  status?: string; // 'Currently in Shortage' | 'Resolved' | 'Discontinued'
  shortage_reason?: string;
  initial_posting_date?: string;
  update_date?: string;
  openfda?: {
    brand_name?: string[];
    generic_name?: string[];
    manufacturer_name?: string[];
    product_type?: string[];
    product_ndc?: string[];
  };
};

export type FdaRecallRecord = {
  recall_number?: string;
  status?: string;
  classification?: string; // 'Class I' | 'Class II' | 'Class III'
  product_description?: string;
  reason_for_recall?: string;
  recall_initiation_date?: string;
  report_date?: string;
  product_type?: string;
  openfda?: {
    brand_name?: string[];
    generic_name?: string[];
    manufacturer_name?: string[];
    product_ndc?: string[];
  };
};

export type FdaResponse<T> = {
  meta?: Record<string, unknown>;
  results?: T[];
};
