import type { UpdateAction, UpdateSnapshot } from '../../shared/updates';
import type { StartupUpdateSnapshot } from '../../shared/startup-updates';

export interface StartupUpdateService {
  snapshot(): UpdateSnapshot;
  action(action: UpdateAction): Promise<UpdateSnapshot>;
}

export function startupUpdateSnapshot(s: UpdateSnapshot): StartupUpdateSnapshot {
  const phase =
    s.status === 'error' || s.installationError
      ? 'error'
      : s.status === 'checking' || s.status === 'idle'
        ? 'checking'
        : s.phase || 'downloading';
  return {
    phase,
    kind: s.kind,
    target: s.target.slice(0, 100),
    percent:
      phase === 'downloading' ||
      (s.kind === 'patch' && (phase === 'installing' || phase === 'verifying'))
        ? Math.max(0, Math.min(100, s.percent || 0))
        : null,
    downloaded: s.downloaded,
    reused: s.reused,
    channel: s.settings.channel,
  };
}

/** Startup owns this check; background checks begin only after the launcher opens. */
export async function runStartupUpdate(
  service: StartupUpdateService,
  report: (snapshot: StartupUpdateSnapshot) => void,
  install: () => Promise<unknown>,
  retryInstallation = false,
  checkedSnapshot?: UpdateSnapshot,
): Promise<'current' | 'handoff' | 'error'> {
  const refresh = (): void => report(startupUpdateSnapshot(service.snapshot()));
  const timer = setInterval(refresh, 100);
  try {
    const checked = checkedSnapshot ?? (await service.action('check'));
    refresh();
    if (checked.status === 'idle') {
      return 'current';
    }
    if (checked.status === 'available') {
      await service.action('download');
    }
    refresh();
    const ready = service.snapshot();
    if (ready.status !== 'ready') {
      return 'error';
    }
    if (ready.installationError && !retryInstallation) {
      return 'error';
    }
    clearInterval(timer);
    report({ ...startupUpdateSnapshot(ready), phase: 'installing', percent: null });
    // Present the verified handoff before the installer/relaunch takes control.
    await new Promise((resolve) => setTimeout(resolve, 180));
    await install();
    const after = service.snapshot();
    return after.status === 'error' || after.installationError ? 'error' : 'handoff';
  } catch {
    return 'error';
  } finally {
    clearInterval(timer);
  }
}
