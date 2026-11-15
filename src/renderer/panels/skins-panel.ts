import type { AccountSummary } from '../../shared/accounts/account';
import type {
  CapeLibrarySnapshot,
  CapeActionResult,
  SkinLibrarySnapshot,
} from '../../shared/skins/skin-contract';
import {
  FlyingAnimation,
  IdleAnimation,
  RunningAnimation,
  SkinViewer,
  WalkingAnimation,
} from 'skinview3d';
import { askBattly } from '../ui/ask-modal';
import { userErrorMessage } from '../ui/user-error';

type AppearanceNotice = 'info' | 'success' | 'error';
let notifyAppearance: (message: string, status: AppearanceNotice) => void = () => {};

let selectedSkinId = '';
let selectedSkinUrl = '';
let selectedSkinModel: 'default' | 'slim' = 'default';
let skinViewer: SkinViewer | null = null;
let skinActionBusy = false;
let currentSkinId: string | null = null;
let bound = false;
let libraryRevision = 0;
let activeAccount: AccountSummary | null = null;
let selectedAccount: AccountSummary | null = null;
let availableAccounts: readonly AccountSummary[] = [];
let accountRevision = 0;
let previewRevision = 0;

function clearSkinPreview(): void {
  previewRevision += 1;
  skinViewer?.loadSkin(null);
  currentSkinId = null;
  selectedSkinModel = 'default';
}
let capeSnapshot: CapeLibrarySnapshot | null = null;
let selectedCapeId: string | null = null;

export function setSkinCustomizerAccount(
  account: AccountSummary | null,
  accounts: readonly AccountSummary[] = [],
): void {
  selectedAccount = account;
  availableAccounts = accounts;
  if (activeAccount?.uuid !== account?.uuid) {
    accountRevision += 1;
    clearSkinPreview();
    libraryRevision += 1;
    const dialog = document.querySelector<HTMLElement>('[data-skin-dialog]');
    if (dialog) {
      dialog.hidden = true;
      dialog.classList.remove('is-active');
    }
    selectedSkinId = '';
    selectedSkinUrl = '';
    capeSnapshot = null;
  }
  activeAccount = account;
  document.querySelectorAll<HTMLButtonElement>('[data-skin-open]').forEach((button) => {
    button.hidden = account?.type !== 'battly';
    button.disabled = account?.type !== 'battly';
    button.title = account?.type === 'battly' ? `Personalizar skin y capa de ${account.name}` : '';
  });
}

function previewCape(url: string | null): void {
  if (!skinViewer) {
    return;
  }
  if (!url) {
    skinViewer.loadCape(null);
    return;
  }
  void Promise.resolve(skinViewer.loadCape(url)).catch(() =>
    setStatus('No se pudo cargar la vista previa de la capa', 'error'),
  );
}

