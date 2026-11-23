import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Client, type TextChannel } from 'discord.js';
import { config } from './config';
import { getSnapshot, getBoards, saveBoard } from './db';

const fmt = (n: number) => new Intl.NumberFormat('hr-HR').format(n);
const repairButtons = () => new ActionRowBuilder<ButtonBuilder>().addComponents(
  new ButtonBuilder().setCustomId('repair:add').setLabel('➕ Dodaj popravku').setStyle(ButtonStyle.Success),
  new ButtonBuilder().setCustomId('repair:reset').setLabel('🔄 Resetiraj popravku').setStyle(ButtonStyle.Danger),
);
const payoutButtons = () => new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('payout:pay').setLabel('💵 Isplati').setStyle(ButtonStyle.Primary));

export async function repairEmbed(guildId: string): Promise<EmbedBuilder> {
  const s = await getSnapshot(guildId);
  const badges = s.badges.length ? s.badges.map((r) => `👮 ${r.badge} — ${fmt(r.count)}`).join('\n') : 'Još nema evidentiranih popravki.';
  const players = s.players.filter((p) => p.repairs).map((p) => `🔧 <@${p.userId}> — ${fmt(p.repairs)}`).join('\n') || 'Još nema evidentiranih igrača.';
  const embed = new EmbedBuilder().setColor(0x5b8cff).setTitle('🚓 POLICIJA | EVIDENCIJA POPRAVAKA').setDescription('Pregled popravaka po policijskim značkama i igračima koji su ih unijeli.\n\n**Evidencija**\n\n**Značka — Popravaka**\n' + badges + '\n\n**Igrač — Popravaka**\n' + players + `\n\n**Ukupno od zadnjeg reseta**\n${fmt(s.totalSinceReset)}\n\n*Resetiranje samo ručno • Automatsko ažuriranje nakon svake promjene • ${config.timezone}*`);
  return embed;
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
export async function postPanels(client: Client, guildId: string, repairChannelId?: string, payoutChannelId?: string): Promise<void> {
  const repairChannel = await client.channels.fetch(repairChannelId || config.repairChannelId || '') as TextChannel | null;
  const payoutChannel = await client.channels.fetch(payoutChannelId || config.payoutChannelId || repairChannelId || '') as TextChannel | null;
  if (!repairChannel?.isTextBased() || !payoutChannel?.isTextBased()) throw new Error('Odaberi valjane tekstualne Discord kanale ili postavi REPAIR_CHANNEL_ID i PAYOUT_CHANNEL_ID.');
  const r = await repairChannel.send({ embeds: [await repairEmbed(guildId)], components: [repairButtons()] });
  const p = await payoutChannel.send({ embeds: [await payoutEmbed(guildId)], components: [payoutButtons()] });
  await saveBoard(guildId, 'repair', repairChannel.id, r.id);
  await saveBoard(guildId, 'payout', payoutChannel.id, p.id);
}
