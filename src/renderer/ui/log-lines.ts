import { formatLog4jText } from '../../shared/minecraft/log4j-log';
import './log-lines.css';
export type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'trace' | 'plain';
const renderedLogs = new WeakMap<HTMLElement, { text: string; children: number }>();
export function logLevel(line: string, previous: LogLevel = 'plain'): LogLevel {
  const token = line
    .match(
      /(?:\[[^\]\r\n]*[\s/]|\[|^\s*|\s)(FATAL|ERROR|SEVERE|WARN(?:ING)?|INFO|DEBUG|TRACE)(?=[\]\s:])/i,
    )?.[1]
    ?.toUpperCase();
  if (token) {
    return /FATAL|ERROR|SEVERE/.test(token)
      ? 'error'
      : /WARN/.test(token)
        ? 'warn'
        : (token.toLowerCase() as LogLevel);
  }
  if (/^\s*(?:at\s|Caused by:|Suppressed:|\.\.\. \d+ more)/.test(line)) {
    return previous;
  }
  return 'plain';
}
export function renderLogLines(host: HTMLElement, text: string): void {
  const previousRender = renderedLogs.get(host);
  if (
    previousRender?.text === text &&
    previousRender.children === host.childElementCount &&
    host.classList.contains('b-log-view')
  ) {
    return;
  }
  const fragment = document.createDocumentFragment();
  let previous: LogLevel = 'plain';
  for (const line of formatLog4jText(text).split('\n')) {
    previous = logLevel(line, previous);
    const span = document.createElement('span');
    span.className = `b-log-line b-log-${previous}`;
    span.textContent = line + '\n';
    fragment.append(span);
  }
  host.classList.add('b-log-view');
  host.replaceChildren(fragment);
  renderedLogs.set(host, { text, children: host.childElementCount });
}
