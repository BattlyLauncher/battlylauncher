import { userErrorMessage } from './user-error';
import type { ModProjectSummary } from '../../shared/mods/mod-contract';
import type { ModBasketRequest, ModBasketProgress } from '../../shared/mods/mod-basket';
import { setUiText, translateUiText as t } from '../i18n/dialog-text';
import { setUserText } from '../i18n/ui-translator';
import './mod-basket.css';

type Item = Pick<ModProjectSummary, 'id' | 'title' | 'iconUrl'> & {
  author?: string;
  recommendedByBattly?: boolean;
};
const storageKey = 'battly.mod-basket.v1';
class ModBasket {
  private items: Item[] = [];
  private view: 'grid' | 'list' = 'grid';
  private incompatible = new Set<string>();
  private dialog: HTMLDialogElement | undefined;
  private busy = false;
  private ready = false;
  private loading = false;
  private unsubscribe: (() => void) | undefined;
  constructor() {
    try {
      this.view = localStorage.getItem('battly.mod-basket.view.v1') === 'list' ? 'list' : 'grid';
      const raw: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
      if (Array.isArray(raw)) {
        const rows: readonly unknown[] = raw;
        const seen = new Set<string>();
        for (const value of rows.slice(0, 50)) {
          if (!value || typeof value !== 'object' || Array.isArray(value)) {
            continue;
          }
          const row = value as Record<string, unknown>;
          if (
            typeof row.id !== 'string' ||
            !/^[\w-]{1,128}$/.test(row.id) ||
            seen.has(row.id) ||
            typeof row.title !== 'string' ||
            row.title.length > 512
          ) {
            continue;
          }
          seen.add(row.id);
          this.items.push({
            id: row.id,
            title: row.title,
            iconUrl:
              typeof row.iconUrl === 'string' && /^https:\/\//.test(row.iconUrl)
                ? row.iconUrl
                : null,
            author: typeof row.author === 'string' ? row.author.slice(0, 256) : undefined,
            recommendedByBattly: row.recommendedByBattly === true,
          });
        }
      }
    } catch {
      // An invalid saved basket starts empty.
    }
  }
  mount(): void {
    document.querySelector('[data-mod-basket-open]')?.addEventListener('click', () => {
      void this.open();
    });
    this.update();
  }
  button(project: ModProjectSummary): HTMLButtonElement | null {
    if (project.projectType !== 'mod') {
      return null;
    }
    const saved = this.items.find((item) => item.id === project.id);
    if (saved) {
      Object.assign(saved, {
        iconUrl: project.iconUrl,
        author: project.author,
        recommendedByBattly: project.recommendedByBattly,
      });
      this.save();
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mod-basket-add';
    button.dataset.basketProject = project.id;
    button.addEventListener('keydown', (event) => event.stopPropagation());
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      if (this.busy) {
        return;
      }
      this.clearFeedback();
      const at = this.items.findIndex((item) => item.id === project.id);
      if (at >= 0) {
        this.items.splice(at, 1);
      } else if (this.items.length < 50) {
        this.items.push({
          id: project.id,
          title: project.title,
          iconUrl: project.iconUrl,
          author: project.author,
          recommendedByBattly: project.recommendedByBattly,
        });
      }
      this.save();
      this.render();
    });
    this.updateButton(button);
    return button;
  }
  private save(): void {
    try {
      localStorage.setItem(storageKey, JSON.stringify(this.items));
    } catch {
      /* Basket remains usable for this session. */
    }
    this.update();
  }
  private updateButton(button: HTMLButtonElement): void {
    const selected = this.items.some((item) => item.id === button.dataset.basketProject);
    button.classList.toggle('is-added', selected);
    button.setAttribute('aria-pressed', String(selected));
    button.title = t(selected ? 'Quitar de la cesta' : 'Añadir a la cesta');
    button.setAttribute('aria-label', button.title);
    button.disabled = this.busy || (!selected && this.items.length >= 50);
    button.innerHTML = selected
      ? '<i class="fa-solid fa-check" aria-hidden="true"></i>'
      : '<i class="fa-solid fa-cart-plus" aria-hidden="true"></i>';
  }
  private update(): void {
    document
      .querySelectorAll<HTMLButtonElement>('[data-basket-project]')
      .forEach((button) => this.updateButton(button));
    const count = document.querySelector('[data-mod-basket-count]');
    if (count) {
      count.textContent = String(this.items.length);
    }
  }
  private message(source: string): void {
    const status = this.dialog?.querySelector<HTMLElement>('[data-basket-status]');
    if (status) {
      setUiText(status, source);
    }
  }
  private state(value: string): void {
    if (!this.dialog) {
      return;
    }
    this.dialog.dataset.state = value;
    const icon = this.dialog.querySelector<HTMLElement>('[data-basket-state-icon]');
    if (icon) {
      icon.className =
        'fa-solid ' +
        (value === 'error'
          ? 'fa-triangle-exclamation'
          : value === 'success'
            ? 'fa-circle-check'
            : 'fa-circle-info');
    }
    this.dialog.setAttribute('aria-busy', String(this.busy || this.loading));
    document.querySelector('[data-mod-basket-open]')?.classList.toggle('is-busy', this.busy);
  }
  private clearFeedback(): void {
    if (!this.dialog || this.busy || this.loading) {
      return;
    }
    this.incompatible.clear();
    this.state('idle');
    this.message('');
    this.dialog.querySelector('[data-basket-issues]')!.replaceChildren();
    this.dialog.querySelector('[data-basket-file]')!.textContent = '';
    this.dialog.querySelector('[data-basket-step]')!.textContent = '';
  }
  private build(): HTMLDialogElement {
    const modal = document.createElement('dialog');
    modal.className = 'mod-basket-modal';
    modal.setAttribute('aria-labelledby', 'mod-basket-heading');
    modal.innerHTML = /* HTML */ `<header>
        <div>
          <i
            class="fa-solid fa-basket-shopping"
            aria-hidden="true"
          ></i>
          <h2
            id="mod-basket-heading"
            data-copy="Cesta de mods"
          ></h2>
          <span class="mod-basket-beta">Beta</span>
        </div>
        <button
          type="button"
          data-basket-close
          aria-label="Cerrar"
        >
          ×
        </button>
      </header>
      <div class="mod-basket-body">
        <section>
          <div class="mod-basket-list-heading">
            <h3>
              <span data-copy="Mods seleccionados"></span> <span data-basket-selection-count></span>
            </h3>
            <div class="mod-basket-list-actions">
              <div
                class="mod-basket-view-switch"
                role="group"
              >
                <button
                  type="button"
                  data-basket-view="grid"
                >
                  <i
                    class="fa-solid fa-grip"
                    aria-hidden="true"
                  ></i></button
                ><button
                  type="button"
                  data-basket-view="list"
                >
                  <i
                    class="fa-solid fa-list"
                    aria-hidden="true"
                  ></i>
                </button>
              </div>
              <button
                type="button"
                data-basket-clear
                data-copy="Vaciar cesta"
              ></button>
            </div>
          </div>
          <div
            class="mod-basket-items"
            data-basket-items
          ></div>
        </section>
        <section class="mod-basket-target">
          <h3 data-copy="Destino de instalación"></h3>
          <label
            ><span data-copy="Destino"></span
            ><select data-basket-destination></select></label
          ><label
            ><span>Minecraft</span
            ><select data-basket-game></select></label
          ><label
            ><span>Loader</span
            ><select data-basket-loader>
              <option value="fabric">Fabric</option>
              <option value="forge">Forge</option>
              <option value="neoforge">NeoForge</option>
              <option value="quilt">Quilt</option>
            </select></label
          >
          <p
            class="mod-basket-hint"
            data-copy="Se comprobarán las versiones, los loaders y las dependencias antes de instalar. Los servidores deben estar detenidos."
          ></p>
        </section>
      </div>
      <footer>
        <div class="mod-basket-feedback">
          <div class="mod-basket-status-line">
            <i
              class="fa-solid fa-circle-info"
              data-basket-state-icon
              aria-hidden="true"
            ></i>
            <p
              role="status"
              data-basket-status
            ></p>
            <span data-basket-step></span>
          </div>
          <p data-basket-file></p>
          <progress
            data-basket-progress
            hidden
          ></progress>
          <div
            data-basket-issues
            role="alert"
          ></div>
        </div>
        <div class="mod-basket-footer-actions">
          <button
            type="button"
            data-basket-retry
            hidden
            data-copy="Reintentar"
          ></button
          ><button
            type="button"
            class="mod-basket-install"
            data-basket-install
            data-copy="Instalar cesta"
          ></button>
        </div>
      </footer>`;
    modal
      .querySelectorAll<HTMLElement>('[data-copy]')
      .forEach((element) => setUiText(element, element.dataset.copy ?? ''));
    const close = modal.querySelector<HTMLButtonElement>('[data-basket-close]')!;
    close.setAttribute('aria-label', t('Cerrar'));
    close.onclick = () => {
      modal.close();
    };

    modal.querySelector<HTMLButtonElement>('[data-basket-clear]')!.onclick = () => {
      if (!this.busy) {
        this.clearFeedback();
        this.items = [];
        this.save();
        this.render();
      }
    };
    modal.querySelector<HTMLButtonElement>('[data-basket-install]')!.onclick = () => {
      void this.install();
    };
    modal.querySelector<HTMLButtonElement>('[data-basket-retry]')!.onclick = () => {
      void this.loadTargets();
    };
    modal.querySelectorAll<HTMLButtonElement>('[data-basket-view]').forEach((button) => {
      const label = button.dataset.basketView === 'grid' ? 'Vista de cuadrícula' : 'Vista de lista';
      button.title = t(label);
      button.setAttribute('aria-label', t(label));
      button.onclick = () => {
        this.view = button.dataset.basketView === 'list' ? 'list' : 'grid';
        try {
          localStorage.setItem('battly.mod-basket.view.v1', this.view);
        } catch {
          /* Keep the selected view for this session if storage is unavailable. */
        }
        this.render();
      };
    });
    document.body.append(modal);
    this.dialog = modal;
    return modal;
  }
  private render(): void {
    this.update();
    if (!this.dialog) {
      return;
    }
    const list = this.dialog.querySelector<HTMLElement>('[data-basket-items]')!;
    list.dataset.view = this.view;
    this.dialog
      .querySelectorAll<HTMLButtonElement>('[data-basket-view]')
      .forEach((button) =>
        button.setAttribute('aria-pressed', String(button.dataset.basketView === this.view)),
      );
    list.replaceChildren();
    for (const item of this.items) {
      const row = document.createElement('article'),
        identity = document.createElement('div'),
        copy = document.createElement('strong'),
        remove = document.createElement('button'),
        icon = document.createElement('span');
      row.dataset.projectId = item.id;
      row.classList.toggle('is-incompatible', this.incompatible.has(item.id));
      icon.className = 'mod-basket-item-icon';
      icon.innerHTML = '<i class="fa-solid fa-cube" aria-hidden="true"></i>';
      if (item.iconUrl) {
        const image = document.createElement('img');
        image.src = item.iconUrl;
        image.alt = '';
        image.loading = 'lazy';
        image.referrerPolicy = 'no-referrer';
        image.onerror = () => image.remove();
        icon.append(image);
      }
      identity.className = 'mod-basket-item-copy';
      setUserText(copy, item.title);
      identity.append(copy);
      if (item.author) {
        const author = document.createElement('span');
        author.className = 'mod-basket-item-author';
        setUserText(author, item.author);
        identity.append(author);
      }
      if (item.recommendedByBattly) {
        const badge = document.createElement('span');
        badge.className = 'mod-basket-recommendation';
        setUiText(badge, 'Recomendado por Battly');
        identity.append(badge);
      }
      remove.type = 'button';
      remove.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
      remove.title = t('Quitar de la cesta');
      remove.setAttribute('aria-label', t('Quitar de la cesta') + ': ' + item.title);
      remove.disabled = this.busy;
      remove.onclick = () => {
        this.clearFeedback();
        this.items = this.items.filter((value) => value.id !== item.id);
        this.save();
        this.render();
      };
      row.append(icon, identity, remove);
      list.append(row);
    }
    this.dialog.querySelector('[data-basket-selection-count]')!.textContent = String(
      this.items.length,
    );
    if (!this.items.length) {
      const empty = document.createElement('p');
      empty.className = 'mod-basket-empty';
      setUiText(empty, 'Añade mods desde el catálogo para preparar tu instalación.');
      list.append(empty);
    }
    this.dialog.querySelector<HTMLButtonElement>('[data-basket-clear]')!.disabled =
      this.busy || !this.items.length;
    this.dialog.querySelector<HTMLButtonElement>('[data-basket-install]')!.disabled =
      this.busy || !this.ready || !this.items.length;
    this.dialog.querySelector<HTMLButtonElement>('[data-basket-close]')!.disabled = false;
  }
  async open(): Promise<void> {
    const modal = this.dialog ?? this.build();
    if (modal.open) {
      return;
    }
    modal.showModal();
    this.render();
    if (this.busy) {
      return;
    }
    await this.loadTargets();
  }
  private async loadTargets(): Promise<void> {
    if (this.loading || this.busy || !this.dialog) {
      return;
    }
    const modal = this.dialog;
    const previousDestination = modal.querySelector<HTMLSelectElement>(
        '[data-basket-destination]',
      )!.value,
      previousGame = modal.querySelector<HTMLSelectElement>('[data-basket-game]')!.value;
    this.clearFeedback();
    this.loading = true;
    this.ready = false;
    this.state('loading');
    this.render();
    modal
      .querySelectorAll<HTMLSelectElement>('select')
      .forEach((control) => (control.disabled = true));
    modal.querySelector<HTMLButtonElement>('[data-basket-retry]')!.hidden = true;
    this.message('Cargando destinos…');
    modal.querySelectorAll<HTMLSelectElement>('select').forEach((control) => {
      if (!control.options.length) {
        control.add(new Option(t('Cargando destinos…'), ''));
      }
    });
    try {
      const [instances, servers, versions] = await Promise.all([
        window.battly.getInstances(),
        window.battly.getServers(),
        window.battly.getMinecraftVersionList(),
      ]);
      const destination = modal.querySelector<HTMLSelectElement>('[data-basket-destination]')!,
        game = modal.querySelector<HTMLSelectElement>('[data-basket-game]')!,
        loader = modal.querySelector<HTMLSelectElement>('[data-basket-loader]')!;
      destination.replaceChildren(new Option(t('Instalación normal'), ''));
      const targets = new Map<string, { version: string; loader: string }>();
      const instanceGroup = document.createElement('optgroup');
      instanceGroup.label = t('Instancias');
      destination.append(instanceGroup);
      const serverGroup = document.createElement('optgroup');
      serverGroup.label = 'Battly Servers';
      destination.append(serverGroup);
      for (const instance of instances) {
        if (!['fabric', 'forge', 'neoforge', 'quilt'].includes(instance.loader ?? '')) {
          continue;
        }
        const key = 'instance:' + instance.id;
        targets.set(key, { version: instance.version, loader: instance.loader! });
        instanceGroup.append(
          new Option(instance.name + ' · ' + instance.version + ' · ' + instance.loader, key),
        );
      }
      for (const server of servers) {
        if (
          !server.software.installedAt ||
          !['fabric', 'forge', 'neoforge'].includes(server.software.kind)
        ) {
          continue;
        }
        const key = 'server:' + server.id,
          version = server.software.gameVersion ?? server.version;
        targets.set(key, { version, loader: server.software.kind });
        serverGroup.append(
          new Option(server.name + ' · ' + version + ' · ' + server.software.kind, key),
        );
      }
      if (!versions.length) {
        throw new Error('MOD_BASKET_NO_VERSIONS');
      }
      game.replaceChildren();
      for (const version of versions) {
        game.add(new Option(version.id, version.id));
      }
      game.value = versions.some((version) => version.id === previousGame)
        ? previousGame
        : (versions.find((version) => version.type === 'release')?.id ?? versions[0].id);
      destination.onchange = () => {
        const target = targets.get(destination.value);
        game.disabled = loader.disabled = !!target;
        if (target) {
          if (![...game.options].some((option) => option.value === target.version)) {
            game.add(new Option(target.version, target.version));
          }
          game.value = target.version;
          loader.value = target.loader;
        }
      };
      destination.disabled = false;
      game.disabled = false;
      loader.disabled = false;
      if ([...destination.options].some((option) => option.value === previousDestination)) {
        destination.value = previousDestination;
      }
      destination.dispatchEvent(new Event('change'));
      this.ready = true;
      this.message('');
      this.state('idle');
    } catch {
      this.message('No se pudieron cargar los destinos.');
      this.state('error');
      modal.querySelector<HTMLButtonElement>('[data-basket-retry]')!.hidden = false;
    } finally {
      this.loading = false;
      modal.setAttribute('aria-busy', 'false');
      this.render();
    }
  }
  private progress(value: ModBasketProgress): void {
    if (!this.busy || !this.dialog) {
      return;
    }
    this.state(value.phase);
    this.dialog.querySelector('[data-basket-step]')!.textContent =
      value.total > 0 && value.phase !== 'checking'
        ? `${Math.min(value.current, value.total)} / ${value.total}`
        : '';
    this.message(
      value.phase === 'checking'
        ? 'Comprobando compatibilidad…'
        : value.phase === 'downloading'
          ? 'Descargando mods y dependencias…'
          : 'Instalando cesta…',
    );
    const meter = this.dialog.querySelector<HTMLProgressElement>('[data-basket-progress]')!;
    meter.hidden = false;
    if (value.total > 0 && value.phase !== 'checking') {
      meter.max = value.total;
      meter.value = value.current;
    } else {
      meter.removeAttribute('value');
    }
    setUserText(
      this.dialog.querySelector<HTMLElement>('[data-basket-file]')!,
      value.filename ?? '',
    );
    this.dialog.querySelector<HTMLElement>('[data-basket-file]')!.title = value.filename ?? '';
  }
  private async install(): Promise<void> {
    if (this.busy || !this.ready || !this.items.length || !this.dialog) {
      return;
    }
    const modal = this.dialog,
      destination = modal.querySelector<HTMLSelectElement>('[data-basket-destination]')!.value;
    const request: ModBasketRequest = {
      projectIds: this.items.map((item) => item.id),
      gameVersion: modal.querySelector<HTMLSelectElement>('[data-basket-game]')!.value,
      loader: modal.querySelector<HTMLSelectElement>('[data-basket-loader]')!.value,
      ...(destination.startsWith('instance:')
        ? { destinationInstanceId: destination.slice(9) }
        : destination.startsWith('server:')
          ? { destinationServerId: destination.slice(7) }
          : {}),
    };
    this.incompatible.clear();
    this.busy = true;
    this.render();
    modal
      .querySelectorAll<HTMLSelectElement>('select')
      .forEach((control) => (control.disabled = true));
    modal.querySelector('[data-basket-issues]')!.replaceChildren();
    this.unsubscribe = window.battly.onModBasketProgress((progress) => this.progress(progress));
    this.progress({ phase: 'checking', current: 0, total: 0 });
    try {
      const result = await window.battly.installModBasket(request);
      if (result.issues.length) {
        this.state('error');
        modal.querySelector('[data-basket-file]')!.textContent = '';
        this.message('La cesta necesita cambios antes de instalarse.');
        const labels = {
          version: 'No hay una versión compatible',
          dependency: 'No se pudieron resolver las dependencias',
          conflict: 'Hay mods incompatibles entre sí',
          environment: 'Este mod no es adecuado para el destino',
          metadata: 'No se pudo verificar el archivo',
          destination: 'El destino cambió o está ocupado',
        };
        for (const issue of result.issues) {
          const row = document.createElement('p'),
            label = document.createElement('strong'),
            detail = document.createElement('span');
          setUiText(label, labels[issue.kind]);
          setUserText(
            detail,
            [
              this.items.find((item) => item.id === issue.project)?.title ?? issue.project,
              ['busy', 'changed', 'cycle', 'limit', 'size', 'filename', 'inventory-limit'].includes(
                issue.detail,
              )
                ? ''
                : issue.detail,
            ]
              .filter(Boolean)
              .join(' · '),
          );
          row.append(label, detail);
          for (const id of issue.projectIds ?? []) {
            const item = this.items.find((item) => item.id === id);
            if (!item) {
              continue;
            }
            this.incompatible.add(id);
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'mod-basket-suggestion';
            const action = document.createElement('span'),
              name = document.createElement('span');
            setUiText(action, 'Quitar de la cesta');
            setUserText(name, item.title);
            remove.append(action, document.createTextNode(' · '), name);
            remove.onclick = () => {
              this.clearFeedback();
              this.items = this.items.filter((item) => item.id !== id);
              this.save();
              this.render();
            };
            row.append(remove);
          }
          modal.querySelector('[data-basket-issues]')!.append(row);
        }
      } else {
        this.state('success');
        this.message('Cesta instalada.');
        this.items = [];
        this.save();
        setUserText(
          modal.querySelector<HTMLElement>('[data-basket-file]')!,
          result.installed.join(', '),
        );
      }
    } catch (error) {
      this.state('error');
      modal.querySelector('[data-basket-file]')!.textContent = '';
      this.message(
        error instanceof Error
          ? userErrorMessage(error.message)
          : 'No se pudo instalar la cesta. No se completaron los cambios.',
      );
    } finally {
      this.busy = false;
      modal.setAttribute('aria-busy', 'false');
      document.querySelector('[data-mod-basket-open]')?.classList.remove('is-busy');
      modal.querySelector('[data-basket-step]')!.textContent = '';
      this.unsubscribe?.();
      this.unsubscribe = undefined;
      modal.querySelector<HTMLProgressElement>('[data-basket-progress]')!.hidden = true;
      modal
        .querySelectorAll<HTMLSelectElement>('select')
        .forEach((control) => (control.disabled = false));
      modal
        .querySelector<HTMLSelectElement>('[data-basket-destination]')!
        .dispatchEvent(new Event('change'));
      this.render();
    }
  }
}
export const modBasket = new ModBasket();
