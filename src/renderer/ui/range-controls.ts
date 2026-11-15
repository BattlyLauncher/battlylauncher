export function refreshRangeControls(): void {
  document.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach((input) => {
    const min = input.min === '' ? 0 : Number(input.min);
    const max = input.max === '' ? 100 : Number(input.max);
    const value = max > min ? ((Number(input.value) - min) / (max - min)) * 100 : 0;
    input.style.setProperty('--range-fill', `${Math.max(0, Math.min(100, value))}%`);
  });
}
document.addEventListener('input', (event) => {
  if (event.target instanceof HTMLInputElement && event.target.type === 'range') {
    refreshRangeControls();
  }
});
document.addEventListener('click', () => requestAnimationFrame(refreshRangeControls));
window.addEventListener('load', refreshRangeControls, { once: true });
