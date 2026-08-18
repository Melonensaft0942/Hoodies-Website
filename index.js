// ============================================================
//  Discord Ticket-/Moderations-Bot
//  - /setup-tickets  -> postet ein Panel mit Button im Kanal
//  - Klick auf "Ticket erstellen" -> legt privaten Kanal an
//  - Klick auf "Ticket schließen" -> löscht den Kanal automatisch
// ============================================================

require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  REST,
  Routes,
  SlashCommandBuilder,
  Events,
} = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');
const playdl = require('play-dl');

// ---------- Konfiguration (auch über .env änderbar) ----------
const CONFIG = {
  ticketCategoryName: process.env.TICKET_CATEGORY_NAME || 'Tickets',
  supportRoleId: process.env.SUPPORT_ROLE_ID || null, // Rolle, die alle Tickets sehen darf
  closeDelaySeconds: 5, // Countdown bevor der Kanal gelöscht wird
  panelTitle: 'Support & Moderation',
  panelDescription:
    'Klicke unten auf **Ticket erstellen**, um ein privates Support-Ticket zu öffnen.\n' +
    'Ein Teammitglied kümmert sich schnellstmöglich um dein Anliegen.',
  panelColor: 0x5865f2,
  musicPanelTitle: '🎵 Musik-Wünsche',
  musicPanelDescription:
    'Klicke auf **Song anfragen**, um einen Songnamen, YouTube- oder Spotify-Link einzugeben.\n' +
    'Du musst dafür in einem Voice-Channel sein – der Bot kommt dann zu dir und spielt den Song ab.',
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel],
});

// ---------- Slash-Commands ----------
const commands = [
  new SlashCommandBuilder()
    .setName('setup-tickets')
    .setDescription('Postet das Ticket-Panel in diesem Kanal (nur Admins).')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild),

  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kickt ein Mitglied vom Server.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.KickMembers)
    .addUserOption((opt) =>
      opt.setName('user').setDescription('Wer gekickt werden soll').setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName('grund').setDescription('Grund für den Kick').setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Bannt ein Mitglied vom Server.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.BanMembers)
    .addUserOption((opt) =>
      opt.setName('user').setDescription('Wer gebannt werden soll').setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName('grund').setDescription('Grund für den Bann').setRequired(false)
    )
    .addIntegerOption((opt) =>
      opt
        .setName('nachrichten_löschen')
        .setDescription('Nachrichten der letzten X Tage löschen (0-7)')
        .setMinValue(0)
        .setMaxValue(7)
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('setup-music')
    .setDescription('Postet das Musik-Panel in diesem Kanal (nur Admins).')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild),

  new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Überspringt den aktuellen Song.'),

  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stoppt die Musik und der Bot verlässt den Voice-Channel.'),

  new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Postet sofort eine @everyone-Ankündigung.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.MentionEveryone)
    .addStringOption((opt) =>
      opt.setName('nachricht').setDescription('Der Text der Ankündigung').setRequired(true)
    )
    .addChannelOption((opt) =>
      opt
        .setName('channel')
        .setDescription('Zielkanal (Standard: dieser Kanal)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false)
    ),

  // ---------- Troll-Plugin ----------
  new SlashCommandBuilder()
    .setName('uwu')
    .setDescription('uwu-ifiziert einen Text.')
    .addStringOption((opt) => opt.setName('text').setDescription('Text').setRequired(true)),

  new SlashCommandBuilder()
    .setName('mock')
    .setDescription('mAcHt AbWeChSeLnD GroSs-/KleInSchReiBunG (Spongebob-Meme).')
    .addStringOption((opt) => opt.setName('text').setDescription('Text').setRequired(true)),

  new SlashCommandBuilder()
    .setName('reverse')
    .setDescription('Dreht einen Text rückwärts um.')
    .addStringOption((opt) => opt.setName('text').setDescription('Text').setRequired(true)),

  new SlashCommandBuilder()
    .setName('clap')
    .setDescription('👏 Klatscht 👏 zwischen 👏 jedem 👏 Wort.')
    .addStringOption((opt) => opt.setName('text').setDescription('Text').setRequired(true)),

  new SlashCommandBuilder()
    .setName('8ball')
    .setDescription('Befragt die magische 8-Ball.')
    .addStringOption((opt) => opt.setName('frage').setDescription('Deine Frage').setRequired(true)),

  new SlashCommandBuilder()
    .setName('roast')
    .setDescription('Verpasst jemandem einen (liebevollen) Roast.')
    .addUserOption((opt) =>
      opt.setName('user').setDescription('Wer geroastet wird (Standard: du selbst)').setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('vanish')
    .setDescription('Postet eine Nachricht, die sich nach ein paar Sekunden wieder löscht.')
    .addStringOption((opt) => opt.setName('text').setDescription('Text').setRequired(true)),

  new SlashCommandBuilder()
    .setName('rickroll')
    .setDescription('Klassiker. Never gonna give you up.'),
].map((c) => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    if (process.env.GUILD_ID) {
      // Sofort verfügbar in einem Server (empfohlen für Entwicklung/Tests)
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
        { body: commands }
      );
      console.log('✅ Guild-Slash-Commands registriert.');
    } else {
      // Global (kann bis zu 1h dauern, bis es überall sichtbar ist)
      await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
        body: commands,
      });
      console.log('✅ Globale Slash-Commands registriert.');
    }
  } catch (err) {
    console.error('❌ Fehler beim Registrieren der Commands:', err);
  }
}

