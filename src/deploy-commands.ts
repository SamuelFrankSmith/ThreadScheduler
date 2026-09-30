import { REST, Routes } from 'discord.js';
import { pathToFileURL } from 'node:url';
import { commands } from './commands/index.js';
import { config } from './config.js';

/**
 * Registers slash commands. Guild-scoped when GUILD_ID is set (instant), otherwise global.
 * Registrations from the other mode are cleared so commands never show up twice;
 * `joinedGuildIds` lists the guilds whose guild-scoped commands to clear in global mode.
 */
export async function deployCommands(joinedGuildIds: string[] = []): Promise<void> {
  const rest = new REST().setToken(config.token);
  const body = commands.map((c) => c.data.toJSON());
  if (config.guildId) {
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body });
    // Clear global registrations from an earlier run without GUILD_ID, which would otherwise show every command twice.
    await rest.put(Routes.applicationCommands(config.clientId), { body: [] });
    console.log(`Registered ${body.length} commands to guild ${config.guildId}.`);
  } else {
    await rest.put(Routes.applicationCommands(config.clientId), { body });
    for (const guildId of joinedGuildIds) {
      await rest.put(Routes.applicationGuildCommands(config.clientId, guildId), { body: [] });
    }
    console.log(`Registered ${body.length} commands globally.`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  deployCommands().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
