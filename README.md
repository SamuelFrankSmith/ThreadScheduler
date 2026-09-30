# Thread Scheduler

A self-hosted Discord bot that posts scheduled messages and starts a thread on each one. Members subscribe to the schedules they care about and get tagged in the thread whenever it's posted.

Each time a schedule runs, the bot:

1. Posts the message to its channel, with the title in **bold**.
2. Starts a thread on that message, named after the title.
3. Posts a first message in the thread that tags every subscriber.

Schedules can be one-time or repeating. Everything is managed with slash commands, and the bot's replies are only visible to the person who ran the command.

## Commands

| Command | Who can use it | What it does |
| --- | --- | --- |
| `/schedule-thread` | Manage Messages | Create a schedule: `title`, `message`, `datetime`, `channel`, and an optional repeat `interval`. |
| `/list-threads` | Manage Messages | Browse schedules in a dropdown. Select one to see its details, then **Edit** or **Delete** it. |
| `/subscribe` | Everyone | Pick one or more schedules to be tagged in. |
| `/unsubscribe` | Everyone | Pick schedules to stop being tagged in. |

Server admins can change who can use each command under **Server Settings → Integrations → Thread Scheduler**.

### Channel permissions

To stop the bot being used to get around channel permissions, you can only schedule posts in channels where you could post yourself (View Channel and Send Messages). Administrators and the server owner always pass this check.

