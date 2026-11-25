import { setUiText, translateUiText } from '../i18n/dialog-text';
import { renderLogLines } from '../ui/log-lines';
import {
  isServerModloader,
  normalizeServerDraft,
  paperMinecraftVersion,
} from '../../shared/servers/server-contract';
import { openBypackFlow } from './bypack-panel';
import { mountServerInvitations } from './server-invitations';
import { renderServerCharts, renderOnlineServerPlayers } from './server-live-panels';
import './servers-restored.css';
import type { PlayVersionLaunchRequest } from '../../shared/minecraft/play-version-contract';
import { mountServerInstallationProgress } from './server-installation-progress';
import { mountServersTutorial } from './servers-tutorial';
import serverSupportMarkup from './servers.html?raw';
import serverMarkup from '../legacy/panels/servers.html?raw';
import legacySpanishStrings from '../legacy/assets/langs/strings.es.json';
import { askBattly } from '../ui/ask-modal';
import { serverSlotText } from './server-slot-copy';
import { serverDomainTakenMessage, serverErrorMessage } from '../../shared/servers/server-errors';
import { serverRegionEndpoints, type ServerRegion } from '../../shared/servers/server-regions';

import type {
  ServerContentEntry,
  ServerContentKind,
  ServerFileContent,
  ServerFileEntry,
  ServerInstallProgress,
  ServerPermissionRole,
  ServerPlayerEntry,
  ServerPlayerListKind,
  ServerPlayerListsSnapshot,
  ServerProperties,
  ServerRuntimeSnapshot,
  ServerSoftwareKind,
  ServerSoftwareAvailability,
  ServerSharingSnapshot,
  ServerSummary,
} from '../../shared/servers/server-contract';

let servers: readonly ServerSummary[] = [];
let selectedId = '';

let installationDialog: ReturnType<typeof mountServerInstallationProgress> | undefined;
let serversTutorial: ReturnType<typeof mountServersTutorial> | undefined;
const runtimeLogs = new Map<string, string[]>();
const runtimeSnapshots = new Map<string, ServerRuntimeSnapshot>();
let runtimeLogFrame: number | undefined;
const installProgress = new Map<string, ServerInstallProgress>();
const installingServers = new Set<string>();
const playerSnapshots = new Map<string, ServerPlayerListsSnapshot>();
let selectedPlayerKind: ServerPlayerListKind = 'banned';
let currentFilePath = '';
let editedFile: ServerFileContent | null = null;
const serverContent = new Map<string, readonly ServerContentEntry[]>();
const sharingSnapshots = new Map<string, ServerSharingSnapshot>();

const statusLabels: Record<ServerRuntimeSnapshot['status'], string> = {
  stopped: 'Detenido',
  starting: 'Iniciando…',
  running: 'En línea',
  stopping: 'Deteniendo…',
  error: 'Error',
};
const emptyPlayerListMessages: Record<ServerPlayerListKind, string> = {
  banned: 'No hay jugadores baneados.',
  whitelist: 'No hay jugadores en la lista blanca.',
  blacklist: 'No hay jugadores en la lista negra.',
  operators: 'No hay operadores.',
};
const runtimeNoticeMessages: Record<ServerRuntimeSnapshot['status'], string> = {
  stopped: 'Servidor detenido',
  starting: 'Iniciando servidor',
  running: 'Servidor iniciado.',
  stopping: 'Deteniendo servidor',
  error: 'El proceso terminó con un error. Revisa los registros de la consola.',
};

const softwareLabels: Record<ServerSoftwareKind, string> = {
  vanilla: 'Vanilla',
  fabric: 'Fabric',
  paper: 'Paper',
  forge: 'Forge',
  neoforge: 'NeoForge',
  spigot: 'Spigot',
};
const permissionLabels: Record<ServerPermissionRole, string> = {
  operator: 'Operador',
  player: 'Jugador',
  viewer: 'Solo invitación',
};
const fallbackFriendAvatar = new URL('../legacy/assets/images/icon.png', import.meta.url).href;
const serverRegions: readonly ServerRegion[] = ['latam', 'eu'];

function serverRegionLabel(region: ServerRegion): string {
  return region === 'eu' ? translateUiText('Europa') : 'LATAM';
}

function measureRegionLatency(host: string, attempts = 3, timeoutMs = 2_000): Promise<number> {
  return new Promise((resolve) => {
    const socket = new WebSocket(`wss://${host}/latency`);
    const samples: number[] = [];
    let startedAt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (latency: number): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      try {
        socket.close();
      } catch {
        // The latency result is still valid when the peer already closed.
      }
      resolve(latency);
    };
    const ping = (): void => {
      startedAt = performance.now();
      socket.send('p');
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => finish(9_999), timeoutMs);
    };
    timer = setTimeout(() => finish(9_999), timeoutMs);
    socket.addEventListener('open', ping);
    socket.addEventListener('error', () => finish(9_999));
    socket.addEventListener('message', () => {
      samples.push(performance.now() - startedAt);
      if (samples.length >= attempts) {
        finish(Math.round(samples.reduce((total, sample) => total + sample, 0) / samples.length));
      } else {
        ping();
      }
    });
  });
}

let creationCatalogRevision = 0;
let panelCatalogRevision = 0;
const softwareAvailability = new Map<string, ServerSoftwareAvailability>();

async function populateServerLoaderBuilds(
  select: HTMLSelectElement,
  kind: 'fabric' | 'forge' | 'neoforge',
  version: string,
  selected?: string,
): Promise<void> {
  const revision = crypto.randomUUID();
  select.dataset.buildRevision = revision;
  select.replaceChildren(new Option(translateUiText('Cargando versiones…'), ''));
  select.disabled = true;
  const automatic = new Option(translateUiText('Automática'), '');
  try {
    const result = await window.battly.getLoaderBuilds(kind, version);
    if (select.dataset.buildRevision !== revision) {
      return;
    }
    select.replaceChildren(
      automatic,
      ...result.builds
        .filter(
          ({ version: build }) =>
            kind !== 'neoforge' || (/^\d+\.\d+\./.test(build) && !build.startsWith('1.')),
        )
        .map(
          ({ version: build }) =>
            new Option(
              kind === 'forge' && build.startsWith(version + '-')
                ? build.slice(version.length + 1)
                : build,
              build,
            ),
        ),
    );
    if (selected) {
      select.value = selected;
    }
    if (select.selectedIndex < 0) {
      select.selectedIndex = 0;
    }
    select.disabled = false;
  } catch {
    if (select.dataset.buildRevision !== revision) {
      return;
    }
    select.replaceChildren(automatic);
  }
}

function refreshCreationLoaderBuilds(): void {
  const select = document.querySelector<HTMLSelectElement>('[name="loaderBuild"]');
  if (!select) {
    return;
  }
  const kind = document.querySelector<HTMLSelectElement>('[name="software"]')?.value ?? '';
  const version = document.querySelector<HTMLSelectElement>('#versionSelectServers')?.value;
  if (version && isServerModloader(kind)) {
    select.parentElement!.hidden = false;
    void populateServerLoaderBuilds(select, kind, version);
  } else {
    delete select.dataset.buildRevision;
    select.disabled = true;
    select.replaceChildren();
    select.parentElement!.hidden = true;
  }
}

async function chooseServerLoaderBuild(
  server: ServerSummary,
  kind: 'fabric' | 'forge' | 'neoforge',
): Promise<string | null> {
  const dialog = document.createElement('dialog');
  dialog.className = 'server-loader-build-dialog';
  const form = document.createElement('form');
  form.method = 'dialog';
  const label = document.createElement('label');
  setUiText(label, 'Versión del modloader');
  const select = document.createElement('select');
  label.append(select);
  const actions = document.createElement('div');
  const cancel = document.createElement('button');
  cancel.type = 'button';
  setUiText(cancel, 'Cancelar');
  cancel.addEventListener('click', () => dialog.close());
  const confirm = document.createElement('button');
  confirm.value = 'install';
  setUiText(confirm, 'Instalar');
  actions.append(cancel, confirm);
  form.append(label, actions);
  dialog.append(form);
  document.body.append(dialog);
  dialog.showModal();
  const selection = new Promise<string | null>((resolve) => {
    dialog.addEventListener(
      'close',
      () => {
        resolve(dialog.returnValue === 'install' ? select.value : null);
        dialog.remove();
      },
      { once: true },
    );
  });
  confirm.disabled = true;
  void populateServerLoaderBuilds(
    select,
    kind,
    server.version,
    server.software.kind === kind ? (server.software.build ?? undefined) : undefined,
  ).finally(() => {
    confirm.disabled = false;
  });
  return selection;
}

async function refreshCreationSoftware(): Promise<void> {
  const revision = ++creationCatalogRevision;
  const version = document.querySelector<HTMLSelectElement>('#versionSelectServers')?.value;
  const select = document.querySelector<HTMLSelectElement>('[name="software"]');
  const submit = document.querySelector<HTMLButtonElement>(
    '[data-server-create-form] [type="submit"]',
  );
  if (!select || !version) {
    return;
  }
  const previous = select.value;
  select.replaceChildren(new Option('Comprobando compatibilidad…', ''));
  select.disabled = true;
  refreshCreationLoaderBuilds();
  if (submit) {
    submit.disabled = true;
  }
  try {
    const result = await window.battly.getServerSoftwareAvailability(version);
    if (revision !== creationCatalogRevision) {
      return;
    }
    softwareAvailability.set(version, result);
    select.replaceChildren(
      ...result.available.map(
        (kind) =>
          new Option(
            `${softwareLabels[kind]}${kind === 'paper' && paperMinecraftVersion(version) !== version ? ` (${paperMinecraftVersion(version)})` : ''}`,
            kind,
          ),
      ),
    );
    if (!result.available.length) {
      select.add(new Option('Sin software disponible. Cambia de versión.', ''));
    }
    if (result.available.includes(previous as ServerSoftwareKind)) {
      select.value = previous;
    }
    select.disabled = !result.available.length;
    refreshCreationLoaderBuilds();
    if (submit) {
      submit.disabled = !select.value || submit.form?.dataset.busy === 'true';
    }
  } catch {
    if (revision !== creationCatalogRevision) {
      return;
    }
    select.replaceChildren(
      new Option('No se pudo comprobar. Cambia de versión para reintentar.', ''),
    );
  }
}

async function refreshPanelSoftware(server: ServerSummary): Promise<void> {
  const revision = ++panelCatalogRevision;
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-server-software]')];
  buttons.forEach((button) => {
    button.disabled = true;
    if (button.parentElement) {
      button.parentElement.hidden = true;
    }
  });
  const status = document.querySelector<HTMLElement>('[data-server-software-detail]');
  if (status) {
    status.textContent = 'Comprobando software compatible…';
  }
  try {
    const result = await window.battly.getServerSoftwareAvailability(server.version);
    if (revision !== panelCatalogRevision || selectedId !== server.id) {
      return;
    }
    softwareAvailability.set(server.version, result);
    buttons.forEach((button) => {
      const supported = result.available.includes(
        button.dataset.serverSoftware as ServerSoftwareKind,
      );
      if (button.parentElement) {
        button.parentElement.hidden = !supported;
      }
      button.disabled =
        !supported ||
        installingServers.has(server.id) ||
        !['stopped', 'error'].includes(runtimeSnapshots.get(server.id)?.status ?? 'stopped');
    });
    if (status) {
      status.textContent = `Instalado: ${softwareLabels[server.software.kind]} · ${server.software.gameVersion ?? server.version}. Solo se muestran las opciones verificadas para esta versión.`;
    }
  } catch {
    if (revision === panelCatalogRevision && status) {
      status.textContent =
        'No se pudo comprobar la compatibilidad. Vuelve a seleccionar el servidor para reintentar.';
    }
  }
}

async function populateServerVersions(): Promise<void> {
  const select = document.querySelector<HTMLSelectElement>('#versionSelectServers');
  if (!select) {
    return;
  }
  try {
    const catalog = await window.battly.getDownloadCatalog();
    const versions = catalog.minecraft.filter((entry) => entry.type === 'release');
    select.replaceChildren(...versions.map((entry) => new Option(entry.id, entry.id)));
    if (!select.options.length) {
      select.add(new Option('1.20.1', '1.20.1'));
    }
  } catch {
    if (!select.options.length) {
      select.add(new Option('1.20.1', '1.20.1'));
    }
  }
}

async function refreshServerRegions(): Promise<void> {
  const select = document.querySelector<HTMLSelectElement>('#regionSelectServers');
  const info = document.querySelector<HTMLElement>('#regionLatencyInfo');
  const button = document.querySelector<HTMLButtonElement>('#b-servers-checkForLatency');
  if (!select || !info) {
    return;
  }
  if (button?.disabled) {
    return;
  }
  info.removeAttribute('data-string-id');
  button?.classList.add('is-loading');
  if (button) {
    button.disabled = true;
  }
  info.textContent = 'Calculando latencia…';
  const previous = select.value;
  const measured = await Promise.all(
    serverRegions.map(async (id) => ({
      id,
      latency: await measureRegionLatency(serverRegionEndpoints[id].apiHost).catch(() => 9_999),
    })),
  );
  measured.sort((left, right) => left.latency - right.latency);
  select.replaceChildren(
    ...measured.map(
      (region) =>
        new Option(
          region.latency === 9_999
            ? serverRegionLabel(region.id)
            : `${serverRegionLabel(region.id)}  –  ${region.latency} ms`,
          region.id,
          false,
          region.id === previous,
        ),
    ),
  );
  if (!select.value && select.options[0]) {
    select.options[0].selected = true;
  }
  const updateInfo = (): void => {
    const region = measured.find((candidate) => candidate.id === select.value) ?? measured[0];
    info.textContent =
      region && region.latency !== 9_999
        ? `Región seleccionada: ${serverRegionLabel(region.id)} (${region.latency} ms de latencia)`
        : 'No se pudo comprobar la latencia.';
    updateServerDomainPreview();
  };
  select.onchange = updateInfo;
  updateInfo();
  button?.classList.remove('is-loading');
  if (button) {
    button.disabled = false;
  }
}

function updateServerDomainPreview(): void {
  const input = document.querySelector<HTMLInputElement>('#domainInput');
  const preview = document.querySelector<HTMLElement>('#serverIP');
  if (!input || !preview) {
    return;
  }
  const suffix = '.battlyservers.net';
  preview.textContent = `${input.value.trim().toLowerCase() || 'dominio'}${suffix}`;
}

function setupServerDomainValidation(): void {
  const input = document.querySelector<HTMLInputElement>('#domainInput');
  const warning = document.querySelector<HTMLElement>('#warningMessage');
  if (!input || !warning) {
    return;
  }
  warning.removeAttribute('data-string-id');
  warning.className = 'server-domain-hint';
  warning.setAttribute('role', 'status');
  input.setAttribute('aria-describedby', 'warningMessage');
  const reserved = ['api', 'server', 'oficial', 'battly'];
  input.addEventListener('input', () => {
    const value = input.value.trim().toLowerCase();
    const reservedWord = reserved.find((word) => value.includes(word));
    const malformed =
      value.length > 0 &&
      (value.length < 3 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value) ||
        value.includes('--'));
    warning.hidden = !(reservedWord || malformed);
    warning.style.removeProperty('display');
    const message = reservedWord
      ? 'Elige otro dominio: este nombre está reservado.'
      : 'Usa al menos 3 letras, números o guiones.';
    setUiText(warning, message);
    input.setCustomValidity(reservedWord || malformed ? translateUiText(message) : '');
    updateServerDomainPreview();
  });
  updateServerDomainPreview();
  warning.hidden = true;
  input.form?.addEventListener('reset', () =>
    queueMicrotask(() => {
      input.setCustomValidity('');
      warning.hidden = true;
      updateServerDomainPreview();
    }),
  );
}

