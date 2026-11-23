import { ActionRowBuilder, Client, GatewayIntentBits, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, type ChatInputCommandInteraction, type Interaction } from 'discord.js';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { config } from './config';
import { addRepair, createPayout, getSnapshot, initializeDatabase, resetRepairs } from './db';
import { payoutEmbed, postPanels, refreshPanels, repairEmbed } from './panels';

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
const hasRole = (interaction: Interaction, allowed: Set<string>) => {
  if (!interaction.inGuild()) return false;
  const roles = interaction.member.roles;
  const roleIds = Array.isArray(roles) ? roles : 'cache' in roles ? [...roles.cache.keys()] : [];
  return roleIds.some((id) => allowed.has(id));
};
const json = (res: import('node:http').ServerResponse, status: number, data: unknown) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' }); res.end(JSON.stringify(data)); };
function startDesktopApi(): void {
  const sessions = new Map<string, { userId: string; expiresAt: number }>();
  const oauthStates = new Map<string, number>();
  const configuredRoles = [...new Set([...config.repairRoles, ...config.resetRoles, ...config.payoutRoles])];
  const server = createServer(async (req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' }); return res.end(); }
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/auth/login') {
      if (!config.oauthClientSecret) return json(res, 503, { error: 'Desktop OAuth nije konfiguriran. Postavi DISCORD_CLIENT_SECRET.' });
      const state = randomBytes(24).toString('hex'); oauthStates.set(state, Date.now() + 5 * 60_000);
      const authorize = new URL('https://discord.com/oauth2/authorize'); authorize.searchParams.set('client_id', config.clientId); authorize.searchParams.set('redirect_uri', config.desktopRedirectUri); authorize.searchParams.set('response_type', 'code'); authorize.searchParams.set('scope', 'identify guilds.members.read'); authorize.searchParams.set('state', state);
      res.writeHead(302, { location: authorize.toString() }); return res.end();
    }
    if (req.method === 'GET' && url.pathname === '/auth/callback') {
      const state = url.searchParams.get('state') ?? ''; const expires = oauthStates.get(state); oauthStates.delete(state);
      const code = url.searchParams.get('code');
      if (!expires || expires < Date.now() || !code || !config.oauthClientSecret) return json(res, 400, { error: 'Discord prijava nije uspjela ili je istekla.' });
      try {
        const tokenResponse = await fetch('https://discord.com/api/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.oauthClientSecret, grant_type: 'authorization_code', code, redirect_uri: config.desktopRedirectUri }) });
        const tokenData = await tokenResponse.json() as { access_token?: string };
        if (!tokenResponse.ok || !tokenData.access_token) throw new Error('Discord token exchange failed');
        const memberResponse = await fetch(`https://discord.com/api/users/@me/guilds/${config.guildId}/member`, { headers: { authorization: `Bearer ${tokenData.access_token}` } });
        const memberData = await memberResponse.json() as { user?: { id: string }; roles?: string[] };
        if (!memberResponse.ok || !memberData.user || !memberData.roles?.some((role) => configuredRoles.includes(role))) throw new Error('Korisnik nema dopuštenu Discord ulogu.');
        const session = randomBytes(32).toString('hex'); sessions.set(session, { userId: memberData.user.id, expiresAt: Date.now() + 8 * 60 * 60_000 });
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'" });
        res.end(`<!doctype html><meta charset="utf-8"><title>Prijava uspjela</title><p>Prijava je uspjela. Možeš zatvoriti ovu karticu i vratiti se u Mechanic Tracker.</p><script>if(window.opener){window.opener.postMessage({type:'mechanic-tracker-auth',session:'${session}'},'*');window.close()}</script>`); return;
      } catch (e) { return json(res, 403, { error: e instanceof Error ? e.message : 'Discord prijava nije uspjela.' }); }
    }
    if (req.method === 'GET' && url.pathname === '/auth/complete') return json(res, 200, { session: url.searchParams.get('session') });
    if (req.method === 'GET' && url.pathname === '/auth/logout') { const token = req.headers.authorization?.replace(/^Bearer\s+/i, ''); if (token) sessions.delete(token); return json(res, 200, { ok: true }); }
    const sessionToken = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
    const session = sessions.get(sessionToken);
    if (!session || session.expiresAt < Date.now()) return json(res, 401, { error: 'Prijavi se Discord računom koji ima ovlaštenu ulogu.' });
    const guildId = url.searchParams.get('guildId') || config.guildId;
    if (guildId !== config.guildId) return json(res, 403, { error: 'Nepoznat Discord server.' });
    try {
      if (req.method === 'GET' && url.pathname === '/api/snapshot') return json(res, 200, await getSnapshot(guildId));
      if (req.method === 'POST' && url.pathname === '/api/repair') {
        let body = ''; for await (const chunk of req) body += chunk;
        const data = JSON.parse(body) as { userId?: string; badge?: string; quantity?: number };
        if (!data.userId || !data.badge || !Number.isInteger(data.quantity) || Number(data.quantity) < 1 || Number(data.quantity) > 10000) return json(res, 400, { error: 'Nedostaje igrač, značka ili ispravan broj popravki.' });
        const guild = await client.guilds.fetch(guildId); const member = await guild.members.fetch(data.userId).catch(() => null);
        if (!member) return json(res, 404, { error: 'Igrač nije pronađen na Discord serveru.' });
        const actor = await guild.members.fetch(session.userId);
        if (!actor.roles.cache.some((role) => config.repairRoles.has(role.id))) return json(res, 403, { error: 'Tvoja Discord uloga nema pravo dodavati popravke.' });
        await addRepair(guildId, member.id, member.user.username, data.badge.trim().slice(0, 32), Number(data.quantity));
        await refreshPanels(client, guildId); return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/reset') {
        const actor = await (await client.guilds.fetch(guildId)).members.fetch(session.userId);
        if (!actor.roles.cache.some((role) => config.resetRoles.has(role.id))) return json(res, 403, { error: 'Tvoja Discord uloga nema pravo resetirati popravke.' });
        await resetRepairs(guildId); await refreshPanels(client, guildId); return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/payout') {
        let body = ''; for await (const chunk of req) body += chunk;
        const data = JSON.parse(body) as { userId?: string };
        const actor = await (await client.guilds.fetch(guildId)).members.fetch(session.userId);
        if (!actor.roles.cache.some((role) => config.payoutRoles.has(role.id))) return json(res, 403, { error: 'Tvoja Discord uloga nema pravo evidentirati isplatu.' });
        if (!data.userId) return json(res, 400, { error: 'Nedostaje igrač.' });
        const result = await createPayout(guildId, data.userId); await refreshPanels(client, guildId); return json(res, 200, result);
      }
      return json(res, 404, { error: 'Nepoznata ruta.' });
    } catch (e) { console.error(e); return json(res, 400, { error: e instanceof Error ? e.message : 'Greška na serveru.' }); }
  });
  server.listen(config.port, '0.0.0.0', () => console.log(`Desktop API sluša na portu ${config.port}.`));
}

