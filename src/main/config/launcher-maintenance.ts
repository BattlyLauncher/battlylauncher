import type { LauncherConfig } from '../../shared/config/launcher-config';
import type { RemoteJsonResult } from './remote-json-client';

/** A cached maintenance flag must not lock out an offline installation. */
export async function launcherMaintenance(
  load: () => Promise<RemoteJsonResult<Pick<LauncherConfig, 'maintenance' | 'maintenanceMessage'>>>,
): Promise<{ message: string } | null> {
  try {
    const result = await load();
    if (result.source === 'network' && result.data.maintenance) {
      return { message: result.data.maintenanceMessage.trim().slice(0, 4096) };
    }
  } catch {
    // As in 3.0.1, an unavailable configuration must still allow offline startup.
  }
  return null;
}
