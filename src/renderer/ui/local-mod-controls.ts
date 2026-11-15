import type {
  LocalModInspection,
  LocalModSummary,
  LocalModTarget,
} from '../../shared/mods/mod-contract';
import { setUiText } from '../i18n/dialog-text';
import { askBattly } from './ask-modal';

export class LocalModControls {
  private mods: readonly LocalModSummary[] = [];
  private inspections = new Map<string, LocalModInspection>();
  private readonly selected = new Set<string>();
  private readonly search = document.createElement('input');
  private readonly state = document.createElement('select');
  private readonly loader = document.createElement('select');
  private readonly sort = document.createElement('select');
  private readonly all = document.createElement('input');
  private readonly count = document.createElement('span');
  private readonly more = document.createElement('button');
  private readonly targetGame = document.createElement('input');
  private readonly targetLoader = document.createElement('select');
  private readonly targetLoaderVersion = document.createElement('input');
  private readonly targetJava = document.createElement('input');
  private limit = 80;
  private busy = false;
  private readonly bulk: HTMLButtonElement[] = [];

  constructor(
    private readonly redraw: () => void,
    private readonly refresh: () => Promise<void>,
  ) {
    const body = document.querySelector('[data-local-mods-list]')!;
    const toolbar = document.createElement('div');
    toolbar.className = 'local-mods-toolbar';
    const field = (label: string, control: HTMLElement) => {
      const wrapper = document.createElement('label');
      const text = document.createElement('span');
      setUiText(text, label);
      wrapper.append(text, control);
      return wrapper;
    };
    const options = (select: HTMLSelectElement, values: [string, string][]) => {
      for (const [value, label] of values) {
        select.add(new Option(label, value));
      }
    };
    this.search.type = 'search';
    this.search.maxLength = 200;
    this.search.placeholder = 'Nombre, ID o archivo';
    options(this.state, [
      ['', 'Todos'],
      ['enabled', 'Activos'],
      ['disabled', 'Inactivos'],
      ['selected', 'Seleccionados'],
    ]);
    const loaders: [string, string][] = ['fabric', 'forge', 'neoforge', 'quilt'].map((value) => [
      value,
      value,
    ]);
    options(this.loader, [['', 'Todos'], ...loaders, ['unknown', 'Desconocido']]);
    options(this.sort, [
      ['name', 'Nombre'],
      ['size', 'Tamaño'],
      ['date', 'Fecha'],
    ]);
    toolbar.append(
      field('Buscar mods', this.search),
      field('Estado', this.state),
      field('Loader', this.loader),
      field('Ordenar', this.sort),
    );
    const target = document.createElement('details');
    target.className = 'local-mods-target';
    const summary = document.createElement('summary');
    setUiText(summary, 'Configurar análisis');
    const inputs = document.createElement('div');
    inputs.className = 'local-mods-target-fields';
    options(this.targetLoader, [['', 'Sin especificar'], ...loaders]);
    this.targetGame.placeholder = '1.21.1';
    this.targetLoaderVersion.placeholder = '0.16.10';
    this.targetJava.placeholder = '21';
    for (const input of [this.targetGame, this.targetLoaderVersion, this.targetJava]) {
      input.maxLength = 100;
      input.spellcheck = false;
    }
    inputs.append(
      field('Minecraft', this.targetGame),
      field('Loader', this.targetLoader),
      field('Versión del loader', this.targetLoaderVersion),
      field('Java', this.targetJava),
    );
    const hint = document.createElement('p');
    setUiText(hint, 'El análisis usa todos los mods activos. Los filtros solo cambian la lista.');
    target.append(summary, inputs, hint);
    const actions = document.createElement('div');
    actions.className = 'local-mods-bulk';
    this.all.type = 'checkbox';
    const allLabel = field('Seleccionar resultados', this.all);
    allLabel.className = 'local-mods-select-all';
    this.count.setAttribute('role', 'status');
    actions.append(allLabel, this.count);
    for (const [action, label] of [
      ['enable', 'Activar'],
      ['disable', 'Desactivar'],
      ['archive', 'Archivar'],
    ] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      setUiText(button, label);
      button.className = 'button is-small';
      button.addEventListener('click', () => void this.apply(action));
      this.bulk.push(button);
      actions.append(button);
    }
    body.before(toolbar, target, actions);
    this.more.type = 'button';
    this.more.className = 'button is-small local-mods-more';
    setUiText(this.more, 'Mostrar más');
    body.after(this.more);
    this.more.addEventListener('click', () => {
      this.limit += 80;
      this.redraw();
    });
    this.all.addEventListener('change', () => {
      for (const mod of this.filtered()) {
        if (this.all.checked) {
          this.selected.add(mod.filename);
        } else {
          this.selected.delete(mod.filename);
        }
      }
      this.redraw();
    });
    let timer: ReturnType<typeof setTimeout>;
    this.search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        this.limit = 80;
        this.redraw();
      }, 100);
    });
    for (const select of [this.state, this.loader, this.sort]) {
      select.addEventListener('change', () => {
        this.limit = 80;
        this.redraw();
      });
    }
    this.updateControls();
  }

  setTarget(gameVersion: string, loader: string): void {
    this.targetGame.value = gameVersion;
    this.targetLoader.value = loader;
  }

  target(): LocalModTarget {
    return {
      gameVersion: this.targetGame.value.trim() || undefined,
      loader: (this.targetLoader.value as LocalModTarget['loader']) || undefined,
      loaderVersion: this.targetLoaderVersion.value.trim() || undefined,
      javaVersion: this.targetJava.value.trim() || undefined,
    };
  }

  showFile(filename: string): void {
    this.search.value = filename;
    this.loader.value = '';
    this.state.value = '';
    this.limit = 80;
    this.redraw();
    document.querySelector('[data-local-mods-list]')?.scrollIntoView({ block: 'nearest' });
  }

  selectFiles(filenames: readonly string[]): void {
    if (this.busy) {
      return;
    }
    this.selected.clear();
    const available = new Set(this.mods.map((mod) => mod.filename));
    for (const filename of filenames) {
      if (available.has(filename)) {
        this.selected.add(filename);
      }
    }
    this.search.value = '';
    this.loader.value = '';
    this.state.value = 'selected';
    this.limit = 80;
    this.redraw();
  }

  setData(mods: readonly LocalModSummary[], inspections: readonly LocalModInspection[]): void {
    this.mods = mods;
    this.inspections = new Map(inspections.map((mod) => [mod.filename, mod]));
    const filenames = new Set(mods.map((mod) => mod.filename));
    for (const name of this.selected) {
      if (!filenames.has(name)) {
        this.selected.delete(name);
      }
    }
  }

  private filtered(): LocalModSummary[] {
    const query = this.search.value.trim().toLocaleLowerCase();
    return this.mods
      .filter((mod) => {
        const info = this.inspections.get(mod.filename);
        return (
          (!query ||
            `${mod.filename} ${info?.name ?? ''} ${info?.id ?? ''} ${info?.version ?? ''}`
              .toLocaleLowerCase()
              .includes(query)) &&
          (!this.loader.value || this.loader.value === (info?.loader ?? 'unknown')) &&
          (!this.state.value ||
            (this.state.value === 'selected'
              ? this.selected.has(mod.filename)
              : mod.enabled === (this.state.value === 'enabled')))
        );
      })
      .sort((a, b) =>
        this.sort.value === 'size'
          ? b.size - a.size
          : this.sort.value === 'date'
            ? b.modifiedAt.localeCompare(a.modifiedAt)
            : (this.inspections.get(a.filename)?.name ?? a.filename).localeCompare(
                this.inspections.get(b.filename)?.name ?? b.filename,
              ),
      );
  }

  visible(): readonly LocalModSummary[] {
    const matches = this.filtered();
    this.more.hidden = matches.length <= this.limit;
    this.updateControls();
    return matches.slice(0, this.limit);
  }

  checkbox(mod: LocalModSummary): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'local-mod-select';
    input.checked = this.selected.has(mod.filename);
    input.disabled = this.busy;
    input.setAttribute(
      'aria-label',
      `Seleccionar: ${this.inspections.get(mod.filename)?.name ?? mod.filename}`,
    );
    input.addEventListener('change', () => {
      if (input.checked) {
        this.selected.add(mod.filename);
      } else {
        this.selected.delete(mod.filename);
      }
      input.closest('.local-mod-row')?.classList.toggle('is-selected', input.checked);
      this.updateControls();
    });
    return input;
  }

  private updateControls(): void {
    const matches = this.filtered(),
      chosen = matches.filter((mod) => this.selected.has(mod.filename)).length;
    this.all.checked = matches.length > 0 && chosen === matches.length;
    this.all.indeterminate = chosen > 0 && chosen < matches.length;
    this.all.disabled = this.busy || !matches.length;
    const selectedLabel = document.createElement('span');
    setUiText(selectedLabel, 'Seleccionados');
    this.count.replaceChildren(
      document.createTextNode(`${matches.length} / ${this.mods.length} · ${this.selected.size} `),
      selectedLabel,
    );
    for (const button of this.bulk) {
      button.disabled = this.busy || !this.selected.size;
    }
    document.querySelector('[data-local-mods-list]')?.classList.toggle('is-busy', this.busy);
    document
      .querySelectorAll<HTMLButtonElement | HTMLInputElement>(
        '[data-local-mods-list] button, [data-local-mods-list] input',
      )
      .forEach((control) => {
        control.disabled = this.busy;
      });
  }

  private dependents(candidates: readonly LocalModSummary[]): LocalModSummary[] {
    const removed = new Set(candidates.map((mod) => mod.filename));
    const identifiers = (mod: LocalModSummary) => {
      const info = this.inspections.get(mod.filename);
      return [info?.id, ...(info?.provides?.map((provider) => provider.id) ?? [])].filter(
        (id): id is string => Boolean(id),
      );
    };
    let changed = true;
    while (changed) {
      changed = false;
      const gone = new Set(
        this.mods.filter((mod) => mod.enabled && removed.has(mod.filename)).flatMap(identifiers),
      );
      const available = new Set(
        this.mods.filter((mod) => mod.enabled && !removed.has(mod.filename)).flatMap(identifiers),
      );
      for (const mod of this.mods) {
        if (!mod.enabled || removed.has(mod.filename)) {
          continue;
        }
        const info = this.inspections.get(mod.filename);
        const dependencies =
          info?.requirements?.filter((req) => req.kind === 'required').map((req) => req.id) ??
          info?.dependencies ??
          [];
        if (dependencies.some((id) => gone.has(id) && !available.has(id))) {
          removed.add(mod.filename);
          changed = true;
        }
      }
    }
    const original = new Set(candidates.map((mod) => mod.filename));
    return this.mods.filter((mod) => removed.has(mod.filename) && !original.has(mod.filename));
  }

  private async apply(action: 'enable' | 'disable' | 'archive'): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.updateControls();
    const status = document.querySelector<HTMLElement>('[data-local-mods-status]');
    const candidates = this.mods.filter(
      (mod) =>
        this.selected.has(mod.filename) &&
        (action === 'archive' || mod.enabled !== (action === 'enable')),
    );
    let failed = 0;
    try {
      if (!candidates.length) {
        return;
      }
      const label =
        action === 'enable' ? 'Activar' : action === 'disable' ? 'Desactivar' : 'Archivar';
      if (
        !(await askBattly({
          title: label,
          text:
            candidates
              .slice(0, 50)
              .map((mod) => this.inspections.get(mod.filename)?.name ?? mod.filename)
              .join('\n') + (candidates.length > 50 ? '\n…' : ''),
        }))
      ) {
        return;
      }
      if (action !== 'enable') {
        const dependents = this.dependents(candidates);
        if (
          dependents.length &&
          (await askBattly({
            title: 'Otros mods necesitan este mod',
            text: dependents
              .slice(0, 50)
              .map((mod) => this.inspections.get(mod.filename)?.name ?? mod.filename)
              .join('\n'),
            confirmText: 'Desactivar también',
            cancelText: 'Solo estos mods',
          }))
        ) {
          // Dependents are only disabled, even when the selected files are archived.
          failed += (
            await window.battly.batchLocalMods(
              'disable',
              dependents.map((mod) => mod.filename),
            )
          ).length;
        }
      }
      // Operate on the snapshot, once per file. A failed file does not undo successful changes.
      for (let offset = 0; offset < candidates.length; offset += 25) {
        const batch = candidates.slice(offset, offset + 25);
        if (status) {
          status.textContent = `${label} ${Math.min(offset + 25, candidates.length)} / ${candidates.length}`;
        }
        const errors = new Set(
          await window.battly.batchLocalMods(
            action,
            batch.map((mod) => mod.filename),
          ),
        );
        failed += errors.size;
        for (const mod of batch) {
          if (!errors.has(mod.filename)) {
            this.selected.delete(mod.filename);
          }
        }
      }
      await this.refresh();
      if (status && failed) {
        delete status.dataset.uiSource;
        const label = document.createElement('span');
        setUiText(label, 'No se pudo completar la operación');
        status.replaceChildren(label, document.createTextNode(`: ${failed}`));
      }
    } catch {
      if (status) {
        setUiText(status, 'No se pudo completar la operación');
      }
    } finally {
      this.busy = false;
      this.redraw();
      this.updateControls();
    }
  }
}