function legacyString(key: string): string | null {
  let value: unknown = legacySpanishStrings;
  for (const part of key.split('.')) {
    if (!value || typeof value !== 'object' || !(part in value)) {
      return null;
    }
    value = (value as Record<string, unknown>)[part];
  }
  return typeof value === 'string' ? value : null;
}

function conceal(element: HTMLElement): void {
  element.hidden = true;
  element.style.setProperty('display', 'none', 'important');
}

function annotateLegacyServers(mount: HTMLElement): void {
  mount.querySelectorAll('script').forEach((script) => script.remove());
  mount
    .querySelectorAll<HTMLElement>('[onclick]')
    .forEach((element) => element.removeAttribute('onclick'));
  mount.querySelectorAll<HTMLElement>('[data-string-id]').forEach((element) => {
    const translated = legacyString(element.dataset.stringId ?? '');
    if (!translated) {
      return;
    }
    if (element instanceof HTMLInputElement && element.hasAttribute('placeholder')) {
      element.placeholder = translated;
    } else {
      const icon = element.querySelector(':scope > i');
      if (icon) {
        element.replaceChildren(icon, document.createTextNode(' ' + translated));
      } else {
        element.textContent = translated;
      }
    }
  });

  const shareButton = mount.querySelector('#b-servers-share-button');
  if (shareButton) {
    shareButton.innerHTML =
      '<i class="fas fa-share-nodes" aria-hidden="true"></i><span>Compartir servidor</span>';
  }
  const latencyButton = mount.querySelector('#b-servers-checkForLatency');
  latencyButton?.setAttribute('aria-label', 'Comprobar latencia');
  latencyButton?.setAttribute('title', 'Comprobar latencia');

  const loading = mount.querySelector<HTMLElement>('.fullscreen-text-div');
  if (loading) {
    loading.hidden = false;
    loading.style.display = 'flex';
  }
  const createContainer = mount.querySelector<HTMLElement>('.panel-container');
  const createCard = createContainer?.querySelector<HTMLElement>('.box2');
  if (createContainer) {
    createContainer.dataset.serverCreateView = '';
    conceal(createContainer);
  }
  if (createCard && createContainer) {
    const form = document.createElement('form');
    form.className = createCard.className;
    form.dataset.serverCreateForm = '';
    while (createCard.firstChild) {
      form.append(createCard.firstChild);
    }
    createCard.replaceWith(form);
    const domain = form.querySelector<HTMLInputElement>('#domainInput');
    const version = form.querySelector<HTMLSelectElement>('#versionSelectServers');
    const region = form.querySelector<HTMLSelectElement>('#regionSelectServers');
    if (domain) {
      domain.name = 'domain';
      domain.required = true;
      domain.minLength = 3;
    }
    if (domain) {
      domain.setAttribute('aria-label', 'Dominio del servidor');
    }
    if (version) {
      version.name = 'version';
      if (!version.options.length) {
        version.add(new Option('1.20.1', '1.20.1'));
      }
    }
    if (region) {
      region.name = 'region';
      region.replaceChildren(...serverRegions.map((id) => new Option(serverRegionLabel(id), id)));
    }
    const name = document.createElement('input');
    name.type = 'text';
    name.name = 'name';
    name.value = 'Servidor de Minecraft';
    name.defaultValue = name.value;
    name.required = true;
    name.setAttribute('aria-label', 'Nombre del servidor');
    conceal(name);
    const port = document.createElement('input');
    port.type = 'number';
    port.name = 'port';
    port.value = '25565';
    port.defaultValue = port.value;
    port.min = '1';
    port.max = '65535';
    port.required = true;
    port.setAttribute('aria-label', 'Puerto');
    conceal(port);
    form.append(name, port);
    const softwareField = document.createElement('label');
    softwareField.className = 'server-create-software';
    softwareField.textContent = 'Software del servidor';
    const software = document.createElement('select');
    software.name = 'software';
    for (const [value, label] of [
      ['vanilla', 'Vanilla'],
      ['paper', 'Paper · recomendado sin mods'],
      ['fabric', 'Fabric · mods'],
      ['forge', 'Forge · mods'],
      ['neoforge', 'NeoForge · mods'],
      ['spigot', 'Spigot · plugins'],
    ]) {
      software.add(new Option(label, value));
    }
    software.replaceChildren(new Option('Comprobando compatibilidad…', ''));
    software.disabled = true;
    softwareField.append(software);
    software.addEventListener('change', refreshCreationLoaderBuilds);
    const loaderBuildField = document.createElement('label');
    loaderBuildField.className = 'server-create-software';
    loaderBuildField.hidden = true;
    setUiText(loaderBuildField, 'Versión del modloader');
    const loaderBuild = document.createElement('select');
    loaderBuild.name = 'loaderBuild';
    loaderBuildField.append(loaderBuild);
    const creationActions = form.querySelector('#create-server')?.parentElement;
    const terms = document.createElement('label');
    terms.className = 'server-create-eula';
    terms.innerHTML =
      '<input type="checkbox" name="eulaAccepted" required><span></span><a href="https://www.minecraft.net/eula" target="_blank" rel="noopener noreferrer">EULA</a>';
    setUiText(terms.querySelector('span')!, 'Acepto el EULA de Minecraft.');
    if (creationActions && creationActions !== form) {
      creationActions.before(softwareField, loaderBuildField);
    } else {
      form.append(softwareField, loaderBuildField);
    }
    creationActions?.before(terms);
    const submit = form.querySelector<HTMLButtonElement>('#create-server');
    if (submit) {
      submit.type = 'submit';
      submit.disabled = true;
    }
    const cancel = form.querySelector<HTMLButtonElement>('#b-servers-cancel-server-creation');
    if (cancel) {
      cancel.type = 'button';
      cancel.removeAttribute('data-panel');
    }
    const status = document.createElement('p');
    status.className = 'help';
    status.dataset.serverCreateStatus = '';
    status.setAttribute('role', 'status');
    form.append(status);
  }

  const dashboard = mount.querySelector<HTMLElement>('.b-servers-main-container');
  if (dashboard) {
    dashboard.dataset.serverDashboard = '';
    conceal(dashboard);
  }
  const title = mount.querySelector<HTMLElement>('#b-servers-header-title');
  if (title) {
    title.dataset.serverTitle = '';
  }
  const share = mount.querySelector<HTMLElement>('#b-servers-share-button');
  if (share) {
    share.dataset.serverShare = '';
  }
  const searchBox = mount.querySelector<HTMLElement>('.b-servers-search-box');
  if (searchBox) {
    const picker = document.createElement('select');
    picker.dataset.serverPicker = '';
    picker.setAttribute('aria-label', 'Seleccionar servidor');
    searchBox.replaceChildren(picker);
    const actions = document.createElement('div');
    actions.className = 'server-header-actions';
    if (share) {
      actions.append(share);
    }
    actions.append(searchBox);
    mount.querySelector('.b-servers-content-header')?.append(actions);
  }

  const tabMap: Readonly<Record<string, string>> = {
    general: 'general',
    recursos: 'resources',
    jugadores: 'players',
    opciones: 'options',
    modloaders: 'modloaders',
    archivos: 'files',
    logs: 'logs',
  };
  const tabOrder = [
    'general',
    'recursos',
    'jugadores',
    'opciones',
    'modloaders',
    'archivos',
    'logs',
  ];
  mount.querySelectorAll<HTMLAnchorElement>('.b-servers-menu-list a').forEach((link, index) => {
    const key = tabOrder[index] ?? '';
    if (key && tabMap[key]) {
      link.dataset.serverTab = tabMap[key];
    }
    if (key && tabMap[key]) {
      link.setAttribute('role', 'button');
    }
    link.href = '#';
  });
  const back = mount.querySelector<HTMLElement>('#b-servers-back-to-home');
  if (back) {
    back.dataset.panel = 'home';
  }
  for (const [id, view] of Object.entries(tabMap)) {
    const panel = mount.querySelector<HTMLElement>(`#${id}`);
    if (panel) {
      panel.dataset.serverView = view;
    }
  }

  const general = mount.querySelector<HTMLElement>('#general');
  general?.querySelectorAll<HTMLAnchorElement>('a.b-servers-action-button').forEach((link) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = link.className;
    button.innerHTML = link.innerHTML;
    link.replaceWith(button);
  });
  const runtimeButtons = general?.querySelectorAll<HTMLElement>('.b-servers-action-button');
  if (runtimeButtons?.[0]) {
    runtimeButtons[0].dataset.serverRuntime = 'toggle';
  }
  if (runtimeButtons?.[1]) {
    runtimeButtons[1].dataset.serverRuntime = 'restart';
  }
  if (runtimeButtons?.[2]) {
    runtimeButtons[2].dataset.serverConnect = '';
  }
  runtimeButtons?.forEach((button) => button.setAttribute('role', 'button'));
  if (general) {
    general.insertAdjacentHTML(
      'afterbegin',
      /* HTML */ `<article
        class="b-servers-installation"
        data-server-installation
      >
        <div class="b-servers-installation-head">
          <div>
            <strong>Archivos del servidor</strong>
            <p data-server-install-current>Instala server.jar y Java antes de iniciar.</p>
          </div>
          <button
            type="button"
            class="button is-info"
            data-server-install
          >
            <i
              class="fa-solid fa-download"
              aria-hidden="true"
            ></i
            >&nbsp; Preparar servidor
          </button>
        </div>
        <progress
          class="progress is-info"
          data-server-install-progress
          max="100"
          value="0"
        ></progress>
      </article>`,
    );
  }
  title?.insertAdjacentHTML(
    'beforeend',
    '<span class="server-runtime-notice" role="status"></span>',
  );
  const consoleOutput = mount.querySelector<HTMLElement>('#consoleOutput');
  if (consoleOutput) {
    data(consoleOutput, 'serverConsole');
  }
  const consoleBox = mount.querySelector<HTMLElement>('.b-servers-console-input');
  if (consoleBox) {
    const form = document.createElement('form');
    form.className = consoleBox.className;
    form.dataset.serverCommandForm = '';
    while (consoleBox.firstChild) {
      form.append(consoleBox.firstChild);
    }
    consoleBox.replaceWith(form);
    const command = form.querySelector<HTMLInputElement>('#consoleCommand');
    if (command) {
      command.name = 'command';
      command.setAttribute('aria-label', 'Comando del servidor');
    }
    const send = form.querySelector<HTMLButtonElement>('button');
    if (send) {
      send.type = 'submit';
    }
  }
  const consoleHeader = mount.querySelector<HTMLElement>('.b-servers-console-header');
  if (consoleHeader) {
    const state = consoleHeader.querySelector<HTMLElement>('.tag');
    if (state) {
      state.dataset.serverState = '';
    }
    const process = document.createElement('span');
    process.dataset.serverConsoleState = '';
    conceal(process);
    consoleHeader.append(process);
  }
  const resources = mount.querySelector<HTMLElement>('#recursos');
  const charts = resources?.querySelectorAll<HTMLElement>('.b-servers-resource-chart-container');
  const metric = (host: HTMLElement | undefined, key: string): void => {
    if (!host) {
      return;
    }
    const value = document.createElement('span');
    value.dataset[`server${key}`] = '';
    value.textContent = '0';
    const progress = document.createElement('progress');
    conceal(progress);
    progress.dataset[`server${key}Progress`] = '';
    progress.max = 100;
    progress.value = 0;
    host.append(value, progress);
  };
  metric(charts?.[0], 'Cpu');
  metric(charts?.[1], 'Memory');
  if (resources) {
    const players = document.createElement('span');
    conceal(players);
    players.dataset.serverPlayers = '';
    const progress = document.createElement('progress');
    conceal(progress);
    progress.dataset.serverPlayersProgress = '';
    resources.append(players, progress);
  }

  const support = document.createElement('template');
  support.innerHTML = serverSupportMarkup;
  const supportView = (name: string): HTMLElement | null =>
    support.content.querySelector<HTMLElement>(`[data-server-view="${name}"]`);

  const playersView = mount.querySelector<HTMLElement>('#jugadores');
  const supportPlayers = supportView('players');
  if (playersView && supportPlayers) {
    const supportControls = document.createElement('div');
    supportControls.className = 'b-servers-player-tools';
    supportPlayers
      .querySelectorAll<HTMLElement>('.server-player-form, [data-server-player-status]')
      .forEach((element) => supportControls.append(element));
    playersView.append(supportControls);
  }
  const playerModals: ReadonlyArray<readonly [string, ServerPlayerListKind]> = [
    ['banlistModal', 'banned'],
    ['blacklistModal', 'blacklist'],
    ['whitelistModal', 'whitelist'],
  ];
  const listButtons = mount.querySelectorAll<HTMLButtonElement>('#listasJugadores button');
  playerModals.forEach(([modalId, kind], index) => {
    const button = listButtons[index];
    if (button) {
      button.dataset.serverPlayerModal = modalId;
      button.dataset.serverPlayerKind = kind;
    }
    const modal = mount.querySelector<HTMLElement>(`#${modalId}`);
    if (!modal) {
      return;
    }
    modal.dataset.serverPlayerModalContainer = modalId;
    modal.querySelector('table')?.classList.add('b-servers-table');
    const header = document.createElement('th');
    header.textContent = 'Acciones';
    modal.querySelector('thead tr')?.append(header);
    modal
      .querySelectorAll<HTMLElement>('.modal-background, .delete, .modal-card-foot .button')
      .forEach((close) => {
        close.dataset.serverPlayerModalClose = modalId;
      });
  });

  const options = mount.querySelector<HTMLElement>('#opciones');
  if (options) {
    options.dataset.serverPropertiesForm = '';
    const performance = document.createElement('section');
    performance.className = 'server-performance-settings';
    performance.innerHTML = /* HTML */ `<h3>Rendimiento</h3>
      <label
        >Límite de CPU (%)
        <input
          name="maxCpuPercent"
          type="number"
          min="1"
          max="100"
          step="1"
          value="100"
          aria-describedby="server-cpu-limit-hint"
        />
      </label>
      <p id="server-cpu-limit-hint">
        100 % permite usar toda la CPU. El cambio se aplica al volver a iniciar el servidor.
      </p>
      <p>Menos chunks reducen el trabajo del servidor. Los cambios se aplican al reiniciarlo.</p>
      <div class="server-performance-controls">
        <label
          >Distancia de visión
          <input
            name="viewDistance"
            type="number"
            min="2"
            max="32"
            placeholder="Predeterminada"
        /></label>
        <label
          >Distancia de simulación
          <input
            name="simulationDistance"
            type="number"
            min="2"
            max="32"
            placeholder="Predeterminada"
        /></label>
        <button
          type="button"
          class="button is-info"
          data-server-optimize
        >
          <i class="fas fa-leaf"></i> Usar consumo reducido
        </button>
      </div>
      <p>
        6 chunks de visión y 4 de simulación. Para jugar sin mods, Paper ofrece una alternativa a
        Vanilla. Los servidores con mods conservan su loader.
      </p>`;
    const description = options.querySelector(':scope > p');
    if (description) {
      description.after(performance);
    } else {
      options.prepend(performance);
    }
    performance.querySelector('[data-server-optimize]')?.addEventListener('click', () => {
      for (const [name, value] of [
        ['viewDistance', '6'],
        ['simulationDistance', '4'],
      ]) {
        const field = performance.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
        field.value = value!;
      }
      performance.querySelector('input')?.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const names: Readonly<Record<string, string>> = {
      maxPlayersInput: 'maxPlayers',
      maxRamInput: 'maxMemoryMb',
      gamemodeSelect: 'gamemode',
      difficultySelect: 'difficulty',
      spawnProtectionInput: 'spawnProtection',
      resourcePackInput: 'resourcePack',
      resourcePackPromptInput: 'resourcePackPrompt',
    };
    for (const [id, name] of Object.entries(names)) {
      const control = options.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`);
      if (control) {
        control.name = name;
        const labels: Readonly<Record<string, string>> = {
          maxPlayers: 'Máximo de jugadores',
          maxMemoryMb: 'Uso de RAM Máx (MB)',
          gamemode: 'Modo de juego',
          difficulty: 'Dificultad',
          spawnProtection: 'Protección del spawn',
          resourcePack: 'Pack de recursos',
          resourcePackPrompt: 'Mensaje del pack de recursos',
        };
        control.setAttribute('aria-label', labels[name] ?? name);
      }
    }
    const booleans: Readonly<Record<string, string>> = {
      pvpToggle: 'pvp',
      animalsToggle: 'spawnAnimals',
      netherToggle: 'allowNether',
      cmdBlocksToggle: 'enableCommandBlock',
      mobsToggle: 'spawnMonsters',
      forceGamemodeToggle: 'forceGamemode',
      whitelistToggle: 'whitelist',
    };
    for (const [id, name] of Object.entries(booleans)) {
      const toggle = options.querySelector<HTMLButtonElement>(`#${id}`);
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.name = name;
      checkbox.hidden = true;
      const labels: Readonly<Record<string, string>> = {
        pvp: 'PVP',
        spawnAnimals: 'Animales',
        allowNether: 'Nether',
        enableCommandBlock: 'Bloques de comandos',
        spawnMonsters: 'Mobs',
        forceGamemode: 'Forzar modo de juego',
        whitelist: 'Whitelist',
      };
      checkbox.setAttribute('aria-label', labels[name] ?? name);
      toggle?.setAttribute('aria-label', labels[name] ?? name);
      toggle?.insertAdjacentElement('afterend', checkbox);
      toggle?.addEventListener('click', (event) => {
        event.preventDefault();
        checkbox.checked = !checkbox.checked;
        toggle.setAttribute('aria-pressed', String(checkbox.checked));
        toggle.classList.toggle('b-servers-check-toggle', checkbox.checked);
        toggle.classList.toggle('b-servers-cross-toggle', !checkbox.checked);
        const icon = toggle.querySelector<HTMLElement>('i');
        icon?.classList.toggle('fa-check', checkbox.checked);
        icon?.classList.toggle('fa-times', !checkbox.checked);
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.dataset.serverPropertiesStatus = '';
    options.append(status);
    const archive = options.querySelector<HTMLElement>('#b-servers-deleteServerButton');
    if (archive) {
      archive.dataset.serverArchive = '';
    }
  }

  const modloaders = mount.querySelector<HTMLElement>('#modloaders');
  if (modloaders) {
    const softwareKinds: readonly ServerSoftwareKind[] = ['paper', 'forge', 'fabric', 'spigot'];
    modloaders
      .querySelectorAll<HTMLButtonElement>(':scope > div > div > button')
      .forEach((button, index) => {
        const kind = softwareKinds[index];
        if (kind) {
          button.dataset.serverSoftware = kind;
        }
      });
    const softwareList = modloaders.querySelector<HTMLElement>(':scope > div');
    if (softwareList) {
      softwareList.classList.add('server-software-grid');
      const addSoftwareButton = (
        kind: 'vanilla' | 'neoforge',
        icon: string,
        label: string,
      ): void => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;margin-bottom:8px';
        const loaderIcon = document.createElement('i');
        loaderIcon.className = `fa-solid ${icon}`;
        loaderIcon.style.cssText = 'margin-right:8px;color:#59b2ff';
        const name = document.createElement('span');
        name.className = 'is-white';
        name.textContent = label;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'button is-success is-small';
        button.style.marginLeft = 'auto';
        button.dataset.serverSoftware = kind;
        button.textContent = 'Instalar';
        row.append(loaderIcon, name, button);
        softwareList.append(row);
      };
      addSoftwareButton('vanilla', 'fa-cube', 'Vanilla');
      addSoftwareButton('neoforge', 'fa-fire-flame-curved', 'NeoForge');
    }
    modloaders.insertAdjacentHTML(
      'beforeend',
      /* HTML */ `<div style="margin-top:22px;">
        <span
          data-server-software-current
          hidden
        ></span>
        <span data-server-software-detail></span>
        <button
          type="button"
          class="button is-small"
          data-server-modpack-import
        >
          Instalar modpack
        </button>
        <span
          data-server-software-state
          hidden
        ></span>
        <h3
          class="title is-5"
          style="color:#fff;margin-bottom:6px;"
        >
          Contenido del servidor
        </h3>
        <p
          class="is-white"
          style="margin-bottom:12px;"
        >
          Importa y administra mods o plugins. Detén el servidor antes de cambiarlos.
        </p>
        <button
          type="button"
          class="button is-info"
          data-server-share-pack
        >
          <i class="fas fa-box"></i> Compartir mods (.bypack)
        </button>
        <p>
          Comparte mods y configuraciones. Revisa los mods exclusivos de servidor antes de usarlos
          en un cliente.
        </p>
        <p
          class="is-white"
          role="status"
          data-server-content-status
        ></p>
        <div class="columns is-multiline">
          <div
            class="column is-6 b-servers-column"
            data-server-content-kind="mods"
          >
            <div
              class="b-servers-server-property-box"
              style="color:#fff;"
            >
              <h3>
                <i
                  class="fa fa-puzzle-piece"
                  style="color:#59b2ff;margin-right:8px;"
                ></i
                >Mods
                <span
                  data-server-content-count="mods"
                  style="font-size:.75rem;font-weight:normal;"
                  >0 archivos</span
                >
              </h3>
              <div style="display:flex;gap:5px;margin:8px 0;">
                <button
                  type="button"
                  class="button is-small is-success"
                  data-server-content-import="mods"
                >
                  <i
                    class="fa fa-upload"
                    style="margin-right:5px;"
                  ></i
                  >Importar JAR
                </button>
                <button
                  type="button"
                  class="button is-small is-info"
                  data-server-content-open="mods"
                >
                  <i
                    class="fa fa-folder-open"
                    style="margin-right:5px;"
                  ></i
                  >Abrir carpeta
                </button>
              </div>
              <div data-server-content-list="mods"><p>No hay mods importados.</p></div>
            </div>
          </div>
          <div
            class="column is-6 b-servers-column"
            data-server-content-kind="plugins"
          >
            <div
              class="b-servers-server-property-box"
              style="color:#fff;"
            >
              <h3>
                <i
                  class="fa fa-plug"
                  style="color:#59b2ff;margin-right:8px;"
                ></i
                >Plugins
                <span
                  data-server-content-count="plugins"
                  style="font-size:.75rem;font-weight:normal;"
                  >0 archivos</span
                >
              </h3>
              <div style="display:flex;gap:5px;margin:8px 0;">
                <button
                  type="button"
                  class="button is-small is-success"
                  data-server-content-import="plugins"
                >
                  <i
                    class="fa fa-upload"
                    style="margin-right:5px;"
                  ></i
                  >Importar JAR
                </button>
                <button
                  type="button"
                  class="button is-small is-info"
                  data-server-content-open="plugins"
                >
                  <i
                    class="fa fa-folder-open"
                    style="margin-right:5px;"
                  ></i
                  >Abrir carpeta
                </button>
              </div>
              <div data-server-content-list="plugins"><p>No hay plugins importados.</p></div>
            </div>
          </div>
        </div>
      </div>`,
    );
  }

  const files = mount.querySelector<HTMLElement>('#archivos');
  const fileTable = files?.querySelector<HTMLTableElement>('table');
  const fileBody = fileTable?.querySelector<HTMLTableSectionElement>('tbody');
  if (fileBody) {
    fileBody.dataset.serverFileList = '';
  }
  if (files) {
    const toolbar = document.createElement('div');
    toolbar.className = 'b-servers-file-toolbar';
    toolbar.innerHTML = /* HTML */ `<button
        type="button"
        class="button is-small"
        data-server-file-up
      >
        <i class="fa fa-level-up-alt"></i> Subir
      </button>
      <span data-server-file-path>/</span
      ><button
        type="button"
        class="button is-small is-info"
        data-server-world-import
      >
        Importar mundo ZIP</button
      ><span data-server-file-status></span>`;
    fileTable?.insertAdjacentElement('beforebegin', toolbar);
  }
  const logs = mount.querySelector<HTMLElement>('#logs-list');
  if (logs) {
    logs.dataset.serverLogList = '';
  }
  logs?.insertAdjacentHTML('afterend', '<span data-server-log-status role="status"></span>');

  mount.insertAdjacentHTML(
    'beforeend',
    /* HTML */ `<div
        class="modal"
        data-server-file-dialog
      >
        <div
          class="modal-background"
          data-server-file-close
        ></div>
        <form
          class="modal-card"
          style="width:80%;max-width:900px;"
          data-server-file-form
        >
          <header class="modal-card-head">
            <p class="modal-card-title">
              Editor de archivo: <span data-server-file-edit-path></span>
            </p>
            <button
              class="delete"
              type="button"
              aria-label="Cerrar editor"
              data-server-file-close
            ></button>
          </header>
          <section class="modal-card-body">
            <textarea
              id="fileEditorTextarea"
              name="content"
              spellcheck="true"
              maxlength="2097152"
            ></textarea>
            <p
              id="fileEditorStatus"
              role="status"
              data-server-file-edit-status
            ></p>
          </section>
          <footer
            class="modal-card-foot"
            style="justify-content:flex-end;"
          >
            <button
              class="button"
              type="button"
              data-server-file-close
            >
              Cancelar
            </button>
            <button
              class="button is-success"
              type="submit"
            >
              Guardar
            </button>
          </footer>
        </form>
      </div>
      <div
        class="modal"
        data-server-log-dialog
      >
        <div
          class="modal-background"
          data-server-log-close
        ></div>
        <div
          class="modal-card"
          style="width:85%;max-width:1200px;height:80vh;"
        >
          <header class="modal-card-head">
            <p class="modal-card-title">Log: <span data-server-log-path></span></p>
            <button
              class="delete"
              type="button"
              aria-label="Cerrar registro"
              data-server-log-close
            ></button>
          </header>
          <section
            class="modal-card-body"
            style="padding:0;"
          >
            <pre
              tabindex="0"
              data-server-log-content
              style="width:100%;height:65vh;font-family:'Battly Emoji','Courier New','Battly Emoji Sequences',monospace;font-size:12px;padding:15px;background:#1e1e1e;color:#d4d4d4;border:none;resize:none;overflow:auto;"
            ></pre>
          </section>
          <footer
            class="modal-card-foot"
            style="justify-content:flex-end;"
          >
            <button
              class="button"
              type="button"
              data-server-log-close
            >
              Cerrar
            </button>
          </footer>
        </div>
      </div>
      <div
        class="modal"
        data-server-share-dialog
        role="dialog"
        aria-modal="true"
        aria-labelledby="server-share-title"
      >
        <div
          class="modal-background"
          data-server-share-close
        ></div>
        <div
          class="modal-card"
          style="max-width:500px;background:linear-gradient(135deg,rgba(31,41,64,.98) 0%,rgba(18,24,38,.95) 100%);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,.1);border-radius:12px;"
        >
          <header
            class="modal-card-head"
            style="background:linear-gradient(135deg,rgba(62,142,208,.2) 0%,rgba(46,204,113,.1) 100%);border-bottom:1px solid rgba(255,255,255,.1);"
          >
            <p
              class="modal-card-title is-inter"
              id="server-share-title"
              style="color:#fff;font-weight:600;"
            >
              <i class="fa fa-share-alt"></i> Compartir Servidor
            </p>
            <button
              class="delete"
              type="button"
              aria-label="Cerrar"
              data-server-share-close
            ></button>
          </header>
          <section
            class="modal-card-body"
            style="background:transparent;max-height:500px;overflow-y:auto;"
          >
            <div class="field">
              <label
                class="label is-inter"
                style="color:rgba(255,255,255,.9);"
                >Buscar amigos</label
              >
              <div class="control has-icons-left">
                <input
                  class="input is-inter"
                  type="text"
                  maxlength="32"
                  placeholder="Buscar por nombre..."
                  data-server-friend-search
                  style="height:auto;background:rgba(44,52,70,.8);color:#fff;border:1px solid rgba(255,255,255,.1);"
                />
                <span class="icon is-left"><i class="fa fa-search"></i></span>
              </div>
            </div>
            <div
              data-server-friends-list
              style="margin-top:15px;"
            >
              <p
                class="is-inter"
                style="color:rgba(255,255,255,.7);text-align:center;padding:30px;"
              >
                Cargando amigos...
              </p>
            </div>
            <div
              style="margin-top:18px;padding-top:15px;border-top:1px solid rgba(255,255,255,.1);"
            >
              <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
                <div>
                  <strong
                    class="is-inter is-white"
                    data-server-tunnel-title
                    >Túnel inactivo</strong
                  >
                  <p
                    class="is-inter"
                    data-server-tunnel-detail
                    style="color:rgba(255,255,255,.7);font-size:.78rem;"
                  ></p>
                </div>
                <span data-server-tunnel-indicator></span>
                <button
                  type="button"
                  class="button is-small is-info is-inter"
                  data-server-tunnel-toggle
                >
                  Activar túnel
                </button>
              </div>
              <div
                data-server-tunnel-address
                hidden
                style="margin-top:8px;display:flex;gap:5px;"
              >
                <code
                  data-server-public-address
                  style="flex:1;"
                ></code
                ><button
                  type="button"
                  class="button is-small"
                  data-server-address-copy
                >
                  Copiar
                </button>
              </div>
              <div
                data-server-permissions-list
                style="margin-top:12px;"
              >
                <p
                  class="is-inter"
                  style="color:rgba(255,255,255,.7);"
                >
                  Todavía no hay invitaciones.
                </p>
              </div>
            </div>
            <p
              class="is-inter"
              role="status"
              data-server-share-status
              style="color:rgba(255,255,255,.8);margin-top:10px;"
            ></p>
          </section>
          <footer
            class="modal-card-foot"
            style="background:transparent;border-top:1px solid rgba(255,255,255,.1);"
          >
            <button
              class="button"
              type="button"
              data-server-share-close
              style="background:rgba(255,255,255,.1);color:#fff;border:1px solid rgba(255,255,255,.2);"
            >
              Cerrar
            </button>
          </footer>
        </div>
      </div>`,
  );
}

function data(element: HTMLElement, name: string): void {
  element.dataset[name] = '';
}

function selectedServer(): ServerSummary | undefined {
  return servers.find((server) => server.id === selectedId) ?? servers[0];
}

function sharingStatus(message: string): void {
  const status = document.querySelector<HTMLElement>('[data-server-share-status]');
  if (status) {
    status.textContent = message;
  }
}

function sharingError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback;
  }
  const detail =
    /Error invoking remote method '[^']+': Error: (.+)$/s.exec(error.message)?.[1] ?? error.message;
  return detail
    .replace('Battly Worlds /create-server failed', 'Battly Worlds no pudo registrar el servidor')
    .replace('Battly Worlds /create-tunnel failed', 'Battly Worlds no pudo crear el túnel');
}

