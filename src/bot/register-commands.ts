import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import { config } from './config';

const commands = [new SlashCommandBuilder().setName('post-panels').setDescription('Objavi evidenciju popravaka i isplata')
  .addChannelOption((o) => o.setName('kanal_popravke').setDescription('Kanal za evidenciju popravaka'))
  .addChannelOption((o) => o.setName('kanal_isplate').setDescription('Kanal za evidenciju isplata'))
  .toJSON()];
const rest = new REST({ version: '10' }).setToken(config.token);
rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commands })
  .then(() => console.log('Slash naredba /post-panels je registrirana.'))
  .catch((err) => { console.error(err); process.exitCode = 1; });
