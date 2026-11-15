import { minecraftDisconnectedFromLog } from '../minecraft/launch-events';
import type { MinecraftLaunchEvent } from '../../shared/minecraft/launch-contract';
import type { MusicPlaybackState } from '../../shared/music/music-contract';
import type { PrivacySettings } from '../../shared/settings/settings-contract';
import { NativeDiscordRpc } from './native-rpc';
import { formatPresenceServer, formatPresenceVersion } from '../../shared/social/presence-format';
import { isMinecraftClientReadyMessage } from '../../shared/minecraft/launch-contract';
import { formatLog4jText } from '../../shared/minecraft/log4j-log';
import type { WorldsSnapshot } from '../../shared/social/battly-worlds-contract';
import { worldsRoomMemberCount } from '../../shared/social/battly-worlds-contract';
import type { ServerRuntimeSnapshot } from '../../shared/servers/server-contract';

const panels: Record<string, string> = {
  home: 'Inicio',
  login: 'Inicio de sesión',
  mods: 'Battly Mods',
  music: 'Battly Music',
  settings: 'Ajustes',
  social: 'Amigos',
  mybattly: 'MyBattly',
  news: 'Novedades',
  servers: 'Battly Servers',
  chat: 'Battly Chat',
  language: 'Idioma',
  welcome: 'Bienvenida',
  instances: 'Instancias',
  downloads: 'Descargas',
  skins: 'Skins',
  worlds: 'Battly Worlds',
};

