import {
  defaultWorldsPreferences,
  normalizeWorldsPreferences,
  type WorldsPreferences,
} from '../../shared/settings/game-preferences';
import { applyWorldsPreferences } from '../social/worlds-preferences';
import { translateUiText } from '../i18n/dialog-text';

let root: HTMLElement | undefined;
const groups: { title: string; fields: [keyof WorldsPreferences, string, string][] }[] = [
  {
    title: 'Sala',
    fields: [
      [
        'defaultPublic',
        'Sala predeterminada',
        'Las salas nuevas empiezan públicas cuando la lista pública está permitida.',
      ],
      [
        'allowPublicListing',
        'Permitir lista pública',
        'Permite publicar tu sala en Battly Worlds.',
      ],
      [
        'durationHours',
        'Duración predeterminada (horas)',
        'Se limita automáticamente al máximo permitido por tu cuenta al crear la sala.',
      ],
      [
        'autoLanDetection',
        'Detectar mundos LAN automáticamente',
        'Sugiere compartir tu mundo al abrirlo en LAN.',
      ],
      [
        'closeOnGameExit',
        'Cerrar la sala al salir de Minecraft',
        'Cierra la conexión y el registro de la sala cuando sales del juego.',
      ],
    ],
  },
  {
    title: 'Invitaciones',
    fields: [
      ['invitations', 'Invitaciones', 'Recibe avisos de invitaciones de tus amigos.'],
      [
        'connectionAlerts',
        'Avisos de conexión',
        'Muestra avisos sobre cambios en la conexión de Worlds.',
      ],
    ],
  },
  {
    title: 'Audio y chat de voz',
    fields: [
      [
        'voiceAutoJoin',
        'Unirse automáticamente al chat de voz',
        'Conecta con el chat de voz al entrar en una sala.',
      ],
      ['voiceMuted', 'Micrófono silenciado', 'Conserva este estado entre salas y partidas.'],
      [
        'voiceDeafened',
        'Ensordecer el chat de voz',
        'Silencia el audio recibido y tu micrófono sin salir de la sala.',
      ],
      [
        'voiceSounds',
        'Sonidos de conexión del chat de voz',
        'Reproduce un aviso cuando alguien entra o sale del chat de voz.',
      ],
      [
        'overlayEnabled',
        'Mostrar overlay de voz',
        'Muestra el panel sobre Minecraft en modo ventana. Ctrl + B abre el panel completo.',
      ],
      ['overlayOpacity', 'Transparencia del overlay', 'Visibilidad del overlay, entre 25 y 100 %.'],
    ],
  },
];
export function setWorldsSettings(value: WorldsPreferences): void {
  applyWorldsPreferences(value);
  root
    ?.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-worlds-setting]')
    .forEach((input) => {
      const v = value[input.dataset.worldsSetting as keyof WorldsPreferences];
      if (input instanceof HTMLInputElement && input.type === 'checkbox') {
        input.checked = v === true;
      } else {
        input.value = String(v);
      }
    });
}
export function readWorldsSettings(): WorldsPreferences {
  const value: Record<string, unknown> = { ...defaultWorldsPreferences };
  root
    ?.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-worlds-setting]')
    .forEach((input) => {
      value[input.dataset.worldsSetting ?? ''] =
        input instanceof HTMLInputElement && input.type === 'checkbox'
          ? input.checked
          : input.value;
    });
  value.defaultPublic = value.defaultPublic === 'true';
  return normalizeWorldsPreferences(value);
}
export function mountWorldsSettings(section: HTMLElement): void {
  root = section;
  for (const group of groups) {
    const fieldset = document.createElement('fieldset'),
      legend = document.createElement('legend');
    legend.textContent = group.title;
    fieldset.append(legend);
    for (const [key, label, description] of group.fields) {
      const row = document.createElement('label');
      row.className = 'worlds-setting-row';
      const text = document.createElement('span'),
        title = document.createElement('strong'),
        detail = document.createElement('small');
      title.textContent = label;
      detail.textContent = description;
      text.append(title, detail);
      row.append(text);
      let control: HTMLInputElement | HTMLSelectElement;
      if (key === 'defaultPublic') {
        control = document.createElement('select');
        control.add(new Option('Privada', 'false'));
        control.add(new Option('Pública', 'true'));
      } else {
        control = document.createElement('input');
        control.type = key === 'durationHours' || key === 'overlayOpacity' ? 'number' : 'checkbox';
        if (control.type === 'number') {
          control.min = key === 'durationHours' ? '1' : '25';
          control.max = key === 'durationHours' ? '720' : '100';
          control.step = '1';
        }
      }
      control.dataset.worldsSetting = key;
      row.append(control);
      fieldset.append(row);
    }
    section.append(fieldset);
  }
  const diagnostics = document.createElement('fieldset');
  diagnostics.innerHTML = /* HTML */ `<legend>Conexión y diagnóstico</legend>
    <div class="minecraft-window-actions">
      <button
        type="button"
        data-worlds-diagnostic="status"
      >
        Estado de conexión
      </button>
      <button
        type="button"
        data-worlds-diagnostic="test"
      >
        Probar conexión
      </button>
      <button
        type="button"
        data-worlds-diagnostic="report"
      >
        Diagnóstico de Battly Worlds
      </button>
      <button
        type="button"
        data-worlds-diagnostic="reset-overlay"
      >
        Restablecer posición del overlay
      </button>
    </div>
    <div
      data-worlds-diagnostic-result
      hidden
    >
      <input
        type="search"
        data-worlds-diagnostic-search
        placeholder="Buscar en el diagnóstico"
        aria-label="Buscar en el diagnóstico"
      />
      <textarea
        readonly
        data-worlds-diagnostic-output
        rows="6"
        aria-label="Diagnóstico de Worlds"
      ></textarea>
      <button
        type="button"
        data-worlds-diagnostic-copy
      >
        Copiar diagnóstico
      </button>
    </div>
    <p
      role="status"
      data-worlds-diagnostic-status
    >
      Elige una consulta para ver el diagnóstico de la conexión.
    </p>`;
  section.append(diagnostics);
  let report = '';
  const output = diagnostics.querySelector<HTMLTextAreaElement>('textarea')!;
  const status = diagnostics.querySelector<HTMLElement>('[data-worlds-diagnostic-status]')!;
  diagnostics.querySelector<HTMLInputElement>('[data-worlds-diagnostic-search]')!.oninput = (
    event,
  ) => {
    const search = (event.target as HTMLInputElement).value.toLowerCase();
    output.value = report
      .split('\n')
      .filter((line) => line.toLowerCase().includes(search))
      .join('\n');
  };
  diagnostics.querySelectorAll<HTMLButtonElement>('[data-worlds-diagnostic]').forEach((button) => {
    button.onclick = () => {
      button.disabled = true;
      status.textContent = 'Consultando…';
      void window.battly
        .worldsDiagnostics(
          button.dataset.worldsDiagnostic as 'status' | 'test' | 'report' | 'reset-overlay',
        )
        .then((text) => {
          report = text
            .split('\n')
            .map((line) => translateUiText(line))
            .join('\n');
          output.value = report;
          diagnostics.querySelector<HTMLElement>('[data-worlds-diagnostic-result]')!.hidden = false;
          diagnostics.querySelector<HTMLInputElement>('[data-worlds-diagnostic-search]')!.value =
            '';
          status.textContent = 'Consulta completada.';
        })
        .catch((error) => {
          status.textContent =
            error instanceof Error ? error.message : 'No se pudo completar el diagnóstico.';
        })
        .finally(() => {
          button.disabled = false;
        });
    };
  });
  diagnostics.querySelector<HTMLButtonElement>('[data-worlds-diagnostic-copy]')!.onclick = () => {
    void navigator.clipboard
      .writeText(report)
      .then(() => {
        status.textContent = 'Diagnóstico copiado.';
      })
      .catch(() => {
        status.textContent = 'No se pudo copiar el diagnóstico.';
      });
  };
  setWorldsSettings(defaultWorldsPreferences);
}