function renderCapes(snapshot: CapeLibrarySnapshot): void {
  capeSnapshot = snapshot;
  selectedCapeId = snapshot.established;
  const panel = document.querySelector<HTMLElement>('[data-cape-panel]');
  if (!panel) {
    return;
  }
  panel.replaceChildren();
  const grid = document.createElement('div');
  grid.className = 'b-cape-grid';
  const apply = document.createElement('button');
  apply.type = 'button';
  apply.className = 'b-cape-action';
  apply.textContent = 'Aplicar capa';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'b-cape-action';
  remove.textContent = 'Eliminar capa propia';
  const choose = (id: string | null): void => {
    selectedCapeId = id;
    const item = snapshot.capes.find((cape) => cape.id === id);
    previewCape(item?.url ?? null);
    if (skinViewer) {
      skinViewer.playerObject.rotation.y = Math.PI;
    }
    grid
      .querySelectorAll<HTMLElement>('button')
      .forEach((button) =>
        button.setAttribute('aria-pressed', String(button.dataset.capeId === (id ?? ''))),
      );
    apply.disabled = skinActionBusy || id === snapshot.established;
    apply.textContent = id ? 'Aplicar capa' : 'Quitar capa';
    remove.hidden = !item?.deletable;
  };
  for (const item of [{ id: '', name: 'Sin capa', url: '' }, ...snapshot.capes]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'b-cape-card';
    button.dataset.capeId = item.id;
    const preview = document.createElement('span');
    preview.className = 'b-cape-texture';
    if (item.url) {
      preview.style.backgroundImage = `url(${JSON.stringify(item.url)})`;
    } else {
      preview.classList.add('is-empty');
      preview.textContent = '—';
    }
    const label = document.createElement('span');
    label.textContent = item.name;
    button.append(preview, label);
    button.addEventListener('click', () => {
      if (!skinActionBusy) {
        choose(item.id || null);
      }
    });
    grid.append(button);
  }
  const actions = document.createElement('div');
  actions.className = 'b-cape-actions';
  const upload = document.createElement('button');
  upload.type = 'button';
  upload.className = 'b-cape-card battly-plus-tile';
  upload.textContent = '＋ Subir capa · Battly+';
  upload.title =
    'Con Battly+ puedes guardar skins y capas ilimitadas. Capas en PNG de 64×32 píxeles, hasta 100 KB.';
  upload.setAttribute('aria-label', upload.title);
  upload.disabled = !snapshot.premium;
  upload.addEventListener('click', () =>
    runCapeAction(
      () => window.battly.uploadCape(activeAccount?.uuid),
      'Validando y subiendo capa…',
    ),
  );
  apply.addEventListener('click', () =>
    runCapeAction(() =>
      selectedCapeId
        ? window.battly.setCape(selectedCapeId, activeAccount?.uuid)
        : window.battly.removeCape(activeAccount?.uuid),
    ),
  );
  remove.addEventListener('click', () => {
    const id = selectedCapeId;
    const revision = accountRevision;
    void askBattly({ text: '¿Eliminar esta capa propia?' }).then((accepted) => {
      if (accepted && id && revision === accountRevision) {
        runCapeAction(() => window.battly.deleteCape(id, activeAccount?.uuid));
      }
    });
  });
  grid.append(upload);
  actions.append(apply, remove);
  const benefits = document.createElement('p');
  benefits.className = 'help-text';
  benefits.textContent = snapshot.premium
    ? 'Battly+ · Skins y capas ilimitadas.'
    : 'Battly permite guardar 4 skins. Con Battly+ tienes skins y capas ilimitadas.';
  panel.append(benefits, grid, actions);
  choose(snapshot.established);
}

function runCapeAction(
  action: () => Promise<CapeActionResult | null>,
  progress = 'Aplicando capa…',
): void {
  if (skinActionBusy || activeAccount?.type !== 'battly') {
    return;
  }
  const revision = accountRevision;
  skinActionBusy = true;
  setStatus(progress, 'progress');
  document.querySelectorAll<HTMLButtonElement>('[data-cape-panel] button').forEach((button) => {
    button.disabled = true;
  });
  void action()
    .then((result) => {
      if (revision !== accountRevision) {
        return;
      }
      if (result) {
        capeSnapshot = result.snapshot;
        setStatus(result.message, 'success');
      } else {
        setStatus('Selección cancelada');
      }
    })
    .catch((error) => {
      if (revision === accountRevision) {
        setStatus(userErrorMessage(error, 'No se pudo modificar la capa'), 'error');
      }
    })
    .finally(() => {
      skinActionBusy = false;
      if (revision === accountRevision && capeSnapshot) {
        renderCapes(capeSnapshot);
      }
    });
}

function showSkin(url: string, model: 'default' | 'slim' = 'default'): void {
  selectedSkinUrl = url;
  selectedSkinModel = model;
  if (!skinViewer || !url) {
    return;
  }
  const viewer = skinViewer;
  const revision = ++previewRevision;
  viewer.loadSkin(null);
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => {
    if (revision !== previewRevision || viewer !== skinViewer) {
      return;
    }
    try {
      viewer.loadSkin(image, { model });
    } catch {
      setStatus('No se pudo cargar la vista previa de la skin', 'error');
    }
  };
  image.onerror = () => {
    if (revision === previewRevision) {
      setStatus('No se pudo cargar la vista previa de la skin', 'error');
    }
  };
  image.src = url;
}

function activateAnimation(
  button: HTMLButtonElement,
  animation: IdleAnimation | FlyingAnimation | WalkingAnimation | RunningAnimation,
): void {
  if (!skinViewer) {
    return;
  }
  skinViewer.animation = animation;
  document
    .querySelectorAll<HTMLElement>('.b-skin-control-btn:not(#skin-anim-rotate)')
    .forEach((candidate) => candidate.classList.toggle('active', candidate === button));
}

