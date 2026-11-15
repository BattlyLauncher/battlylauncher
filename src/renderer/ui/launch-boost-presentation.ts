export function setLaunchBoostPreference(input: HTMLInputElement, enabled: boolean): void {
  input.dataset.requestedBoost = String(enabled);
  input.checked = enabled && !input.disabled;
}

export function applyLaunchBoostEntitlement(root: Document, premium: boolean): void {
  const input = root.querySelector<HTMLInputElement>('#launchboost');
  if (!input) {
    return;
  }
  if (!input.disabled) {
    input.dataset.requestedBoost = String(input.checked);
  }
  input.disabled = !premium;
  input.checked = premium && input.dataset.requestedBoost === 'true';
  root.querySelector('#launchboost-panel')?.setAttribute('data-locked', String(!premium));
}
