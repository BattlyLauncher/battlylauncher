const boundLists = new WeakSet<HTMLElement>();

export function bindFriendsDragScroll(list: HTMLElement): void {
  if (boundLists.has(list)) {
    return;
  }
  boundLists.add(list);
  let pointer: number | undefined;
  let startX = 0;
  let startScroll = 0;
  let dragged = false;
  let suppressClick = false;
  list.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.pointerType === 'touch') {
      return;
    }
    pointer = event.pointerId;
    startX = event.clientX;
    startScroll = list.scrollLeft;
    dragged = false;
    suppressClick = false;
  });
  list.addEventListener('pointermove', (event) => {
    if (event.pointerId !== pointer) {
      return;
    }
    const distance = event.clientX - startX;
    if (!dragged && Math.abs(distance) < 6) {
      return;
    }
    if (!dragged) {
      dragged = true;
      list.setPointerCapture(event.pointerId);
      list.classList.add('is-dragging');
    }
    event.preventDefault();
    list.scrollLeft = startScroll - distance;
  });
  const finish = (event: PointerEvent): void => {
    if (event.pointerId !== pointer) {
      return;
    }
    suppressClick = dragged;
    pointer = undefined;
    list.classList.remove('is-dragging');
    if (list.hasPointerCapture(event.pointerId)) {
      list.releasePointerCapture(event.pointerId);
    }
  };
  list.addEventListener('pointerup', finish);
  list.addEventListener('pointercancel', finish);
  list.addEventListener('lostpointercapture', finish);
  list.addEventListener('pointerleave', (event) => {
    if (!dragged) {
      finish(event);
    }
  });
  list.addEventListener('dragstart', (event) => event.preventDefault());
  list.addEventListener(
    'click',
    (event) => {
      if (!suppressClick || event.detail === 0) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressClick = false;
    },
    true,
  );
}
