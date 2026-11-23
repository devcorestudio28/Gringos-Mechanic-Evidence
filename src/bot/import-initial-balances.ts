import { pool, initializeDatabase } from './db';
import { config } from './config';
import { syncSavedPanels } from './panels';

const importKey = 'legacy-snapshot-2026-11-23-v1';
const badges: Array<[string, number]> = [
  ['202', 11], ['103', 9], ['007', 7], ['252', 7], ['404', 7], ['401', 6], ['203', 5],
  ['002', 4], ['101', 4], ['201', 4], ['255', 4], ['003', 3], ['005', 3], ['207', 3],
  ['006', 2], ['102', 2], ['105', 2], ['106', 2], ['206', 2], ['208', 2], ['222', 2], ['UKP-3', 2],
  ['001', 1], ['009', 1], ['010', 1], ['104', 1], ['251', 1], ['251 nezavrsena', 1], ['253', 1],
];
const players: Array<[string, string, number]> = [
  ['778265736962900019', 'Petar Blagojevic', 37],
  ['1522978211523461218', 'Aleksa Petrić', 27],
  ['994960078128029698', 'Mario Makarevic', 13],
  ['814571152273178714', 'Filip Grkovic', 10],
  ['1448750710731706448', 'r007f', 1],
];

async function run(): Promise<void> {
  await initializeDatabase();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('INSERT IGNORE INTO guild_state (guild_id) VALUES (?)', [config.guildId]);
    const [states] = await conn.query<any[]>('SELECT reset_batch FROM guild_state WHERE guild_id = ? FOR UPDATE', [config.guildId]);
    const batch = Number(states[0].reset_batch);
    const [existing] = await conn.query<any[]>('SELECT import_key FROM opening_balance_imports WHERE import_key = ? FOR UPDATE', [importKey]);
    const alreadyImported = existing.length > 0;
    if (!alreadyImported) {
      const [repairs] = await conn.query<any[]>('SELECT COUNT(*) AS count FROM repair_events WHERE guild_id = ? AND reset_batch = ?', [config.guildId, batch]);
      if (Number(repairs[0].count) > 0) throw new Error('U bazi već postoje popravke u aktivnom razdoblju. Uvoz je prekinut da se ne bi dvostruko uračunale.');
      const [payouts] = await conn.query<any[]>('SELECT COUNT(*) AS count FROM payouts WHERE guild_id = ? AND reset_batch = ?', [config.guildId, batch]);
      if (Number(payouts[0].count) > 0) throw new Error('U bazi već postoje isplate u aktivnom razdoblju. Uvoz je prekinut da se ne bi pokvario saldo.');

      await conn.query('INSERT INTO opening_balance_imports (import_key, guild_id) VALUES (?, ?)', [importKey, config.guildId]);
      const rows = [
        ...badges.map(([badge, count]) => [config.guildId, batch, 'badge', badge, badge, count]),
        ...players.map(([userId, username, count]) => [config.guildId, batch, 'player', userId, username, count]),
      ];
      await conn.query('INSERT INTO opening_balances (guild_id, reset_batch, balance_type, subject_id, subject_name, quantity) VALUES ?', [rows]);
    }
    await conn.query("UPDATE guild_state SET reset_at = COALESCE(reset_at, '2026-11-13 00:00:00') WHERE guild_id = ?", [config.guildId]);
    await conn.commit();
    if (alreadyImported) console.log(`Početno stanje ${importKey} već je uvezeno; postojeći podaci nisu duplicirani.`);
    else {
      const badgeTotal = badges.reduce((sum, [, count]) => sum + count, 0);
      const playerTotal = players.reduce((sum, [, , count]) => sum + count, 0);
      console.log(`Početno stanje je uvezeno: ${badges.length} znački (${badgeTotal} popravki) i ${players.length} igrača (${playerTotal} popravki). Stefan Turbina i Mosa Pucko nisu uvezeni.`);
      if (badgeTotal !== playerTotal) console.warn('Napomena: zbir znački i zbir igrača su različiti; liste su sačuvane odvojeno prema dostavljenim podacima.');
    }
    try { await syncSavedPanels(config.guildId); console.log('Discord paneli su osvježeni.'); }
    catch (error) { console.error('Uvoz je spremljen, ali Discord paneli nisu osvježeni. Pokreni /post-panels ili pošalji grešku Codexu:', error); }
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
    await pool.end();
  }
}

void run().catch((error) => { console.error('Uvoz nije uspio:', error); process.exitCode = 1; });