- The check runs when a schedule is created and **every time one is saved**, even if you only changed the message text. So you can't edit a schedule that posts to a channel you can't post in.
- It doesn't run again when the schedule posts. If the creator later loses access or leaves the server, the schedule keeps posting until someone deletes it.
- Some servers want moderators to post in a locked channel (such as #announcements) only through the bot. They can turn the check off with `ENFORCE_CHANNEL_PERMISSIONS=false`.

### Editing a schedule

In `/list-threads`, select a schedule and press **Edit**. Buttons for **Title**, **Message**, **Channel**, **Datetime**, and **Interval** each open a form. Your changes appear straight away, but nothing is saved until you press **Save changes**. **Back to list** discards your changes. You can also close the whole thing with Discord's **Dismiss message** link.

Unsaved edits expire after 15 minutes, or if the bot restarts.

### Datetime and interval formats

All times use the timezone set by `TZ` (see [Configuration](#configuration)). The default is UTC.

**Datetime:** `MM/dd HH:mm` in 24-hour time, e.g. `03/14 18:30`. The bot uses the current year, or next year if that date has already passed.

**Interval** (optional; leave it empty for a one-time post):

| Example | Meaning |
| --- | --- |
| `30m`, `6h`, `6hr` | Every 30 minutes or 6 hours |
| `1d`, `2w` | Every day or every 2 weeks, at the same local time |
| `1mo`, `1y` | Every month or year. Starting on the 31st uses the last day of shorter months. |
| `1d6h`, `1d 6h` | Units can be combined |
| `18:30`, `18:30hr` | Every day at 18:30 |

The first post is always at the datetime you set. Repeats follow the interval after that. Day, week, month, and year intervals stay at the same local time across daylight-saving changes. Hour and minute intervals count elapsed time.

If the bot is offline when posts are due, it posts once when it comes back and then continues on schedule. It doesn't post every run it missed.

## Setup

You need [Docker](https://docs.docker.com/get-docker/) with Docker Compose.

### 1. Create a Discord application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**.
2. On **General Information**, copy the **Application ID**. This is `DISCORD_CLIENT_ID`.
3. On **Bot**, click **Reset Token** and copy the token. This is `DISCORD_TOKEN`. Keep it secret.

The bot doesn't need any privileged gateway intents.

### 2. Invite the bot to your server

Open this link, replacing `YOUR_CLIENT_ID` with your Application ID:

```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot+applications.commands&permissions=309237648384
```

This requests the four permissions the bot needs: **View Channel**, **Send Messages**, **Create Public Threads**, and **Send Messages in Threads**. You need the Manage Server permission to add it.

If the bot is blocked from a channel by channel-level permission overrides, `/schedule-thread` will tell you which permission is missing.

### 3. Configure

Clone or download this repository, then create your settings file:

```bash
cp .env.example .env
```

Fill in `DISCORD_TOKEN` and `DISCORD_CLIENT_ID`, and set `TZ` to your timezone. The other settings are optional.

### 4. Run

```bash
mkdir -p data
docker compose up -d --build
docker compose logs -f
```

You should see `Logged in as …` and `Registered 4 commands …`. Run `/schedule-thread` in your server to create your first schedule.

## Configuration

All settings go in `.env`.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `DISCORD_TOKEN` | Yes | | Bot token. |
| `DISCORD_CLIENT_ID` | Yes | | Application ID. |
| `GUILD_ID` | No | | Register commands to one server only, so they show up instantly. Without it, commands work in every server the bot is in but can take up to an hour to appear. To get a server's ID, turn on **Developer Mode** (User Settings → Advanced), then right-click the server icon and choose **Copy Server ID**. |
| `TZ` | No | `UTC` | [IANA timezone](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) used for entering, displaying, and repeating schedules, e.g. `America/New_York`. |
| `ENFORCE_CHANNEL_PERMISSIONS` | No | `true` | Only let users schedule posts in channels where they can post themselves. See [Channel permissions](#channel-permissions). |
| `PUID` / `PGID` | No | `1000` | User and group ID the container runs as. They must be able to write to `DATA_DIR`. |
| `DATA_DIR` | No | `./data` | Folder on the host where the database is stored. |
| `DB_PATH` | No | `./data/bot.db` | Database file path. Only used when running without Docker; Compose sets it for you. |

**Changing `TZ` later:** existing schedules keep their next post time. Daily (`HH:mm`) and day-based intervals will follow the new timezone from then on.

## Unraid

1. Copy this folder to your server, e.g. `/mnt/user/appdata/thread-scheduler`, and create `.env` as described above.
2. In `.env`, set `PUID=99` and `PGID=100` so the bot can write to the appdata share.
3. Install **Compose Manager Plus** from the **Apps** tab. It adds the `docker compose` command.
4. Open the Unraid terminal and run:

   ```bash
   cd /mnt/user/appdata/thread-scheduler
   mkdir -p data && chown 99:100 data
   docker compose up -d --build
   ```

**Without a plugin:** Unraid's built-in Docker can do the same with these commands:

```bash
cd /mnt/user/appdata/thread-scheduler
mkdir -p data && chown 99:100 data
docker build -t thread-scheduler .
docker run -d --name thread-scheduler --user 99:100 \
  --env-file .env -e DB_PATH=/data/bot.db \
  -v /mnt/user/appdata/thread-scheduler/data:/data \
  --restart unless-stopped thread-scheduler
```

The Docker tab may show the container's update status as "not available". That's expected for a locally built image.

## Updating

Get the new code, then rebuild:

```bash
docker compose up -d --build
```

Schedules and subscriptions are kept, because they live in the data folder.

## Backups

Everything is stored in one SQLite file, `bot.db`, in your data folder. Stop the container before copying it (for example `docker compose stop`), because copying it while the bot is writing can produce a corrupt backup. On Unraid, the Appdata Backup plugin stops containers by default.

## Running without Docker

This needs Node.js 22.13 or newer.

```bash
npm ci
npm run build
npm start
```

`npm test` runs the unit tests.

## Troubleshooting

**Commands don't appear.** Without `GUILD_ID`, commands can take up to an hour to show up. Set `GUILD_ID` and restart for instant registration. Also check the invite link included the `applications.commands` scope.

**Every command appears twice.** The bot clears old registrations automatically when you add or remove `GUILD_ID`, so restarting it should fix this. If the duplicates are still there, press Ctrl+R (Cmd+R on a Mac) to reload Discord, which may still be showing old commands.

**The container keeps restarting with a database error.** The container user can't write to the data folder. Make the folder owned by `PUID:PGID`, e.g. `chown 1000:1000 data`.

**A schedule didn't post.** Run `docker compose logs` to see the error. Usually the bot lost access to the channel, or the channel was deleted. Failed posts aren't retried; a repeating schedule tries again at its next time.

## Limits

- Discord dropdowns hold at most 25 items. `/list-threads` pages through larger lists. `/subscribe` and `/unsubscribe` show the first 25, so run them again to see the rest.
- Titles can be up to 100 characters, which is Discord's limit for thread names. Messages can be up to 1,800 characters.

## License

This project is licensed under the [GNU General Public License v3.0](LICENSE). You can use, modify, and share it. If you distribute a modified version, you must release its source code under the same license.