function permissionSelect(value: ServerPermissionRole): HTMLSelectElement {
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Permiso de la invitación');
  for (const role of ['player', 'operator', 'viewer'] as const) {
    const option = document.createElement('option');
    option.value = role;
    option.textContent = permissionLabels[role];
    option.selected = role === value;
    select.append(option);
  }
  return select;
}

function renderServerSharing(snapshot: ServerSharingSnapshot): void {
  const server = selectedServer();
  if (!server) {
    return;
  }
  sharingSnapshots.set(server.id, snapshot);
  const indicator = document.querySelector<HTMLElement>('[data-server-tunnel-indicator]');
  const title = document.querySelector<HTMLElement>('[data-server-tunnel-title]');
  const detail = document.querySelector<HTMLElement>('[data-server-tunnel-detail]');
  const address = document.querySelector<HTMLElement>('[data-server-tunnel-address]');
  const addressText = document.querySelector<HTMLElement>('[data-server-public-address]');
  const toggle = document.querySelector<HTMLButtonElement>('[data-server-tunnel-toggle]');
  const runtime = runtimeSnapshots.get(server.id);
  if (indicator) {
    indicator.dataset.status = snapshot.tunnel.status;
  }
  if (title) {
    title.textContent =
      snapshot.tunnel.status === 'active'
        ? 'Túnel activo'
        : snapshot.tunnel.status === 'starting'
          ? 'Abriendo túnel…'
          : snapshot.tunnel.status === 'error'
            ? 'Error en el túnel'
            : 'Túnel inactivo';
  }
  if (detail) {
    detail.textContent =
      snapshot.tunnel.message ??
      (snapshot.tunnel.status === 'active'
        ? 'El proveedor ha confirmado el acceso externo.'
        : runtime?.status === 'running'
          ? 'El servidor está listo para publicar su puerto.'
          : 'Inicia el servidor antes de abrir el acceso externo.');
  }
  if (address) {
    address.hidden = !snapshot.tunnel.publicAddress;
  }
  if (addressText) {
    addressText.textContent = snapshot.tunnel.publicAddress ?? '';
  }
  if (toggle) {
    toggle.textContent = snapshot.tunnel.status === 'active' ? 'Cerrar túnel' : 'Activar túnel';
    toggle.disabled =
      snapshot.tunnel.status === 'starting' ||
      (snapshot.tunnel.status !== 'active' && runtime?.status !== 'running');
  }
  const friends = document.querySelector<HTMLElement>('[data-server-friends-list]');
  const query =
    document
      .querySelector<HTMLInputElement>('[data-server-friend-search]')
      ?.value.trim()
      .toLowerCase() ?? '';
  const visibleFriends = snapshot.friends.filter(
    (friend) => friend.status !== 'offline' && friend.username.toLowerCase().includes(query),
  );
  if (friends) {
    if (!visibleFriends.length) {
      const empty = document.createElement('p');
      empty.textContent = query ? 'No hay coincidencias.' : 'No hay amigos conectados.';
      friends.replaceChildren(empty);
    } else {
      friends.replaceChildren(
        ...visibleFriends.map((friend) => {
          const row = document.createElement('article');
          row.className = 'share-friend-card';
          row.dataset.friendName = friend.username;
          const avatar = document.createElement('img');
          avatar.className = 'share-friend-avatar';
          avatar.src = `https://mc-heads.net/avatar/${encodeURIComponent(friend.username)}/64`;
          avatar.onerror = () => {
            avatar.onerror = null;
            avatar.src = fallbackFriendAvatar;
          };
          avatar.alt = friend.username;
          const identity = document.createElement('div');
          identity.className = 'share-friend-info';
          const name = document.createElement('strong');
          const presence = document.createElement('span');
          name.className = 'share-friend-name is-inter';
          presence.className = 'share-friend-status is-inter';
          name.textContent = friend.username;
          const dot = document.createElement('span');
          dot.className = 'share-friend-status-dot';
          presence.append(dot, friend.status === 'ingame' ? ' Jugando' : ' En línea');
          identity.append(name, presence);
          const select = permissionSelect('player');
          select.hidden = true;
          const invite = document.createElement('button');
          invite.type = 'button';
          invite.className = 'button is-small share-friend-btn is-inter';
          invite.innerHTML = '<i class="fa fa-paper-plane"></i> Invitar';
          invite.dataset.serverInvite = friend.username;
          invite.disabled = snapshot.tunnel.status !== 'active';
          row.append(avatar, identity, select, invite);
          return row;
        }),
      );
    }
  }
  const permissions = document.querySelector<HTMLElement>('[data-server-permissions-list]');
  if (permissions) {
    if (!snapshot.permissions.length) {
      const empty = document.createElement('p');
      empty.textContent = 'Todavía no hay invitaciones.';
      permissions.replaceChildren(empty);
    } else {
      permissions.replaceChildren(
        ...snapshot.permissions.map((permission) => {
          const row = document.createElement('article');
          row.className = 'server-share-entry';
          const identity = document.createElement('div');
          const name = document.createElement('strong');
          const role = document.createElement('span');
          name.textContent = permission.username;
          const roleLabel = document.createElement('span');
          setUiText(roleLabel, permissionLabels[permission.role]);
          const updatedAt = document.createElement('time');
          updatedAt.dateTime = permission.updatedAt;
          updatedAt.setAttribute('translate', 'no');
          updatedAt.textContent = new Date(permission.updatedAt).toLocaleString(
            document.documentElement.lang || 'es',
          );
          role.append(roleLabel, ' · ', updatedAt);
          identity.append(name, role);
          const revoke = document.createElement('button');
          revoke.type = 'button';
          revoke.className = 'button is-small is-danger';
          revoke.textContent = 'Revocar';
          revoke.dataset.serverPermissionRevoke = permission.username;
          row.append(identity, revoke);
          return row;
        }),
      );
    }
  }
}

