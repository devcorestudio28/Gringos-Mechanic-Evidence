export type SummaryRow = { badge: string; count: number };
export type PlayerSummary = { userId: string; username: string; repairs: number; unpaidRepairs: number; unpaidAmount: number };
export type Snapshot = { badges: SummaryRow[]; players: PlayerSummary[]; totalSinceReset: number; resetAt: string | null; rate: number };
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };
