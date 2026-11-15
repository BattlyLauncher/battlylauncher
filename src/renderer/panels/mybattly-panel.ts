import { emptyState } from '../ui/empty-state';
import { mountAutomaticWorldBackup } from '../ui/automatic-world-backup';
import { steveLoader } from '../ui/steve-loader';
import { clearMyBattlySelection, mountMyBattlySelection } from '../ui/mybattly-selection';
import { renderUsageChart } from '../ui/usage-chart';
import { driveProgressPercent, driveProgressLabel } from '../../shared/settings/drive-progress';
import { setUiText, translateUiText } from '../i18n/dialog-text';
import { setUserText } from '../i18n/ui-translator';

import { authorizeGoogleDrive } from '../ui/google-drive-auth';

import './mybattly-panel.css';

import myBattlyMarkup from '../legacy/panels/mybattly.html?raw';

import battlyIconUrl from '../assets/icon.png?url';

import legacySpanishStrings from '../legacy/assets/langs/strings.es.json';

import type { MyBattlySnapshot, WorldBackupSummary } from '../../shared/mybattly/mybattly-contract';

import { mountMyBattlyTutorial } from './mybattly-tutorial';

import { askBattly } from '../ui/ask-modal';

interface MyBattlyPanelOptions {
  readonly navigate: (panel: string) => Promise<void>;
  readonly notify: (message: string, error?: boolean) => void;
}

function text(root: ParentNode, selector: string, value: string | number): void {
  const element = root.querySelector<HTMLElement>(selector);

  if (element) {
    element.textContent = String(value);
  }
}

function emptyRow(columns: number, message: string): HTMLTableRowElement {
  const row = document.createElement('tr');

  const cell = document.createElement('td');

  cell.colSpan = columns;

  cell.className = 'b-mybattly-empty';

  cell.append(emptyState(message));

  row.append(cell);

  return row;
}

function cell(value = ''): HTMLTableCellElement {
  const element = document.createElement('td');

  element.textContent = value;

  return element;
}

function actionCell(): HTMLTableCellElement {
  const element = document.createElement('td');

  element.className = 'b-mybattly-table-actions';

  return element;
}

function updatedModState(
  filename: string,
  mods: MyBattlySnapshot['mods'],
): MyBattlySnapshot['mods'] {
  return mods.map((mod) =>
    mod.filename === filename
      ? {
          ...mod,
          enabled: !mod.enabled,
          filename: mod.enabled
            ? `${filename.slice(0, -4)}.disabledmod`
            : `${filename.slice(0, -12)}.jar`,
        }
      : mod,
  );
}