function openServerSharing(): void {
  const server = selectedServer();
  const dialog = document.querySelector<HTMLElement>('[data-server-share-dialog]');
  if (!server || !dialog) {
    return;
  }
  sharingStatus('Cargando amigos y permisos…');
  dialog.classList.add('is-active');
  void window.battly
    .getServerSharing(server.id)
    .then((snapshot) => {
      if (selectedId !== server.id) {
        return;
      }
      renderServerSharing(snapshot);
      sharingStatus('');
    })
    .catch((error: unknown) => {
      sharingStatus(sharingError(error, 'Selecciona una cuenta de Battly.'));
    });
}

function input<T extends HTMLInputElement | HTMLSelectElement>(name: string): T | null {
  return document.querySelector<T>(`[data-server-properties-form] [name="${name}"]`);
}

function renderProperties(properties: ServerProperties): void {
  const values: Record<string, string | number | boolean> = {
    maxCpuPercent: 100,
    viewDistance: '',
    simulationDistance: '',
    ...properties,
  };
  for (const [name, value] of Object.entries(values)) {
    const element = input(name);
    if (!element) {
      continue;
    }
    if (element instanceof HTMLInputElement && element.type === 'checkbox') {
      element.checked = value === true;
      const toggle = element.previousElementSibling;
      if (toggle instanceof HTMLButtonElement) {
        toggle.classList.toggle('b-servers-check-toggle', element.checked);
        toggle.classList.toggle('b-servers-cross-toggle', !element.checked);
        toggle.setAttribute('aria-pressed', String(element.checked));
        const icon = toggle.querySelector('i');
        icon?.classList.toggle('fa-check', element.checked);
        icon?.classList.toggle('fa-times', !element.checked);
      }
    } else {
      element.value = String(value);
    }
    updateLegacyPropertyMeta(element);
  }
}

function renderRuntime(snapshot: ServerRuntimeSnapshot): void {
  runtimeSnapshots.set(snapshot.id, snapshot);
  if (snapshot.id !== selectedServer()?.id) {
    return;
  }
  const server = selectedServer();
  const active = snapshot.status === 'running';
  const busy = snapshot.status === 'starting' || snapshot.status === 'stopping';
  const state = document.querySelector<HTMLElement>('[data-server-state]');
  const consoleState = document.querySelector<HTMLElement>('[data-server-console-state]');
  if (state) {
    state.textContent = statusLabels[snapshot.status];
    state.dataset.status = snapshot.status;
  }
  if (consoleState) {
    consoleState.textContent = active
      ? `PID ${snapshot.pid ?? '—'}`
      : statusLabels[snapshot.status];
  }
  const toggle = document.querySelector<HTMLButtonElement>('[data-server-runtime="toggle"]');
  if (toggle) {
    toggle.disabled = snapshot.status === 'stopping' || installingServers.has(snapshot.id);
    toggle.innerHTML =
      active || snapshot.status === 'starting'
        ? '<i class="fa-solid fa-stop" aria-hidden="true"></i> Detener servidor'
        : '<i class="fa-solid fa-play" aria-hidden="true"></i> Iniciar servidor';
  }
  const restart = document.querySelector<HTMLButtonElement>('[data-server-runtime="restart"]');
  if (restart) {
    restart.disabled = !active;
  }
  const install = document.querySelector<HTMLButtonElement>('[data-server-install]');
  if (install) {
    install.disabled = busy || active || installingServers.has(snapshot.id);
  }
  const command = document.querySelector<HTMLInputElement>('[data-server-command-form] input');
  const send = document.querySelector<HTMLButtonElement>('[data-server-command-form] button');
  if (command) {
    command.disabled = !active;
  }
  if (send) {
    send.disabled = !active;
  }
  document
    .querySelectorAll<HTMLButtonElement>(
      '[data-server-content-import], [data-server-content-action], [data-server-software], [data-server-modpack-import]',
    )
    .forEach((button) => {
      button.disabled = active || busy || installingServers.has(snapshot.id);
    });
  const notice = document.querySelector<HTMLElement>('.server-runtime-notice');
  if (notice && notice.dataset.runtimeStatus !== snapshot.status) {
    notice.dataset.runtimeStatus = snapshot.status;
    setUiText(notice, runtimeNoticeMessages[snapshot.status]);
  }

  const cpu = document.querySelector<HTMLElement>('[data-server-cpu]');
  const cpuProgress = document.querySelector<HTMLProgressElement>('[data-server-cpu-progress]');
  const memory = document.querySelector<HTMLElement>('[data-server-memory]');
  const memoryProgress = document.querySelector<HTMLProgressElement>(
    '[data-server-memory-progress]',
  );
  const players = document.querySelector<HTMLElement>('[data-server-players]');
  const playersProgress = document.querySelector<HTMLProgressElement>(
    '[data-server-players-progress]',
  );
  if (cpu) {
    cpu.textContent = `${snapshot.cpuPercent.toFixed(1)}%`;
  }
  if (cpuProgress) {
    cpuProgress.value = snapshot.cpuPercent;
  }
  if (memory) {
    memory.textContent = `${snapshot.memoryMb} MB`;
  }
  if (memoryProgress) {
    memoryProgress.value = snapshot.memoryMb;
    memoryProgress.max = server?.properties.maxMemoryMb ?? Math.max(1, snapshot.memoryMb);
  }
  if (players) {
    players.textContent = `${snapshot.players} / ${snapshot.maxPlayers}`;
  }
  if (playersProgress) {
    playersProgress.value = snapshot.players;
    playersProgress.max = Math.max(1, snapshot.maxPlayers);
  }
  const output = document.querySelector<HTMLOutputElement>('[data-server-console]');
  if (output) {
    const filter =
      document.querySelector<HTMLInputElement>('#searchConsole')?.value.toLowerCase() ?? '';
    const lines = (runtimeLogs.get(snapshot.id) ?? []).filter((line) =>
      line.toLowerCase().includes(filter),
    );
    const atEnd = output.scrollHeight - output.scrollTop - output.clientHeight < 30;
    renderLogLines(
      output,
      lines.length
        ? lines.join('\n')
        : active
          ? 'Servidor iniciado. Esperando registros…'
          : 'Servidor detenido. No hay registros de ejecución.',
    );
    if (atEnd) {
      output.scrollTop = output.scrollHeight;
    }
  }
  renderServerCharts(snapshot);
  renderOnlineServerPlayers(snapshot);
  const connect = document.querySelector<HTMLButtonElement>('[data-server-connect]');
  if (connect) {
    connect.disabled = !active;
  }
  const sharing = sharingSnapshots.get(snapshot.id);
  if (
    sharing &&
    document
      .querySelector<HTMLElement>('[data-server-share-dialog]')
      ?.classList.contains('is-active')
  ) {
    renderServerSharing(sharing);
  }
}

function renderInstall(progress: ServerInstallProgress): void {
  installProgress.set(progress.id, progress);
  installationDialog?.update(progress);
  if (progress.id !== selectedServer()?.id) {
    return;
  }
  const installation = document.querySelector<HTMLElement>('[data-server-installation]');
  if (installation) {
    installation.hidden = progress.phase === 'complete';
  }
  const current = document.querySelector<HTMLElement>('[data-server-install-current]');
  const bar = document.querySelector<HTMLProgressElement>('[data-server-install-progress]');
  const button = document.querySelector<HTMLButtonElement>('[data-server-install]');
  const percent =
    progress.totalBytes > 0
      ? Math.min(100, Math.round((progress.completedBytes / progress.totalBytes) * 100))
      : null;
  if (current) {
    current.textContent =
      progress.phase === 'complete'
        ? 'server.jar y Java están listos para iniciar.'
        : `${progress.current}${percent === null ? '' : ` · ${percent}%`}`;
  }
  if (bar) {
    if (percent === null) {
      bar.removeAttribute('value');
    } else {
      bar.value = percent;
    }
  }
  if (button) {
    button.disabled = progress.phase !== 'complete' || installingServers.has(progress.id);
    if (progress.phase === 'complete') {
      button.innerHTML =
        '<i class="fa-solid fa-rotate" aria-hidden="true"></i> Reinstalar archivos';
    }
  }
}

function playerAction(
  player: ServerPlayerEntry,
  kind: ServerPlayerListKind,
  action: 'add' | 'remove',
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.serverPlayerAction = action;
  button.dataset.serverPlayerKind = kind;
  button.dataset.playerName = player.name;
  button.dataset.playerUuid = player.uuid;
  button.className = 'button is-small';
  const icon = document.createElement('i');
  icon.className = 'fa';
  if (kind === 'banned') {
    button.classList.add(action === 'add' ? 'is-danger' : 'is-link');
    icon.classList.add(action === 'add' ? 'fa-ban' : 'fa-undo');
    button.append(icon, ` ${action === 'add' ? 'Banear' : 'Desbanear'}`);
  } else if (kind === 'whitelist') {
    button.classList.add('is-success');
    icon.classList.add('fa-user-check');
    button.append(icon, action === 'add' ? ' Whitelist' : ' Quitar de whitelist');
  } else if (kind === 'blacklist') {
    button.classList.add('is-warning');
    icon.classList.add('fa-user-times');
    button.append(icon, action === 'add' ? ' Blacklist' : ' Quitar de blacklist');
  } else {
    icon.classList.add('fa-shield');
    button.append(icon, ` ${action === 'add' ? 'Dar OP' : 'Quitar OP'}`);
  }
  return button;
}

