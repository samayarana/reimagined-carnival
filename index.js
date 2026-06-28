const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActivityType,
} = require("discord.js");
const { LavalinkManager } = require("lavalink-client");

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const TOKEN          = "MTE5MDE0OTczMTM2MDQ1Njc2Ng.GZlIkI.qn4kwUJDZhgXc1TtZQrVIMtv14T39EEjH_IkpA";
const CLIENT_ID      = "1190149731360456766";
const INVITE_LINK    = "https://discord.com/oauth2/authorize?client_id=1190149731360456766";
const SUPPORT_SERVER = "https://discord.gg/ZHuvUA6PZg";

const LAVALINK_HOST     = "nodelink-full-setup.onrender.com";
const LAVALINK_PORT     = 443
const LAVALINK_PASSWORD = "yourpassword"

const COLOR = 0x5865F2;
// ─────────────────────────────────────────────────────────────────────────────

// ─── EMBED HELPERS ───────────────────────────────────────────────────────────
const base = () => new EmbedBuilder().setColor(COLOR).setTimestamp();
const ok   = (title, desc) => base().setTitle(title).setDescription(desc ?? null);
const err  = (desc)        => base().setColor(0xED4245).setTitle("Error").setDescription(desc);
const info = (title, desc) => base().setColor(0x57F287).setTitle(title).setDescription(desc ?? null);

// ─── SLASH COMMANDS ──────────────────────────────────────────────────────────
const commands = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a song or playlist by name or URL")
    .addStringOption(o =>
      o.setName("query").setDescription("Song name or URL").setRequired(true)
    ),
  new SlashCommandBuilder().setName("skip").setDescription("Skip the current song"),
  new SlashCommandBuilder().setName("stop").setDescription("Stop playback and clear the queue"),
  new SlashCommandBuilder().setName("pause").setDescription("Pause the current song"),
  new SlashCommandBuilder().setName("resume").setDescription("Resume the paused song"),
  new SlashCommandBuilder().setName("queue").setDescription("Show the current queue"),
  new SlashCommandBuilder().setName("nowplaying").setDescription("Show details about the currently playing song"),
  new SlashCommandBuilder().setName("uptime").setDescription("Show how long the bot has been online"),
  new SlashCommandBuilder().setName("ping").setDescription("Check bot and Lavalink latency"),
  new SlashCommandBuilder().setName("help").setDescription("Show all available commands"),
  new SlashCommandBuilder().setName("invite").setDescription("Get the bot invite link"),
  new SlashCommandBuilder().setName("support").setDescription("Get the support server link"),
];

// ─── DEPLOY ───────────────────────────────────────────────────────────────────
async function deployCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    console.log("Deploying global slash commands...");
    await rest.put(Routes.applicationCommands(CLIENT_ID), {
      body: commands.map(c => c.toJSON()),
    });
    console.log("Global slash commands deployed.");
  } catch (e) {
    console.error("Deploy failed:", e);
  }
}

// ─── CLIENT ───────────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});

// ─── LAVALINK ─────────────────────────────────────────────────────────────────
client.lavalink = new LavalinkManager({
  nodes: [
    {
      host: LAVALINK_HOST,
      port: LAVALINK_PORT,
      authorization: LAVALINK_PASSWORD,
      id: "main-node",
      secure: true,
    },
  ],
  sendToShard: (guildId, payload) => {
    const guild = client.guilds.cache.get(guildId);
    if (guild) guild.shard.send(payload);
  },
  client: { id: CLIENT_ID, username: "MusicBot" },
  autoSkip: true,
});

