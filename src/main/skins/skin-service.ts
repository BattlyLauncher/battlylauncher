import { readBoundedResponse } from '../network/read-bounded-response';
import { nativeImage } from 'electron';
import { readBattlyPremium } from '../auth/battly-auth-common';
import { readFile, stat } from 'node:fs/promises';
import { OfflineSnapshotCache } from '../network/offline-snapshot-cache';

import type {
  CapeActionResult,
  CapeLibrarySnapshot,
  SkinActionResult,
  SkinLibraryItem,
  SkinLibrarySnapshot,
} from '../../shared/skins/skin-contract';

const maximumSkinBytes = 1024 * 1024;

function validateRenderablePng(bytes: Buffer, width: number, height: number): void {
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty() || image.getSize().width !== width || image.getSize().height !== height) {
    throw new TypeError('El PNG está dañado o no se puede mostrar');
  }
  if (bytes.includes(Buffer.from('acTL'))) {
    throw new TypeError('Selecciona un PNG estático');
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function own(source: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(source, key)?.value as unknown;
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function safeUrl(value: unknown, baseUrl: URL): string | null {
  if (typeof value !== 'string' || value.length > 2_048) {
    return null;
  }
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const body = await readBoundedResponse(
    response,
    256 * 1024,
    'La respuesta de skins es demasiado grande',
  );
  try {
    return object(JSON.parse(body) as unknown);
  } catch {
    if (response.status === 429 || /has excedido|too many requests|rate limit/i.test(body)) {
      throw new Error(
        'La API de skins está temporalmente limitada. Espera un momento y reintenta.',
      );
    }
    throw new Error(`La API de skins devolvió una respuesta no válida (${response.status})`);
  }
}

export class SkinService {
  readonly #baseUrl: URL;
  #legacyPremium = new Map<string, { premium: boolean; until: number }>();

  async #premium(
    data: Record<string, unknown>,
    token: string,
    username?: string,
  ): Promise<boolean> {
    if (typeof data.premium === 'boolean') {
      return data.premium;
    }
    const cached = this.#legacyPremium.get(token);
    if (cached && cached.until > Date.now()) {
      return cached.premium;
    }
    if (!username) {
      return false;
    }
    // Older library routes omit premium. Resolve it from the server profile,
    // never from the caller's potentially stale local account flag.
    const premium = await readBattlyPremium(
      this.fetcher,
      new URL('api/v2/users/profile/', this.#baseUrl).href,
      username,
      AbortSignal.timeout(6000),
    );
    if (this.#legacyPremium.size >= 100) {
      this.#legacyPremium.clear();
    }
    this.#legacyPremium.set(token, { premium, until: Date.now() + 60000 });
    return premium;
  }
  #cachedSnapshot: { readonly username: string; readonly snapshot: SkinLibrarySnapshot } | null =
    null;

  constructor(
    baseUrl = 'https://api.battlylauncher.com/',
    private readonly fetcher: typeof fetch = fetch,
    private readonly cacheDirectory?: string,
  ) {
    this.#baseUrl = new URL(baseUrl);
    if (
      this.#baseUrl.protocol !== 'https:' &&
      !(this.#baseUrl.protocol === 'http:' && this.#baseUrl.hostname === '127.0.0.1')
    ) {
      throw new TypeError('Invalid skin API URL');
    }
  }

  async snapshot(token: string, username: string, _premium: boolean): Promise<SkinLibrarySnapshot> {
    const cache = new OfflineSnapshotCache<SkinLibrarySnapshot>(this.cacheDirectory, (value) => {
      const data = object(value);
      if (!Array.isArray(data.skins) || typeof data.currentSkinUrl !== 'string') {
        throw new TypeError('Invalid cached skins');
      }
      return {
        currentSkinId: text(data.currentSkinId) || null,
        currentSkinUrl: safeUrl(data.currentSkinUrl, this.#baseUrl) ?? '',
        premium: data.premium === true,
        limitReached: data.premium !== true && data.skins.length >= 4,
        skins: data.skins.flatMap((value) => {
          const item = object(value),
            id = text(item.id),
            url = safeUrl(item.url, this.#baseUrl);
          return /^[A-Za-z0-9_-]{1,128}$/.test(id) && url
            ? [
                {
                  id,
                  url,
                  name: text(item.name, id).slice(0, 128),
                  model: item.model === 'slim' ? ('slim' as const) : ('default' as const),
                },
              ]
            : [];
        }),
      };
    });
    const result = await cache.load(
      username,
      () => this.#remoteSnapshot(token, username, _premium),
      () => ({
        currentSkinId: null,
        currentSkinUrl: '',
        limitReached: true,
        premium: false,
        skins: [],
      }),
    );
    this.#cachedSnapshot = { username, snapshot: result.data };
    return result.data;
  }

  async #remoteSnapshot(
    token: string,
    username: string,
    _premium: boolean,
  ): Promise<SkinLibrarySnapshot> {
    void _premium; // Kept for caller compatibility; the API supplies the actual entitlement.
    const response = await this.fetcher(new URL('api/v2/skins/library', this.#baseUrl), {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    const data = await responseJson(response);
    if (!response.ok) {
      throw new Error(
        text(own(data, 'message'), `No se pudieron cargar las skins (${response.status})`),
      );
    }
    const sourceSkins = own(data, 'skins');
    const skins: SkinLibraryItem[] = Array.isArray(sourceSkins)
      ? sourceSkins.flatMap((value, index) => {
          const source = object(value);
          const stringId = typeof value === 'string' ? value : '';
          const id =
            text(own(source, 'skinId')) ||
            text(own(source, '_id')) ||
            text(own(source, 'id')) ||
            stringId;
          if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
            return [];
          }
          const url =
            safeUrl(own(source, 'fileUrl') ?? own(source, 'url'), this.#baseUrl) ??
            new URL(
              `api/v2/skin/${encodeURIComponent(username)}/${encodeURIComponent(id)}`,
              this.#baseUrl,
            ).toString();
          const modelValue = own(source, 'model');
          return [
            {
              id,
              name: text(own(source, 'name'), `Skin ${index + 1}`).slice(0, 128),
              url,
              model: modelValue === 'slim' || modelValue === 'alex' ? 'slim' : 'default',
            },
          ];
        })
      : [];
    const established = text(own(data, 'established')) || null;
    const premium = await this.#premium(data, token, username);
    const snapshot = {
      currentSkinId: established,
      currentSkinUrl: new URL(`api/skin/${encodeURIComponent(username)}`, this.#baseUrl).toString(),
      premium,
      limitReached: !premium && skins.length >= 4,
      skins,
    };
    this.#cachedSnapshot = { username, snapshot };
    return snapshot;
  }

  async capes(token: string, username?: string): Promise<CapeLibrarySnapshot> {
    const response = await this.fetcher(new URL('api/v2/capes/library', this.#baseUrl), {
      headers: { authorization: `Bearer ${token}`, 'accept-language': 'es' },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    const data = await responseJson(response);
    if (!response.ok || data.success !== true) {
      throw new Error(text(data.message, 'No se pudieron cargar las capas'));
    }
    const capes = Array.isArray(data.capes)
      ? data.capes.flatMap((value) => {
          const item = object(value);
          const id = text(item.id);
          const url = safeUrl(item.url, this.#baseUrl);
          return /^[A-Za-z0-9_-]{1,128}$/.test(id) && url
            ? [
                {
                  id,
                  url,
                  name: text(item.name, id).slice(0, 128),
                  deletable: item.deletable === true,
                },
              ]
            : [];
        })
      : [];
    return {
      capes,
      established: text(data.established) || null,
      premium: await this.#premium(data, token, username),
    };
  }

  async changeCape(
    token: string,
    action: 'establecer' | 'eliminar' | 'quitar',
    capeID?: string,
  ): Promise<CapeActionResult> {
    if (action !== 'quitar' && (!capeID || !/^[A-Za-z0-9_-]{1,128}$/.test(capeID))) {
      throw new TypeError('Capa inválida');
    }
    const response = await this.fetcher(new URL(`api/v2/capa/${action}`, this.#baseUrl), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ capeID }),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    const data = await responseJson(response);
    if (!response.ok || (data.status !== 200 && data.status !== 'OK')) {
      throw new Error(text(data.description, text(data.message, 'No se pudo cambiar la capa')));
    }
    return { message: text(data.message, 'Capa actualizada'), snapshot: await this.capes(token) };
  }

  async uploadCape(token: string, premium: boolean, file: string): Promise<CapeActionResult> {
    void premium; // The authenticated API owns Battly+ eligibility.
    if (!(await this.capes(token)).premium) {
      throw new Error('Necesitas Battly+ para subir capas propias');
    }
    if ((await stat(file)).size > 100 * 1024) {
      throw new TypeError('La capa debe ser un PNG de hasta 100 KB');
    }
    const bytes = await readFile(file);
    if (
      bytes.length < 24 ||
      bytes.length > 100 * 1024 ||
      bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
    ) {
      throw new TypeError('La capa debe ser un PNG de hasta 100 KB');
    }
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (width !== 64 || height !== 32) {
      throw new TypeError('La capa debe medir 64x32 píxeles');
    }
    validateRenderablePng(bytes, width, height);
    const body = new FormData();
    body.append('cape', new Blob([bytes], { type: 'image/png' }), 'cape.png');
    const response = await this.fetcher(new URL('api/v2/capa/subir', this.#baseUrl), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    });
    const data = await responseJson(response);
    if (!response.ok || data.status !== 200) {
      throw new Error(text(data.description, text(data.message, 'No se pudo subir la capa')));
    }
    return { message: text(data.message, 'Capa subida'), snapshot: await this.capes(token) };
  }

  async upload(
    token: string,
    username: string,
    premium: boolean,
    path: string,
  ): Promise<SkinActionResult> {
    const info = await stat(path);
    if (!info.isFile() || info.size > maximumSkinBytes) {
      throw new TypeError('La skin debe ser un PNG de hasta 1 MB');
    }
    const library = await this.snapshot(token, username, premium);
    if (library.limitReached) {
      throw new Error(
        'Has alcanzado el límite de 4 skins. Con Battly+ tienes skins y capas ilimitadas.',
      );
    }
    const bytes = await readFile(path);
    if (
      bytes.length > maximumSkinBytes ||
      bytes.length < 24 ||
      bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
    ) {
      throw new TypeError('La skin debe ser un PNG válido de hasta 1 MB');
    }
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (width !== 64 || (height !== 64 && height !== 32)) {
      throw new TypeError('La skin debe medir 64x64 o 64x32 píxeles');
    }
    validateRenderablePng(bytes, width, height);
    const form = new FormData();
    form.append('skin', new Blob([bytes], { type: 'image/png' }), 'skin.png');
    form.append('token', token);
    const response = await this.fetcher(new URL('api/v2/skin/subir', this.#baseUrl), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(20_000),
    });
    const data = await responseJson(response);
    if (!response.ok || own(data, 'status') !== 200) {
      throw new Error(text(own(data, 'message'), 'No se pudo subir la skin'));
    }
    return {
      message: text(own(data, 'message'), 'Skin subida correctamente'),
      snapshot: await this.snapshot(token, username, premium),
    };
  }

  async set(
    token: string,
    username: string,
    premium: boolean,
    skinId: string,
  ): Promise<SkinActionResult> {
    return this.#action('set', 'api/v2/skin/establecer', token, username, premium, skinId);
  }

  async delete(
    token: string,
    username: string,
    premium: boolean,
    skinId: string,
  ): Promise<SkinActionResult> {
    return this.#action('delete', 'api/v2/skin/eliminar', token, username, premium, skinId);
  }

  async #action(
    kind: 'delete' | 'set',
    path: string,
    token: string,
    username: string,
    premium: boolean,
    skinId: string,
  ): Promise<SkinActionResult> {
    const response = await this.fetcher(new URL(path, this.#baseUrl), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ token, skinID: skinId }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await responseJson(response);
    if (!response.ok || own(data, 'status') !== 200) {
      throw new Error(
        `No se pudo modificar la skin: ${text(own(data, 'description'), text(own(data, 'message'), `HTTP ${response.status}`))}`,
      );
    }
    let snapshot: SkinLibrarySnapshot;
    const previous =
      this.#cachedSnapshot?.username === username ? this.#cachedSnapshot.snapshot : null;
    if (kind === 'set' && previous) {
      const selected = previous.skins.find((candidate) => candidate.id === skinId);
      snapshot = {
        ...previous,
        currentSkinId: skinId,
        currentSkinUrl: selected?.url ?? previous.currentSkinUrl,
      };
      this.#cachedSnapshot = { username, snapshot };
      return { message: text(own(data, 'message'), 'Skin actualizada'), snapshot };
    }
    try {
      snapshot = await this.snapshot(token, username, premium);
    } catch {
      if (!previous) {
        throw new Error('La skin se actualizó, pero no se pudo recargar la biblioteca');
      }
      const skins =
        kind === 'delete'
          ? previous.skins.filter((candidate) => candidate.id !== skinId)
          : previous.skins;
      snapshot = {
        ...previous,
        currentSkinId:
          kind === 'set'
            ? skinId
            : previous.currentSkinId === skinId
              ? (skins[0]?.id ?? null)
              : previous.currentSkinId,
        skins,
      };
      this.#cachedSnapshot = { username, snapshot };
    }
    return { message: text(own(data, 'message'), 'Skin actualizada'), snapshot };
  }
}