// ---------- Hilfsfunktionen ----------

function buildPanelEmbed() {
  return new EmbedBuilder()
    .setTitle(CONFIG.panelTitle)
    .setDescription(CONFIG.panelDescription)
    .setColor(CONFIG.panelColor)
    .setFooter({ text: 'Ticket-System' });
}

function buildPanelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_create')
      .setLabel('Ticket erstellen')
      .setEmoji('🎫')
      .setStyle(ButtonStyle.Primary)
  );
}

function buildTicketControlRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_close')
      .setLabel('Ticket schließen')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger)
  );
}

function buildMusicPanelEmbed() {
  return new EmbedBuilder()
    .setTitle(CONFIG.musicPanelTitle)
    .setDescription(CONFIG.musicPanelDescription)
    .setColor(CONFIG.panelColor)
    .setFooter({ text: 'Musik-System' });
}

function buildMusicPanelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('music_request')
      .setLabel('Song anfragen')
      .setEmoji('🎵')
      .setStyle(ButtonStyle.Success)
  );
}

function buildMusicRequestModal() {
  const modal = new ModalBuilder()
    .setCustomId('music_request_modal')
    .setTitle('Song anfragen');

  const input = new TextInputBuilder()
    .setCustomId('song_query')
    .setLabel('Songname, YouTube- oder Spotify-Link')
    .setPlaceholder('z.B. "Take On Me" oder ein YouTube/Spotify-Link')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

async function getOrCreateCategory(guild) {
  let category = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name === CONFIG.ticketCategoryName
  );
  if (!category) {
    category = await guild.channels.create({
      name: CONFIG.ticketCategoryName,
      type: ChannelType.GuildCategory,
    });
  }
  return category;
}

