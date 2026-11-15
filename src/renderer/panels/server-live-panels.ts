import type { ServerRuntimeSnapshot } from '../../shared/servers/server-contract';

const histories = new Map<string, { at: number; cpu: number[]; ram: number[] }>();

export function renderServerCharts(snapshot: ServerRuntimeSnapshot): void {
  const history = histories.get(snapshot.id) ?? { at: 0, cpu: [], ram: [] };
  if (Date.now() - history.at > 1000) {
    history.at = Date.now();
    history.cpu.push(snapshot.cpuPercent);
    history.ram.push(snapshot.memoryMb);
    if (history.cpu.length > 60) {
      history.cpu.shift();
      history.ram.shift();
    }
    histories.set(snapshot.id, history);
  }
  for (const [id, values, unit, minimum] of [
    ['cpuChart', history.cpu, '%', 100],
    ['ramChart', history.ram, ' MB', 512],
  ] as const) {
    const canvas = document.getElementById(id) as HTMLCanvasElement | null;
    if (!canvas || !canvas.clientWidth) {
      continue;
    }
    const width = canvas.clientWidth,
      height = 180,
      ratio = window.devicePixelRatio || 1;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      continue;
    }
    ctx.scale(ratio, ratio);
    const max = Math.max(minimum, ...values);
    const color =
      getComputedStyle(document.body).getPropertyValue('--theme-color').trim() || '#3e8ed0';
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#b8c8df';
    ctx.fillText(`${(values.at(-1) ?? 0).toFixed(1)}${unit}`, 8, 18);
    ctx.strokeStyle = '#ffffff18';
    for (let y = 35; y < height; y += 35) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.beginPath();
    values.forEach((value, index) => {
      const x = 5 + (index / 59) * (width - 10),
        y = height - 8 - (value / max) * (height - 40);
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    if (values.length === 1) {
      ctx.lineTo(7, height - 8 - (values[0] / max) * (height - 40));
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    if (values.length) {
      ctx.lineTo(5 + ((values.length - 1) / 59) * (width - 10), height - 8);
      ctx.lineTo(5, height - 8);
      ctx.closePath();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = color;
      ctx.fill();
    }
    canvas.setAttribute('role', 'img');
    canvas.setAttribute(
      'aria-label',
      `${id === 'cpuChart' ? 'CPU' : 'RAM'}: ${(values.at(-1) ?? 0).toFixed(1)}${unit}`,
    );
  }
}

export function renderOnlineServerPlayers(snapshot: ServerRuntimeSnapshot): void {
  const list = document.querySelector<HTMLElement>('#jugadores > .columns');
  if (!list) {
    return;
  }
  const names = snapshot.onlinePlayers ?? [];
  const key = JSON.stringify([snapshot.id, snapshot.status, names]);
  if (list.dataset.playersKey === key) {
    return;
  }
  list.dataset.playersKey = key;
  list.replaceChildren();
  if (!names.length) {
    const empty = document.createElement('p');
    empty.textContent =
      snapshot.status === 'running' ? 'No hay jugadores conectados.' : 'El servidor está detenido.';
    list.append(empty);
  }
  for (const name of names) {
    const card = document.createElement('article');
    card.className = 'b-servers-player-card';
    const face = document.createElement('img');
    face.className = 'b-servers-live-face';
    face.src = `https://mc-heads.net/avatar/${encodeURIComponent(name)}/64`;
    face.alt = '';
    const title = document.createElement('strong');
    title.textContent = name;
    const actions = document.createElement('div');
    actions.className = 'b-servers-player-actions';
    for (const [command, label, icon] of [
      ['op', 'Dar OP', 'fa-shield'],
      ['deop', 'Quitar OP', 'fa-shield-halved'],
      ['kick', 'Expulsar', 'fa-right-from-bracket'],
      ['ban', 'Banear', 'fa-ban'],
    ]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button is-small';
      const glyph = document.createElement('i');
      glyph.className = `fa-solid ${icon}`;
      button.append(glyph, ` ${label}`);
      button.onclick = () => {
        button.disabled = true;
        void window.battly
          .sendServerCommand(snapshot.id, `${command} ${name}`)
          .catch(() => {
            button.title = 'No se pudo enviar el comando';
          })
          .finally(() => {
            button.disabled = false;
          });
      };
      actions.append(button);
    }
    card.append(face, title, actions);
    list.append(card);
  }
}
