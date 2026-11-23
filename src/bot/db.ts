import mysql from 'mysql2/promise';
import { config } from './config';
import type { PlayerSummary, Snapshot } from '../shared/types';

const dbUrl = new URL(config.databaseUrl);
export const pool = mysql.createPool({ host: dbUrl.hostname, port: Number(dbUrl.port || 3306), user: decodeURIComponent(dbUrl.username), password: decodeURIComponent(dbUrl.password), database: decodeURIComponent(dbUrl.pathname.replace(/^\//, '')), connectionLimit: 10, timezone: 'Z', decimalNumbers: true, ssl: dbUrl.searchParams.get('ssl') === 'true' ? { rejectUnauthorized: true } : undefined });

export async function initializeDatabase(): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS repair_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(32) NOT NULL,
    user_id VARCHAR(32) NOT NULL,
    username VARCHAR(100) NOT NULL,
    badge VARCHAR(32) NOT NULL,
    quantity INT UNSIGNED NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reset_batch BIGINT UNSIGNED NOT NULL DEFAULT 0,
    INDEX idx_repairs_guild_batch (guild_id, reset_batch),
    INDEX idx_repairs_user (guild_id, user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await pool.query(`CREATE TABLE IF NOT EXISTS payouts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(32) NOT NULL,
    user_id VARCHAR(32) NOT NULL,
    username VARCHAR(100) NOT NULL,
    repair_count INT UNSIGNED NOT NULL,
    amount BIGINT UNSIGNED NOT NULL,
    reset_batch BIGINT UNSIGNED NOT NULL DEFAULT 0,
    paid_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_payouts_guild_user (guild_id, user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  // Add this field for installations created by an earlier version.
  const [columns] = await pool.query<mysql.RowDataPacket[]>("SHOW COLUMNS FROM payouts LIKE 'reset_batch'");
  if (!columns.length) await pool.query('ALTER TABLE payouts ADD COLUMN reset_batch BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER amount');
  await pool.query('UPDATE payouts p JOIN guild_state g ON p.guild_id = g.guild_id SET p.reset_batch = g.reset_batch WHERE p.reset_batch = 0');
  await pool.query(`CREATE TABLE IF NOT EXISTS guild_state (
    guild_id VARCHAR(32) NOT NULL PRIMARY KEY,
    reset_batch BIGINT UNSIGNED NOT NULL DEFAULT 0,
    reset_at TIMESTAMP NULL,
    repair_message_id VARCHAR(32) NULL,
    repair_channel_id VARCHAR(32) NULL,
    payout_message_id VARCHAR(32) NULL,
    payout_channel_id VARCHAR(32) NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

async function currentBatch(guildId: string, conn: mysql.PoolConnection | typeof pool = pool): Promise<number> {
  await conn.query('INSERT IGNORE INTO guild_state (guild_id) VALUES (?)', [guildId]);
  const [rows] = await conn.query<mysql.RowDataPacket[]>('SELECT reset_batch FROM guild_state WHERE guild_id = ?', [guildId]);
  return Number(rows[0].reset_batch);
}

export async function addRepair(guildId: string, userId: string, username: string, badge: string, quantity: number): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const batch = await currentBatch(guildId, conn);
    await conn.query('INSERT INTO repair_events (guild_id, user_id, username, badge, quantity, reset_batch) VALUES (?, ?, ?, ?, ?, ?)', [guildId, userId, username, badge, quantity, batch]);
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

export async function resetRepairs(guildId: string): Promise<void> {
  await pool.query('INSERT IGNORE INTO guild_state (guild_id) VALUES (?)', [guildId]);
  await pool.query('UPDATE guild_state SET reset_batch = reset_batch + 1, reset_at = CURRENT_TIMESTAMP WHERE guild_id = ?', [guildId]);
}

export async function getSnapshot(guildId: string): Promise<Snapshot> {
  const batch = await currentBatch(guildId);
  const [badgeRows] = await pool.query<mysql.RowDataPacket[]>(`SELECT badge, SUM(quantity) AS count FROM repair_events WHERE guild_id = ? AND reset_batch = ? GROUP BY badge ORDER BY count DESC, badge ASC`, [guildId, batch]);
  const [repairRows] = await pool.query<mysql.RowDataPacket[]>(`SELECT user_id, MAX(username) AS username, SUM(quantity) AS repairs FROM repair_events WHERE guild_id = ? AND reset_batch = ? GROUP BY user_id`, [guildId, batch]);
  const [paidRows] = await pool.query<mysql.RowDataPacket[]>(`SELECT user_id, SUM(repair_count) AS paid FROM payouts WHERE guild_id = ? AND reset_batch = ? GROUP BY user_id`, [guildId, batch]);
  const paid = new Map<string, number>(paidRows.map((r) => [String(r.user_id), Number(r.paid)]));
  const players: PlayerSummary[] = repairRows.map((r) => {
    const repairs = Number(r.repairs);
    const unpaidRepairs = Math.max(0, repairs - (paid.get(String(r.user_id)) ?? 0));
    return { userId: String(r.user_id), username: String(r.username), repairs, unpaidRepairs, unpaidAmount: unpaidRepairs * config.rate };
  }).sort((a, b) => b.unpaidAmount - a.unpaidAmount || a.username.localeCompare(b.username));
  const [stateRows] = await pool.query<mysql.RowDataPacket[]>('SELECT reset_at FROM guild_state WHERE guild_id = ?', [guildId]);
  return { badges: badgeRows.map((r) => ({ badge: String(r.badge), count: Number(r.count) })), players, totalSinceReset: badgeRows.reduce((s, r) => s + Number(r.count), 0), resetAt: stateRows[0]?.reset_at ? new Date(stateRows[0].reset_at).toISOString() : null, rate: config.rate };
}

export async function createPayout(guildId: string, userId: string): Promise<{ player: PlayerSummary; paidAmount: number }> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const batch = await currentBatch(guildId, conn);
    const [repairRows] = await conn.query<mysql.RowDataPacket[]>('SELECT MAX(username) AS username, COALESCE(SUM(quantity), 0) AS repairs FROM repair_events WHERE guild_id = ? AND user_id = ? AND reset_batch = ? FOR UPDATE', [guildId, userId, batch]);
    const repairs = Number(repairRows[0]?.repairs ?? 0);
    const [paidThisBatchRows] = await conn.query<mysql.RowDataPacket[]>('SELECT COALESCE(SUM(repair_count), 0) AS paid FROM payouts WHERE guild_id = ? AND user_id = ? AND reset_batch = ?', [guildId, userId, batch]);
    const currentUnpaid = Math.max(0, repairs - Number(paidThisBatchRows[0]?.paid ?? 0));
    if (!currentUnpaid) throw new Error('Ovaj igrač nema neisplaćenih popravki.');
    const username = String(repairRows[0].username ?? userId);
    const amount = currentUnpaid * config.rate;
    await conn.query('INSERT INTO payouts (guild_id, user_id, username, repair_count, amount, reset_batch) VALUES (?, ?, ?, ?, ?, ?)', [guildId, userId, username, currentUnpaid, amount, batch]);
    await conn.commit();
    return { player: { userId, username, repairs, unpaidRepairs: 0, unpaidAmount: 0 }, paidAmount: amount };
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

export async function saveBoard(guildId: string, kind: 'repair' | 'payout', channelId: string, messageId: string): Promise<void> {
  const column = kind === 'repair' ? 'repair' : 'payout';
  await pool.query(`INSERT INTO guild_state (guild_id, ${column}_channel_id, ${column}_message_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE ${column}_channel_id = VALUES(${column}_channel_id), ${column}_message_id = VALUES(${column}_message_id)`, [guildId, channelId, messageId]);
}
export async function getBoards(guildId: string): Promise<{ repair: { channelId: string; messageId: string } | null; payout: { channelId: string; messageId: string } | null }> {
  const [rows] = await pool.query<mysql.RowDataPacket[]>('SELECT repair_channel_id, repair_message_id, payout_channel_id, payout_message_id FROM guild_state WHERE guild_id = ?', [guildId]);
  const r = rows[0];
  if (!r) return { repair: null, payout: null };
  return { repair: r.repair_channel_id && r.repair_message_id ? { channelId: String(r.repair_channel_id), messageId: String(r.repair_message_id) } : null, payout: r.payout_channel_id && r.payout_message_id ? { channelId: String(r.payout_channel_id), messageId: String(r.payout_message_id) } : null };
}
