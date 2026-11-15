import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { SettingsStore } from '../settings/settings-store';

const importantText = `IMPORTANTE - Battly Launcher

Esta carpeta contiene los datos de Minecraft administrados por Battly.
No elimines ni muevas sus archivos mientras el launcher o Minecraft estén abiertos.
`;

export class NewsStateService {
  constructor(
    private readonly settings: SettingsStore,
    private readonly importantFilePath: string,
    private readonly translate: (source: string) => string = (source) => source,
  ) {}

  async state(): Promise<{ readonly seen: boolean }> {
    return { seen: await this.settings.newsSeen() };
  }

  async complete(): Promise<{ readonly seen: true }> {
    await this.settings.markNewsSeen();
    await mkdir(dirname(this.importantFilePath), { recursive: true });
    await writeFile(this.importantFilePath, this.translate(importantText), {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    });
    return { seen: true };
  }
}
