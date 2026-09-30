import { Client, Events, GatewayIntentBits, MessageFlags, type Interaction } from 'discord.js';
import { commandMap } from './commands/index.js';
import { handleListComponent, handleListModal } from './commands/listThreads.js';
import { handleSubscriptionSelect } from './commands/subscriptions.js';
import { config } from './config.js';
import { openDatabase } from './db.js';
import { deployCommands } from './deploy-commands.js';
import { startScheduler } from './scheduler.js';
import { parseCustomId } from './ui/customIds.js';

openDatabase(config.dbPath);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (ready) => {
  console.log(`Logged in as ${ready.user.tag}`);
  try {
    await deployCommands([...ready.guilds.cache.keys()]);
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
  startScheduler(ready);
});

async function route(interaction: Interaction): Promise<void> {
  if (!interaction.inCachedGuild()) return;

  if (interaction.isChatInputCommand()) {
    await commandMap.get(interaction.commandName)?.execute(interaction);
    return;
  }

  if (interaction.isButton() || interaction.isStringSelectMenu()) {
    const { namespace } = parseCustomId(interaction.customId);
    if (namespace === 'lt') await handleListComponent(interaction);
    else if (interaction.isStringSelectMenu() && namespace === 'sub') await handleSubscriptionSelect(interaction, 'subscribe');
    else if (interaction.isStringSelectMenu() && namespace === 'unsub') await handleSubscriptionSelect(interaction, 'unsubscribe');
    return;
  }

  if (interaction.isModalSubmit() && parseCustomId(interaction.customId).namespace === 'lt') {
    await handleListModal(interaction);
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    await route(interaction);
  } catch (err) {
    console.error('Interaction failed:', err);
    if (!interaction.isRepliable()) return;
    const payload = { content: '❌ Something went wrong. Please try again.', flags: MessageFlags.Ephemeral } as const;
    await (interaction.replied || interaction.deferred ? interaction.followUp(payload) : interaction.reply(payload)).catch(
      () => {},
    );
  }
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`Received ${signal}, shutting down.`);
    void client.destroy().finally(() => process.exit(0));
  });
}

await client.login(config.token);
