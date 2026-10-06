export interface Pagination {
  page: number;
  limit: number;
  total: number;
}

export function pageRange(page: number, limit: number): { from: number; to: number } {
  const from = (page - 1) * limit;
  return { from, to: from + limit - 1 };
}
