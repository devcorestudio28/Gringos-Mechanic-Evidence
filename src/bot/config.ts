import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
function roleIds(name: string): Set<string> {
  return new Set((process.env[name] ?? '').split(',').map((x) => x.trim()).filter(Boolean));
}

export const config = {
  token: required('DISCORD_TOKEN'),
  clientId: required('DISCORD_CLIENT_ID'),
  guildId: required('DISCORD_GUILD_ID'),
  databaseUrl: required('DATABASE_URL'),
  desktopApiKey: required('DESKTOP_API_KEY'),
  oauthClientSecret: process.env.DISCORD_CLIENT_SECRET?.trim() ?? '',
  desktopRedirectUri: process.env.DESKTOP_REDIRECT_URI?.trim() ?? 'http://localhost:3210/auth/callback',
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