async function createTicketChannel(interaction) {
  const { guild, user } = interaction;

  // Verhindern, dass ein User mehrere offene Tickets gleichzeitig hat
  const existing = guild.channels.cache.find(
    (c) => c.topic === `ticket-owner:${user.id}`
  );
  if (existing) {
    return interaction.reply({
      content: `Du hast bereits ein offenes Ticket: ${existing}`,
      ephemeral: true,
    });
  }

  const category = await getOrCreateCategory(guild);

  const permissionOverwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionsBitField.Flags.ViewChannel],
    },
    {
      id: user.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.AttachFiles,
      ],
    },
    {
      id: client.user.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ManageChannels,
      ],
    },
  ];

  if (CONFIG.supportRoleId) {
    permissionOverwrites.push({
      id: CONFIG.supportRoleId,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
      ],
    });
  }

  const safeName = user.username.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20) || 'user';

  const ticketChannel = await guild.channels.create({
    name: `ticket-${safeName}`,
    type: ChannelType.GuildText,
    parent: category.id,
    topic: `ticket-owner:${user.id}`, // wird genutzt, um Owner + Duplikate zu erkennen
    permissionOverwrites,
  });

  const embed = new EmbedBuilder()
    .setTitle('🎫 Neues Ticket')
    .setDescription(
      `Hallo ${user}, danke für dein Ticket!\n\n` +
        `Beschreibe hier bitte dein Anliegen. Ein Teammitglied wird sich melden.\n\n` +
        `Klicke auf **Ticket schließen**, sobald dein Anliegen geklärt ist.`
    )
    .setColor(CONFIG.panelColor)
    .setTimestamp();

  await ticketChannel.send({
    content: CONFIG.supportRoleId ? `<@&${CONFIG.supportRoleId}> ${user}` : `${user}`,
    embeds: [embed],
    components: [buildTicketControlRow()],
  });

  await interaction.reply({
    content: `✅ Dein Ticket wurde erstellt: ${ticketChannel}`,
    ephemeral: true,
  });
}

async function closeTicketChannel(interaction) {
  const { channel } = interaction;

  if (!channel.topic || !channel.topic.startsWith('ticket-owner:')) {
    return interaction.reply({
      content: 'Dieser Kanal ist kein Ticket-Kanal.',
      ephemeral: true,
    });
  }

  await interaction.reply({
    content: `🔒 Ticket wird in ${CONFIG.closeDelaySeconds} Sekunden geschlossen und der Kanal automatisch gelöscht...`,
  });

  setTimeout(async () => {
    try {
      await channel.delete('Ticket geschlossen');
    } catch (err) {
      console.error('Fehler beim Löschen des Ticket-Kanals:', err);
    }
  }, CONFIG.closeDelaySeconds * 1000);
}

// ---------- Musik-System ----------

// guildId -> { connection, player, queue: [{ title, url }], voiceChannelId, textChannelId }
const musicState = new Map();

function getMusicState(guildId) {
  return musicState.get(guildId);
}

async function resolveSongQuery(rawQuery) {
  let query = rawQuery.trim();

  // Spotify-Link erkannt -> Songtitel + Künstler aus der öffentlichen Seite auslesen,
  // danach normal auf YouTube danach suchen (Spotify erlaubt kein direktes Audio-Streaming über Bots)
  if (query.includes('open.spotify.com/track')) {
    try {
      const res = await fetch(query);
      const html = await res.text();
      const titleMatch = html.match(/<title>(.*?)<\/title>/i);
      if (titleMatch) {
        // Titel sieht meist so aus: "Songname - song by Artist | Spotify"
        query = titleMatch[1].replace(/\s*\|\s*Spotify$/i, '').replace(/\s*-\s*song by\s*/i, ' ');
      }
    } catch (err) {
      console.error('Konnte Spotify-Seite nicht lesen:', err);
    }
  }

  // Direkter YouTube-Link -> direkt validieren
  if (playdl.yt_validate(query) === 'video') {
    const info = await playdl.video_info(query);
    return { title: info.video_details.title, url: info.video_details.url };
  }

  // Ansonsten: Textsuche auf YouTube
  const results = await playdl.search(query, { limit: 1, source: { youtube: 'video' } });
  if (!results || results.length === 0) {
    return null;
  }
  return { title: results[0].title, url: results[0].url };
}

function playNextInQueue(guildId) {
  const state = getMusicState(guildId);
  if (!state) return;

  const next = state.queue.shift();
  if (!next) {
    return; // Warteschlange leer, Bot bleibt einfach im Channel bis /stop
  }

  playdl
    .stream(next.url)
    .then((source) => {
      const resource = createAudioResource(source.stream, { inputType: source.type });
      state.player.play(resource);
      state.currentSong = next;

      const channel = client.channels.cache.get(state.textChannelId);
      if (channel) {
        channel.send({
          embeds: [
            new EmbedBuilder()
              .setTitle('🎶 Spielt jetzt')
              .setDescription(next.title)
              .setColor(CONFIG.panelColor),
          ],
        });
      }
    })
    .catch((err) => {
      console.error('Fehler beim Abspielen:', err);
      playNextInQueue(guildId); // nächsten Song versuchen
    });
}