// ─── ACTIVITY ROTATION ────────────────────────────────────────────────────────
const activities = [
  { name: "/help", type: ActivityType.Playing },
  { name: "/play", type: ActivityType.Listening },
  { name: "music for you", type: ActivityType.Listening },
];
let activityIndex = 0;
function rotateActivity() {
  const a = activities[activityIndex % activities.length];
  client.user.setActivity(a.name, { type: a.type });
  activityIndex++;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function msToTime(ms) {
  if (!ms || isNaN(ms)) return "0:00";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

// Build a Unicode progress bar for the now-playing embed
// Returns e.g.  ▓▓▓▓▓▓░░░░░░░░░  3:12 / 4:55
function buildProgressBar(positionMs, durationMs, barLength = 15) {
  if (!durationMs || durationMs <= 0) return "";
  const ratio   = Math.min(positionMs / durationMs, 1);
  const filled  = Math.round(ratio * barLength);
  const empty   = barLength - filled;
  const bar     = "▓".repeat(filled) + "░".repeat(empty);
  return `\`${bar}\`  \`${msToTime(positionMs)} / ${msToTime(durationMs)}\``;
}

function createPlayer(interaction) {
  return client.lavalink.createPlayer({
    guildId: interaction.guildId,
    voiceChannelId: interaction.member.voice.channelId,
    textChannelId: interaction.channelId,
    selfDeaf: true,
    selfMute: false,
  });
}

async function safeDefer(interaction, ephemeral = false) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral });
  }
}

async function send(interaction, embed) {
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply({ embeds: [embed] });
  }
  return interaction.reply({ embeds: [embed] });
}

