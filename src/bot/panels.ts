import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, REST, Routes, type Client, type TextChannel } from 'discord.js';
import { config } from './config';
import { getSnapshot, getBoards, saveBoard } from './db';

const fmt = (n: number) => new Intl.NumberFormat('hr-HR').format(n);
export const repairButtons = () => new ActionRowBuilder<ButtonBuilder>().addComponents(
  new ButtonBuilder().setCustomId('repair:add').setLabel('➕ Dodaj popravku').setStyle(ButtonStyle.Success),
  new ButtonBuilder().setCustomId('repair:reset').setLabel('🔄 Resetiraj popravku').setStyle(ButtonStyle.Danger),
);
export const payoutButtons = () => new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('payout:pay').setLabel('💵 Isplati').setStyle(ButtonStyle.Primary));

export async function repairEmbed(guildId: string): Promise<EmbedBuilder> {
  const s = await getSnapshot(guildId);
  const badges = s.badges.length ? s.badges.map((r) => `👮 ${r.badge} — ${fmt(r.count)}`).join('\n') : 'Još nema evidentiranih popravki.';
  const players = s.players.filter((p) => p.repairs).map((p) => `🔧 <@${p.userId}> — ${fmt(p.repairs)}`).join('\n') || 'Još nema evidentiranih igrača.';
  const dateParts = s.resetAt
    ? new Intl.DateTimeFormat('en-CA', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: config.timezone }).formatToParts(new Date(s.resetAt))
    : [];
  const datePart = (type: Intl.DateTimeFormatPartTypes) => dateParts.find((part) => part.type === type)?.value;
  const evidenceDate = s.resetAt ? `${datePart('day')}.${datePart('month')}.${datePart('year')}.` : '13.11.2026.';
  return new EmbedBuilder()
    .setColor(0x5b8cff)
    .setTitle('🚓 POLICIJA | EVIDENCIJA POPRAVAKA')
    .setDescription(`Pregled popravaka po policijskim značkama i igračima koji su ih unijeli.\n\n**Evidencija od ${evidenceDate}**`)
    .addFields(
      { name: 'Značka — Popravaka', value: badges, inline: true },
      { name: 'Igrač — Popravaka', value: players, inline: true },
      { name: 'Ukupno od zadnjeg reseta', value: fmt(s.totalSinceReset), inline: false },
    )
    .setFooter({ text: `Resetiranje samo ručno • Automatsko ažuriranje nakon svake promjene • ${config.timezone}` });
}

export async function payoutEmbed(guildId: string): Promise<EmbedBuilder> {
  const s = await getSnapshot(guildId);
  const rows = s.players.filter((p) => p.unpaidRepairs > 0).map((p) => `🔧 <@${p.userId}> — ${fmt(p.unpaidRepairs)} popravaka — **${fmt(p.unpaidAmount)} $**`).join('\n') || 'Nema neisplaćenih popravki.';
  return new EmbedBuilder().setColor(0x23a66b).setTitle('💵 EVIDENCIJA ISPLATA').setDescription(`Neisplaćene popravke po igračima.\n**1 popravka = ${fmt(s.rate)} $**\n\n${rows}\n\n*Isplata umanjuje samo neisplaćeni saldo • Stanje se čuva nakon restarta*`);
}

async function editSaved(client: Client, guildId: string, kind: 'repair' | 'payout'): Promise<void> {
  const board = await getBoards(guildId);
  const item = board[kind];
  if (!item) return;
  try {
    const channel = await client.channels.fetch(item.channelId) as TextChannel | null;
    if (!channel?.isTextBased()) return;
    const msg = await channel.messages.fetch(item.messageId);
    if (kind === 'repair') await msg.edit({ embeds: [await repairEmbed(guildId)], components: [repairButtons()] });
    else await msg.edit({ embeds: [await payoutEmbed(guildId)], components: [payoutButtons()] });
  } catch (e) { console.error(`Could not update ${kind} panel:`, e); }
}
export async function refreshPanels(client: Client, guildId: string): Promise<void> { await editSaved(client, guildId, 'repair'); await editSaved(client, guildId, 'payout'); }
export async function syncSavedPanels(guildId: string): Promise<void> {
  const boards = await getBoards(guildId);
  const rest = new REST({ version: '10' }).setToken(config.token);
  if (boards.repair) await rest.patch(Routes.channelMessage(boards.repair.channelId, boards.repair.messageId), { body: { embeds: [(await repairEmbed(guildId)).toJSON()], components: [repairButtons().toJSON()] } });
  if (boards.payout) await rest.patch(Routes.channelMessage(boards.payout.channelId, boards.payout.messageId), { body: { embeds: [(await payoutEmbed(guildId)).toJSON()], components: [payoutButtons().toJSON()] } });
}
export async function postPanels(client: Client, guildId: string, repairChannelId?: string, payoutChannelId?: string): Promise<void> {
  const repairChannel = await client.channels.fetch(repairChannelId || config.repairChannelId || '') as TextChannel | null;
  const payoutChannel = await client.channels.fetch(payoutChannelId || config.payoutChannelId || repairChannelId || '') as TextChannel | null;
  if (!repairChannel?.isTextBased() || !payoutChannel?.isTextBased()) throw new Error('Odaberi valjane tekstualne Discord kanale ili postavi REPAIR_CHANNEL_ID i PAYOUT_CHANNEL_ID.');
  const r = await repairChannel.send({ embeds: [await repairEmbed(guildId)], components: [repairButtons()] });
  const p = await payoutChannel.send({ embeds: [await payoutEmbed(guildId)], components: [payoutButtons()] });
  await saveBoard(guildId, 'repair', repairChannel.id, r.id);
  await saveBoard(guildId, 'payout', payoutChannel.id, p.id);
}