export class DiscordPresence {
  #panel = 'home';
  #panelAt = Date.now();
  #games = new Map<
    symbol,
    { version: string; ready: boolean; started: number; server: string | null }
  >();
  #music: MusicPlaybackState | null = null;
  #musicAt = Date.now();
  #worlds: WorldsSnapshot | null = null;
  #servers = new Map<string, ServerRuntimeSnapshot>();
  #privacy = { discordShareStatus: false, discordShareServer: false };
  #version = '';
  #username = '';
  #joinSecret = '';
  constructor(
    private readonly rpc = new NativeDiscordRpc(),
    private readonly translate: (text: string) => string = (text) => text,
  ) {}
  identity(version: string, username: string): void {
    this.#version = version;
    this.#username = /^[\w.+-]{1,64}$/.test(username) ? username : '';
    this.refresh();
  }
  joinSecret(secret: string): void {
    this.#joinSecret = /^[a-f0-9]{64}$/.test(secret) ? secret : '';
    this.refresh();
  }
  configure(privacy: Pick<PrivacySettings, 'discordShareStatus' | 'discordShareServer'>): void {
    this.#privacy = privacy;
    this.refresh();
    this.rpc.setEnabled(privacy.discordShareStatus);
  }
  panel(value: unknown): void {
    if (typeof value !== 'string' || !Object.hasOwn(panels, value)) {
      return;
    }
    if (value !== this.#panel) {
      this.#panel = value;
      this.#panelAt = Date.now();
    }
    this.refresh();
  }
  begin(label: string): () => void {
    void label;
    return () => {};
  }
  operation(channel: string): () => void {
    void channel;
    return () => {};
  }
  music(state: MusicPlaybackState): void {
    if (
      !this.#music ||
      state.title !== this.#music.title ||
      (!this.#music.playing && state.playing)
    ) {
      this.#musicAt = Date.now();
    }
    if (
      state.playing &&
      typeof state.currentTime === 'number' &&
      Math.abs((Date.now() - this.#musicAt) / 1000 - state.currentTime) > 2
    ) {
      this.#musicAt = Date.now() - state.currentTime * 1000;
    }
    this.#music = state;
    this.refresh();
  }
  worlds(snapshot: WorldsSnapshot): void {
    if (snapshot.code !== this.#worlds?.code || !['hosting', 'joined'].includes(snapshot.state)) {
      this.#joinSecret = '';
    }
    this.#worlds = snapshot;
    this.refresh();
  }
  hosting(snapshot: ServerRuntimeSnapshot): void {
    if (['starting', 'running', 'stopping'].includes(snapshot.status)) {
      this.#servers.set(snapshot.id, snapshot);
    } else {
      this.#servers.delete(snapshot.id);
    }
    this.refresh();
  }
  launch(id: symbol, event: MinecraftLaunchEvent, version: string): void {
    if (
      (event.type === 'state' && ['preparing', 'running'].includes(event.state)) ||
      event.type === 'process'
    ) {
      if (!this.#games.has(id)) {
        this.#games.set(id, { version, ready: false, started: Date.now(), server: null });
      }
    }
    const game = this.#games.get(id);
    if (
      (event.type === 'client-ready' ||
        (event.type === 'log' &&
          !/\[CHAT\]/i.test(event.message) &&
          isMinecraftClientReadyMessage(formatLog4jText(event.message)))) &&
      game
    ) {
      if (!game.ready) {
        game.started = Date.now();
      }
      game.ready = true;
    }
    if (game && event.type === 'log' && minecraftDisconnectedFromLog(event.message)) {
      game.server = null;
    }
    if (
      event.type === 'exit' ||
      (event.type === 'state' && ['failed', 'exited', 'idle'].includes(event.state))
    ) {
      this.#games.delete(id);
    }
    this.refresh();
  }
  server(id: symbol, address: string | null): void {
    const game = this.#games.get(id);
    if (game) {
      game.server = address;
      this.refresh();
    }
  }
  refresh(): void {
    const game =
      [...this.#games.values()].reverse().find((g) => g.ready) ?? [...this.#games.values()].at(-1);
    const music = this.#music?.playing && this.#music.title ? this.#music : null;
    const room =
      this.#worlds && ['hosting', 'joined'].includes(this.#worlds.state) ? this.#worlds : null;
    const hosting = [...this.#servers.values()].at(-1);
    const details = game
      ? game.ready
        ? room && this.#privacy.discordShareServer
          ? 'Battly Worlds'
          : 'Jugando Minecraft'
        : 'Preparando Minecraft'
      : music
        ? 'Escuchando música'
        : room
          ? 'Battly Worlds'
          : hosting
            ? 'Battly Servers'
            : 'En Battly';
    const state =
      game && room
        ? `${formatPresenceVersion(game.version)}${this.#privacy.discordShareServer ? ' · Battly Worlds' : ''}`
        : game
          ? `${formatPresenceVersion(game.version)}${this.#privacy.discordShareServer && game.server ? ` · ${formatPresenceServer(game.server)}` : ''}`
          : music
            ? `${music.title} · ${music.artist}`
            : room
              ? `${formatPresenceVersion(room.version)} · ${worldsRoomMemberCount(room)}`
              : hosting
                ? `${this.translate(hosting.status === 'running' ? 'Servidor iniciado' : hosting.status === 'starting' ? 'Iniciando servidor' : 'Deteniendo servidor')} · ${hosting.players}/${hosting.maxPlayers}`
                : panels[this.#panel];
    const started = game?.started ?? (music ? this.#musicAt : this.#panelAt);
    // Discord fields must not contain C0 control characters.
    const shorten = (text: string) =>
      // eslint-disable-next-line no-control-regex -- Este patrón filtra caracteres de control deliberadamente.
      [...text.replace(/[\u0000-\u001f]/g, ' ')].slice(0, 120).join('');
    const launcher = `Battly Launcher${this.#version ? ` ${this.#version}` : ''}`;
    const join = room && this.#privacy.discordShareServer && this.#joinSecret;
    this.rpc.update({
      type: !game && music ? 2 : 0,
      details: shorten(`${launcher} · ${this.translate(details)}`),
      state: shorten((music && !game) || game || room ? state : this.translate(state)),
      timestamps: {
        start: Math.floor(started / 1000),
        ...(!game && music?.duration
          ? { end: Math.floor(this.#musicAt / 1000 + music.duration) }
          : {}),
      },
      assets: {
        large_image: 'battly_512',
        large_text: launcher,
        ...(this.#username
          ? {
              small_image: `https://api.battlylauncher.com/api/face/${encodeURIComponent(this.#username)}`,
              small_text: this.#username,
            }
          : {}),
      },
      ...(join
        ? {
            supported_platforms: ['desktop'],
            party: {
              id: `battly-worlds-${join.slice(0, 32)}`,
              size: [
                worldsRoomMemberCount(room),
                Math.max(worldsRoomMemberCount(room), (room.maxGuests ?? 3) + 1),
              ],
            },
            secrets: { join },
            instance: true,
          }
        : {
            buttons: [
              { label: 'Discord', url: 'https://discord.gg/tecno-bros-885235460178342009' },
              { label: 'Battly', url: 'https://battlylauncher.com' },
            ],
            instance: false,
          }),
    });
  }
  dispose(): void {
    this.rpc.dispose();
  }
}