function ensureSkinViewer(): void {
  const container = document.querySelector<HTMLElement>('[data-skin-preview]');
  if (!container || skinViewer) {
    return;
  }
  const fallback = container.querySelector<HTMLImageElement>('[data-skin-current]');
  if (fallback) {
    fallback.hidden = true;
  }
  const canvas = document.createElement('canvas');
  skinViewer = new SkinViewer({
    canvas,
    width: container.clientWidth || 300,
    height: container.clientHeight || 350,
    model: selectedSkinModel,
  });
  skinViewer.animation = new IdleAnimation();
  skinViewer.controls.enableRotate = true;
  skinViewer.controls.enableZoom = true;
  skinViewer.controls.enablePan = false;
  container.append(canvas);

  const controls = document.createElement('div');
  controls.className = 'b-skin-viewer-controls';
  const entries = [
    ['skin-anim-idle', 'fa-person', 'Idle', () => new IdleAnimation()],
    ['skin-anim-fly', 'fa-plane', 'Fly', () => new FlyingAnimation()],
    ['skin-anim-walk', 'fa-walking', 'Walk', () => new WalkingAnimation()],
    ['skin-anim-run', 'fa-running', 'Run', () => new RunningAnimation()],
  ] as const;
  for (const [id, icon, title, animation] of entries) {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = id;
    button.title = title;
    button.className = `b-skin-control-btn${id === 'skin-anim-idle' ? ' active' : ''}`;
    button.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i>`;
    button.addEventListener('click', () => activateAnimation(button, animation()));
    controls.append(button);
  }
  const rotate = document.createElement('button');
  rotate.type = 'button';
  rotate.id = 'skin-anim-rotate';
  rotate.title = 'Girar';
  rotate.className = 'b-skin-control-btn';
  rotate.innerHTML = '<i class="fa-solid fa-sync" aria-hidden="true"></i>';
  rotate.addEventListener('click', () => {
    if (!skinViewer) {
      return;
    }
    skinViewer.autoRotate = !skinViewer.autoRotate;
    rotate.classList.toggle('active', skinViewer.autoRotate);
  });
  controls.insertBefore(rotate, controls.children[1] ?? null);
  container.append(controls);
}

async function skinThumbnail(url: string, model: 'default' | 'slim'): Promise<HTMLImageElement> {
  const canvas = document.createElement('canvas');
  const viewer = new SkinViewer({ canvas, width: 112, height: 132, model });
  try {
    await viewer.loadSkin(url, { model });
    viewer.playerObject.rotation.y = 0.35;
    viewer.zoom = 0.82;
    viewer.render();
    const image = document.createElement('img');
    image.className = 'b-skin-item-preview';
    image.alt = '';
    image.src = canvas.toDataURL('image/png');
    return image;
  } finally {
    viewer.dispose();
  }
}

function fallbackSkinHead(url: string): HTMLElement {
  const preview = document.createElement('span');
  preview.className = 'b-skin-item-preview b-skin-head-preview';
  preview.setAttribute('aria-hidden', 'true');
  preview.style.setProperty('--skin-url', `url(${JSON.stringify(url)})`);
  const face = document.createElement('span');
  face.className = 'b-skin-head-face b-skin-head-front';
  face.style.backgroundPosition = '-48px -48px';
  face.style.setProperty('--skin-overlay-position', '-240px -48px');
  preview.append(face);
  return preview;
}

async function renderSkinLibrary(snapshot: SkinLibrarySnapshot): Promise<void> {
  const revision = ++libraryRevision;
  currentSkinId = snapshot.currentSkinId;
  const grid = document.querySelector<HTMLElement>('[data-skin-grid]');
  const current = document.querySelector<HTMLImageElement>('[data-skin-current]');
  const apply = document.querySelector<HTMLButtonElement>('[data-skin-apply]');
  const remove = document.querySelector<HTMLButtonElement>('[data-skin-delete]');
  if (current) {
    // The image is only a non-WebGL fallback. Keeping it visible after the
    // viewer has mounted overlays the raw 64x64 texture in the top-left.
    current.hidden = Boolean(skinViewer) || !snapshot.currentSkinUrl;
    if (snapshot.currentSkinUrl) {
      current.src = snapshot.currentSkinUrl;
    } else {
      current.removeAttribute('src');
    }
  }
  const currentItem = snapshot.skins.find((skin) => skin.id === snapshot.currentSkinId);
  if (!snapshot.skins.some((skin) => skin.id === selectedSkinId)) {
    selectedSkinId = currentItem?.id ?? '';
    if (snapshot.currentSkinUrl) {
      showSkin(currentItem?.url ?? snapshot.currentSkinUrl, currentItem?.model ?? 'default');
    }
  }
  if (apply) {
    apply.disabled = !selectedSkinId;
  }
  if (remove) {
    remove.disabled = !selectedSkinId;
  }
  const retained = new Set(snapshot.skins.map((skin) => `skin-card-${skin.id}`));
  grid?.querySelectorAll<HTMLElement>('.b-skin-item-card:not(.b-skin-add-card)').forEach((card) => {
    if (!retained.has(card.id)) {
      card.remove();
    }
  });

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'b-skin-item-card b-skin-add-card';
  add.disabled = snapshot.limitReached;
  const library = grid?.parentElement;
  let benefits = library?.querySelector<HTMLElement>('[data-skin-benefits]');
  if (!benefits && library) {
    benefits = document.createElement('p');
    benefits.dataset.skinBenefits = '';
    benefits.className = 'help-text';
    grid?.before(benefits);
  }
  if (benefits) {
    benefits.textContent = snapshot.premium
      ? 'Battly+ · Skins y capas ilimitadas.'
      : 'Battly permite guardar 4 skins. Con Battly+ tienes skins y capas ilimitadas.';
  }
  add.title = snapshot.limitReached
    ? 'Battly permite guardar 4 skins. Con Battly+ tienes skins y capas ilimitadas.'
    : 'PNG renderizable de 64×64 o 64×32 píxeles, hasta 1 MB.';
  if (snapshot.limitReached || snapshot.premium) {
    add.classList.add('battly-plus-tile');
  }
  add.setAttribute(
    'aria-label',
    snapshot.limitReached ? 'Límite de skins alcanzado' : 'Subir una skin',
  );
  const addIcon = document.createElement('i');
  addIcon.className = 'fa-solid fa-plus';
  const addText = document.createElement('span');
  addText.textContent = snapshot.limitReached ? 'Límite alcanzado' : 'Subir skin';
  add.append(addIcon, addText);
  add.addEventListener('click', () =>
    runSkinAction(
      () => window.battly.uploadSkin(activeAccount?.uuid),
      true,
      'Validando y subiendo skin…',
    ),
  );
  const oldAdd = grid?.querySelector('.b-skin-add-card');
  if (oldAdd) {
    oldAdd.replaceWith(add);
  } else {
    grid?.prepend(add);
  }

  for (const skin of snapshot.skins) {
    const existing = document.getElementById(`skin-card-${skin.id}`);
    if (existing && existing.dataset.skinSource === `${skin.url}|${skin.model}`) {
      existing.classList.toggle('is-current', skin.id === snapshot.currentSkinId);
      existing.classList.toggle('is-selected', skin.id === selectedSkinId);
      existing.setAttribute('aria-pressed', String(skin.id === selectedSkinId));
      continue;
    }
    existing?.remove();
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'b-skin-item-card';
    button.id = `skin-card-${skin.id}`;
    button.dataset.skinSource = `${skin.url}|${skin.model}`;
    button.classList.toggle('is-current', skin.id === snapshot.currentSkinId);
    button.classList.toggle('is-selected', skin.id === selectedSkinId);
    button.setAttribute('aria-pressed', String(skin.id === selectedSkinId));
    button.setAttribute('aria-label', skin.name);
    button.title = skin.name;
    const preview = await skinThumbnail(skin.url, skin.model).catch(() =>
      fallbackSkinHead(skin.url),
    );
    if (revision !== libraryRevision) {
      return;
    }
    const name = document.createElement('span');
    name.className = 'b-skin-item-name';
    name.textContent = skin.name;
    button.append(preview, name);
    // A library can contain dozens of entries. Static 3D heads avoid exhausting
    // WebGL contexts while the selected skin keeps the full animated viewer.
    button.addEventListener('click', () => {
      selectedSkinId = skin.id;
      const currentImage = document.querySelector<HTMLImageElement>('[data-skin-current]');
      if (currentImage) {
        currentImage.hidden = Boolean(skinViewer);
        currentImage.src = skin.url;
      }
      showSkin(skin.url, skin.model);
      document.querySelectorAll<HTMLElement>('.b-skin-item-card').forEach((card) => {
        const chosen = card === button;
        card.classList.toggle('is-selected', chosen);
        card.setAttribute('aria-pressed', String(chosen));
      });
      if (apply) {
        apply.disabled = false;
      }
      if (remove) {
        remove.disabled = false;
      }
    });
    grid?.append(button);
  }
}

function setStatus(message: string, status: AppearanceNotice | 'progress' = 'info'): void {
  const dialog = document.querySelector('[data-skin-dialog]');
  let notice = dialog?.querySelector<HTMLElement>('[data-appearance-status]');
  if (!notice && dialog && status === 'progress' && message) {
    notice = document.createElement('p');
    notice.dataset.appearanceStatus = '';
    notice.setAttribute('role', 'status');
    dialog.querySelector('.modal-card-body')?.prepend(notice);
    if (!notice.isConnected) {
      dialog.append(notice);
    }
  }
  if (notice) {
    notice.textContent = status === 'progress' ? message : '';
    notice.dataset.state = status;
    notice.hidden = status !== 'progress' || !message;
  }
  document
    .querySelector('[data-skin-dialog]')
    ?.setAttribute('aria-busy', String(status === 'progress'));
  if (message && status !== 'progress') {
    notifyAppearance(message, status);
  }
}

function runSkinAction(
  action: () =>
    ReturnType<typeof window.battly.setSkin> | ReturnType<typeof window.battly.uploadSkin>,
  refreshLibrary = true,
  progress = 'Aplicando skin…',
): void {
  if (skinActionBusy) {
    return;
  }
  skinActionBusy = true;
  const revision = accountRevision;
  const selectedBefore = selectedSkinId;
  document
    .querySelectorAll<HTMLButtonElement>('[data-skin-apply], [data-skin-delete], .b-skin-add-card')
    .forEach((button) => {
      button.disabled = true;
    });
  setStatus(progress, 'progress');
  void action()
    .then(async (result) => {
      if (revision !== accountRevision) {
        return;
      }
      if (!result) {
        setStatus('Selección cancelada');
        return;
      }
      if (refreshLibrary) {
        selectedSkinId = selectedBefore;
        await renderSkinLibrary(result.snapshot);
      } else {
        currentSkinId = result.snapshot.currentSkinId;
        document.querySelectorAll<HTMLElement>('.b-skin-item-card').forEach((card) => {
          card.classList.toggle(
            'is-current',
            card.id === `skin-card-${result.snapshot.currentSkinId}`,
          );
        });
      }
      setStatus(result.message, 'success');
    })
    .catch((error: unknown) => {
      if (revision !== accountRevision) {
        return;
      }
      setStatus(
        userErrorMessage(
          error,
          'No se pudo modificar la skin. Comprueba tu sesión y vuelve a intentarlo.',
        ),
        'error',
      );
    })
    .finally(() => {
      skinActionBusy = false;
      document
        .querySelectorAll<HTMLButtonElement>('[data-skin-apply], [data-skin-delete]')
        .forEach((button) => {
          button.disabled = !selectedSkinId;
        });
      const upload = document.querySelector<HTMLButtonElement>('.b-skin-add-card');
      if (upload) {
        upload.disabled = upload.getAttribute('aria-label') === 'Límite de skins alcanzado';
      }
    });
}

export function bindSkinCustomizer(
  notify?: (message: string, status: AppearanceNotice) => void,
): void {
  if (notify) {
    notifyAppearance = notify;
  }
  if (bound) {
    return;
  }
  bound = true;
  const dialog = document.querySelector<HTMLElement>('[data-skin-dialog]');
  document.querySelectorAll<HTMLButtonElement>('[data-appearance-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      const capes = tab.dataset.appearanceTab === 'cape';
      document
        .querySelectorAll<HTMLElement>(
          '[data-skin-grid], .b-skin-actions, .b-skin-current > .help-text',
        )
        .forEach((el) => {
          el.hidden = capes;
        });
      const panel = document.querySelector<HTMLElement>('[data-cape-panel]');
      if (panel) {
        panel.hidden = !capes;
      }
      document
        .querySelectorAll<HTMLElement>('[data-appearance-tab]')
        .forEach((el) => el.setAttribute('aria-pressed', String(el === tab)));
      if (skinViewer) {
        skinViewer.playerObject.rotation.y = capes ? Math.PI : 0;
      }
    });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-skin-open]').forEach((button) => {
    button.addEventListener('click', () => {
      if (skinActionBusy || button.hidden || button.disabled) {
        return;
      }
      const target =
        button.id === 'b-settings-skin'
          ? availableAccounts.find(
              (account) =>
                account.uuid ===
                document.querySelector<HTMLElement>('#b-settings-profile-menu')?.dataset.uuid,
            )
          : selectedAccount;
      if (target?.type !== 'battly') {
        return;
      }
      activeAccount = target;
      const revision = ++accountRevision;
      libraryRevision += 1;
      clearSkinPreview();
      selectedSkinId = '';
      selectedSkinUrl = '';
      document.querySelector('[data-skin-grid]')?.replaceChildren();
      document.querySelector('[data-cape-panel]')?.replaceChildren();
      const title = document.querySelector<HTMLElement>('#skin-customizer-title');
      if (title) {
        title.textContent = `Skin y capa de ${activeAccount.name}`;
      }
      if (dialog) {
        dialog.hidden = false;
        dialog.classList.add('is-active');
      }
      ensureSkinViewer();
      previewCape(null);
      if (skinViewer) {
        skinViewer.playerObject.rotation.y = 0;
      }
      document.querySelector<HTMLButtonElement>('[data-appearance-tab=skin]')?.click();
      void window.battly
        .getCapes(activeAccount?.uuid)
        .then((snapshot) => {
          if (revision !== accountRevision) {
            return;
          }
          renderCapes(snapshot);
          if (skinViewer) {
            skinViewer.playerObject.rotation.y = 0;
          }
        })
        .catch(() => {
          if (revision !== accountRevision) {
            return;
          }
          const panel = document.querySelector<HTMLElement>('[data-cape-panel]');
          if (panel) {
            panel.textContent =
              'No se pudieron cargar las capas. Cierra y vuelve a abrir el personalizador para reintentar.';
          }
        });
      setStatus('Cargando skins…', 'progress');
      void window.battly
        .getSkins(activeAccount?.uuid)
        .then(async (snapshot) => {
          if (revision !== accountRevision) {
            return;
          }
          await renderSkinLibrary(snapshot);
          if (revision === accountRevision) {
            setStatus('');
          }
        })
        .catch(() => {
          if (revision === accountRevision) {
            setStatus('Selecciona una cuenta Battly para gestionar tus skins');
          }
        });
    });
  });
  document.querySelectorAll<HTMLElement>('[data-skin-close]').forEach((close) => {
    close.addEventListener('click', () => {
      accountRevision += 1;
      libraryRevision += 1;
      clearSkinPreview();
      if (dialog) {
        dialog.classList.remove('is-active');
        dialog.hidden = true;
      }
    });
  });
  document.querySelector<HTMLButtonElement>('[data-skin-apply]')?.addEventListener('click', () => {
    if (selectedSkinId === currentSkinId) {
      setStatus('Esta skin ya está aplicada.');
      return;
    }
    if (selectedSkinId) {
      runSkinAction(() => window.battly.setSkin(selectedSkinId, activeAccount?.uuid), false);
    }
  });
  document.querySelector<HTMLButtonElement>('[data-skin-delete]')?.addEventListener('click', () => {
    if (!selectedSkinId) {
      return;
    }
    const id = selectedSkinId;
    const revision = accountRevision;
    void askBattly({ text: '¿Estás seguro de eliminar esta skin?' }).then((accepted) => {
      if (accepted && revision === accountRevision) {
        runSkinAction(
          () => window.battly.deleteSkin(id, activeAccount?.uuid),
          true,
          'Eliminando skin…',
        );
      }
    });
  });
  document
    .querySelector<HTMLButtonElement>('[data-skin-model]')
    ?.addEventListener('click', (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      const slim = button.getAttribute('aria-pressed') !== 'true';
      button.setAttribute('aria-pressed', String(slim));
      document.querySelector<HTMLElement>('[data-skin-preview]')?.classList.toggle('is-slim', slim);
      if (selectedSkinUrl) {
        showSkin(selectedSkinUrl, slim ? 'slim' : 'default');
      }
    });
  window.addEventListener(
    'beforeunload',
    () => {
      skinViewer?.dispose();
      skinViewer = null;
    },
    { once: true },
  );
}
