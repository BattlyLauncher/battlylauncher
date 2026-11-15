import type { UsageDay } from '../../shared/mybattly/mybattly-contract';
import { setUiText, translateUiText } from '../i18n/dialog-text';
import { uiLocale } from '../i18n/locale';

function duration(seconds: number): string {
  return seconds < 60
    ? `${Math.floor(seconds)} s`
    : `${Math.floor(seconds / 3600)} h ${Math.floor((seconds % 3600) / 60)} min`;
}
function dateLabel(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(uiLocale(), {
    day: 'numeric',
    month: 'short',
  });
}
function periodDays(history: readonly UsageDay[], count: number): UsageDay[] {
  const first = history.map((day) => day.date).sort()[0];
  return Array.from({ length: count }, (_, index) => {
    const day = new Date();
    day.setDate(day.getDate() - count + index + 1);
    const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    return history.find((item) => item.date === date) ?? { date, game: 0, launcher: 0, hours: [] };
  }).filter((day) => !first || day.date >= first);
}
function graph(
  values: readonly { game: number; launcher: number; label: string }[],
  hourly = false,
): HTMLElement {
  const frame = document.createElement('div');
  frame.className = 'b-usage-graph';
  const maximum = Math.max(60, ...values.flatMap((v) => [v.game, v.launcher]));
  const x = (i: number) =>
    values.length === 1 ? 346 : 36 + i * (620 / Math.max(1, values.length - 1));
  const y = (v: number) => 180 - (v / maximum) * 145;
  const path = (key: 'game' | 'launcher') =>
    values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(v[key]).toFixed(2)}`).join(' ');
  const grid = [0, 0.5, 1]
    .map(
      (r) =>
        /* HTML */ `<line
            x1="36"
            x2="660"
            y1="${180 - r * 145}"
            y2="${180 - r * 145}"
            stroke="var(--usage-grid, #304158)"
          /><text
            x="0"
            y="${184 - r * 145}"
            fill="var(--usage-muted, #9db2cc)"
            font-size="10"
            >${maximum * r < 60 ? Math.round(maximum * r) + 's' : Math.round((maximum * r) / 60) + 'm'}</text
          >`,
    )
    .join('');
  const lines = (['game', 'launcher'] as const)
    .map((key, index) => {
      const color = index ? 'var(--usage-secondary)' : 'var(--theme-color, #7048c4)';
      if (!hourly && values.length === 1) {
        const value = values[0];
        return /* HTML */ `<rect
          x="${290 + index * 64}"
          y="${y(value[key])}"
          width="48"
          height="${180 - y(value[key])}"
          rx="5"
          fill="${color}"
          ><title>${value.label}: ${duration(value[key])}</title></rect
        >`;
      }
      if (hourly) {
        return values
          .map(
            (v, i) =>
              /* HTML */ `<rect
                x="${36 + i * 25 + index * 9}"
                y="${y(v[key])}"
                width="8"
                height="${180 - y(v[key])}"
                rx="2"
                fill="${color}"
                ><title>${v.label}: ${duration(v[key])}</title></rect
              >`,
          )
          .join('');
      }
      return (
        /* HTML */ `<path d="${path(key)} L${x(Math.max(0, values.length - 1))},180 L${x(0)},180 Z" fill="${color}" fill-opacity=".08"/><path d="${path(key)}" fill="none" stroke="${color}" stroke-width="2.5"/>` +
        values
          .map(
            (v, i) =>
              `<circle cx="${x(i)}" cy="${y(v[key])}" r="3" fill="${color}"><title>${v.label}: ${duration(v[key])}</title></circle>`,
          )
          .join('')
      );
    })
    .join('');
  const labels = values
    .filter(
      (_, i) =>
        i === 0 || i === values.length - 1 || i % Math.max(1, Math.ceil(values.length / 6)) === 0,
    )
    .map((v) => {
      const i = values.indexOf(v);
      return /* HTML */ `<text
        x="${hourly ? 40 + i * 25 : x(i)}"
        y="205"
        text-anchor="middle"
        fill="var(--usage-muted, #9db2cc)"
        font-size="11"
        >${v.label}</text
      >`;
    })
    .join('');
  frame.innerHTML = /* HTML */ `<svg
    viewBox="0 0 690 220"
    role="img"
    aria-label="${translateUiText(hourly ? 'Uso por horas' : 'Uso diario')}"
  >
    ${grid}${lines}${labels}
  </svg>`;
  return frame;
}

export function renderUsageChart(host: HTMLElement, history: readonly UsageDay[]): void {
  host.replaceChildren();
  const title = document.createElement('h3');
  setUiText(title, 'Actividad en PC');
  host.append(title);
  const summary = document.createElement('p');
  if (!history.length) {
    setUiText(summary, 'No hay historial de actividad disponible.');
    host.append(summary);
    return;
  }
  const recent = periodDays(history, 7);
  host.append(graph(recent.map((d) => ({ ...d, label: dateLabel(d.date) }))));
  const legend = document.createElement('p');
  legend.className = 'b-usage-legend';
  legend.innerHTML = '<span>● Minecraft</span><span>● Battly Launcher</span>';
  host.append(legend);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button is-info is-small is-outlined';
  setUiText(button, 'Ver actividad');
  button.onclick = () => openUsageHistory(history);
  host.append(button);
}

export function openUsageHistory(history: readonly UsageDay[]): void {
  document.querySelector('.b-usage-dialog')?.remove();
  const dialog = document.createElement('dialog');
  dialog.className = 'b-usage-dialog';
  const header = document.createElement('header');
  const heading = document.createElement('h2');
  heading.id = 'usage-title';
  setUiText(heading, 'Actividad en PC');
  dialog.setAttribute('aria-labelledby', heading.id);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'delete';
  close.setAttribute('aria-label', translateUiText('Cerrar'));
  close.onclick = () => dialog.close();
  header.append(heading, close);
  const body = document.createElement('section');
  const filters = document.createElement('div');
  filters.className = 'b-usage-filters';
  const period = document.createElement('select');
  period.setAttribute('aria-label', translateUiText('Periodo'));
  [7, 30, 90].forEach((n) => period.add(new Option(`${n} ${translateUiText('días')}`, String(n))));
  const day = document.createElement('select');
  day.setAttribute('aria-label', translateUiText('Día'));
  filters.append(period, day);
  const daily = document.createElement('div'),
    hourly = document.createElement('div'),
    summary = document.createElement('p'),
    detail = document.createElement('p');
  detail.setAttribute('aria-live', 'polite');
  const legend = document.createElement('p');
  legend.className = 'b-usage-legend';
  legend.innerHTML = '<span>● Minecraft</span><span>● Battly Launcher</span>';
  const showDay = () => {
    const selected = periodDays(history, Number(period.value)).find((d) => d.date === day.value);
    if (!selected) {
      return;
    }
    detail.textContent = `${dateLabel(selected.date)} · Minecraft: ${duration(selected.game)} · Battly Launcher: ${duration(selected.launcher)}`;
    const values = Array.from({ length: 24 }, (_, hour) => ({
      ...(selected.hours.find((h) => h.hour === hour) ?? { game: 0, launcher: 0 }),
      label: `${hour}:00`,
    }));
    hourly.replaceChildren(graph(values, true));
  };
  const redraw = () => {
    const rows = periodDays(history, Number(period.value));
    summary.className = 'b-usage-total';
    summary.textContent = `Minecraft: ${duration(rows.reduce((s, d) => s + d.game, 0))} · Battly Launcher: ${duration(rows.reduce((s, d) => s + d.launcher, 0))}`;
    daily.replaceChildren(graph(rows.map((d) => ({ ...d, label: dateLabel(d.date) }))));
    day.replaceChildren();
    [...rows].reverse().forEach((d) => day.add(new Option(dateLabel(d.date), d.date)));
    hourly.replaceChildren();
    detail.textContent = '';
    showDay();
  };
  day.onchange = showDay;
  period.onchange = redraw;
  const dailyTitle = document.createElement('h3');
  setUiText(dailyTitle, 'Uso diario');
  const hourTitle = document.createElement('h3');
  setUiText(hourTitle, 'Uso por horas');
  body.append(filters, summary, legend, dailyTitle, daily, hourTitle, detail, hourly);
  dialog.append(header, body);
  dialog.onclose = () => dialog.remove();
  document.body.append(dialog);
  redraw();
  dialog.showModal();
  period.focus();
}
