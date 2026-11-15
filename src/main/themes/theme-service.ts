import { readBoundedResponse } from '../network/read-bounded-response';
import { nativeImage } from 'electron';
import {
  normalizeTheme,
  normalizeThemeDraft,
  normalizeThemeId,
  normalizeThemeImport,
  normalizeThemeList,
  normalizeThemeSound,
  type ThemeSoundLibrary,
  type BattlyTheme,
  type ThemeDraft,
  type ThemeLibrarySnapshot,
  type ThemeReviewResult,
  type ThemeShareResult,
} from '../../shared/themes/theme-contract';
import type { SettingsStore } from '../settings/settings-store';
import { OfflineSnapshotCache } from '../network/offline-snapshot-cache';

async function responseJson(response: Response): Promise<unknown> {
  return JSON.parse(
    await readBoundedResponse(response, 4 * 1024 * 1024, 'Theme response is too large'),
  ) as unknown;
}

type Fetch = typeof fetch;

function own(source: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(source, key)?.value as unknown;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function apiBase(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    throw new Error('Theme API must use HTTPS');
  }
  url.pathname = `${url.pathname.replace(/\/$/, '')}/`;
  return url;
}

function themePayload(draft: ThemeDraft): Record<string, unknown> {
  return {
    ...(draft.id ? { id: draft.id } : {}),
    name: draft.name,
    btnColor: draft.buttonColor,
    footerColor: draft.footerColor,
    footerOpacity: draft.footerOpacity,
    loadingColor: draft.loadingColor,
    startupSound: draft.startupSound,
    startupVolume: draft.startupVolume,
    // Production rejects `background: null` with HTTP 400. The original UI
    // treated an unselected background as optional, so omit it entirely.
    ...(draft.backgroundUrl ? { background: draft.backgroundUrl } : {}),
    animated: false,
  };
}

export class ThemeService {
  readonly #base: URL;
  readonly #store: SettingsStore;
  readonly #fetch: Fetch;
  #soundCache: { token: string; expires: number; library: ThemeSoundLibrary } | null = null;
  readonly #libraryCache: OfflineSnapshotCache<ThemeLibrarySnapshot>;