function formatServerPlayerDate(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  // Minecraft writes dates as "yyyy-MM-dd HH:mm:ss +HHmm".
  const normalized = value
    .trim()
    .replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/, '$1T$2$3:$4');
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime())) {
    return '—';
  }
  return new Intl.DateTimeFormat(document.documentElement.lang || 'es', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function renderLegacyPlayerTable(
  selector: string,
  entries: readonly ServerPlayerEntry[],
  kind: ServerPlayerListKind,
): void {
  const body = document.querySelector<HTMLTableSectionElement>(selector);
  if (!body) {
    return;
  }
  if (!entries.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 3;
    cell.className = 'has-text-centered';
    setUiText(cell, emptyPlayerListMessages[kind]);
    row.append(cell);
    body.replaceChildren(row);
    return;
  }
  body.replaceChildren(
    ...entries.map((player) => {
      const row = document.createElement('tr');
      const name = document.createElement('td');
      const created = document.createElement('td');
      name.textContent = player.name;
      created.textContent = formatServerPlayerDate(player.created);
      const actionsCell = document.createElement('td');
      const actions = document.createElement('div');
      actions.className = 'server-file-actions';
      actionsCell.append(actions);
      const kind: ServerPlayerListKind = selector.includes('banlist')
        ? 'banned'
        : selector.includes('blacklist')
          ? 'blacklist'
          : 'whitelist';
      actions.append(playerAction(player, kind, 'remove'));
      row.append(name, created, actionsCell);
      return row;
    }),
  );
}

function renderPlayerLists(snapshot: ServerPlayerListsSnapshot): void {
  const server = selectedServer();
  if (!server) {
    return;
  }
  playerSnapshots.set(server.id, snapshot);
  const legacyHistory = document.querySelector<HTMLElement>('#historico .columns');
  if (legacyHistory) {
    legacyHistory.replaceChildren(
      ...snapshot.history.map((player) => {
        const column = document.createElement('div');
        column.className = 'column is-6 b-servers-column';
        column.dataset.uuid = player.uuid;
        const card = document.createElement('div');
        card.className = 'b-servers-player-card';
        const avatar = document.createElement('div');
        avatar.className = 'b-servers-player-avatar';
        const image = document.createElement('img');
        image.src = `https://mc-heads.net/avatar/${encodeURIComponent(player.name)}/64`;
        image.alt = player.name;
        avatar.append(image);
        const info = document.createElement('div');
        info.className = 'b-servers-player-info';
        const name = document.createElement('h4');
        name.className = 'b-servers-player-name is-white';
        name.textContent = player.name;
        const subtitle = document.createElement('p');
        subtitle.className = 'b-servers-player-subtitle';
        subtitle.textContent = `Unido el: ${formatServerPlayerDate(player.created)}`;
        info.append(name, subtitle);
        const actions = document.createElement('div');
        actions.className = 'b-servers-player-actions';
        for (const kind of ['banned', 'whitelist', 'blacklist', 'operators'] as const) {
          const present = snapshot.lists[kind].some((entry) => entry.uuid === player.uuid);
          actions.append(playerAction(player, kind, present ? 'remove' : 'add'));
        }
        card.append(avatar, info, actions);
        column.append(card);
        return column;
      }),
    );
  }
  renderLegacyPlayerTable('#banlistTableBody', snapshot.lists.banned, 'banned');
  renderLegacyPlayerTable('#blacklistTableBody', snapshot.lists.blacklist, 'blacklist');
  renderLegacyPlayerTable('#whitelistTableBody', snapshot.lists.whitelist, 'whitelist');
  const history = document.querySelector<HTMLElement>('[data-server-player-history]');
  if (history) {
    if (!snapshot.history.length) {
      const empty = document.createElement('p');
      empty.textContent = 'El servidor todavía no ha registrado jugadores en usercache.json.';
      history.replaceChildren(empty);
    } else {
      history.replaceChildren(
        ...snapshot.history.map((player) => {
          const card = document.createElement('article');
          const identity = document.createElement('div');
          const name = document.createElement('strong');
          const uuid = document.createElement('span');
          name.textContent = player.name;
          uuid.textContent = player.uuid;
          identity.append(name, uuid);
          const actions = document.createElement('div');
          for (const kind of ['banned', 'whitelist', 'blacklist', 'operators'] as const) {
            const present = snapshot.lists[kind].some((entry) => entry.uuid === player.uuid);
            actions.append(playerAction(player, kind, present ? 'remove' : 'add'));
          }
          card.append(identity, actions);
          return card;
        }),
      );
    }
  }
  document.querySelectorAll<HTMLButtonElement>('[data-server-player-kind]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.serverPlayerKind === selectedPlayerKind);
  });
  const list = document.querySelector<HTMLElement>('[data-server-player-list]');
  if (!list) {
    return;
  }
  const entries = snapshot.lists[selectedPlayerKind];
  if (!entries.length) {
    const empty = document.createElement('p');
    setUiText(empty, emptyPlayerListMessages[selectedPlayerKind]);
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(
    ...entries.map((player) => {
      const row = document.createElement('article');
      const identity = document.createElement('div');
      const name = document.createElement('strong');
      const detail = document.createElement('span');
      name.textContent = player.name;
      detail.textContent = player.created ?? player.uuid;
      identity.append(name, detail);
      row.append(identity, playerAction(player, selectedPlayerKind, 'remove'));
      return row;
    }),
  );
}

function loadPlayerLists(): void {
  const server = selectedServer();
  if (!server) {
    return;
  }
  void window.battly
    .getServerPlayerLists(server.id)
    .then((snapshot) => {
      if (selectedId === server.id) {
        renderPlayerLists(snapshot);
      }
    })
    .catch(() => {
      const status = document.querySelector<HTMLElement>('[data-server-player-status]');
      if (status) {
        status.textContent = 'No se pudieron leer las listas del servidor.';
      }
    });
}

function fileSize(bytes: number | null): string {
  if (bytes === null) {
    return '—';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function contentCacheKey(id: string, kind: ServerContentKind): string {
  return `${id}:${kind}`;
}

function renderServerContent(
  kind: ServerContentKind,
  entries: readonly ServerContentEntry[],
): void {
  const server = selectedServer();
  if (!server) {
    return;
  }
  serverContent.set(contentCacheKey(server.id, kind), entries);
  const count = document.querySelector<HTMLElement>(`[data-server-content-count="${kind}"]`);
  const list = document.querySelector<HTMLElement>(`[data-server-content-list="${kind}"]`);
  if (count) {
    count.textContent = `${entries.length} ${entries.length === 1 ? 'archivo' : 'archivos'}`;
  }
  if (!list) {
    return;
  }
  if (!entries.length) {
    const empty = document.createElement('p');
    empty.textContent = kind === 'mods' ? 'No hay mods importados.' : 'No hay plugins importados.';
    list.replaceChildren(empty);
    return;
  }
  const runtime = runtimeSnapshots.get(server.id);
  const mutationsDisabled = runtime ? !['stopped', 'error'].includes(runtime.status) : false;
  list.replaceChildren(
    ...entries.map((entry) => {
      const row = document.createElement('div');
      row.style.cssText = `display:flex;align-items:center;gap:8px;margin-top:7px;${entry.enabled ? '' : 'opacity:.55;'}`;
      const detail = document.createElement('div');
      detail.style.cssText = 'display:grid;min-width:0;flex:1;';
      const name = document.createElement('strong');
      const metadata = document.createElement('span');
      name.style.cssText = 'color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      metadata.style.cssText = 'color:rgba(255,255,255,.75);font-size:.72rem;';
      name.textContent = entry.name;
      const enabledLabel = document.createElement('span');
      setUiText(enabledLabel, entry.enabled ? 'Activado' : 'Desactivado');
      const fileMetadata = document.createElement('span');
      fileMetadata.setAttribute('translate', 'no');
      fileMetadata.textContent = ` · ${fileSize(entry.size)} · ${new Date(entry.modifiedAt).toLocaleString(document.documentElement.lang || 'es')}`;
      metadata.append(enabledLabel, fileMetadata);
      detail.append(name, metadata);
      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:5px;';
      const toggle = document.createElement('button');
      const archive = document.createElement('button');
      toggle.type = archive.type = 'button';
      toggle.className = 'button is-small is-info';
      archive.className = 'button is-small is-danger';
      toggle.title = entry.enabled ? 'Desactivar' : 'Activar';
      archive.title = 'Eliminar';
      toggle.innerHTML = `<i class="fa ${entry.enabled ? 'fa-toggle-on' : 'fa-toggle-off'}"></i>`;
      archive.innerHTML = '<i class="fa fa-trash-alt"></i>';
      toggle.dataset.serverContentAction = 'toggle';
      archive.dataset.serverContentAction = 'archive';
      toggle.dataset.serverContentItemKind = archive.dataset.serverContentItemKind = kind;
      toggle.dataset.serverContentName = archive.dataset.serverContentName = entry.name;
      toggle.disabled = archive.disabled = mutationsDisabled;
      actions.append(toggle, archive);
      row.append(detail, actions);
      return row;
    }),
  );
}

function loadServerContent(): void {
  const server = selectedServer();
  if (!server) {
    return;
  }
  const status = document.querySelector<HTMLElement>('[data-server-content-status]');
  if (status) {
    status.textContent = 'Cargando mods y plugins…';
  }
  void Promise.all(
    (['mods', 'plugins'] as const).map(async (kind) => {
      const entries = await window.battly.getServerContent(server.id, kind);
      if (selectedId === server.id) {
        renderServerContent(kind, entries);
      }
    }),
  )
    .then(() => {
      if (status) {
        status.textContent = '';
      }
    })
    .catch(() => {
      if (status) {
        status.textContent = 'No se pudo leer el contenido del servidor.';
      }
    });
}

function fileAction(
  entry: ServerFileEntry,
  action: 'archive' | 'edit' | 'reveal' | 'export',
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.serverFileAction = action;
  button.dataset.serverFilePath = entry.path;
  button.className = `button is-small ${
    action === 'archive' ? 'is-danger' : action === 'edit' ? 'is-success' : 'is-info'
  }`;
  button.title =
    action === 'archive'
      ? 'Eliminar'
      : action === 'edit'
        ? 'Editar'
        : action === 'export'
          ? 'Guardar archivo'
          : 'Mostrar en carpeta';
  button.setAttribute('aria-label', button.title);
  const icon = document.createElement('i');
  icon.className = `fa ${
    action === 'archive'
      ? 'fa-trash-alt'
      : action === 'edit'
        ? 'fa-edit'
        : action === 'export'
          ? 'fa-download'
          : 'fa-folder-open'
  }`;
  icon.setAttribute('aria-hidden', 'true');
  button.append(icon);
  return button;
}

function serverFileIcon(entry: ServerFileEntry): string {
  if (entry.type === 'directory') {
    return 'fa-folder';
  }
  const extension = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
  if (extension === '.zip' || extension === '.jar') {
    return 'fa-file-archive';
  }
  if (extension === '.json') {
    return 'fa-file-code';
  }
  return 'fa-file-alt';
}

function renderServerFiles(entries: readonly ServerFileEntry[]): void {
  const list = document.querySelector<HTMLTableSectionElement>('[data-server-file-list]');
  const path = document.querySelector<HTMLElement>('[data-server-file-path]');
  const up = document.querySelector<HTMLButtonElement>('[data-server-file-up]');
  if (path) {
    path.textContent = currentFilePath ? `/${currentFilePath}` : '/';
  }
  if (up) {
    up.disabled = !currentFilePath;
  }
  if (!list) {
    return;
  }
  if (!entries.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 4;
    cell.textContent = 'Este directorio está vacío.';
    row.append(cell);
    list.replaceChildren(row);
    return;
  }
  list.replaceChildren(
    ...entries.map((entry) => {
      const row = document.createElement('tr');
      const name = document.createElement('td');
      const size = document.createElement('td');
      const modified = document.createElement('td');
      const actionsCell = document.createElement('td');
      const actions = document.createElement('div');
      actions.className = 'server-file-actions';
      actionsCell.append(actions);
      const icon = document.createElement('i');
      icon.className = `fa ${serverFileIcon(entry)}`;
      icon.setAttribute('aria-hidden', 'true');
      name.append(icon, document.createTextNode(` ${entry.name}`));
      size.textContent = fileSize(entry.size);
      modified.textContent = new Date(entry.modifiedAt).toLocaleString(
        document.documentElement.lang || 'es',
      );
      actions.style.display = 'flex';
      actions.style.gap = '5px';
      if (entry.type === 'directory') {
        row.dataset.serverFileDirectory = entry.path;
        row.style.cursor = 'pointer';
      } else {
        actions.append(fileAction(entry, 'export'), fileAction(entry, 'reveal'));
        if (entry.editable) {
          actions.append(fileAction(entry, 'edit'));
        }
      }
      actions.append(fileAction(entry, 'archive'));
      row.append(name, size, modified, actionsCell);
      return row;
    }),
  );
}

function loadServerFiles(path = currentFilePath, completedStatus = ''): void {
  const server = selectedServer();
  if (!server) {
    return;
  }
  const status = document.querySelector<HTMLElement>('[data-server-file-status]');
  if (status) {
    status.textContent = 'Cargando archivos…';
  }
  void window.battly
    .listServerFiles(server.id, path)
    .then((entries) => {
      if (selectedId !== server.id) {
        return;
      }
      currentFilePath = path;
      renderServerFiles(entries);
      if (status) {
        status.textContent = completedStatus;
      }
    })
    .catch(() => {
      if (status) {
        status.textContent = 'No se pudo abrir este directorio.';
      }
    });
}

function renderServerLogs(entries: readonly ServerFileEntry[]): void {
  const list = document.querySelector<HTMLElement>('[data-server-log-list]');
  if (!list) {
    return;
  }
  const logs = entries.filter(
    (entry) =>
      entry.type === 'file' &&
      (entry.name.endsWith('.log') ||
        entry.name.endsWith('.txt') ||
        entry.name.endsWith('.log.gz')),
  );
  if (!logs.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No hay registros persistidos.';
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(
    ...logs.map((entry) => {
      const row = document.createElement('article');
      const detail = document.createElement('div');
      const name = document.createElement('strong');
      const metadata = document.createElement('span');
      name.textContent = entry.name;
      metadata.textContent = `${fileSize(entry.size)} · ${new Date(entry.modifiedAt).toLocaleString(document.documentElement.lang || 'es')}`;
      detail.append(name, metadata);
      const actions = document.createElement('div');
      const view = document.createElement('button');
      const reveal = document.createElement('button');
      view.type = reveal.type = 'button';
      view.innerHTML = '<i class="fa fa-eye" aria-hidden="true"></i> Ver';
      reveal.innerHTML = '<i class="fa fa-folder-open" aria-hidden="true"></i> Mostrar';
      view.dataset.serverLogAction = 'view';
      reveal.dataset.serverLogAction = 'reveal';
      view.dataset.serverLogPath = reveal.dataset.serverLogPath = entry.path;
      actions.append(view, reveal);
      row.append(detail, actions);
      return row;
    }),
  );
}

function loadServerLogs(): void {
  const server = selectedServer();
  if (!server) {
    return;
  }
  const status = document.querySelector<HTMLElement>('[data-server-log-status]');
  if (status) {
    status.textContent = 'Cargando registros…';
  }
  void window.battly
    .listServerFiles(server.id, 'logs')
    .then((entries) => {
      if (selectedId !== server.id) {
        return;
      }
      renderServerLogs(entries);
      if (status) {
        status.textContent = '';
      }
    })
    .catch(() => {
      renderServerLogs([]);
      if (status) {
        status.textContent = '';
      }
    });
}

function renderServers(next: readonly ServerSummary[]): void {
  servers = next;
  if (!servers.some((server) => server.id === selectedId)) {
    selectedId = servers[0]?.id ?? '';
  }
  const create = document.querySelector<HTMLElement>('[data-server-create-view]');
  const dashboard = document.querySelector<HTMLElement>('[data-server-dashboard]');
  const loading = document.querySelector<HTMLElement>('.fullscreen-text-div');
  if (loading) {
    loading.style.display = 'none';
  }
  if (create) {
    create.hidden = servers.length > 0;
    create.style.display = servers.length ? 'none' : 'flex';
  }
  if (dashboard) {
    dashboard.hidden = servers.length === 0;
    dashboard.style.display = servers.length ? 'flex' : 'none';
  }
  const picker = document.querySelector<HTMLSelectElement>('[data-server-picker]');
  serversTutorial?.refresh();
  picker?.replaceChildren(
    ...servers.map((server) => {
      const option = document.createElement('option');
      option.value = server.id;
      option.textContent = server.name;
      option.selected = server.id === selectedId;
      return option;
    }),
  );
  const createOption = new Option(serverSlotText('add'), '__create-server__');
  createOption.dataset.serverNew = '';
  picker?.add(createOption);
  const server = selectedServer();
  if (!server) {
    return;
  }
  selectedId = server.id;
  const title = document.querySelector<HTMLElement>('[data-server-title]');
  if (title) {
    const name = document.createElement('strong');
    name.textContent = server.name;
    const address = document.createElement('span');
    address.className = 'server-address-tag';
    address.textContent = `${server.domain}.battlyservers.net`;
    const tags = document.createElement('span');
    tags.className = 'server-identity-tags';
    tags.append(address);
    const notice = title.querySelector<HTMLElement>('.server-runtime-notice');
    if (notice) {
      const status = runtimeSnapshots.get(server.id)?.status ?? 'stopped';
      notice.dataset.runtimeStatus = status;
      setUiText(notice, runtimeNoticeMessages[status]);
      tags.append(notice);
    }
    title.replaceChildren(name, tags);
  }
  const state = document.querySelector<HTMLElement>('[data-server-state]');
  if (state) {
    state.textContent = statusLabels[runtimeSnapshots.get(server.id)?.status ?? 'stopped'];
  }
  void refreshPanelSoftware(server);
  renderProperties(server.properties);
  const existingRuntime = runtimeSnapshots.get(server.id);
  if (existingRuntime) {
    renderRuntime(existingRuntime);
  } else {
    void window.battly
      .getServerRuntime(server.id)
      .then(renderRuntime)
      .catch(() => {
        if (selectedId === server.id && state) {
          state.textContent = 'No se pudo consultar el estado';
        }
      });
  }
  const existingInstall = installProgress.get(server.id);
  if (existingInstall) {
    renderInstall(existingInstall);
  } else if (server.software.installedAt) {
    renderInstall({
      completedBytes: 1,
      current: `${softwareLabels[server.software.kind]} instalado`,
      id: server.id,
      phase: 'complete',
      totalBytes: 1,
    });
  }
  const softwareName = document.querySelector<HTMLElement>('[data-server-software-current]');
  const softwareDetail = document.querySelector<HTMLElement>('[data-server-software-detail]');
  const softwareState = document.querySelector<HTMLElement>('[data-server-software-state]');
  if (softwareName) {
    softwareName.textContent = softwareLabels[server.software.kind];
  }
  if (softwareDetail) {
    softwareDetail.textContent = server.software.installedAt
      ? `${server.software.gameVersion ?? server.version} · build ${server.software.build ?? 'estable'}`
      : 'Todavía no se ha instalado este software.';
  }
  if (softwareState) {
    softwareState.textContent = server.software.installedAt ? 'Instalado' : 'Sin instalar';
  }
  document.querySelectorAll<HTMLButtonElement>('[data-server-software]').forEach((button) => {
    const kind = button.dataset.serverSoftware as ServerSoftwareKind;
    const label = button.parentElement?.querySelector('span');
    if (label) {
      const target = kind === 'paper' ? paperMinecraftVersion(server.version) : server.version;
      label.textContent =
        target !== server.version
          ? `${softwareLabels[kind]} · Minecraft ${target} · clientes ${server.version}`
          : `${softwareLabels[kind]} · Minecraft ${target}`;
    }
    button.innerHTML =
      kind === server.software.kind
        ? '<i class="fas fa-rotate" aria-hidden="true"></i> Reinstalar'
        : '<i class="fas fa-download" aria-hidden="true"></i> Instalar';
    button.classList.toggle('is-current', kind === server.software.kind);
  });
}

function propertiesDraft(): ServerProperties {
  const number = (name: string): number => Number(input<HTMLInputElement>(name)?.value);
  const checked = (name: string): boolean => input<HTMLInputElement>(name)?.checked ?? false;
  const value = (name: string): string => input(name)?.value ?? '';
  return {
    ...(value('viewDistance') ? { viewDistance: number('viewDistance') } : {}),
    ...(value('simulationDistance') ? { simulationDistance: number('simulationDistance') } : {}),
    maxPlayers: number('maxPlayers'),
    maxMemoryMb: number('maxMemoryMb'),
    maxCpuPercent: number('maxCpuPercent'),
    gamemode: value('gamemode') as ServerProperties['gamemode'],
    difficulty: value('difficulty') as ServerProperties['difficulty'],
    spawnProtection: number('spawnProtection'),
    pvp: checked('pvp'),
    spawnAnimals: checked('spawnAnimals'),
    allowNether: checked('allowNether'),
    enableCommandBlock: checked('enableCommandBlock'),
    spawnMonsters: checked('spawnMonsters'),
    forceGamemode: checked('forceGamemode'),
    whitelist: checked('whitelist'),
    resourcePack: value('resourcePack'),
    resourcePackPrompt: value('resourcePackPrompt'),
  };
}

function updateLegacyPropertyMeta(control: HTMLInputElement | HTMLSelectElement): void {
  const metadata: Readonly<Record<string, readonly [string, string, string]>> = {
    maxPlayers: ['maxPlayersMeta', 'max-players', ''],
    maxMemoryMb: ['maxRamMeta', 'max-memory', 'MB'],
    gamemode: ['gamemodeMeta', 'gamemode', ''],
    difficulty: ['difficultyMeta', 'difficulty', ''],
    spawnProtection: ['spawnProtectionMeta', 'spawn-protection', ''],
    pvp: ['pvpMeta', 'pvp', ''],
    spawnAnimals: ['animalsMeta', 'spawn-animals', ''],
    allowNether: ['netherMeta', 'allow-nether', ''],
    enableCommandBlock: ['cmdBlocksMeta', 'enable-command-block', ''],
    spawnMonsters: ['mobsMeta', 'spawn-monsters', ''],
    forceGamemode: ['forceGamemodeMeta', 'force-gamemode', ''],
    whitelist: ['whitelistMeta', 'white-list', ''],
    resourcePack: ['resourcePackMeta', 'resource-pack', ''],
    resourcePackPrompt: ['resourcePackPromptMeta', 'resource-pack-prompt', ''],
  };
  const entry = metadata[control.name];
  if (!entry) {
    return;
  }
  const [id, key, suffix] = entry;
  const value =
    control instanceof HTMLInputElement && control.type === 'checkbox'
      ? String(control.checked)
      : `${control.value}${suffix}`;
  const target = document.getElementById(id);
  if (target) {
    target.textContent = `${key}=${value}`;
  }
}

function formText(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === 'string' ? value : '';
}

async function installServerSoftware(
  software: ServerSoftwareKind,
  acceptCompatiblePaper = false,
  build?: string,
): Promise<void> {
  const server = selectedServer();
  if (!server || installingServers.has(server.id)) {
    return;
  }
  const verified = softwareAvailability.get(server.version);
  if (!verified?.available.includes(software)) {
    const status = document.querySelector<HTMLElement>('[data-server-content-status]');
    if (status) {
      status.textContent =
        verified?.unavailable[software] ??
        'Espera a que termine la comprobación de compatibilidad.';
    }
    return;
  }
  const paperVersion = paperMinecraftVersion(server.version);
  if (software === 'paper' && paperVersion !== server.version && !acceptCompatiblePaper) {
    void askBattly({
      text: `Paper no publica Minecraft ${server.version}. ¿Instalar Paper ${paperVersion}, compatible con clientes ${server.version}? El servidor ejecutará ${paperVersion}. Conserva una copia de tu mundo antes de cambiar de software.`,
    }).then((accepted) => {
      if (accepted && selectedServer()?.id === server.id) {
        void installServerSoftware(software, true);
      }
    });
    return;
  }

  installingServers.add(server.id);
  installationDialog?.open(server.id, server.name, Boolean(server.software.installedAt));
  const button = document.querySelector<HTMLButtonElement>('[data-server-install]');
  const current = document.querySelector<HTMLElement>('[data-server-install-current]');
  const softwareStatus = document.querySelector<HTMLElement>('[data-server-content-status]');
  if (button) {
    button.disabled = true;
  }
  const runtimeToggle = document.querySelector<HTMLButtonElement>('[data-server-runtime="toggle"]');
  const runtimeRestart = document.querySelector<HTMLButtonElement>(
    '[data-server-runtime="restart"]',
  );
  if (runtimeToggle) {
    runtimeToggle.disabled = true;
  }
  if (runtimeRestart) {
    runtimeRestart.disabled = true;
  }
  document
    .querySelectorAll<HTMLButtonElement>('[data-server-software]')
    .forEach((candidate) => (candidate.disabled = true));
  if (current) {
    current.textContent = `Preparando ${software} y Java de forma aislada…`;
  }
  if (softwareStatus) {
    softwareStatus.textContent = `Instalando ${software}…`;
  }
  await window.battly
    .installServer(server.id, software, acceptCompatiblePaper, build)
    .then(() => window.battly.getServers())
    .then((next) => {
      renderServers(next);
      installationDialog?.finish(server.id);
      if (softwareStatus) {
        softwareStatus.textContent = `${software} instalado correctamente.`;
      }
    })
    .catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : 'Error desconocido';
      installationDialog?.fail(server.id, detail);
      if (current) {
        current.textContent = `No se pudieron instalar los archivos: ${detail}`;
      }
      if (softwareStatus) {
        softwareStatus.textContent = `No se pudo instalar ${software}: ${detail}`;
      }
    })
    .finally(() => {
      installingServers.delete(server.id);
      const snapshot = runtimeSnapshots.get(server.id);
      const enabled = !snapshot || ['stopped', 'error'].includes(snapshot.status);
      if (button && enabled) {
        button.disabled = false;
      }
      if (runtimeToggle) {
        runtimeToggle.disabled = !enabled;
      }
      if (runtimeRestart) {
        runtimeRestart.disabled = snapshot?.status !== 'running';
      }
      document
        .querySelectorAll<HTMLButtonElement>('[data-server-software]')
        .forEach((candidate) => (candidate.disabled = !enabled));
    });
}

export function mountServersPanel(
  launch?: (request: PlayVersionLaunchRequest, label: string) => void,
  home?: () => void,
): void {
  const mount = document.querySelector<HTMLElement>('[data-server-mount]');
  if (!mount) {
    return;
  }
  mount.innerHTML = serverMarkup.replace(
    'sandbox="allow-same-origin allow-scripts allow-popups allow-forms"',
    'sandbox=""',
  );
  annotateLegacyServers(mount);
  serversTutorial = mountServersTutorial(mount, () => Boolean(selectedServer()));
  const cancelCreation = mount.querySelector<HTMLButtonElement>(
    '#b-servers-cancel-server-creation',
  );
  if (cancelCreation) {
    cancelCreation.removeAttribute('data-panel');
    cancelCreation.onclick = () => {
      renderServers(servers);
      if (servers.length === 0) {
        home?.();
      }
    };
  }
  installationDialog ??= mountServerInstallationProgress();
  if (launch) {
    mountServerInvitations(launch);
  }
  document.querySelector<HTMLElement>('#jugadores > .columns')?.replaceChildren();
  document
    .querySelector<HTMLButtonElement>('[data-server-connect]')
    ?.addEventListener('click', () => {
      const server = selectedServer();
      if (!server || runtimeSnapshots.get(server.id)?.status !== 'running') {
        return;
      }
      const loader = ['forge', 'neoforge', 'fabric'].includes(server.software.kind)
        ? server.software.kind
        : 'vanilla';
      launch?.(
        {
          version: server.version,
          custom: false,
          customVersion: '',
          loader,
          loaderVersion: server.software.build || 'latest',
          requiredJavaVersion: '',
          safeMode: false,
          directConnect: { host: '127.0.0.1', port: server.port },
        },
        `Servidor ${server.domain}.battlyservers.net`,
      );
    });
  document.querySelector<HTMLInputElement>('#searchConsole')?.addEventListener('input', () => {
    const snapshot = runtimeSnapshots.get(selectedId);
    if (snapshot) {
      renderRuntime(snapshot);
    }
  });
  setupServerDomainValidation();
  document
    .querySelector('#versionSelectServers')
    ?.addEventListener('change', () => void refreshCreationSoftware());
  void populateServerVersions().then(refreshCreationSoftware);
  void refreshServerRegions();
  document
    .querySelector<HTMLButtonElement>('#b-servers-checkForLatency')
    ?.addEventListener('click', () => void refreshServerRegions());

  window.battly.onServerRuntimeEvent((event) => {
    if (event.type === 'snapshot') {
      renderRuntime(event.snapshot);
      return;
    }
    const lines = runtimeLogs.get(event.id) ?? [];
    lines.push(event.line);
    if (lines.length > 500) {
      lines.splice(0, lines.length - 500);
    }
    runtimeLogs.set(event.id, lines);
    if (event.id === selectedId && runtimeLogFrame === undefined) {
      runtimeLogFrame = requestAnimationFrame(() => {
        runtimeLogFrame = undefined;
        const snapshot = runtimeSnapshots.get(selectedId);
        if (snapshot) {
          renderRuntime(snapshot);
        }
      });
    }
  });
  window.battly.onServerInstallProgress(renderInstall);

  document
    .querySelector<HTMLButtonElement>('[data-server-share]')
    ?.addEventListener('click', openServerSharing);
  document.querySelectorAll<HTMLButtonElement>('[data-server-share-close]').forEach((button) => {
    button.addEventListener('click', () =>
      document
        .querySelector<HTMLElement>('[data-server-share-dialog]')
        ?.classList.remove('is-active'),
    );
  });
  document
    .querySelector<HTMLInputElement>('[data-server-friend-search]')
    ?.addEventListener('input', () => {
      const server = selectedServer();
      const snapshot = server ? sharingSnapshots.get(server.id) : undefined;
      if (snapshot) {
        renderServerSharing(snapshot);
      }
    });
  document
    .querySelector<HTMLButtonElement>('[data-server-address-copy]')
    ?.addEventListener('click', () => {
      const address = document.querySelector<HTMLElement>(
        '[data-server-public-address]',
      )?.textContent;
      if (!address) {
        return;
      }
      void navigator.clipboard.writeText(address).then(() => sharingStatus('Dirección copiada.'));
    });
  document
    .querySelector<HTMLButtonElement>('[data-server-tunnel-toggle]')
    ?.addEventListener('click', () => {
      const server = selectedServer();
      if (!server) {
        return;
      }
      const snapshot = sharingSnapshots.get(server.id);
      const active = snapshot?.tunnel.status === 'active';
      const button = document.querySelector<HTMLButtonElement>('[data-server-tunnel-toggle]');
      if (button) {
        button.disabled = true;
      }
      sharingStatus(active ? 'Cerrando túnel…' : 'Solicitando túnel seguro…');
      const request = active
        ? window.battly.stopServerTunnel(server.id)
        : window.battly.startServerTunnel(server.id);
      void request
        .then((next) => {
          renderServerSharing(next);
          sharingStatus(active ? 'Túnel cerrado.' : 'Túnel activo y confirmado.');
        })
        .catch((error: unknown) => {
          sharingStatus(sharingError(error, 'No se pudo cambiar el túnel.'));
          if (snapshot) {
            renderServerSharing(snapshot);
          }
        });
    });
  document
    .querySelector<HTMLElement>('[data-server-share-dialog]')
    ?.addEventListener('click', (event) => {
      const target = event.target as Element;
      const server = selectedServer();
      if (!server) {
        return;
      }
      const invite = target.closest<HTMLButtonElement>('[data-server-invite]');
      const revoke = target.closest<HTMLButtonElement>('[data-server-permission-revoke]');
      if (invite) {
        const username = invite.dataset.serverInvite;
        const select = invite.parentElement?.querySelector<HTMLSelectElement>('select');
        if (!username || !select) {
          return;
        }
        invite.disabled = true;
        sharingStatus(`Enviando invitación a ${username}…`);
        void window.battly
          .inviteServerFriend(server.id, {
            role: select.value as ServerPermissionRole,
            username,
          })
          .then((next) => {
            renderServerSharing(next);
            sharingStatus(`Invitación enviada a ${username}.`);
          })
          .catch((error: unknown) => {
            sharingStatus(sharingError(error, 'No se pudo invitar.'));
            invite.disabled = false;
          });
      }
      if (revoke) {
        const username = revoke.dataset.serverPermissionRevoke;
        if (!username) {
          return;
        }
        revoke.disabled = true;
        sharingStatus(`Revocando acceso de ${username}…`);
        void window.battly
          .revokeServerPermission(server.id, username)
          .then((next) => {
            renderServerSharing(next);
            sharingStatus(`Acceso de ${username} revocado.`);
          })
          .catch(() => {
            sharingStatus('No se pudo revocar el permiso.');
            revoke.disabled = false;
          });
      }
    });

  document.querySelectorAll<HTMLButtonElement>('[data-server-tab]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      const target = button.dataset.serverTab;
      document.querySelectorAll<HTMLButtonElement>('[data-server-tab]').forEach((candidate) => {
        const active = candidate === button;
        candidate.classList.toggle('is-active', active);
        candidate.classList.toggle('active', active);
      });
      document.querySelectorAll<HTMLElement>('[data-server-view]').forEach((view) => {
        const active = view.dataset.serverView === target;
        view.hidden = !active;
        view.classList.toggle('is-active', active);
        view.classList.toggle('active', active);
      });
      const current = selectedServer();
      const runtime = current && runtimeSnapshots.get(current.id);
      if (runtime) {
        renderServerCharts(runtime);
        renderOnlineServerPlayers(runtime);
      }
      if (target === 'players') {
        loadPlayerLists();
      }
      if (target === 'modloaders') {
        loadServerContent();
      }
      if (target === 'files') {
        loadServerFiles();
      }
      if (target === 'logs') {
        loadServerLogs();
      }
    });
  });
  document
    .querySelector<HTMLSelectElement>('[data-server-picker]')
    ?.addEventListener('change', (event) => {
      const picker = event.currentTarget as HTMLSelectElement;
      if (picker.value === '__create-server__') {
        picker.value = selectedId;
        openServerCreation();
        return;
      }
      if (propertiesSaveTimer) {
        clearTimeout(propertiesSaveTimer);
        saveProperties();
      }
      selectedId = picker.value;
      currentFilePath = '';
      loadPlayerLists();
      loadServerFiles('');
      loadServerLogs();
      renderServers(servers);
      if (document.querySelector('[data-server-tab="modloaders"].is-active')) {
        loadServerContent();
      }
    });
  function openServerCreation(): void {
    if (servers.length >= 1) {
      void askBattly({
        title: 'Battly Servers',
        text: serverSlotText('full'),
        confirmText: 'Cerrar',
        hideCancel: true,
      });
      return;
    }
    const create = document.querySelector<HTMLElement>('[data-server-create-view]');
    const dashboard = document.querySelector<HTMLElement>('[data-server-dashboard]');
    if (create) {
      create.hidden = false;
      create.style.display = 'flex';
    }
    if (dashboard) {
      dashboard.hidden = true;
      dashboard.style.display = 'none';
    }
  }
  document
    .querySelector<HTMLFormElement>('[data-server-create-form]')
    ?.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      const data = new FormData(form);
      const status = document.querySelector<HTMLElement>('[data-server-create-status]');
      const submit = form.querySelector<HTMLButtonElement>('[type="submit"]');
      if (submit?.disabled) {
        return;
      }
      if (form.dataset.busy === 'true' || !form.reportValidity()) {
        return;
      }
      form.dataset.busy = 'true';
      if (submit) {
        submit.disabled = true;
      }
      const version = formText(data, 'version');
      const software = formText(data, 'software') as ServerSoftwareKind;
      let creationProgressId = '';
      void (async () => {
        if (servers.length >= 1) {
          throw new Error(serverSlotText('full'));
        }
        normalizeServerDraft({
          name: formText(data, 'name'),
          domain: formText(data, 'domain'),
          version,
          region: formText(data, 'region'),
          port: Number(formText(data, 'port')),
        });
        if (!softwareAvailability.get(version)?.available.includes(software)) {
          throw new Error('Selecciona un software compatible antes de crear el servidor.');
        }
        if (software === 'paper' && paperMinecraftVersion(version) !== version) {
          if (
            !(await askBattly({
              text: `Se instalará Paper ${paperMinecraftVersion(version)}, compatible con clientes ${version}. ¿Continuar?`,
            }))
          ) {
            return;
          }
        }
        if (status) {
          status.textContent = 'Creando servidor…';
        }
        creationProgressId = crypto.randomUUID();
        installationDialog?.open(
          creationProgressId,
          `${formText(data, 'domain')}.battlyservers.net`,
          false,
        );
        const next = await window.battly.createServer(
          {
            name: formText(data, 'name'),
            domain: formText(data, 'domain'),
            version,
            region: formText(data, 'region'),
            port: Number(formText(data, 'port')),
            eulaAccepted: data.get('eulaAccepted') === 'on',
          },
          software,
        );
        const created = next.find(
          (entry) => entry.domain === formText(data, 'domain').toLowerCase().trim(),
        );
        if (!created) {
          throw new Error('No se encontró el servidor creado');
        }
        selectedId = created.id;
        mount.classList.add('is-installing-server');
        renderServers(next);
        await installServerSoftware(software, true, formText(data, 'loaderBuild'));
        installationDialog?.finish(creationProgressId);
        form.reset();
        if (status) {
          status.textContent = '';
        }
        void refreshCreationSoftware();
      })()
        .catch((error: unknown) => {
          const message = serverErrorMessage(error, 'Error desconocido');
          if (message === serverDomainTakenMessage) {
            installationDialog?.finish(creationProgressId);
            const input = form.querySelector<HTMLInputElement>('#domainInput');
            const warning = form.querySelector<HTMLElement>('#warningMessage');
            if (warning) {
              setUiText(warning, message);
              warning.hidden = false;
            }
            input?.setCustomValidity(translateUiText(message));
            input?.focus();
            input?.select();
            if (status) {
              setUiText(status, message);
            }
            return;
          }
          if (creationProgressId) {
            installationDialog?.fail(creationProgressId, message);
          }
          if (status) {
            status.textContent = `No se pudo crear: ${message}`;
          }
        })
        .finally(() => {
          delete form.dataset.busy;
          if (submit) {
            submit.disabled = false;
          }
        });
    });
  const propertiesForm = document.querySelector<HTMLElement>('[data-server-properties-form]');
  let propertyRevision = 0;
  const saveProperties = (): void => {
    const id = selectedId;
    const revision = ++propertyRevision;
    const status = document.querySelector<HTMLElement>('[data-server-properties-status]');
    if (status) {
      status.textContent = 'Guardando…';
    }
    void window.battly
      .updateServerProperties(id, propertiesDraft())
      .then((next) => {
        // Preserve focus and newer edits while persistence finishes.
        servers = next;
        if (selectedId === id && revision === propertyRevision && status) {
          status.textContent =
            'Propiedades guardadas. Los cambios se aplican al reiniciar el servidor.';
        }
      })
      .catch(() => {
        if (selectedId === id && revision === propertyRevision && status) {
          status.textContent = 'No se pudieron guardar las propiedades';
        }
      });
  };
  let propertiesSaveTimer: ReturnType<typeof setTimeout> | undefined;
  propertiesForm?.addEventListener('input', (event) => {
    const control = event.target;
    if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement)) {
      return;
    }
    updateLegacyPropertyMeta(control);
    if (propertiesSaveTimer) {
      clearTimeout(propertiesSaveTimer);
    }
    propertiesSaveTimer = setTimeout(saveProperties, 350);
  });
  propertiesForm?.addEventListener('change', (event) => {
    const control = event.target;
    if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement)) {
      return;
    }
    updateLegacyPropertyMeta(control);
    if (propertiesSaveTimer) {
      clearTimeout(propertiesSaveTimer);
    }
    propertiesSaveTimer = setTimeout(saveProperties, 100);
  });
  document
    .querySelector<HTMLButtonElement>('[data-server-archive]')
    ?.addEventListener('click', (event) => {
      const server = selectedServer();
      const button = event.currentTarget as HTMLButtonElement;
      if (!server || button.disabled) {
        return;
      }
      button.disabled = true;
      void askBattly({
        text: `¿Eliminar definitivamente ${server.name}? Se detendrá y se borrarán sus mundos, archivos, registro remoto y subdominio. Esta acción no se puede deshacer.`,
      })
        .then(async (accepted) => {
          if (!accepted) {
            return;
          }
          if (propertiesSaveTimer) {
            clearTimeout(propertiesSaveTimer);
          }
          const status = document.querySelector<HTMLElement>('[data-server-properties-status]');
          if (status) {
            status.textContent = 'Deteniendo y eliminando el servidor…';
          }
          installationDialog?.remove(server.id, server.name);
          try {
            const next = await window.battly.archiveServer(server.id);
            runtimeSnapshots.delete(server.id);
            runtimeLogs.delete(server.id);
            sharingSnapshots.delete(server.id);
            playerSnapshots.delete(server.id);
            installProgress.delete(server.id);
            installationDialog?.finish(server.id);
            currentFilePath = '';
            editedFile = null;
            renderServers(next);
            const creationForm = document.querySelector<HTMLFormElement>(
              '[data-server-create-form]',
            );
            creationForm?.reset();
            const creationStatus = document.querySelector<HTMLElement>(
              '[data-server-create-status]',
            );
            if (creationStatus) {
              creationStatus.textContent = '';
            }
            void refreshCreationSoftware();
            if (status) {
              status.textContent = '';
            }
          } catch (error) {
            installationDialog?.fail(
              server.id,
              sharingError(error, 'No se pudo completar el borrado. Vuelve a intentarlo.'),
            );
            if (status) {
              status.textContent = sharingError(
                error,
                'No se pudo completar el borrado. Vuelve a intentarlo.',
              );
            }
          }
        })
        .finally(() => {
          button.disabled = false;
        });
    });
  document
    .querySelector<HTMLButtonElement>('[data-server-runtime="toggle"]')
    ?.addEventListener('click', (event) => {
      const control = event.currentTarget as HTMLButtonElement;
      if (control.disabled) {
        return;
      }
      control.disabled = true;
      const server = selectedServer();
      if (!server) {
        control.disabled = false;
        return;
      }
      const snapshot = runtimeSnapshots.get(server.id);
      const action =
        snapshot && ['running', 'starting'].includes(snapshot.status) ? 'Deteniendo' : 'Iniciando';
      const notice = document.querySelector<HTMLElement>('.server-runtime-notice');
      if (notice) {
        notice.textContent = `${action} ${server.name}…`;
      }
      const request =
        action === 'Deteniendo'
          ? window.battly.stopServerRuntime(server.id)
          : window.battly.startServerRuntime(server.id);
      void request
        .then(async () => {
          if (action === 'Iniciando') {
            const sharing = await window.battly.getServerSharing(server.id);
            renderServerSharing(sharing);
            if (notice) {
              notice.textContent = `Servidor conectado: ${sharing.tunnel.publicAddress || server.domain + '.battlyservers.net'}`;
            }
          } else if (notice) {
            notice.textContent = 'Guardando mundos y deteniendo el servidor…';
          }
        })
        .catch((error: unknown) => {
          if (notice) {
            notice.textContent = sharingError(
              error,
              'No se pudo completar el inicio del servidor.',
            );
          }
        })
        .finally(() => {
          const latest = runtimeSnapshots.get(server.id);
          if (latest) {
            renderRuntime(latest);
          } else {
            control.disabled = false;
          }
        });
    });
  document
    .querySelector<HTMLButtonElement>('[data-server-install]')
    ?.addEventListener('click', () => {
      const server = selectedServer();
      if (server) {
        void installServerSoftware(server.software.kind);
      }
    });
  document.querySelectorAll<HTMLButtonElement>('[data-server-software]').forEach((button) => {
    button.addEventListener('click', () => {
      const kind = button.dataset.serverSoftware as ServerSoftwareKind;
      const server = selectedServer();
      if (!server) {
        return;
      }
      const install = async () => {
        const build = isServerModloader(kind)
          ? await chooseServerLoaderBuild(server, kind)
          : undefined;
        if (build !== null && selectedServer()?.id === server.id) {
          await installServerSoftware(kind, false, build);
        }
      };
      if (server.software.installedAt && server.software.kind !== kind) {
        void askBattly({
          text: `¿Cambiar de ${server.software.kind} a ${kind}? Los mods y plugins deben ser compatibles con el software elegido. Haz una copia del mundo antes de abrirlo con otro loader.`,
        }).then((accepted) => {
          if (accepted) {
            void install();
          }
        });
      } else {
        void install();
      }
    });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-server-player-kind]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedPlayerKind = button.dataset.serverPlayerKind as ServerPlayerListKind;
      const server = selectedServer();
      const snapshot = server ? playerSnapshots.get(server.id) : undefined;
      if (snapshot) {
        renderPlayerLists(snapshot);
      }
    });
  });
  const serverMount = document.querySelector<HTMLElement>('[data-server-mount]');
  serverMount?.addEventListener('click', (event) => {
    const target = event.target as Element;
    const open = target.closest<HTMLButtonElement>('[data-server-player-modal]');
    if (open) {
      selectedPlayerKind = open.dataset.serverPlayerKind as ServerPlayerListKind;
      const modalId = open.dataset.serverPlayerModal;
      const modal = modalId ? document.getElementById(modalId) : null;
      modal?.classList.add('is-active');
      modal?.setAttribute('aria-hidden', 'false');
      return;
    }
    const close = target.closest<HTMLElement>('[data-server-player-modal-close]');
    if (close) {
      const modalId = close.dataset.serverPlayerModalClose;
      const modal = modalId ? document.getElementById(modalId) : null;
      modal?.classList.remove('is-active');
      modal?.setAttribute('aria-hidden', 'true');
      return;
    }
    const button = (event.target as Element).closest<HTMLButtonElement>(
      '[data-server-player-action]',
    );
    const server = selectedServer();
    if (!button || !server) {
      return;
    }
    const name = button.dataset.playerName ?? '';
    const uuid = button.dataset.playerUuid ?? '';
    const kind = button.dataset.serverPlayerKind as ServerPlayerListKind;
    const action = button.dataset.serverPlayerAction as 'add' | 'remove';
    button.disabled = true;
    void window.battly
      .mutateServerPlayerList(server.id, { name, uuid, kind, action })
      .then(renderPlayerLists)
      .catch(() => {
        const status = document.querySelector<HTMLElement>('[data-server-player-status]');
        if (status) {
          status.textContent = 'No se pudo actualizar la lista del jugador.';
        }
        button.disabled = false;
      });
  });
  document
    .querySelector<HTMLFormElement>('[data-server-player-form]')
    ?.addEventListener('submit', (event) => {
      event.preventDefault();
      const server = selectedServer();
      const form = event.currentTarget as HTMLFormElement;
      if (!server) {
        return;
      }
      const data = new FormData(form);
      const name = formText(data, 'name');
      const uuid = formText(data, 'uuid');
      const kind = formText(data, 'kind') as ServerPlayerListKind;
      const status = document.querySelector<HTMLElement>('[data-server-player-status]');
      if (status) {
        status.textContent = 'Actualizando lista…';
      }
      void window.battly
        .mutateServerPlayerList(server.id, { action: 'add', kind, name, uuid })
        .then((snapshot) => {
          form.reset();
          selectedPlayerKind = kind;
          renderPlayerLists(snapshot);
          if (status) {
            status.textContent = 'Lista actualizada';
          }
        })
        .catch(() => {
          if (status) {
            status.textContent = 'Revisa el nombre y UUID del jugador.';
          }
        });
    });
  document
    .querySelector<HTMLButtonElement>('[data-server-file-up]')
    ?.addEventListener('click', () => {
      const parent = currentFilePath.split('/').slice(0, -1).join('/');
      loadServerFiles(parent);
    });
  document
    .querySelector<HTMLButtonElement>('[data-server-world-import]')
    ?.addEventListener('click', () => {
      const server = selectedServer();
      if (!server) {
        return;
      }
      void askBattly({
        text: '¿Importar un mundo ZIP? El mundo actual se moverá al archivo recuperable de Battly.',
      }).then((accepted) => {
        if (!accepted) {
          return;
        }
        const status = document.querySelector<HTMLElement>('[data-server-file-status]');
        if (status) {
          status.textContent = 'Importando mundo…';
        }
        void window.battly
          .importServerWorld(server.id)
          .then((imported) => {
            if (imported) {
              loadServerFiles(currentFilePath, 'Mundo importado y anterior archivado');
            } else if (status) {
              status.textContent = '';
            }
          })
          .catch(() => {
            if (status) {
              status.textContent = 'No se pudo importar el mundo ZIP.';
            }
          });
      });
    });
  document
    .querySelector<HTMLButtonElement>('[data-server-modpack-import]')
    ?.addEventListener('click', () => {
      const server = selectedServer();
      if (!server || installingServers.has(server.id)) {
        return;
      }
      installationDialog?.open(server.id, server.name, Boolean(server.software.installedAt));
      const status = document.querySelector<HTMLElement>('[data-server-content-status]');
      const button = document.querySelector<HTMLButtonElement>('[data-server-modpack-import]');
      installingServers.add(server.id);
      if (button) {
        button.disabled = true;
      }
      void window.battly
        .importServerModpack(server.id)
        .then(async (name) => {
          installationDialog?.finish(server.id);
          if (!name) {
            return;
          }
          renderServers(await window.battly.getServers());
          loadServerContent();
          if (status) {
            setUiText(status, `Se ha instalado ${name} en el servidor.`);
          }
        })
        .catch((error: unknown) => {
          const message = serverErrorMessage(error, 'No se pudo instalar el modpack.');
          installationDialog?.fail(server.id, message);
          if (status) {
            setUiText(status, message);
          }
        })
        .finally(() => {
          installingServers.delete(server.id);
          const current = runtimeSnapshots.get(server.id);
          if (current) {
            renderRuntime(current);
          } else if (button) {
            button.disabled = false;
          }
        });
    });
  document.querySelectorAll<HTMLButtonElement>('[data-server-content-import]').forEach((button) => {
    button.addEventListener('click', () => {
      const server = selectedServer();
      const kind = button.dataset.serverContentImport as ServerContentKind;
      if (!server) {
        return;
      }
      const status = document.querySelector<HTMLElement>('[data-server-content-status]');
      button.disabled = true;
      if (status) {
        status.textContent = `Importando ${kind === 'mods' ? 'mod' : 'plugin'}…`;
      }
      void window.battly
        .importServerContent(server.id, kind)
        .then((entries) => {
          if (entries) {
            renderServerContent(kind, entries);
            if (status) {
              status.textContent = 'JAR importado correctamente.';
            }
          } else if (status) {
            status.textContent = '';
          }
        })
        .catch(() => {
          if (status) {
            status.textContent = 'No se pudo importar: usa un JAR válido y detén el servidor.';
          }
        })
        .finally(() => {
          const runtime = runtimeSnapshots.get(server.id);
          button.disabled = runtime ? !['stopped', 'error'].includes(runtime.status) : false;
        });
    });
  });
  document.querySelector('[data-server-share-pack]')?.addEventListener('click', () => {
    const server = selectedServer();
    if (!server) {
      return;
    }
    void openBypackFlow(
      {
        id: server.id,
        name: server.name,
        description: '',
        version: server.version,
        loader: null,
        loaderVersion: null,
      },
      undefined,
      (id) => window.battly.exportServerBypack(id),
    );
  });
  document.querySelectorAll<HTMLButtonElement>('[data-server-content-open]').forEach((button) => {
    button.addEventListener('click', () => {
      const server = selectedServer();
      if (!server) {
        return;
      }
      const kind = button.dataset.serverContentOpen as ServerContentKind;
      void window.battly.openServerContentFolder(server.id, kind).catch(() => {
        const status = document.querySelector<HTMLElement>('[data-server-content-status]');
        if (status) {
          status.textContent = 'No se pudo abrir la carpeta del servidor.';
        }
      });
    });
  });
  document
    .querySelector<HTMLElement>('[data-server-view="modloaders"]')
    ?.addEventListener('click', (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>(
        '[data-server-content-action]',
      );
      const server = selectedServer();
      const kind = button?.dataset.serverContentItemKind as ServerContentKind | undefined;
      const name = button?.dataset.serverContentName;
      const action = button?.dataset.serverContentAction as 'archive' | 'toggle' | undefined;
      if (!button || !server || !kind || !name || !action) {
        return;
      }
      const execute = (): void => {
        button.disabled = true;
        const status = document.querySelector<HTMLElement>('[data-server-content-status]');
        if (status) {
          status.textContent = action === 'archive' ? 'Archivando JAR…' : 'Actualizando JAR…';
        }
        const request =
          action === 'archive'
            ? window.battly.archiveServerContent(server.id, kind, name)
            : window.battly.toggleServerContent(server.id, kind, name);
        void request
          .then((entries) => {
            renderServerContent(kind, entries);
            if (status) {
              status.textContent =
                action === 'archive' ? 'JAR movido al archivo recuperable.' : 'Estado actualizado.';
            }
          })
          .catch(() => {
            if (status) {
              status.textContent = 'Detén el servidor y vuelve a intentarlo.';
            }
            button.disabled = false;
          });
      };
      if (action === 'archive') {
        void askBattly({
          text: `¿Archivar ${name}? El archivo se conservará para recuperarlo.`,
        }).then((accepted) => {
          if (accepted) {
            execute();
          }
        });
      } else {
        execute();
      }
    });
  document
    .querySelector<HTMLTableSectionElement>('[data-server-file-list]')
    ?.addEventListener('click', (event) => {
      const target = event.target as Element;
      const button = (event.target as Element).closest<HTMLButtonElement>(
        '[data-server-file-action]',
      );
      const server = selectedServer();
      const path = button?.dataset.serverFilePath;
      const action = button?.dataset.serverFileAction;
      if (!button) {
        const row = target.closest<HTMLTableRowElement>('[data-server-file-directory]');
        if (row?.dataset.serverFileDirectory) {
          loadServerFiles(row.dataset.serverFileDirectory);
        }
        return;
      }
      if (!server || !path) {
        return;
      }
      if (action === 'export') {
        void window.battly.exportServerFile(server.id, path).catch(() => {
          const status = document.querySelector<HTMLElement>('[data-server-file-status]');
          if (status) {
            status.textContent = 'No se pudo guardar el archivo.';
          }
        });
        return;
      }
      if (action === 'reveal') {
        void window.battly.revealServerFile(server.id, path);
        return;
      }
      if (action === 'archive') {
        void askBattly({ text: `¿Seguro que quieres borrar “${path}”?` }).then((accepted) => {
          if (!accepted) {
            return;
          }
          button.disabled = true;
          const status = document.querySelector<HTMLElement>('[data-server-file-status]');
          if (status) {
            status.textContent = 'Archivando…';
          }
          void window.battly
            .archiveServerFile(server.id, path)
            .then(() => loadServerFiles(currentFilePath, 'Elemento eliminado y archivado.'))
            .catch(() => {
              if (status) {
                status.textContent = 'Detén el servidor y vuelve a intentarlo.';
              }
              button.disabled = false;
            });
        });
        return;
      }
      if (action !== 'edit') {
        return;
      }
      const status = document.querySelector<HTMLElement>('[data-server-file-status]');
      if (status) {
        status.textContent = 'Abriendo archivo…';
      }
      void window.battly
        .readServerFile(server.id, path)
        .then((file) => {
          editedFile = file;
          const dialog = document.querySelector<HTMLElement>('[data-server-file-dialog]');
          const title = document.querySelector<HTMLElement>('[data-server-file-edit-path]');
          const textarea = document.querySelector<HTMLTextAreaElement>(
            '[data-server-file-form] textarea',
          );
          if (title) {
            title.textContent = file.path;
          }
          if (textarea) {
            textarea.value = file.content;
          }
          if (status) {
            status.textContent = '';
          }
          const editStatus = document.querySelector<HTMLElement>('[data-server-file-edit-status]');
          if (editStatus) {
            editStatus.textContent = '';
            delete editStatus.dataset.state;
          }
          dialog?.classList.add('is-active');
        })
        .catch(() => {
          if (status) {
            status.textContent = 'No se pudo leer el archivo.';
          }
        });
    });
  document.querySelectorAll<HTMLButtonElement>('[data-server-file-close]').forEach((button) => {
    button.addEventListener('click', () => {
      document
        .querySelector<HTMLElement>('[data-server-file-dialog]')
        ?.classList.remove('is-active');
      editedFile = null;
    });
  });
  document
    .querySelector<HTMLFormElement>('[data-server-file-form]')
    ?.addEventListener('submit', (event) => {
      event.preventDefault();
      const server = selectedServer();
      const form = event.currentTarget as HTMLFormElement;
      const textarea = form.elements.namedItem('content') as HTMLTextAreaElement | null;
      const status = document.querySelector<HTMLElement>('[data-server-file-edit-status]');
      if (!server || !editedFile || !textarea) {
        return;
      }
      if (status) {
        status.textContent = 'Guardando…';
        delete status.dataset.state;
      }
      void window.battly
        .writeServerFile(server.id, editedFile.path, textarea.value)
        .then((file) => {
          editedFile = file;
          if (status) {
            status.textContent = 'Archivo guardado';
            status.dataset.state = 'success';
          }
          loadServerFiles();
        })
        .catch(() => {
          if (status) {
            status.textContent = 'Contenido inválido o archivo no editable.';
            status.dataset.state = 'error';
          }
        });
    });
  document
    .querySelector<HTMLElement>('[data-server-log-list]')
    ?.addEventListener('click', (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>(
        '[data-server-log-action]',
      );
      const server = selectedServer();
      const path = button?.dataset.serverLogPath;
      const action = button?.dataset.serverLogAction;
      if (!button || !server || !path) {
        return;
      }
      if (action === 'reveal') {
        void window.battly.revealServerFile(server.id, path);
        return;
      }
      if (action !== 'view') {
        return;
      }
      void window.battly
        .readServerFile(server.id, path)
        .then((file) => {
          const dialog = document.querySelector<HTMLElement>('[data-server-log-dialog]');
          const title = document.querySelector<HTMLElement>('[data-server-log-path]');
          const content = document.querySelector<HTMLElement>('[data-server-log-content]');
          if (title) {
            title.textContent = file.path;
          }
          if (content) {
            renderLogLines(content, file.content);
          }
          dialog?.classList.add('is-active');
        })
        .catch(() => {
          const status = document.querySelector<HTMLElement>('[data-server-log-status]');
          if (status) {
            status.textContent = 'No se pudo leer este registro.';
          }
        });
    });
  document.querySelectorAll<HTMLButtonElement>('[data-server-log-close]').forEach((button) => {
    button.addEventListener('click', () => {
      document
        .querySelector<HTMLElement>('[data-server-log-dialog]')
        ?.classList.remove('is-active');
    });
  });
  document
    .querySelector<HTMLButtonElement>('[data-server-runtime="restart"]')
    ?.addEventListener('click', () => {
      const server = selectedServer();
      if (server) {
        void window.battly.restartServerRuntime(server.id).catch((error: unknown) => {
          const notice = document.querySelector<HTMLElement>('.server-runtime-notice');
          if (notice) {
            notice.textContent = sharingError(error, 'No se pudo reiniciar el servidor.');
          }
        });
      }
    });
  document
    .querySelector<HTMLFormElement>('[data-server-command-form]')
    ?.addEventListener('submit', (event) => {
      event.preventDefault();
      const server = selectedServer();
      const form = event.currentTarget as HTMLFormElement;
      const input = form.elements.namedItem('command') as HTMLInputElement | null;
      const command = input?.value.trim() ?? '';
      if (!server || !command) {
        return;
      }
      void window.battly
        .sendServerCommand(server.id, command)
        .then(() => {
          form.reset();
        })
        .catch(() => {
          const notice = document.querySelector<HTMLElement>('.server-runtime-notice');
          if (notice) {
            notice.textContent =
              'No se pudo enviar el comando. Comprueba que el servidor esté iniciado.';
          }
        });
    });
}

export function loadServersPanel(): void {
  const loading = document.querySelector<HTMLElement>('[data-server-mount] .fullscreen-text-div');
  if (loading) {
    loading.hidden = false;
    loading.style.display = 'flex';
  }
  document
    .querySelectorAll<HTMLElement>('[data-server-create-view], [data-server-dashboard]')
    .forEach(conceal);
  const status = document.querySelector<HTMLElement>('[data-server-create-status]');
  if (status) {
    status.textContent = 'Cargando Battly Servers…';
  }
  void window.battly
    .getServers()
    .then((next) => {
      renderServers(next);
      if (status) {
        status.textContent = '';
      }
    })
    .catch(() => {
      renderServers(servers);
      if (status) {
        status.textContent = 'No se pudieron cargar los servidores locales';
      }
    });
}