function playedTime(seconds: number | null): string {
  if (seconds === null) {
    return 'No disponible sin conexión';
  }

  const hours = Math.floor(seconds / 3_600);

  const minutes = Math.floor((seconds % 3_600) / 60);

  return `${hours} ${hours === 1 ? 'hora' : 'horas'} y ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;
}

function backupNotice(createdAt: string | null): string {
  if (!createdAt) {
    return 'Todavía no hay copias de seguridad registradas';
  }

  const timestamp = Date.parse(createdAt);

  if (!Number.isFinite(timestamp)) {
    return 'Hay copias de seguridad registradas en Battly';
  }

  const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));

  if (days === 0) {
    return 'La última copia de seguridad se realizó hoy.';
  }

  const message =
    days === 1
      ? `La última copia de seguridad fue hace ${days} día.`
      : `La última copia de seguridad fue hace ${days} días.`;

  return days >= 30
    ? `La última copia de seguridad fue hace ${days} días. Es recomendable hacer una nueva copia de seguridad.`
    : message;
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

export function mountMyBattlyPanel(options: MyBattlyPanelOptions): void {
  const panel = document.querySelector<HTMLElement>('[data-panel-view="mybattly"]');

  if (!panel) {
    return;
  }

  panel.innerHTML = myBattlyMarkup.replaceAll(
    /https:\/\/minotar\.net\/helm\/1ly4s0/g,

    battlyIconUrl,
  );

  panel.querySelectorAll('script').forEach((script) => script.remove());

  panel.querySelectorAll<HTMLElement>('[data-string-id]').forEach((element) => {
    const translated = legacyString(element.dataset.stringId ?? '');

    if (!translated) {
      return;
    }

    if (element instanceof HTMLInputElement && element.hasAttribute('placeholder')) {
      element.placeholder = translated;
    } else {
      element.textContent = translated;
    }
  });

  const logo = panel.querySelector<HTMLImageElement>('[data-mybattly-logo]');

  if (logo) {
    logo.src = battlyIconUrl;
  }

  const tutorial = mountMyBattlyTutorial(panel);

  let snapshot: MyBattlySnapshot | null = null;

  const backupDialog = document.querySelector<HTMLDialogElement>('[data-world-backups-dialog]');

  const backupList = backupDialog?.querySelector<HTMLElement>('[data-world-backups-list]');

  const backupStatus = backupDialog?.querySelector<HTMLElement>('[data-world-backups-status]');

  const worldSelect = backupDialog?.querySelector<HTMLSelectElement>('[data-world-backups-world]');

  let lastBackups: readonly WorldBackupSummary[] = [];
  let backupsLoading = false;
  let backupLoadRevision = 0;

  const search = document.createElement('input');

  search.type = 'search';

  search.placeholder = 'Buscar mundo o instancia';

  search.setAttribute('aria-label', search.placeholder);

  const date = document.createElement('input');

  date.type = 'date';

  date.setAttribute('aria-label', 'Fecha de la copia');

  const filters = document.createElement('div');

  filters.className = 'world-backups-filters';

  filters.append(search, date);

  backupList?.before(filters);

  search.addEventListener('input', () => renderBackups(lastBackups));

  date.addEventListener('input', () => renderBackups(lastBackups));

  const renderBackups = (backups: readonly WorldBackupSummary[]): void => {
    if (!backupList || backupsLoading) {
      return;
    }

    lastBackups = backups;
    search.disabled = false;
    date.disabled = false;

    backups = backups.filter(
      (backup) =>
        `${backup.worldName} ${backup.scope ?? ''}`

          .toLowerCase()

          .includes(search.value.toLowerCase()) &&
        (!date.value || new Date(backup.createdAt).toLocaleDateString('en-CA') === date.value),
    );

    backupList.replaceChildren();

    if (!backups.length) {
      const empty = document.createElement('div');

      empty.className = 'world-backups-empty';

      empty.append(emptyState('Sin copias todavía', 'Elige uno de tus mundos para protegerlo.'));

      backupList.append(empty);

      return;
    }

    backups.forEach((backup) => {
      const row = document.createElement('article');

      row.className = 'world-backups-row';

      const icon = document.createElement('i');

      icon.className = 'fas fa-file-zipper';

      icon.setAttribute('aria-hidden', 'true');

      const details = document.createElement('div');

      const title = document.createElement('strong');

      setUserText(title, backup.worldName);

      const metadata = document.createElement('span');

      const size = backup.sizeBytes
        ? `${new Intl.NumberFormat(document.documentElement.lang || 'es', { maximumFractionDigits: 1 }).format(backup.sizeBytes / (backup.sizeBytes < 1048576 ? 1024 : 1048576))} ${backup.sizeBytes < 1048576 ? 'KB' : 'MB'}`
        : '—';

      const backupDate = document.createElement('time');
      setUserText(
        backupDate,
        `${new Date(backup.createdAt).toLocaleString(document.documentElement.lang || 'es')} · ${size} · `,
      );
      const backupScope = document.createElement('span');
      if (backup.scope && backup.scope !== 'general') {
        setUserText(backupScope, backup.scope);
      } else {
        setUiText(
          backupScope,
          backup.scope === 'general'
            ? 'General'
            : backup.storage === 'drive'
              ? 'Copia antigua en Drive'
              : 'Copia local',
        );
      }
      metadata.append(backupDate, backupScope);

      details.append(title, metadata);

      const remove = document.createElement('button');

      remove.type = 'button';

      remove.className = 'world-backups-remove';

      remove.setAttribute('aria-label', `Eliminar copia de ${backup.worldName}`);

      remove.innerHTML = '<i class="fas fa-trash" aria-hidden="true"></i>';

      remove.addEventListener('click', () => {
        void askBattly({
          text:
            backup.storage === 'drive'
              ? `¿Eliminar la copia de ${backup.worldName}? Se moverá a la papelera de Google Drive.`
              : `¿Eliminar la copia de ${backup.worldName}? Se conservará en el archivo recuperable local.`,
        }).then((accepted) => {
          if (!accepted) {
            return;
          }

          remove.disabled = true;

          void window.battly

            .archiveWorldBackup(backup.id)

            .then(renderBackups)

            .catch(() => {
              remove.disabled = false;

              if (backupStatus) {
                backupStatus.textContent = 'No se pudo eliminar la copia.';
              }
            });
        });
      });

      const actions = document.createElement('div');

      actions.className = 'world-backups-actions';

      if (backup.restorable) {
        const restore = document.createElement('button');

        restore.type = 'button';

        restore.textContent = 'Restaurar';

        restore.addEventListener('click', () => {
          if (uploading) {
            return;
          }

          void askBattly({
            title: 'Restaurar mundo',

            text: 'Se creará un mundo nuevo en la carpeta general. Tu mundo actual no se modificará.',
          }).then(async (accepted) => {
            if (!accepted || uploading) {
              return;
            }

            uploading = true;

            restore.disabled = true;

            startTransfer(true);

            try {
              const name = await window.battly.restoreWorldBackup(backup.id);

              if (backupStatus) {
                backupStatus.textContent = `Mundo recuperado: ${name}`;
              }

              finishTransfer();

              await load();
            } catch (error) {
              finishTransfer(true);

              if (backupStatus) {
                backupStatus.textContent =
                  error instanceof Error ? error.message : 'No se pudo restaurar la copia';
              }
            } finally {
              uploading = false;

              restore.disabled = false;
            }
          });
        });

        actions.append(restore);
      }

      actions.append(remove);

      row.append(icon, details, actions);

      backupList.append(row);
    });
  };

  backupDialog?.querySelector('[data-backup-local]')?.addEventListener('click', () => {
    void window.battly.openLocalBackups().catch(() => {
      if (backupStatus) {
        backupStatus.textContent = 'No hay carpeta de copias locales en este perfil';
      }
    });
  });

  let driveConnected = false;

  let uploading = false;
  const showAutomaticBackup = mountAutomaticWorldBackup();

  const transferDialog = document.createElement('dialog');

  transferDialog.className = 'world-transfer-modal';
  transferDialog.setAttribute('aria-labelledby', 'world-transfer-title');

  transferDialog.innerHTML = /* HTML */ `<section>
    <span>Google Drive / Battly</span>
    <h2 id="world-transfer-title"></h2>
    <p
      role="status"
      aria-live="polite"
    ></p>
    <progress max="100"></progress
    ><button
      type="button"
      hidden
    ></button>
  </section>`;

  document.body.append(transferDialog);

  const transferTitle = transferDialog.querySelector('h2')!;

  const transferStatus = transferDialog.querySelector('p')!;

  const transferProgress = transferDialog.querySelector('progress')!;
  const transferCount = document.createElement('output');
  transferCount.className = 'world-transfer-count';
  transferProgress.after(transferCount);

  const transferClose = transferDialog.querySelector('button')!;

  transferClose.addEventListener('click', () => transferDialog.close());

  transferDialog.addEventListener('cancel', (event) => {
    if (uploading) {
      event.preventDefault();
    }
  });

  function startTransfer(restoring = false): void {
    setUiText(transferTitle, restoring ? 'Restaurando mundo' : 'Guardando tus mundos');

    setUiText(transferStatus, 'Preparando la copia…');

    transferProgress.removeAttribute('value');
    transferCount.textContent = '';

    transferClose.hidden = true;

    if (!transferDialog.open) {
      transferDialog.showModal();
    }
  }

  function finishTransfer(error = false): void {
    setUiText(transferTitle, error ? 'No se pudo completar la copia' : 'Copia completada');

    setUiText(
      transferStatus,
      error
        ? 'Comprueba tu conexión y vuelve a intentarlo. Tus mundos locales no se han modificado.'
        : 'Tus mundos están listos.',
    );

    if (error) {
      transferProgress.removeAttribute('value');
    } else {
      transferProgress.value = 100;
    }
    transferCount.textContent = error ? '' : '100%';

    setUiText(transferClose, 'Cerrar');

    transferClose.hidden = false;
  }

  const autoLabel = document.createElement('label');

  autoLabel.className = 'world-backups-auto';

  const autoSync = document.createElement('input');

  autoSync.type = 'checkbox';

  const autoText = document.createElement('span');

  autoText.textContent = 'Guardar al cerrar Minecraft';

  autoLabel.append(autoSync, autoText);

  filters.before(autoLabel);

  autoSync.addEventListener('change', () => {
    autoSync.disabled = true;

    void window.battly

      .getSettings()

      .then((settings) =>
        window.battly.saveSettings({ ...settings, autoSyncEnabled: autoSync.checked }),
      )

      .catch(() => {
        autoSync.checked = !autoSync.checked;

        if (backupStatus) {
          backupStatus.textContent = 'No se pudo guardar la configuración';
        }
      })

      .finally(() => {
        autoSync.disabled = !driveConnected;
      });
  });

  const refreshDrive = async (): Promise<void> => {
    const state = await window.battly.getDriveState();

    driveConnected = state.connected;

    autoSync.checked = (await window.battly.getSettings()).autoSyncEnabled;

    autoSync.disabled = !driveConnected || uploading;

    const account = backupDialog?.querySelector<HTMLElement>('[data-backup-account]');

    if (account) {
      account.textContent = state.connected
        ? `${state.email || state.name} · Google Drive / Battly`
        : 'Inicia sesión en Google para guardar tus mundos en Drive.';
    }

    backupDialog

      ?.querySelectorAll<HTMLElement>('[data-backup-open], [data-backup-disconnect]')

      .forEach((button) => {
        button.hidden = !state.connected;
      });

    const connect = backupDialog?.querySelector<HTMLElement>('[data-backup-connect]');

    if (connect) {
      connect.hidden = state.connected;
    }

    const create = backupDialog?.querySelector<HTMLButtonElement>('[data-world-backups-create]');

    if (create) {
      create.disabled =
        backupsLoading || uploading || !state.connected || !worldSelect?.options.length;
    }
  };

  backupDialog?.querySelector('[data-backup-connect]')?.addEventListener('click', () => {
    void authorizeGoogleDrive()
      .then(refreshDrive)

      .then(async () => renderBackups(await window.battly.getWorldBackups()))

      .catch((error) => {
        if (backupStatus) {
          backupStatus.textContent =
            error instanceof Error ? error.message : 'No se pudo conectar con Google';
        }
      });
  });

  backupDialog?.querySelector('[data-backup-disconnect]')?.addEventListener('click', () => {
    if (uploading) {
      return;
    }

    void window.battly

      .disconnectDrive()

      .then(refreshDrive)

      .then(() => {
        renderBackups([]);

        window.dispatchEvent(new Event('battly:drive-changed'));
      })

      .catch(() => {
        if (backupStatus) {
          backupStatus.textContent = 'No se pudo desconectar la cuenta';
        }
      });
  });

  backupDialog?.querySelector('[data-backup-open]')?.addEventListener('click', () => {
    void window.battly.openDriveFolder().catch(() => {
      if (backupStatus) {
        backupStatus.textContent = 'No se pudo abrir Google Drive';
      }
    });
  });

  window.battly.onDriveProgress((message, automaticState, detail) => {
    if (automaticState) {
      showAutomaticBackup(message, automaticState, detail);
      return;
    }
    if (backupStatus && uploading) {
      setUiText(backupStatus, message);
    }

    if (uploading && transferDialog.open) {
      setUiText(transferStatus, message);

      const count = /^(\d+)\/(\d+) ·/.exec(message);

      if (detail) {
        const percent = driveProgressPercent(detail);
        if (percent !== null) {
          transferProgress.value = percent;
        } else {
          transferProgress.removeAttribute('value');
        }
        transferCount.textContent = driveProgressLabel(detail);
        const libraryProgress =
          backupDialog?.querySelector<HTMLProgressElement>('[data-backup-progress]');
        if (libraryProgress) {
          libraryProgress.max = 100;
          if (percent !== null) {
            libraryProgress.value = percent;
          } else {
            libraryProgress.removeAttribute('value');
          }
        }
      } else if (count && Number(count[2])) {
        transferProgress.value = (Number(count[1]) / Number(count[2])) * 100;
      } else {
        transferProgress.removeAttribute('value');
      }
    }
  });

  const openBackups = async (createImmediately: boolean): Promise<void> => {
    if (!backupDialog || !worldSelect || !snapshot) {
      return;
    }
    if (backupDialog.open && backupsLoading) {
      return;
    }
    const revision = ++backupLoadRevision;
    let loaded = false;
    const current = (): boolean => revision === backupLoadRevision && backupDialog.open;
    backupsLoading = true;
    search.disabled = true;
    date.disabled = true;
    worldSelect.disabled = true;
    worldSelect.replaceChildren();
    backupList?.setAttribute('aria-busy', 'true');
    backupList?.replaceChildren(steveLoader(translateUiText('Cargando…')));
    if (backupStatus) {
      backupStatus.textContent = '';
    }
    const create = backupDialog.querySelector<HTMLButtonElement>('[data-world-backups-create]');
    if (create) {
      create.disabled = true;
    }
    if (!backupDialog.open) {
      backupDialog.showModal();
    }
    try {
      if (createImmediately) {
        await refreshDrive();
        if (!current()) {
          return;
        }
        if (!driveConnected) {
          await authorizeGoogleDrive();
        }
      }
      const available = await window.battly.getBackupWorlds();
      if (!current()) {
        return;
      }
      const all = document.createElement('option');

      all.value = '*';

      all.textContent = 'Todos los mundos e instancias';

      worldSelect.replaceChildren(
        all,

        ...available.map((world) => {
          const option = document.createElement('option');

          option.value = JSON.stringify({ name: world.name, instanceId: world.instanceId });

          option.textContent = `${world.label} · ${world.name}`;

          return option;
        }),
      );

      if (backupStatus) {
        backupStatus.textContent = snapshot.worlds.length
          ? createImmediately
            ? 'Selecciona el mundo que quieres copiar.'
            : ''
          : 'No hay mundos locales disponibles.';
      }

      await refreshDrive();
      if (!current()) {
        return;
      }
      const backups = await window.battly.getWorldBackups();
      if (!current()) {
        return;
      }
      backupsLoading = false;
      renderBackups(backups);
      loaded = true;
    } catch {
      if (!current()) {
        return;
      }
      const error = document.createElement('p');
      error.setAttribute('role', 'alert');
      setUiText(error, 'No se pudo cargar el historial.');
      backupList?.replaceChildren(error);
      if (backupStatus) {
        backupStatus.textContent = 'No se pudo cargar el historial.';
      }
    } finally {
      if (current()) {
        backupsLoading = false;
        backupList?.setAttribute('aria-busy', 'false');
        search.disabled = !loaded;
        date.disabled = !loaded;
        worldSelect.disabled = false;
        if (create) {
          create.disabled = uploading || !driveConnected || !worldSelect.options.length;
        }
      }
    }
  };
  backupDialog?.addEventListener('close', () => {
    if (backupDialog.open) {
      return;
    }
    backupLoadRevision++;
    backupsLoading = false;
    backupList?.setAttribute('aria-busy', 'false');
  });

  const renderMods = (): void => {
    const table = panel.querySelector<HTMLTableSectionElement>('#panel-mods tbody');

    if (!table || !snapshot) {
      return;
    }
    const enabled = snapshot.mods.filter((mod) => mod.enabled).length;
    text(panel, '#mybattly-mods-count', snapshot.mods.length);
    text(panel, '#mybattly-activated-mods-count', enabled);
    text(panel, '#mybattly-deactivated-mods-count', snapshot.mods.length - enabled);
    const stat = panel.querySelectorAll<HTMLElement>('.b-mybattly-stat-item .b-mybattly-ccc')[2];
    if (stat) {
      const count = document.createElement('span');
      setUserText(count, String(enabled));
      const label = document.createElement('span');
      setUiText(label, 'Activo');
      stat.replaceChildren(count, document.createTextNode(' '), label);
    }

    table.replaceChildren();

    if (!snapshot.mods.length) {
      clearMyBattlySelection(table.closest('table')!);
      table.append(emptyRow(5, 'No hay mods instalados'));

      return;
    }

    snapshot.mods.forEach((mod) => {
      const row = document.createElement('tr');

      const icon = cell();

      const image = document.createElement('img');

      image.src = mod.iconDataUrl ?? battlyIconUrl;

      image.alt = '';

      image.width = 30;

      image.height = 30;

      icon.append(image);

      const status = cell();

      const tag = document.createElement('span');

      tag.className = mod.enabled ? 'tag is-success' : 'tag is-warning';

      tag.textContent = mod.enabled ? 'Activo' : 'Inactivo';

      status.append(tag);

      const actions = actionCell();

      const actionList = document.createElement('div');

      actionList.className = 'b-mybattly-actions-td';

      const toggle = document.createElement('button');

      toggle.type = 'button';

      toggle.className = 'b-mybattly-icon-action';

      toggle.title = mod.enabled ? 'Desactivar' : 'Activar';

      toggle.setAttribute('aria-label', toggle.title);

      toggle.innerHTML = `<i class="fa-solid ${mod.enabled ? 'fa-eye-slash' : 'fa-eye'}" aria-hidden="true"></i>`;

      toggle.addEventListener('click', () => {
        toggle.disabled = true;

        void window.battly

          .toggleLocalMod(mod.filename)

          .then(() => {
            if (!snapshot) {
              return;
            }
            snapshot = { ...snapshot, mods: updatedModState(mod.filename, snapshot.mods) };
            renderMods();
            options.notify(translateUiText(mod.enabled ? 'Mod desactivado' : 'Mod activado'));
          })

          .catch(() => {
            toggle.disabled = false;
            options.notify(
              translateUiText('No se pudieron guardar los cambios. Inténtalo de nuevo.'),
              true,
            );
          });
      });

      const open = document.createElement('button');

      open.type = 'button';

      open.className = 'b-mybattly-icon-action';

      open.title = 'Abrir archivo';

      open.setAttribute('aria-label', open.title);

      open.innerHTML = '<i class="fa-solid fa-file-zipper" aria-hidden="true"></i>';

      open.addEventListener(
        'click',
        () =>
          void window.battly
            .openLocalMod(mod.filename)
            .catch(() => options.notify(translateUiText('No se pudo abrir el archivo'), true)),
      );

      const archive = document.createElement('button');

      archive.type = 'button';

      archive.className = 'b-mybattly-icon-action';

      archive.title = 'Eliminar';

      archive.setAttribute('aria-label', `Eliminar ${mod.filename}`);

      archive.innerHTML = '<i class="fa-solid fa-trash" aria-hidden="true"></i>';

      archive.addEventListener('click', () => {
        void askBattly({
          text: `¿Eliminar ${mod.filename}? Se moverá al archivo recuperable.`,
        }).then((accepted) => {
          if (!accepted) {
            return;
          }

          archive.disabled = true;

          void window.battly

            .archiveLocalMod(mod.filename)

            .then(load)

            .catch(() => {
              archive.disabled = false;
            });
        });
      });

      actionList.append(toggle, open, archive);

      actions.append(actionList);

      const name = cell(mod.name || mod.filename);
      name.title = mod.name || mod.filename;
      const version = cell(mod.version ?? 'Desconocida');
      version.title = mod.version ?? '';
      row.append(icon, name, version, status, actions);

      table.append(row);
    });
    mountMyBattlySelection(table.closest('table')!, {
      items: snapshot.mods.map((mod) => ({
        id: mod.filename,
        name: mod.name || mod.filename,
        enabled: mod.enabled,
      })),
      archive: async (id) => {
        await window.battly.archiveLocalMod(id);
        if (snapshot) {
          snapshot = { ...snapshot, mods: snapshot.mods.filter((m) => m.filename !== id) };
        }
      },
      toggle: async (id) => {
        await window.battly.toggleLocalMod(id);
        if (snapshot) {
          snapshot = { ...snapshot, mods: updatedModState(id, snapshot.mods) };
        }
      },
      refresh: () =>
        Promise.resolve().then(() => {
          renderMods();
          options.notify(translateUiText('Cambios guardados'));
        }),
    });
  };

  const renderWorlds = (): void => {
    const table = panel.querySelector<HTMLTableSectionElement>('#panel-worlds tbody');

    if (!table || !snapshot) {
      return;
    }

    table.replaceChildren();

    if (!snapshot.worlds.length) {
      clearMyBattlySelection(table.closest('table')!);
      table.append(emptyRow(4, 'No hay mundos guardados'));

      return;
    }

    snapshot.worlds.forEach((world) => {
      const row = document.createElement('tr');

      const icon = cell();

      if (world.iconDataUrl) {
        const image = document.createElement('img');

        image.src = world.iconDataUrl;

        image.alt = '';

        image.width = 30;

        image.height = 30;

        icon.append(image);
      } else {
        icon.innerHTML = '<i class="fa-solid fa-earth" aria-hidden="true"></i>';
      }

      const actions = actionCell();

      const backup = document.createElement('button');

      backup.type = 'button';

      backup.className =
        'button is-info is-small is-outlined b-mybattly-b-600 b-mybattly-is-poppins';

      backup.textContent = 'Hacer copia de seguridad';

      backup.addEventListener('click', () => {
        void openBackups(true).then(() => {
          if (worldSelect) {
            worldSelect.value = world.name;
          }
        });
      });

      const archive = document.createElement('button');

      archive.type = 'button';

      archive.className =
        'button is-danger is-small is-outlined b-mybattly-b-600 b-mybattly-is-poppins';

      archive.textContent = 'Eliminar';

      archive.setAttribute('aria-label', `Eliminar mundo ${world.name}`);

      archive.addEventListener('click', () => {
        void askBattly({
          text: `¿Eliminar el mundo ${world.name}? Se moverá al archivo recuperable.`,
        }).then((accepted) => {
          if (!accepted) {
            return;
          }

          archive.disabled = true;

          void window.battly

            .archiveWorld(world.name)

            .then(load)

            .catch(() => (archive.disabled = false));
        });
      });

      actions.append(backup, archive);

      row.append(icon, cell(world.name), cell('Mundo de Minecraft'), actions);

      table.append(row);
    });
    mountMyBattlySelection(table.closest('table')!, {
      items: snapshot.worlds.map((world) => ({ id: world.name, name: world.name })),
      archive: async (id) => {
        await window.battly.archiveWorld(id);
        if (snapshot) {
          snapshot = { ...snapshot, worlds: snapshot.worlds.filter((w) => w.name !== id) };
        }
      },
      refresh: () =>
        Promise.resolve().then(() => {
          renderWorlds();
          options.notify(translateUiText('Cambios guardados'));
        }),
    });
  };

  const renderResourcePacks = (): void => {
    const table = panel.querySelector<HTMLTableSectionElement>('#panel-resourcepacks tbody');

    if (!table || !snapshot) {
      return;
    }

    table.replaceChildren();

    if (!snapshot.resourcePacks.length) {
      clearMyBattlySelection(table.closest('table')!);
      table.append(emptyRow(5, 'No hay packs de recursos instalados'));

      return;
    }

    snapshot.resourcePacks.forEach((pack) => {
      const row = document.createElement('tr');

      const icon = cell();

      if (pack.iconDataUrl) {
        const image = document.createElement('img');

        image.src = pack.iconDataUrl;

        image.alt = '';

        image.width = 30;

        image.height = 30;

        icon.append(image);
      } else {
        icon.innerHTML = '<i class="fa-solid fa-image" aria-hidden="true"></i>';
      }

      const status = cell();

      const tag = document.createElement('span');

      tag.className = pack.enabled ? 'tag is-success' : 'tag is-warning';

      tag.textContent = pack.enabled ? 'Activo' : 'Inactivo';

      status.append(tag);

      const actions = actionCell();

      const toggle = document.createElement('button');

      toggle.type = 'button';

      toggle.className =
        'button is-info is-small is-outlined b-mybattly-b-600 b-mybattly-is-poppins';

      toggle.textContent = pack.enabled ? 'Desactivar' : 'Activar';

      toggle.addEventListener('click', () => {
        toggle.disabled = true;

        void window.battly

          .toggleResourcePack(pack.name)

          .then((resourcePacks) => {
            if (!snapshot) {
              return;
            }
            snapshot = { ...snapshot, resourcePacks };
            renderResourcePacks();
            options.notify(translateUiText(pack.enabled ? 'Pack desactivado' : 'Pack activado'));
          })

          .catch(() => {
            toggle.disabled = false;
            options.notify(
              translateUiText('No se pudieron guardar los cambios. Inténtalo de nuevo.'),
              true,
            );
          });
      });

      const archive = document.createElement('button');

      archive.type = 'button';

      archive.className =
        'button is-danger is-small is-outlined b-mybattly-b-600 b-mybattly-is-poppins';

      archive.textContent = 'Eliminar';

      archive.setAttribute('aria-label', `Eliminar pack ${pack.name}`);

      archive.addEventListener('click', () => {
        void askBattly({
          text: `¿Eliminar ${pack.name}? Se moverá al archivo recuperable.`,
        }).then((accepted) => {
          if (!accepted) {
            return;
          }

          archive.disabled = true;

          void window.battly

            .archiveResourcePack(pack.name)

            .then(load)

            .catch(() => (archive.disabled = false));
        });
      });

      actions.append(toggle, archive);

      row.append(icon, cell(pack.name), cell('Archivo local'), status, actions);

      table.append(row);
    });
    mountMyBattlySelection(table.closest('table')!, {
      items: snapshot.resourcePacks.map((pack) => ({
        id: pack.name,
        name: pack.name,
        enabled: pack.enabled,
      })),
      archive: async (id) => {
        const resourcePacks = await window.battly.archiveResourcePack(id);
        if (snapshot) {
          snapshot = { ...snapshot, resourcePacks };
        }
      },
      toggle: async (id) => {
        const resourcePacks = await window.battly.toggleResourcePack(id);
        if (snapshot) {
          snapshot = { ...snapshot, resourcePacks };
        }
      },
      refresh: () =>
        Promise.resolve().then(() => {
          renderResourcePacks();
          options.notify(translateUiText('Cambios guardados'));
        }),
    });
  };

  const reveal = (target: string): void => {
    if (target === 'panel-mods') {
      renderMods();
    }

    if (target === 'panel-worlds') {
      renderWorlds();
    }

    if (target === 'panel-resourcepacks') {
      renderResourcePacks();
    }

    panel.querySelector<HTMLElement>(`#${target}`)?.classList.remove('b-mybattly-blur-panel');

    const overlay = panel.querySelector<HTMLElement>(
      `.b-mybattly-panel-overlay[data-target="${target}"]`,
    );

    if (overlay) {
      overlay.classList.add('b-mybattly-overlay-leaving');

      window.setTimeout(() => {
        overlay.hidden = true;

        overlay.classList.remove('b-mybattly-overlay-leaving');
      }, 500);
    }
  };

  const render = (value: MyBattlySnapshot): void => {
    snapshot = value;
    let usage = panel.querySelector<HTMLElement>('.b-mybattly-usage');
    if (!usage) {
      usage = document.createElement('section');
      usage.className = 'b-mybattly-usage';
      panel.querySelector('.b-mybattly-main-panel-stats')?.append(usage);
    }
    renderUsageChart(usage, value.usageHistory ?? []);

    const enabled = value.mods.filter((mod) => mod.enabled).length;

    text(panel, '#b-mybattly-username', value.username || 'Jugador');

    text(panel, '#mybattly-mods-count', value.mods.length);

    text(panel, '#mybattly-activated-mods-count', enabled);

    text(panel, '#mybattly-deactivated-mods-count', value.mods.length - enabled);

    text(panel, '#mybattly-worlds-count', value.worlds.length);

    text(panel, '#mybattly-resourcepacks-count', value.resourcePacks.length);

    text(panel, '#mybattly-worlds-summary', value.worlds.length);

    text(panel, '#mybattly-packs-summary', value.resourcePacks.length);

    text(panel, '#mybattly-backups-summary', value.backupCount);

    text(panel, '#mybattly-stats-hours', playedTime(value.playedSeconds));

    const stats = panel.querySelectorAll<HTMLElement>('.b-mybattly-stat-item .b-mybattly-ccc');

    if (stats[1]) {
      stats[1].textContent = `${value.backupCount} realizadas`;
    }

    if (stats[2]) {
      stats[2].textContent = `${enabled} activos`;
    }

    text(panel, '#backup-notification-text', backupNotice(value.latestBackupAt));

    const notifications = panel.querySelector<HTMLElement>('.b-mybattly-notifications-list');

    notifications

      ?.querySelectorAll('[data-mybattly-social-notification]')

      .forEach((element) => element.remove());

    if (notifications && value.social) {
      value.social.receivedRequests.forEach((username) => {
        const socialNotification = document.createElement('div');

        socialNotification.className = 'b-mybattly-notification-message';

        socialNotification.dataset.mybattlySocialNotification = '';

        const title = document.createElement('h1');

        title.innerHTML =
          '<i class="fa-solid fa-user-friends" aria-hidden="true"></i> Solicitud de amistad';

        const divider = document.createElement('hr');

        divider.className = 'b-mybattly-hr';

        const summary = document.createElement('p');

        summary.textContent = `${username} te ha enviado una solicitud de amistad.`;

        socialNotification.append(title, divider, summary);

        const actions = document.createElement('div');

        actions.className = 'b-mybattly-user-profile-last-register-actions';

        const respond = (label: string, action: 'accept' | 'reject'): HTMLButtonElement => {
          const button = document.createElement('button');

          button.type = 'button';

          button.className = `button ${action === 'accept' ? 'is-info' : 'is-danger'} is-small is-outlined b-mybattly-b-600 b-mybattly-is-inter btn-dont-change`;

          button.textContent = label;

          button.addEventListener('click', () => {
            button.disabled = true;

            void window.battly

              .socialAction(action, username)

              .then(load)

              .catch(() => (button.disabled = false));
          });

          return button;
        };

        actions.append(respond('Aceptar', 'accept'), respond('Rechazar', 'reject'));

        socialNotification.append(actions);

        notifications.append(socialNotification);
      });
    }

    const recent = panel.querySelector<HTMLElement>('.b-mybattly-main-panel-recent-worlds ul');

    recent?.replaceChildren(
      ...(value.worlds.slice(0, 3).length
        ? value.worlds.slice(0, 3).map((world) => {
            const item = document.createElement('li');

            const name = document.createElement('p');

            name.className = 'b-mybattly-b-600 b-mybattly-white';

            name.textContent = world.name;

            const date = document.createElement('p');

            date.className = 'b-mybattly-b-500 b-mybattly-ccc';

            date.textContent = `Última modificación: ${new Date(world.modifiedAt).toLocaleDateString(document.documentElement.lang || 'es')}`;

            item.append(name, date);

            return item;
          })
        : [
            Object.assign(document.createElement('li'), { textContent: 'No hay mundos recientes' }),
          ]),
    );

    panel

      .querySelectorAll<HTMLElement>('.b-mybattly-panel-overlay[data-target]')

      .forEach((overlay) => {
        if (overlay.hidden) {
          reveal(overlay.dataset.target ?? '');
        }
      });

    if (!panel.querySelector('#panel-mods')?.classList.contains('b-mybattly-blur-panel')) {
      renderMods();
    }

    if (!panel.querySelector('#panel-worlds')?.classList.contains('b-mybattly-blur-panel')) {
      renderWorlds();
    }

    if (!panel.querySelector('#panel-resourcepacks')?.classList.contains('b-mybattly-blur-panel')) {
      renderResourcePacks();
    }
  };

  const load = async (): Promise<void> => {
    panel.dataset.state = 'loading';
    panel.setAttribute('aria-busy', 'true');
    panel.querySelector('.b-mybattly-loading')?.remove();
    const loading = steveLoader(translateUiText('Cargando...'));
    loading.classList.add('b-mybattly-loading');
    panel.prepend(loading);

    try {
      render(await window.battly.getMyBattly());

      panel.dataset.state = 'ready';

      tutorial.offer();
    } catch {
      panel.dataset.state = 'error';

      text(panel, '#backup-notification-text', 'No se pudo cargar MyBattly');
    } finally {
      loading.remove();
      panel.removeAttribute('aria-busy');
    }
  };

  panel.querySelector<HTMLButtonElement>('#back-mybattly-btn')?.addEventListener('click', () => {
    void options.navigate('home');
  });

  panel.querySelector<HTMLButtonElement>('#save-drive')?.addEventListener('click', () => {
    void openBackups(true);
  });

  panel

    .querySelector<HTMLButtonElement>('#view-backup-history-btn')

    ?.addEventListener('click', () => {
      void openBackups(false);
    });

  backupDialog

    ?.querySelector<HTMLButtonElement>('[data-world-backups-close]')

    ?.addEventListener('click', () => {
      backupDialog.close();
    });

  backupDialog

    ?.querySelector<HTMLFormElement>('[data-world-backups-form]')

    ?.addEventListener('submit', (event) => {
      event.preventDefault();

      const button = backupDialog.querySelector<HTMLButtonElement>('[data-world-backups-create]');

      const worldName = worldSelect?.value;

      if (!button || !worldName || !driveConnected || uploading) {
        return;
      }

      uploading = true;

      startTransfer();

      const progress = backupDialog.querySelector<HTMLProgressElement>('[data-backup-progress]');

      if (progress) {
        progress.hidden = false;
      }

      button.disabled = true;

      const selected =
        worldName === '*'
          ? null
          : (JSON.parse(worldName) as { name: string; instanceId: string | null });

      if (backupStatus) {
        backupStatus.textContent = selected
          ? `Creando copia de ${selected.name}…`
          : 'Copiando todos los mundos…';
      }

      const operation = selected
        ? window.battly.createWorldBackup(selected.name, selected.instanceId ?? undefined)
        : window.battly.syncGoogleDrive().then(async (result) => {
            if (!result.success) {
              throw new Error('No se pudo sincronizar con Google Drive');
            }

            return window.battly.getWorldBackups();
          });

      void operation

        .then((backups) => {
          finishTransfer();

          renderBackups(backups);

          if (backupStatus) {
            backupStatus.textContent = 'Mundo guardado en Google Drive / Battly.';
          }

          uploading = false;

          if (progress) {
            progress.hidden = true;
          }

          button.disabled = false;

          void refreshDrive().catch(() => undefined);

          void load();
        })

        .catch(() => {
          finishTransfer(true);

          uploading = false;

          if (progress) {
            progress.hidden = true;
          }

          if (backupStatus) {
            backupStatus.textContent =
              'No se pudo subir a Google Drive. Comprueba tu conexión y la autorización de la cuenta.';
          }

          button.disabled = false;
        });
    });

  panel.querySelectorAll<HTMLButtonElement>('.b-mybattly-load-panel').forEach((button) => {
    button.addEventListener('click', () => reveal(button.dataset.target ?? ''));
  });

  panel.addEventListener('battly:panel-enter', () => void load());
}
