import { REST, Routes } from 'discord.js';
import { pathToFileURL } from 'node:url';
import { commands } from './commands/index.js';
import { config } from './config.js';

/** Registers slash commands. Guild-scoped when GUILD_ID is set (instant), otherwise global. */
export async function deployCommands(): Promise<void> {
  const rest = new REST().setToken(config.token);
  const body = commands.map((c) => c.data.toJSON());
  const route = config.guildId
    ? Routes.applicationGuildCommands(config.clientId, config.guildId)
    : Routes.applicationCommands(config.clientId);
  await rest.put(route, { body });
  console.log(`Registered ${body.length} commands ${config.guildId ? `to guild ${config.guildId}` : 'globally'}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  deployCommands().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