// ─── COMMAND HANDLERS ─────────────────────────────────────────────────────────
const handlers = {

  // /play — supports single tracks, search results, and playlists
  async play(interaction) {
    await safeDefer(interaction);

    if (!interaction.member.voice.channelId) {
      return send(interaction, err("You need to join a voice channel first."));
    }

    const query  = interaction.options.getString("query");
    const player = createPlayer(interaction);
    if (!player.connected) await player.connect();

    // Use YouTube Music for plain searches; leave URLs / other prefixes as-is
    const isUrl    = /^https?:\/\//i.test(query);
    const hasPrefix = /^[a-z]+search:/i.test(query);
    const searchQuery = (isUrl || hasPrefix) ? query : `ytmsearch:${query}`;

    const result = await player.search({ query: searchQuery }, interaction.user);

    // loadType: "playlist" | "track" | "search" | "empty"
    if (!result || result.loadType === "empty" || !result.tracks.length) {
      return send(interaction, err(`No results found for **${query}**.`));
    }

    if (result.loadType === "playlist") {
      // ── PLAYLIST ── add entire array in one call
      await player.queue.add(result.tracks);

      const plName   = result.playlist?.name ?? result.playlist?.title ?? "Unknown Playlist";
      const plArt    = result.playlist?.thumbnail ?? result.tracks[0]?.info?.artworkUrl ?? null;
      const totalMs  = result.playlist?.duration
        ?? result.tracks.reduce((a, t) => a + (t.info.duration ?? 0), 0);

      const embed = ok("Playlist Added", `**${plName}**`)
        .addFields(
          { name: "Tracks",         value: `${result.tracks.length}`,       inline: true },
          { name: "Total Duration", value: msToTime(totalMs),               inline: true },
          { name: "Queue Size",     value: `${player.queue.tracks.length}`, inline: true },
        )
        .setThumbnail(plArt)
        .setFooter({
          text: `Requested by ${interaction.user.tag}`,
          iconURL: interaction.user.displayAvatarURL(),
        });

      await send(interaction, embed);

    } else {
      // ── SINGLE TRACK (search or direct track) ──
      const track     = result.tracks[0];
      const isPlaying = player.playing || player.paused;

      const embed = ok(
        isPlaying ? "Added to Queue" : "Now Playing",
        `**[${track.info.title}](${track.info.uri})**`
      )
        .addFields(
          { name: "Artist",   value: track.info.author,              inline: true },
          { name: "Duration", value: msToTime(track.info.duration),  inline: true },
          ...(isPlaying
            ? [{ name: "Position", value: `#${player.queue.tracks.length + 1}`, inline: true }]
            : []),
        )
        .setThumbnail(track.info.artworkUrl ?? null)
        .setFooter({
          text: `Requested by ${interaction.user.tag}`,
          iconURL: interaction.user.displayAvatarURL(),
        });

      player.queue.add(track);
      await send(interaction, embed);
    }

    if (!player.playing && !player.paused) await player.play();
  },

  // /skip
  async skip(interaction) {
    await safeDefer(interaction);
    const player = client.lavalink.getPlayer(interaction.guildId);
    if (!player || !player.playing) {
      return send(interaction, err("Nothing is playing right now."));
    }
    const skipped = player.queue.current;
    try {
      await player.skip(0, false);
    } catch {
      await player.stopPlaying(true, false);
    }
    return send(interaction,
      ok("Skipped", `**[${skipped.info.title}](${skipped.info.uri})**`)
        .setThumbnail(skipped.info.artworkUrl ?? null)
    );
  },

  // /stop
  async stop(interaction) {
    await safeDefer(interaction);
    const player = client.lavalink.getPlayer(interaction.guildId);
    if (!player) return send(interaction, err("Nothing is playing right now."));
    await player.stopPlaying(true, true);
    await player.destroy();
    return send(interaction, info("Stopped", "Playback stopped and the queue has been cleared."));
  },

  // /pause
  async pause(interaction) {
    await safeDefer(interaction);
    const player = client.lavalink.getPlayer(interaction.guildId);
    if (!player || !player.playing) return send(interaction, err("Nothing is playing right now."));
    if (player.paused) return send(interaction, err("The player is already paused."));
    await player.pause();
    const track = player.queue.current;
    return send(interaction,
      ok("Paused", `**[${track.info.title}](${track.info.uri})**`)
        .setThumbnail(track.info.artworkUrl ?? null)
    );
  },

  // /resume
  async resume(interaction) {
    await safeDefer(interaction);
    const player = client.lavalink.getPlayer(interaction.guildId);
    if (!player || !player.paused) return send(interaction, err("The player is not paused."));
    await player.resume();
    const track = player.queue.current;
    return send(interaction,
      ok("Resumed", `**[${track.info.title}](${track.info.uri})**`)
        .setThumbnail(track.info.artworkUrl ?? null)
    );
  },

  // /queue
  async queue(interaction) {
    await safeDefer(interaction);
    const player = client.lavalink.getPlayer(interaction.guildId);
    if (!player || !player.queue.current) {
      return send(interaction, err("The queue is empty."));
    }

    const current  = player.queue.current;
    const upcoming = player.queue.tracks;

    const upcomingText = upcoming.length === 0
      ? "*No songs queued.*"
      : upcoming
          .slice(0, 10)
          .map((t, i) =>
            `\`${i + 1}.\` **[${t.info.title}](${t.info.uri})** — ${msToTime(t.info.duration)}`
          )
          .join("\n") + (upcoming.length > 10 ? `\n*...and ${upcoming.length - 10} more*` : "");

    const embed = ok("Queue")
      .addFields(
        { name: "Now Playing", value: `**[${current.info.title}](${current.info.uri})** — ${msToTime(current.info.duration)}` },
        { name: `Up Next — ${upcoming.length} track${upcoming.length !== 1 ? "s" : ""}`, value: upcomingText },
      )
      .setThumbnail(current.info.artworkUrl ?? null);

    return send(interaction, embed);
  },

  // /nowplaying — rich embed with progress bar, requester, and queue size
  async nowplaying(interaction) {
    await safeDefer(interaction);
    const player = client.lavalink.getPlayer(interaction.guildId);
    if (!player || !player.queue.current) {
      return send(interaction, err("Nothing is playing right now."));
    }

    const track      = player.queue.current;
    const positionMs = player.position ?? 0;
    const durationMs = track.info.duration ?? 0;
    const isStream   = track.info.isStream ?? false;
    const isPaused   = player.paused;

    const statusIcon = isPaused ? "⏸" : "▶";
    const progressLine = isStream
      ? "`🔴 LIVE`"
      : buildProgressBar(positionMs, durationMs);

    const requester = track.requester
      ? (track.requester.tag ?? track.requester.username ?? "Unknown")
      : "Unknown";

    const embed = new EmbedBuilder()
      .setColor(COLOR)
      .setTitle(`${statusIcon}  Now Playing`)
      .setDescription(`**[${track.info.title}](${track.info.uri})**\n\n${progressLine}`)
      .addFields(
        { name: "Artist",     value: track.info.author,                                    inline: true },
        { name: "Duration",   value: isStream ? "Live" : msToTime(durationMs),             inline: true },
        { name: "Requested",  value: requester,                                            inline: true },
        { name: "Queue",      value: `${player.queue.tracks.length} track(s) remaining`,   inline: true },
        { name: "Volume",     value: `${player.volume ?? 100}%`,                           inline: true },
        { name: "Status",     value: isPaused ? "Paused" : "Playing",                      inline: true },
      )
      .setThumbnail(track.info.artworkUrl ?? null)
      .setTimestamp();

    return send(interaction, embed);
  },

  // /uptime — uses Discord timestamp formatting (https://r.3v.fi/discord-timestamps/)
  async uptime(interaction) {
    await safeDefer(interaction);

    // client.readyAt is a Date; convert to Unix seconds for Discord timestamps
    const readyAtSec = Math.floor(client.readyAt.getTime() / 1000);

    // <t:UNIX:R> → relative  e.g. "3 hours ago"
    // <t:UNIX:F> → full      e.g. "Saturday, 30 May 2026 12:34:56"
    const relative = `<t:${readyAtSec}:R>`;
    const full     = `<t:${readyAtSec}:F>`;

    const embed = ok("Bot Uptime", `Online since ${relative}\n${full}`)
      .addFields(
        { name: "Started", value: full,     inline: true },
        { name: "Uptime",  value: relative, inline: true },
      )
      .setFooter({
        text: `${client.user.username} • Shard ${interaction.guild?.shardId ?? 0}`,
        iconURL: client.user.displayAvatarURL(),
      });

    return send(interaction, embed);
  },

  // /ping
  async ping(interaction) {
    await safeDefer(interaction);

    const botLatency = Date.now() - interaction.createdTimestamp;
    const wsLatency  = Math.round(client.ws.ping);

    const node = client.lavalink.nodeManager.getNode("main-node");
    let llStatus, llPing;
    if (!node || !node.isAlive) {
      llStatus = "Offline";
      llPing   = "N/A";
    } else {
      llStatus = "Online";
      const p  = node.heartBeatPing;
      llPing   = (Number.isFinite(p) && p > 0) ? `${p}ms` : "Calculating...";
    }

    const quality = (ms) => {
      if (ms < 100) return "Excellent";
      if (ms < 200) return "Good";
      if (ms < 400) return "Fair";
      return "Poor";
    };

    const embed = ok("Pong!")
      .addFields(
        { name: "Bot Latency", value: `\`${botLatency}ms\` — ${quality(botLatency)}`, inline: true },
        { name: "WebSocket",   value: `\`${wsLatency}ms\` — ${quality(wsLatency)}`,   inline: true },
        { name: "Lavalink",    value: `\`${llStatus}\` — ${llPing}`,                  inline: true },
      )
      .setFooter({ text: `Shard ${interaction.guild?.shardId ?? 0}` });

    return send(interaction, embed);
  },

  // /help — uses bot avatar + name pulled live from the API
  async help(interaction) {
    await safeDefer(interaction);

    const botUser    = client.user;
    const botName    = botUser.username;
    const botAvatar  = botUser.displayAvatarURL({ size: 512 });

    const embed = new EmbedBuilder()
      .setColor(COLOR)
      .setAuthor({ name: botName, iconURL: botAvatar })
      .setTitle(`${botName} — Command List`)
      .setDescription(`The best music bot for your server.\nUse the commands below to control music playback.`)
      .setThumbnail(botAvatar)
      .addFields(
        {
          name: "Music Commands",
          value: [
            "`/play <query>` — Play a song, search result, or playlist URL",
            "`/skip` — Skip the current song",
            "`/stop` — Stop playback and clear the queue",
            "`/pause` — Pause the current song",
            "`/resume` — Resume paused playback",
            "`/queue` — Show the current queue",
            "`/nowplaying` — Show details about the current song with progress",
          ].join("\n"),
        },
        {
          name: "General Commands",
          value: [
            "`/ping` — Check bot and Lavalink latency",
            "`/uptime` — Show how long the bot has been online",
            "`/help` — Show this message",
            "`/invite` — Invite the bot to your server",
            "`/support` — Join the support server",
          ].join("\n"),
        },
        {
          name: "Links",
          value: `[Invite](${INVITE_LINK}) • [Support](${SUPPORT_SERVER})`,
        }
      )
      .setFooter({ text: `${botName} • Made with love`, iconURL: botAvatar })
      .setTimestamp();

    return send(interaction, embed);
  },

  // /invite
  async invite(interaction) {
    await safeDefer(interaction);
    return send(interaction,
      ok("Invite Me!", `[Click here to add ${client.user.username} to your server](${INVITE_LINK})`)
        .setThumbnail(client.user.displayAvatarURL({ size: 256 }))
        .setFooter({ text: `Thank you for using ${client.user.username}!` })
    );
  },

  // /support
  async support(interaction) {
    await safeDefer(interaction);
    return send(interaction,
      ok("Support Server", `[Click here to join our support server](${SUPPORT_SERVER})`)
        .setThumbnail(client.user.displayAvatarURL({ size: 256 }))
        .setFooter({ text: "We are happy to help!" })
    );
  },
};

