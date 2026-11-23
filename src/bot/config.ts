import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
function databaseConnectionString(): string {
  const direct = process.env.DATABASE_URL?.trim() || process.env.MYSQL_URL?.trim();
  if (direct) return direct;
  const host = process.env.MYSQLHOST?.trim();
  const port = process.env.MYSQLPORT?.trim() || '3306';
  const user = process.env.MYSQLUSER?.trim();
  const password = process.env.MYSQLPASSWORD;
  const database = process.env.MYSQLDATABASE?.trim() || process.env.MYSQL_DATABASE?.trim();
  if (host && user && password !== undefined && database) {
    return `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}`;
  }
  throw new Error('Set DATABASE_URL/MYSQL_URL or the Railway MYSQLHOST, MYSQLPORT, MYSQLUSER, MYSQLPASSWORD and MYSQLDATABASE variables.');
}
function roleIds(name: string): Set<string> {
  return new Set((process.env[name] ?? '').split(',').map((x) => x.trim()).filter(Boolean));
}

export const config = {
  token: required('DISCORD_TOKEN'),
  clientId: required('DISCORD_CLIENT_ID'),
  guildId: required('DISCORD_GUILD_ID'),
  databaseUrl: databaseConnectionString(),
  oauthClientSecret: process.env.DISCORD_CLIENT_SECRET?.trim() ?? '',
  desktopRedirectUri: process.env.DESKTOP_REDIRECT_URI?.trim() || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/auth/callback` : 'http://localhost:3210/auth/callback'),
  repairRoles: roleIds('REPAIR_ROLE_IDS'),
  resetRoles: roleIds('RESET_ROLE_IDS'),
  payoutRoles: roleIds('PAYOUT_ROLE_IDS'),
  repairChannelId: process.env.REPAIR_CHANNEL_ID?.trim(),
  payoutChannelId: process.env.PAYOUT_CHANNEL_ID?.trim(),
  port: Number(process.env.PORT ?? 3210),
  rate: Number(process.env.REPAIR_RATE ?? 1650),
  timezone: process.env.TIMEZONE ?? 'Europe/Zagreb',
};
if (!Number.isFinite(config.rate) || config.rate < 0) throw new Error('REPAIR_RATE must be a non-negative number');
if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('PORT must be a valid TCP port');