async function handleMusicRequest(interaction) {
  const query = interaction.fields.getTextInputValue('song_query');
  const member = interaction.member;
  const voiceChannel = member.voice?.channel;

  if (!voiceChannel) {
    return interaction.reply({
      content: '❌ Du musst in einem Voice-Channel sein, damit ich dir folgen kann.',
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const song = await resolveSongQuery(query).catch(() => null);
  if (!song) {
    return interaction.editReply({
      content: '❌ Konnte keinen passenden Song finden. Versuch es mit einem anderen Suchbegriff oder Link.',
    });
  }

  let state = getMusicState(interaction.guildId);

  if (!state || state.connection.state.status === VoiceConnectionStatus.Destroyed) {
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: interaction.guildId,
      adapterCreator: interaction.guild.voiceAdapterCreator,
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
    } catch (err) {
      connection.destroy();
      return interaction.editReply({
        content: '❌ Konnte dem Voice-Channel nicht beitreten. Bitte erneut versuchen.',
      });
    }

    const player = createAudioPlayer();
    connection.subscribe(player);

    player.on(AudioPlayerStatus.Idle, () => playNextInQueue(interaction.guildId));
    player.on('error', (err) => {
      console.error('Player-Fehler:', err);
      playNextInQueue(interaction.guildId);
    });

    state = {
      connection,
      player,
      queue: [],
      voiceChannelId: voiceChannel.id,
      textChannelId: interaction.channelId,
      currentSong: null,
    };
    musicState.set(interaction.guildId, state);
  } else {
    state.textChannelId = interaction.channelId;
  }

  state.queue.push(song);

  if (state.player.state.status !== AudioPlayerStatus.Playing) {
    playNextInQueue(interaction.guildId);
    await interaction.editReply({ content: `🎶 Wird jetzt gestartet: **${song.title}**` });
  } else {
    await interaction.editReply({
      content: `➕ Zur Warteschlange hinzugefügt (Position ${state.queue.length}): **${song.title}**`,
    });
  }
}

async function handleSkip(interaction) {
  const state = getMusicState(interaction.guildId);
  if (!state || state.player.state.status !== AudioPlayerStatus.Playing) {
    return interaction.reply({ content: '❌ Gerade läuft nichts, das ich überspringen könnte.', ephemeral: true });
  }
  state.player.stop(); // löst AudioPlayerStatus.Idle aus -> nächster Song wird automatisch gestartet
  await interaction.reply({ content: '⏭️ Song übersprungen.' });
}

async function handleStop(interaction) {
  const state = getMusicState(interaction.guildId);
  if (!state) {
    return interaction.reply({ content: '❌ Ich bin gerade in keinem Voice-Channel.', ephemeral: true });
  }
  state.queue = [];
  state.player.stop();
  state.connection.destroy();
  musicState.delete(interaction.guildId);
  await interaction.reply({ content: '⏹️ Musik gestoppt, ich habe den Voice-Channel verlassen.' });
}

// ---------- Troll-Plugin ----------

function uwuify(text) {
  return text
    .replace(/[rl]/g, 'w')
    .replace(/[RL]/g, 'W')
    .replace(/n([aeiou])/g, 'ny$1')
    .replace(/N([aeiou])/g, 'Ny$1')
    .replace(/ove/g, 'uv')
    .concat(' uwu');
}

function mockify(text) {
  return text
    .split('')
    .map((ch, i) => (i % 2 === 0 ? ch.toLowerCase() : ch.toUpperCase()))
    .join('');
}

const EIGHT_BALL_ANSWERS = [
  'Ja, definitiv.',
  'Sieht gut aus.',
  'Ohne Zweifel.',
  'Frag später nochmal.',
  'Sehr zweifelhaft.',
  'Nein.',
  'Meine Quellen sagen nein.',
  'Konzentriere dich und frag nochmal.',
  'Auf keinen Fall.',
  'Absolut.',
];

const ROAST_LINES = [
  'ist der Beweis, dass WLAN auch Gehirnzellen killen kann.',
  'hat mehr Ladebalken gesehen als echte Erfolge.',
  'würde beim Multitasking scheitern, selbst wenn die Aufgabe "atmen" wäre.',
  'ist wie ein Software-Update: keiner wollte das, aber jetzt ist es halt da.',
  'hat den IQ von Zimmertemperatur, aber im Winter.',
  'ist der lebende Beweis, dass man nicht alles glauben sollte, was man liest.',
];

async function handleTrollCommand(interaction) {
  const name = interaction.commandName;

  if (name === 'uwu') {
    const text = interaction.options.getString('text', true);
    return interaction.reply(uwuify(text));
  }

  if (name === 'mock') {
    const text = interaction.options.getString('text', true);
    return interaction.reply(mockify(text));
  }

  if (name === 'reverse') {
    const text = interaction.options.getString('text', true);
    return interaction.reply(text.split('').reverse().join(''));
  }

  if (name === 'clap') {
    const text = interaction.options.getString('text', true);
    return interaction.reply(text.split(' ').join(' 👏 ') + ' 👏');
  }

  if (name === '8ball') {
    const frage = interaction.options.getString('frage', true);
    const answer = EIGHT_BALL_ANSWERS[Math.floor(Math.random() * EIGHT_BALL_ANSWERS.length)];
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('🎱 Magic 8-Ball')
          .addFields({ name: 'Frage', value: frage }, { name: 'Antwort', value: answer })
          .setColor(0x2c2f33),
      ],
    });
  }

  if (name === 'roast') {
    const target = interaction.options.getUser('user') || interaction.user;
    const line = ROAST_LINES[Math.floor(Math.random() * ROAST_LINES.length)];
    return interaction.reply(`${target} ${line}`);
  }

  if (name === 'vanish') {
    const text = interaction.options.getString('text', true);
    await interaction.reply(text);
    setTimeout(() => {
      interaction.deleteReply().catch(() => {});
    }, 5000);
    return;
  }

  if (name === 'rickroll') {
    return interaction.reply('Schau dir das an: https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  }
}

async function handleAnnounce(interaction) {
  const message = interaction.options.getString('nachricht', true);
  const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

  const permissions = targetChannel.permissionsFor(interaction.guild.members.me);
  if (!permissions || !permissions.has(PermissionsBitField.Flags.SendMessages)) {
    return interaction.reply({
      content: `❌ Ich habe keine Schreibrechte in ${targetChannel}.`,
      ephemeral: true,
    });
  }
  if (!permissions.has(PermissionsBitField.Flags.MentionEveryone)) {
    return interaction.reply({
      content: `❌ Mir fehlt in ${targetChannel} die Berechtigung "@everyone erwähnen".`,
      ephemeral: true,
    });
  }

  await targetChannel.send({
    content: `@everyone ${message}`,
    allowedMentions: { parse: ['everyone'] },
  });

  await interaction.reply({
    content: `✅ Ankündigung wurde in ${targetChannel} gepostet.`,
    ephemeral: true,
  });
}

async function handleKick(interaction) {
  const { guild } = interaction;
  const targetUser = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('grund') || 'Kein Grund angegeben';

  const member = await guild.members.fetch(targetUser.id).catch(() => null);
  if (!member) {
    return interaction.reply({
      content: '❌ Dieses Mitglied wurde auf dem Server nicht gefunden.',
      ephemeral: true,
    });
  }

  if (!member.kickable) {
    return interaction.reply({
      content: '❌ Ich kann dieses Mitglied nicht kicken (höhere Rolle oder fehlende Rechte).',
      ephemeral: true,
    });
  }

  // Versuchen, den User vorher per DM zu informieren (schlägt fehl, wenn DMs geschlossen sind – kein Problem)
  await member
    .send(`Du wurdest von **${guild.name}** gekickt.\nGrund: ${reason}`)
    .catch(() => {});

  await member.kick(reason);

  const embed = new EmbedBuilder()
    .setTitle('👢 Mitglied gekickt')
    .setColor(0xf59e0b)
    .addFields(
      { name: 'Mitglied', value: `${targetUser.tag} (${targetUser.id})` },
      { name: 'Moderator', value: `${interaction.user.tag}` },
      { name: 'Grund', value: reason }
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function handleBan(interaction) {
  const { guild } = interaction;
  const targetUser = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('grund') || 'Kein Grund angegeben';
  const deleteDays = interaction.options.getInteger('nachrichten_löschen') || 0;

  const member = await guild.members.fetch(targetUser.id).catch(() => null);

  if (member && !member.bannable) {
    return interaction.reply({
      content: '❌ Ich kann dieses Mitglied nicht bannen (höhere Rolle oder fehlende Rechte).',
      ephemeral: true,
    });
  }

  // Versuchen, den User vorher per DM zu informieren (schlägt fehl, wenn DMs geschlossen sind – kein Problem)
  if (member) {
    await member
      .send(`Du wurdest von **${guild.name}** gebannt.\nGrund: ${reason}`)
      .catch(() => {});
  }

  await guild.members.ban(targetUser.id, {
    reason,
    deleteMessageSeconds: deleteDays * 24 * 60 * 60,
  });

  const embed = new EmbedBuilder()
    .setTitle('🔨 Mitglied gebannt')
    .setColor(0xef4444)
    .addFields(
      { name: 'Mitglied', value: `${targetUser.tag} (${targetUser.id})` },
      { name: 'Moderator', value: `${interaction.user.tag}` },
      { name: 'Grund', value: reason }
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

// ---------- Event-Handler ----------

client.once(Events.ClientReady, async (c) => {
  console.log(`🤖 Eingeloggt als ${c.user.tag}`);
  await registerCommands();
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'setup-tickets') {
        await interaction.channel.send({
          embeds: [buildPanelEmbed()],
          components: [buildPanelRow()],
        });
        await interaction.reply({
          content: '✅ Ticket-Panel wurde in diesem Kanal gepostet.',
          ephemeral: true,
        });
      } else if (interaction.commandName === 'kick') {
        await handleKick(interaction);
      } else if (interaction.commandName === 'ban') {
        await handleBan(interaction);
      } else if (interaction.commandName === 'setup-music') {
        await interaction.channel.send({
          embeds: [buildMusicPanelEmbed()],
          components: [buildMusicPanelRow()],
        });
        await interaction.reply({
          content: '✅ Musik-Panel wurde in diesem Kanal gepostet.',
          ephemeral: true,
        });
      } else if (interaction.commandName === 'skip') {
        await handleSkip(interaction);
      } else if (interaction.commandName === 'stop') {
        await handleStop(interaction);
      } else if (interaction.commandName === 'announce') {
        await handleAnnounce(interaction);
      } else if (
        ['uwu', 'mock', 'reverse', 'clap', '8ball', 'roast', 'vanish', 'rickroll'].includes(
          interaction.commandName
        )
      ) {
        await handleTrollCommand(interaction);
      }
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId === 'ticket_create') {
        await createTicketChannel(interaction);
      } else if (interaction.customId === 'ticket_close') {
        await closeTicketChannel(interaction);
      } else if (interaction.customId === 'music_request') {
        await interaction.showModal(buildMusicRequestModal());
      }
      return;
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'music_request_modal') {
        await handleMusicRequest(interaction);
      }
      return;
    }
  } catch (err) {
    console.error('Fehler bei der Interaktion:', err);
    if (interaction.isRepliable() && !interaction.replied) {
      await interaction.reply({
        content: '❌ Es ist ein Fehler aufgetreten.',
        ephemeral: true,
      });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
