/** Only host-provided PNG data is accepted; account endpoints stay in the host. */
export function setOverlayAvatar(
  image: HTMLImageElement,
  username: string,
  api: { faceImageUrl(username: string): string | Promise<string> },
): void {
  image.dataset.avatarOwner = username;
  image.hidden = true;
  void Promise.resolve()
    .then(() => api.faceImageUrl(username))
    .then((value) => {
      if (image.dataset.avatarOwner !== username) {
        return;
      }
      if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value) || value.length > 400000) {
        return;
      }
      image.src = value;
      image.hidden = false;
    })
    .catch(() => {
      /* Keep the existing placeholder when an avatar is unavailable. */
    });
}