async function handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (interaction.commandName !== 'post-panels') return;
  const repairChannel = interaction.options.getChannel('kanal_popravke');
  const payoutChannel = interaction.options.getChannel('kanal_isplate');
  await interaction.deferReply({ ephemeral: true });
  try { await postPanels(client, interaction.guildId!, repairChannel?.id, payoutChannel?.id); await interaction.editReply('Objavljene su evidencije popravaka i isplata.'); }
  catch (e) { await interaction.editReply(e instanceof Error ? e.message : 'Greška pri objavi.'); }
}
function modal(title: string, id: string, fields: { id: string; label: string; placeholder: string; style?: TextInputStyle }[]): ModalBuilder {
  const m = new ModalBuilder().setCustomId(id).setTitle(title);
  for (const f of fields) m.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId(f.id).setLabel(f.label).setPlaceholder(f.placeholder).setRequired(true).setStyle(f.style ?? TextInputStyle.Short)));
  return m;
}
async function onInteraction(i: Interaction): Promise<void> {
  try {
    if (i.isChatInputCommand()) return await handleCommand(i);
    if (i.isButton()) {
      if (i.customId === 'repair:add') {
        if (!hasRole(i, config.repairRoles)) return void await i.reply({ content: 'Tvoja uloga nema pravo dodavati popravke.', ephemeral: true });
        return void await i.showModal(modal('Dodaj popravku', 'repair:submit', [
          { id: 'badge', label: 'Broj značke', placeholder: 'Npr. 202' },
          { id: 'quantity', label: 'Broj odrađenih popravki', placeholder: 'Npr. 3' },
        ]));
      }
      if (i.customId === 'repair:reset') {
        if (!hasRole(i, config.resetRoles)) return void await i.reply({ content: 'Tvoja uloga nema pravo resetirati popravke.', ephemeral: true });
        await i.deferReply({ ephemeral: true }); await resetRepairs(i.guildId!); await refreshPanels(client, i.guildId!);
        return void await i.editReply('Evidencija popravaka resetirana je na 0. Isplate i povijest isplata ostaju sačuvane.');
      }
      if (i.customId === 'payout:pay') {
        if (!hasRole(i, config.payoutRoles)) return void await i.reply({ content: 'Tvoja uloga nema pravo evidentirati isplate.', ephemeral: true });
        const s = await getSnapshot(i.guildId!); const players = s.players.filter((p) => p.unpaidRepairs > 0).slice(0, 25);
        if (!players.length) return void await i.reply({ content: 'Trenutno nema neisplaćenih popravki.', ephemeral: true });
        const menu = new StringSelectMenuBuilder().setCustomId('payout:select').setPlaceholder('Odaberi igrača za isplatu').addOptions(players.map((p) => ({ label: `${p.username} — ${p.unpaidRepairs} popravki`, description: `${new Intl.NumberFormat('hr-HR').format(p.unpaidAmount)} $`, value: p.userId })));
        return void await i.reply({ content: 'Odaberi igrača kojem je isplaćen saldo:', components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)], ephemeral: true });
      }
    }
    if (i.isModalSubmit() && i.customId === 'repair:submit') {
      if (!hasRole(i, config.repairRoles)) return void await i.reply({ content: 'Tvoja uloga nema pravo dodavati popravke.', ephemeral: true });
      const badge = i.fields.getTextInputValue('badge').trim(); const quantity = Number(i.fields.getTextInputValue('quantity').trim());
      if (!badge || badge.length > 32 || !Number.isInteger(quantity) || quantity < 1 || quantity > 10000) return void await i.reply({ content: 'Unesi značku do 32 znaka i broj popravki od 1 do 10000.', ephemeral: true });
      await addRepair(i.guildId!, i.user.id, i.user.username, badge, quantity); await refreshPanels(client, i.guildId!);
      return void await i.reply({ content: `Dodano ${quantity} popravki za značku ${badge}. Evidencije su ažurirane.`, ephemeral: true });
    }
    if (i.isStringSelectMenu() && i.customId === 'payout:select') {
      if (!hasRole(i, config.payoutRoles)) return void await i.reply({ content: 'Tvoja uloga nema pravo evidentirati isplate.', ephemeral: true });
      const result = await createPayout(i.guildId!, i.values[0]); await refreshPanels(client, i.guildId!);
      return void await i.update({ content: `Isplata evidentirana za ${result.player.username}: ${result.player.unpaidRepairs ? result.player.unpaidRepairs : 'sve neisplaćene'} popravki, ukupno ${new Intl.NumberFormat('hr-HR').format(result.paidAmount)} $.`, components: [] });
    }
  } catch (e) { console.error(e); if (i.isRepliable()) { const msg = e instanceof Error ? e.message : 'Došlo je do greške.'; if (i.deferred || i.replied) await i.followUp({ content: msg, ephemeral: true }).catch(() => undefined); else await i.reply({ content: msg, ephemeral: true }).catch(() => undefined); } }
}

client.on('interactionCreate', (i) => { void onInteraction(i); });
client.once('ready', () => { console.log(`Bot prijavljen kao ${client.user?.tag}`); startDesktopApi(); });
void initializeDatabase().then(() => client.login(config.token)).catch((e) => { console.error('Pokretanje nije uspjelo:', e); process.exit(1); });