// ─── READY ────────────────────────────────────────────────────────────────────
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await client.lavalink.init({ ...client.user });
  console.log("Lavalink initialized.");
  await deployCommands();
  rotateActivity();
  setInterval(rotateActivity, 15_000);
});

// ─── RAW (required for Lavalink voice) ───────────────────────────────────────
client.on("raw", (d) => client.lavalink.sendRawData(d));

// ─── INTERACTIONS ─────────────────────────────────────────────────────────────
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const handler = handlers[interaction.commandName];
  if (!handler) return;
  try {
    await handler(interaction);
  } catch (e) {
    console.error(`Error in /${interaction.commandName}:`, e);
    const embed = err("Something went wrong while running that command.");
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.reply({ embeds: [embed], ephemeral: true });
      }
    } catch (_) {}
  }
});

// ─── LAVALINK EVENTS ──────────────────────────────────────────────────────────
client.lavalink.on("trackStart", (player, track) => {
  const channel = client.channels.cache.get(player.textChannelId);
  if (!channel) return;
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle("Now Playing")
    .setDescription(`**[${track.info.title}](${track.info.uri})**`)
    .addFields(
      { name: "Artist",   value: track.info.author,             inline: true },
      { name: "Duration", value: msToTime(track.info.duration), inline: true },
    )
    .setThumbnail(track.info.artworkUrl ?? null)
    .setTimestamp();
  channel.send({ embeds: [embed] });
});

// queueEnd fires when there are no more tracks left — leave VC here
client.lavalink.on("queueEnd", async (player) => {
  const channel = client.channels.cache.get(player.textChannelId);
  if (channel) {
    const embed = new EmbedBuilder()
      .setColor(0xFEE75C)
      .setTitle("Queue Finished")
      .setDescription("No more songs in the queue. Leaving the voice channel.")
      .setTimestamp();
    channel.send({ embeds: [embed] });
  }
  // Disconnect and destroy the player cleanly
  try {
    await player.destroy();
  } catch (_) {}
});

client.lavalink.on("trackError", (player, track) => {
  const channel = client.channels.cache.get(player.textChannelId);
  if (channel) {
    const embed = new EmbedBuilder()
      .setColor(0xED4245)
      .setTitle("Playback Error")
      .setDescription(`Failed to play **${track.info.title}**. Skipping...`)
      .setTimestamp();
    channel.send({ embeds: [embed] });
  }
});

// ─── LOGIN ────────────────────────────────────────────────────────────────────
client.login(TOKEN);
