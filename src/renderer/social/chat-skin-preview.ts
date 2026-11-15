import { SkinViewer } from 'skinview3d';

/** Mount one chat portrait. The caller supplies a cropped face as its fallback. */
export function mountChatSkinPreview(stage: HTMLElement, skinUrl: string): () => void {
  const canvas = stage.querySelector<HTMLCanvasElement>('[data-social-chat-skin]');
  const fallback = stage.querySelector<HTMLImageElement>('[data-social-chat-profile-avatar]');
  if (!canvas || !fallback) {
    return () => undefined;
  }

  let disposed = false;
  let failed = !skinUrl.trim();
  let image: HTMLImageElement | null = null;
  let imageLoaded = false;
  let viewer: SkinViewer | null = null;
  let width = 0;
  let height = 0;

  canvas.setAttribute('aria-hidden', 'true');
  canvas.hidden = true;
  fallback.hidden = false;
  stage.dataset.skinState = failed ? 'fallback' : 'loading';

  function visibleSize(): { width: number; height: number } | null {
    if (disposed || document.hidden || !stage.isConnected || !stage.getClientRects().length) {
      return null;
    }
    const style = getComputedStyle(stage);
    if (style.visibility === 'hidden' || style.visibility === 'collapse') {
      return null;
    }
    const bounds = stage.getBoundingClientRect();
    const nextWidth = Math.round(bounds.width);
    const nextHeight = Math.round(bounds.height);
    return nextWidth > 0 && nextHeight > 0 ? { width: nextWidth, height: nextHeight } : null;
  }

  function disposeViewer(): void {
    if (!viewer) {
      return;
    }
    viewer.controls.removeEventListener('change', renderPreview);
    // SkinViewer 3.0.1 omits the composer's two render targets during disposal.
    viewer.composer.dispose();
    viewer.dispose();
    viewer = null;
  }

  function showFallback(): void {
    if (disposed) {
      return;
    }
    failed = true;
    canvas!.hidden = true;
    fallback!.hidden = false;
    stage.dataset.skinState = 'fallback';
    disposeViewer();
  }

  function renderPreview(): void {
    if (!viewer || !visibleSize()) {
      return;
    }
    try {
      viewer.render();
    } catch {
      showFallback();
    }
  }

  function syncPreview(): void {
    const size = visibleSize();
    if (!size || failed) {
      return;
    }

    if (!image) {
      image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        if (disposed) {
          return;
        }
        imageLoaded = true;
        syncPreview();
      };
      image.onerror = showFallback;
      image.src = skinUrl;
      return;
    }
    if (!imageLoaded) {
      return;
    }

    try {
      if (!viewer) {
        width = size.width;
        height = size.height;
        viewer = new SkinViewer({
          canvas: canvas!,
          width,
          height,
          pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
          renderPaused: true,
          zoom: 0.85,
          fov: 45,
        });
        // Loading a decoded image is synchronous, so a late request cannot
        // allocate a texture on a viewer already disposed after a chat switch.
        viewer.loadSkin(image, { model: 'auto-detect' });
        viewer.autoRotate = false;
        viewer.controls.enableDamping = false;
        viewer.controls.enableRotate = true;
        viewer.controls.enableZoom = false;
        viewer.controls.enablePan = false;
        viewer.playerObject.rotation.y = 0.45;
        const skin = viewer.playerObject.skin;
        skin.head.rotation.y = -0.12;
        skin.head.rotation.z = -0.025;
        skin.rightArm.rotation.z = 0.08;
        skin.leftArm.rotation.z = -0.08;
        skin.rightLeg.rotation.x = 0.035;
        skin.leftLeg.rotation.x = -0.035;
        viewer.controls.addEventListener('change', renderPreview);
      } else if (width !== size.width || height !== size.height) {
        width = size.width;
        height = size.height;
        viewer.setSize(width, height);
      }
      // No animation frame loop runs, including while the details panel is hidden.
      viewer.render();
      canvas!.hidden = false;
      fallback!.hidden = true;
      stage.dataset.skinState = 'ready';
    } catch {
      showFallback();
    }
  }

  const resizeObserver = new ResizeObserver(syncPreview);
  resizeObserver.observe(stage);
  const dialog = stage.closest('dialog');
  const visibilityObserver = new MutationObserver(syncPreview);
  if (dialog) {
    visibilityObserver.observe(dialog, {
      attributes: true,
      attributeFilter: ['open', 'hidden', 'data-details'],
    });
  }
  document.addEventListener('visibilitychange', syncPreview);
  canvas.addEventListener('webglcontextlost', showFallback);
  syncPreview();

  return () => {
    if (disposed) {
      return;
    }
    disposed = true;
    resizeObserver.disconnect();
    visibilityObserver.disconnect();
    document.removeEventListener('visibilitychange', syncPreview);
    canvas.removeEventListener('webglcontextlost', showFallback);
    if (image) {
      image.onload = null;
      image.onerror = null;
      if (!imageLoaded) {
        image.removeAttribute('src');
      }
      image = null;
    }
    disposeViewer();
    canvas.hidden = true;
    fallback.hidden = false;
    delete stage.dataset.skinState;
  };
}
