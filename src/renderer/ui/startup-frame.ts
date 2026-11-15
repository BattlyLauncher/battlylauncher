/** Hidden windows may suspend animation frames. Never depend on them to show the window. */
export function commitStartupFrame(timeoutMs = 200): Promise<void> {
  return new Promise((resolve) => {
    let frame: number | undefined;
    let done = false;
    const finish = () => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timeout);
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
      }
      resolve();
    };
    const timeout = setTimeout(finish, timeoutMs);
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(finish);
    });
  });
}