  constructor(
    baseUrl: string,
    store: SettingsStore,
    fetchImplementation: Fetch = fetch,
    cacheDirectory?: string,
  ) {
    this.#base = apiBase(baseUrl);
    this.#store = store;
    this.#fetch = fetchImplementation;
    this.#libraryCache = new OfflineSnapshotCache(cacheDirectory, (value) => {
      const source = object(value);
      if (
        !Array.isArray(source.themes) ||
        !source.themes.every((theme: unknown) => {
          const entry = object(theme);
          return (
            typeof entry.id === 'string' &&
            typeof entry.name === 'string' &&
            entry.visual &&
            typeof entry.visual === 'object'
          );
        })
      ) {
        throw new TypeError('Tema inválido');
      }
      return source as unknown as ThemeLibrarySnapshot;
    });
  }

  async library(token: string): Promise<ThemeLibrarySnapshot> {
    const activeThemeId = await this.#store.activeThemeId();
    const result = await this.#libraryCache.load(
      token,
      () => this.#remoteLibrary(token),
      () => ({ activeThemeId, themes: [] }),
    );
    return { ...result.data, activeThemeId };
  }

  async #remoteLibrary(token: string): Promise<ThemeLibrarySnapshot> {
    const [themesValue, defaultValue, activeThemeId] = await Promise.all([
      this.#request(token, 'my', 'POST', {}),
      this.#request(token, 'default', 'GET'),
      this.#store.activeThemeId(),
    ]);
    const premium = (await this.sounds(token)).premium;
    const themes = normalizeThemeList(themesValue).map((theme) => this.#restrict(theme, premium));
    const defaultTheme = normalizeTheme(defaultValue);
    if (defaultTheme && !themes.some((theme) => theme.id === defaultTheme.id)) {
      themes.unshift(this.#restrict(defaultTheme, premium));
    }
    return { activeThemeId, themes };
  }

  async marketplace(
    query = '',
    sort: 'newest' | 'trending' = 'newest',
  ): Promise<readonly BattlyTheme[]> {
    const value = await this.#request(
      '',
      'public',
      'POST',
      { page: 1, limit: 100, q: query.trim().slice(0, 80), sort },
      false,
    );
    // The public endpoint only returns approved themes, but older responses omit
    // reviewStatus. Keep this compatibility limited to that endpoint.
    const publicThemes = Array.isArray(value)
      ? value.map((entry) => {
          const theme = object(entry);
          return own(theme, 'reviewStatus') === undefined
            ? { ...theme, reviewStatus: 'approved' }
            : theme;
        })
      : value;
    const themes = normalizeThemeList(publicThemes).filter(
      (theme) => theme.isPublic && theme.reviewStatus === 'approved' && !theme.contentRestricted,
    );
    return themes;
  }

  async save(token: string, value: unknown): Promise<ThemeLibrarySnapshot> {
    const original = normalizeThemeDraft(value);
    const premium = (await this.sounds(token)).premium;
    const draft = premium
      ? original
      : {
          ...original,
          startupSound: 'start',
          startupVolume: 0,
          backgroundUrl: this.#staticBackground(original.backgroundUrl),
        };
    const path = draft.id ? 'update' : 'create';
    const payload = themePayload(draft);
    if (draft.id) {
      const previous = (await this.library(token)).themes.find((theme) => theme.id === draft.id);
      if (previous) {
        const old = themePayload({
          id: previous.id,
          name: previous.name,
          buttonColor: previous.visual.buttonColor,
          buttonHoverColor: previous.visual.buttonHoverColor,
          footerColor: previous.visual.footerColor,
          footerOpacity: previous.visual.footerOpacity,
          loadingColor: previous.loadingColor,
          backgroundUrl: previous.visual.backgroundUrl,
          startupSound: previous.startupSound,
          startupVolume: previous.startupVolume,
        });
        for (const key of Object.keys(payload)) {
          if (key !== 'id' && Object.is(payload[key], old[key])) {
            delete payload[key];
          }
        }
      }
    }
    const saved = Object.keys(payload).some((key) => key !== 'id')
      ? object(await this.#request(token, path, 'POST', payload))
      : { id: draft.id };
    const snapshot = await this.library(token);
    const returnedId = own(saved, 'id');
    const theme = snapshot.themes.find(
      (candidate) =>
        candidate.id === (draft.id ?? returnedId) ||
        (!draft.id && typeof returnedId !== 'string' && candidate.name === draft.name),
    );
    if (!theme) {
      return snapshot;
    }
    await this.#store.applyTheme(theme);
    return { ...snapshot, activeThemeId: theme.id };
  }

  async archive(token: string, value: unknown): Promise<ThemeLibrarySnapshot> {
    const id = normalizeThemeId(value);
    await this.#request(token, 'delete', 'POST', { id });
    const snapshot = await this.library(token);
    if (snapshot.activeThemeId !== id) {
      return snapshot;
    }
    const fallback = snapshot.themes.find((theme) => theme.isDefault);
    if (fallback) {
      await this.#store.applyTheme(fallback);
      return { ...snapshot, activeThemeId: fallback.id };
    }
    await this.#store.clearActiveTheme();
    return { ...snapshot, activeThemeId: null };
  }

  async apply(token: string, value: unknown): Promise<ThemeLibrarySnapshot> {
    const id = normalizeThemeId(value);
    const snapshot = await this.library(token);
    const theme = snapshot.themes.find((candidate) => candidate.id === id);
    if (!theme) {
      throw new Error('El tema ya no está disponible');
    }
    await this.#store.applyTheme(theme);
    return { ...snapshot, activeThemeId: theme.id };
  }

  async install(token: string, value: unknown): Promise<ThemeLibrarySnapshot> {
    const id = normalizeThemeId(value);
    await this.#request(token, 'download', 'POST', { themeId: id });
    const rawSource = normalizeTheme(await this.#request('', 'public/get', 'POST', { id }, false));
    const source = rawSource ? this.#restrict(rawSource, (await this.sounds(token)).premium) : null;
    if (!source) {
      throw new Error('El marketplace devolvió un tema inválido');
    }
    const created = object(
      await this.#request(token, 'create', 'POST', {
        ...themePayload({
          name: source.name,
          buttonColor: source.visual.buttonColor,
          buttonHoverColor: source.visual.buttonHoverColor,
          footerColor: source.visual.footerColor,
          footerOpacity: source.visual.footerOpacity,
          loadingColor: source.loadingColor,
          backgroundUrl: source.visual.backgroundUrl,
          startupSound: source.startupSound,
          startupVolume: source.startupVolume,
        }),
      }),
    );
    const createdId = own(created, 'id');
    const snapshot = await this.library(token);
    return typeof createdId === 'string' ? this.apply(token, createdId) : snapshot;
  }

  async share(token: string, value: unknown): Promise<ThemeShareResult> {
    const id = normalizeThemeId(value);
    const result = object(await this.#request(token, 'share', 'POST', { id }));
    const shareUrl = own(result, 'shareUrl');
    const expiresAt = own(result, 'expiresAt');
    if (typeof shareUrl !== 'string' || shareUrl.length > 2048) {
      throw new Error('La API no devolvió un enlace válido');
    }
    const url = new URL(shareUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'battlylauncher.com') {
      throw new Error('La API no devolvió un enlace válido');
    }
    return {
      shareUrl: url.toString(),
      expiresAt: typeof expiresAt === 'string' && expiresAt.length <= 64 ? expiresAt : null,
    };
  }

  async requestReview(token: string, value: unknown): Promise<ThemeLibrarySnapshot> {
    const id = normalizeThemeId(value);
    await this.#request(token, 'requestReview', 'POST', { id });
    return this.library(token);
  }

  async reviewStatus(token: string, value: unknown): Promise<ThemeReviewResult> {
    const id = normalizeThemeId(value);
    const result = object(await this.#request(token, 'reviewStatus', 'POST', { id }));
    const rawStatus = own(result, 'status');
    const status =
      rawStatus === 'requested' ||
      rawStatus === 'pending' ||
      rawStatus === 'approved' ||
      rawStatus === 'rejected'
        ? rawStatus
        : 'draft';
    const reason = own(result, 'reason');
    return { status, reason: typeof reason === 'string' && reason.length <= 2_000 ? reason : null };
  }

  async unpublish(token: string, value: unknown): Promise<ThemeLibrarySnapshot> {
    const id = normalizeThemeId(value);
    await this.#request(token, 'unpublish', 'POST', { id });
    return this.library(token);
  }

  async import(token: string, value: unknown): Promise<ThemeLibrarySnapshot> {
    const draft = normalizeThemeImport(value);
    await this.#request(
      token,
      `import/${encodeURIComponent(draft.code)}`,
      'POST',
      draft.customName ? { customName: draft.customName } : {},
    );
    return this.library(token);
  }

  async uploadBackground(token: string, bytes: Buffer, filename: string): Promise<string> {
    if (!token || token.length > 8192) {
      throw new Error('Cuenta Battly requerida');
    }
    if (!bytes.length || bytes.length > 8 * 1024 * 1024) {
      throw new Error('La imagen supera 8 MB');
    }
    const extension = filename.toLowerCase().match(/\.(png|jpe?g|gif|webp)$/)?.[1];
    if (!extension) {
      throw new Error('Formato de imagen no compatible');
    }
    if (!(await this.sounds(token)).premium && !['png', 'jpg', 'jpeg'].includes(extension)) {
      throw new Error('Necesitas Battly+ para fondos animados');
    }
    const image = nativeImage.createFromBuffer(bytes);
    const dimensions = image.getSize();
    if (image.isEmpty() || dimensions.width > 8192 || dimensions.height > 8192) {
      throw new Error('La imagen está dañada o supera 8192 píxeles');
    }
    const mime = extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : `image/${extension}`;
    const form = new FormData();
    form.append(
      'background',
      new Blob([Uint8Array.from(bytes)], { type: mime }),
      `background.${extension}`,
    );
    const response = await this.#fetch('https://api.battlylauncher.com/api/v2/background/subir', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    const result = object(await responseJson(response).catch(() => ({})));
    const raw = own(result, 'url');
    if (!response.ok || own(result, 'status') !== 200 || typeof raw !== 'string') {
      throw new Error('No se pudo subir el fondo');
    }
    const url = new URL(raw);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'cdn.battlylauncher.com' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error('Fondo inválido');
    }
    return url.toString();
  }

  #staticBackground(url: string | null): string | null {
    return url && /\.(png|jpe?g)$/i.test(new URL(url).pathname) ? url : null;
  }

  #restrict(theme: BattlyTheme, premium: boolean): BattlyTheme {
    return premium
      ? theme
      : {
          ...theme,
          startupVolume: 0,
          startupSound: 'start',
          visual: {
            ...theme.visual,
            backgroundUrl: this.#staticBackground(theme.visual.backgroundUrl),
          },
        };
  }

  async sounds(token: string): Promise<ThemeSoundLibrary> {
    if (this.#soundCache?.token === token && this.#soundCache.expires > Date.now()) {
      return this.#soundCache.library;
    }
    const result = object(await this.#appearance(token, 'list'));
    const sounds = Array.isArray(result.sounds) ? result.sounds.slice(0, 100) : [];
    const library: ThemeSoundLibrary = {
      premium: result.isPremium === true,
      sounds: sounds.flatMap((raw) => {
        const sound = object(raw);
        const url = normalizeThemeSound(sound.url);
        if (url === 'start' || typeof sound.id !== 'string' || typeof sound.name !== 'string') {
          return [];
        }
        return [{ id: sound.id.slice(0, 128), name: sound.name.slice(0, 80), url }];
      }),
    };
    this.#soundCache = { token, expires: Date.now() + 30_000, library };
    return library;
  }

  async uploadSound(token: string, bytes: Buffer, filename: string): Promise<ThemeSoundLibrary> {
    if (!(await this.sounds(token)).premium) {
      throw new Error('Necesitas Battly+ para subir sonidos personalizados');
    }
    if (!bytes.length || bytes.length > 5 * 1024 * 1024) {
      throw new Error('El sonido supera 5 MB');
    }
    const extension = filename.toLowerCase().match(/\.(mp3|wav|ogg|m4a|aac)$/)?.[1];
    if (!extension) {
      throw new Error('Selecciona un audio MP3, WAV, OGG, M4A o AAC');
    }
    const mime: Record<string, string> = {
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      m4a: 'audio/mp4',
      aac: 'audio/aac',
    };
    const form = new FormData();
    form.append(
      'sound',
      new Blob([Uint8Array.from(bytes)], { type: mime[extension] }),
      `sound.${extension}`,
    );
    await this.#appearance(token, 'subir', form);
    this.#soundCache = null;
    return this.sounds(token);
  }

  async #appearance(token: string, path: string, body?: FormData): Promise<unknown> {
    if (!token || token.length > 8192) {
      throw new Error('Cuenta Battly requerida');
    }
    const response = await this.#fetch(new URL(`../v2/sounds/${path}`, this.#base), {
      method: body ? 'POST' : 'GET',
      redirect: 'error',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      ...(body ? { body } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    const result = object(await responseJson(response));
    if (!response.ok || (result.success !== true && result.status !== 200)) {
      throw new Error(
        typeof result.message === 'string'
          ? result.message.slice(0, 500)
          : 'No se pudo cargar el panel de sonidos',
      );
    }
    return result;
  }

  async #request(
    token: string,
    path: string,
    method: 'GET' | 'POST',
    body?: Record<string, unknown>,
    authenticated = true,
  ): Promise<unknown> {
    if (authenticated && (!token || token.length > 8192)) {
      throw new Error('Cuenta Battly requerida');
    }
    const response = await this.#fetch(new URL(path, this.#base), {
      method,
      redirect: 'error',
      headers: {
        accept: 'application/json',
        ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
        ...(authenticated ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
    });
    const result = await responseJson(response).catch(() => ({}));
    if (!response.ok) {
      const payload = object(result);
      const detail = own(payload, 'error') ?? own(payload, 'message');
      throw new Error(
        typeof detail === 'string' && detail.trim() && detail.length <= 500
          ? detail.trim()
          : `No se pudo completar la operación de temas (${response.status})`,
      );
    }
    return result;
  }
}
