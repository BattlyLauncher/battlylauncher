import type { InstanceSummary } from '../../shared/minecraft/instance';
import { bypackImportPercent, type BypackPreview } from '../../shared/minecraft/bypack';
import defaultIcon from '../legacy/assets/images/icons/minecraft.png';
import vanillaBanner from '../assets/instance-banners/vanilla.png';
import fabricBanner from '../assets/instance-banners/fabric.png';
import forgeBanner from '../assets/instance-banners/forge.png';
import neoforgeBanner from '../assets/instance-banners/neoforge.png';
import './bypack-panel.css';

function readableSize(bytes: number): string {
  const unit = bytes < 1024 ? 0 : bytes < 1024 ** 2 ? 1 : bytes < 1024 ** 3 ? 2 : 3;
  return `${(bytes / 1024 ** unit).toLocaleString(document.documentElement.lang || 'es', { maximumFractionDigits: 1 })} ${['B', 'KB', 'MB', 'GB'][unit]}`;
}

export async function openBypackImportFlow(
  source?: string | File,
  onImported?: (instance: InstanceSummary) => void,
  onOpen?: (instance: InstanceSummary) => void | Promise<void>,
): Promise<void> {
  let previousDialog: HTMLDialogElement | null;
  while ((previousDialog = document.querySelector<HTMLDialogElement>('.bypack-dialog[open]'))) {
    await new Promise<void>((resolve) =>
      previousDialog!.addEventListener('close', () => resolve(), { once: true }),
    );
  }
  const previousFocus = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.className = 'bypack-dialog bypack-import';
  dialog.dataset.stage = 'loading';
  dialog.setAttribute('aria-labelledby', 'bypack-import-title');
  dialog.innerHTML = /* HTML */ `<header>
      <span data-step>BATTLY PACK</span>
      <h2 id="bypack-import-title">Preparando vista previa…</h2>
    </header>
    <div
      class="bypack-hero"
      hidden
    >
      <img
        class="bypack-banner"
        alt=""
        hidden
      />
      <div class="bypack-identity">
        <img
          data-icon
          alt=""
          width="64"
          height="64"
        />
        <div>
          <h3 data-name></h3>
          <p data-author></p>
        </div>
      </div>
    </div>
    <section
      data-review
      aria-label="Información del paquete"
    >
      <p data-description></p>
      <dl data-facts></dl>
    </section>
    <p data-notice>Revisaremos los datos del paquete antes de instalarlo.</p>
    <section
      class="bypack-stage"
      aria-live="polite"
    >
      <div class="bypack-status-row">
        <p
          data-status
          role="status"
        >
          Leyendo el paquete…
        </p>
        <strong
          data-percent
          hidden
          >0%</strong
        >
      </div>
      <div
        class="bypack-meter"
        role="progressbar"
        aria-label="Instalación del Battly Pack"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <span></span>
      </div>
      <p data-current></p>
    </section>
    <footer>
      <button
        type="button"
        data-close
      >
        Cancelar</button
      ><button
        type="button"
        data-action
        hidden
      >
        Instalar y crear instancia
      </button>
    </footer>`;
  const title = dialog.querySelector('h2')!;
  const status = dialog.querySelector<HTMLElement>('[data-status]')!;
  const current = dialog.querySelector<HTMLElement>('[data-current]')!;
  const meter = dialog.querySelector<HTMLElement>('.bypack-meter')!;
  const fill = meter.querySelector('span')!;
  const percent = dialog.querySelector<HTMLElement>('[data-percent]')!;
  const action = dialog.querySelector<HTMLButtonElement>('[data-action]')!;
  const close = dialog.querySelector<HTMLButtonElement>('[data-close]')!;
  const notice = dialog.querySelector<HTMLElement>('[data-notice]')!;
  let busy = false;
  let preview: BypackPreview | undefined;
  let installed: InstanceSummary | undefined;
  const motion = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let displayedPercent = 0;
  let progressFrame = 0;
  const paintProgress = (value: number): void => {
    displayedPercent = Number.isFinite(value)
      ? Math.max(displayedPercent, Math.min(100, Math.max(0, Math.floor(value))))
      : displayedPercent;
    percent.textContent = `${displayedPercent}%`;
    meter.setAttribute('aria-valuenow', String(displayedPercent));
    fill.style.width = `${displayedPercent}%`;
  };
  const animateProgress = (target: number): void => {
    cancelAnimationFrame(progressFrame);
    target = Number.isFinite(target)
      ? Math.max(displayedPercent, Math.min(100, target))
      : displayedPercent;
    if (!motion) {
      paintProgress(target);
      return;
    }
    const from = displayedPercent;
    const started = performance.now();
    const tick = (): void => {
      // Use one clock throughout: a queued frame's timestamp may precede this animation.
      const ratio = Math.max(0, Math.min(1, (performance.now() - started) / 220));
      paintProgress(Math.floor(from + (target - from) * (1 - (1 - ratio) ** 3)));
      if (ratio < 1) {
        progressFrame = requestAnimationFrame(tick);
      }
    };
    progressFrame = requestAnimationFrame(tick);
  };
  const transition = (stage: string): void => {
    dialog.dataset.stage = stage;
    dialog.querySelector('[data-step]')!.textContent =
      stage === 'review'
        ? 'BATTLY PACK · INFORMACIÓN'
        : stage === 'installing'
          ? 'BATTLY PACK · INSTALACIÓN'
          : stage === 'success'
            ? 'BATTLY PACK · COMPLETADO'
            : 'BATTLY PACK';
    dialog.querySelector<HTMLElement>('[data-review]')!.hidden = stage !== 'review';
    if (motion) {
      dialog.querySelector(stage === 'review' ? '[data-review]' : '.bypack-stage')!.animate(
        [
          { opacity: 0, transform: 'translateY(8px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        { duration: 240, easing: 'ease-out' },
      );
    }
  };
  const dismiss = async (): Promise<void> => {
    if (busy || !dialog.open) {
      return;
    }
    if (motion) {
      await dialog
        .animate(
          [
            { opacity: 1, transform: 'translateY(0)' },
            { opacity: 0, transform: 'translateY(8px)' },
          ],
          { duration: 150 },
        )
        .finished.catch(() => undefined);
    }
    dialog.close();
  };
  const unsubscribe = window.battly.onBypackProgress((value) => {
    if (!busy || !preview || installed) {
      return;
    }
    const amount = bypackImportPercent(value, preview);
    status.textContent =
      value.phase === 'complete'
        ? 'Finalizando instalación…'
        : value.phase === 'downloading-files'
          ? 'Descargando y verificando contenido…'
          : value.phase === 'extracting'
            ? 'Restaurando configs y archivos…'
            : 'Preparando la instancia…';
    current.textContent = value.item;
    current.title = value.item;
    animateProgress(amount);
  });
  close.addEventListener('click', () => void dismiss());
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    void dismiss();
  });
  const closed = new Promise<void>((resolve) =>
    dialog.addEventListener(
      'close',
      () => {
        unsubscribe();
        cancelAnimationFrame(progressFrame);
        dialog.remove();
        if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
          previousFocus.focus();
        }
        resolve();
      },
      { once: true },
    ),
  );
  const fail = (error: unknown): void => {
    transition('error');
    title.textContent = 'No se pudo instalar el Battly Pack';
    status.textContent =
      error instanceof Error
        ? error.message.replace(/^Error invoking remote method '[^']+':\s*/, '')
        : 'No se pudo completar la operación.';
    current.textContent = '';
    action.hidden = true;
    close.textContent = 'Cerrar';
    busy = false;
    close.disabled = false;
    close.focus();
  };
  action.addEventListener('click', () => {
    if (busy) {
      return;
    }
    if (installed) {
      busy = true;
      action.disabled = true;
      void Promise.resolve(onOpen?.(installed))
        .then(() => {
          busy = false;
          return dismiss();
        })
        .catch((error) => {
          busy = false;
          action.disabled = false;
          status.textContent =
            error instanceof Error ? error.message : 'No se pudo abrir la instancia';
        });
      return;
    }
    if (!preview) {
      return;
    }
    busy = true;
    action.hidden = true;
    close.disabled = true;
    transition('installing');
    title.textContent = 'Instalando Battly Pack';
    status.textContent = 'Preparando la instancia…';
    percent.hidden = false;
    notice.textContent =
      'Espera a que termine la instalación. Los archivos descargados se comprobarán antes de guardar la instancia.';
    void window.battly
      .confirmBypack(preview.token)
      .then((instance) => {
        installed = instance;
        busy = false;
        onImported?.(instance);
        transition('success');
        title.textContent = 'Battly Pack instalado';
        status.textContent = `${instance.name} ya está en tus instancias.`;
        notice.textContent = '¿Quieres abrirlo y jugar ahora?';
        current.textContent = '';
        animateProgress(100);
        close.disabled = false;
        close.textContent = 'Ahora no';
        action.textContent = 'Abrir instancia';
        action.hidden = !onOpen;
        action.focus();
      })
      .catch(fail);
  });
  document.body.append(dialog);
  dialog.showModal();
  try {
    const result = await window.battly.importBypack(source);
    if (!dialog.open) {
      return;
    }
    if (!result) {
      await dismiss();
      return;
    }
    preview = result;
    transition('review');
    title.textContent = '¿Instalar este Battly Pack?';
    dialog.querySelector<HTMLElement>('.bypack-hero')!.hidden = false;
    dialog.querySelector('[data-name]')!.textContent = result.instance.name;
    dialog.querySelector('[data-author]')!.textContent = result.author
      ? `Compartido por ${result.author}`
      : 'Autor no indicado';
    dialog.querySelector('[data-description]')!.textContent = result.instance.description;
    const loadImage = (
      image: HTMLImageElement,
      candidates: (string | null | undefined)[],
    ): void => {
      const urls = [...new Set(candidates.filter((url): url is string => Boolean(url)))];
      const next = (): void => {
        const url = urls.shift();
        if (url) {
          image.src = url;
        } else {
          image.hidden = true;
        }
      };
      image.onload = () => {
        image.hidden = false;
      };
      image.onerror = next;
      next();
    };
    const loaderBanner =
      result.instance.loader === 'fabric'
        ? fabricBanner
        : result.instance.loader === 'forge'
          ? forgeBanner
          : result.instance.loader === 'neoforge'
            ? neoforgeBanner
            : vanillaBanner;
    loadImage(dialog.querySelector<HTMLImageElement>('[data-icon]')!, [
      result.instance.iconDataUrl,
      result.artwork?.iconUrl,
      defaultIcon,
    ]);
    loadImage(dialog.querySelector<HTMLImageElement>('.bypack-banner')!, [
      result.artwork?.coverUrl,
      ...(result.artwork?.coverUrls?.slice(0, 4) ?? []),
      loaderBanner,
    ]);
    const facts = dialog.querySelector('[data-facts]')!;
    for (const [label, text] of [
      ['Minecraft', result.instance.version],
      [
        'Loader',
        result.instance.loader
          ? `${result.instance.loader} ${result.instance.loaderVersion || ''}`.trim()
          : 'Vanilla',
      ],
      [
        'Contenido',
        `${result.files.toLocaleString(document.documentElement.lang || 'es')} archivos · ${result.downloads.toLocaleString(document.documentElement.lang || 'es')} descargas`,
      ],
      ['Tamaño al instalar', readableSize(result.bytes)],
    ]) {
      const term = document.createElement('dt');
      term.textContent = label;
      const detail = document.createElement('dd');
      detail.textContent = text;
      facts.append(term, detail);
    }
    notice.textContent =
      'Se creará una instancia nueva con sus configuraciones y archivos. Tus instancias actuales se conservarán.';
    status.textContent = result.downloads
      ? 'Necesitas conexión para descargar el contenido referenciado.'
      : 'El contenido está incluido en el paquete.';
    action.hidden = false;
    action.focus();
  } catch (error) {
    if (dialog.open) {
      fail(error);
    }
  }
  await closed;
}
