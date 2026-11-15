import type { AccountCollection } from '../../shared/accounts/account';
import { presentPremiumWelcome } from './premium-celebration';
import { applyLaunchBoostEntitlement } from './launch-boost-presentation';

export function applyPremiumPresentation(
  collection: AccountCollection,
  root: Document = document,
): void {
  // Minecraft ownership is separate from the Battly Plus subscription.
  const premiumAccount = collection.accounts.find(
    (account) => account.type === 'battly' && account.premium,
  );
  const premium = Boolean(premiumAccount);
  const advertisements = [...root.querySelectorAll<HTMLElement>('#ads, .b-ad-slot, [data-ad-slot]')]
    .map((slot) => slot.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0);
  root.body.dataset.battlyPlus = String(premium);
  applyLaunchBoostEntitlement(root, premium);
  root.querySelector('.titlebar')?.classList.toggle('is-premium', premium);
  const title = root.querySelector('[data-app-info]');
  if (
    title &&
    (!premium || !['waiting', 'explosion'].includes(root.body.dataset.plusWelcomeStage ?? ''))
  ) {
    title.textContent = `Battly Launcher 3.1.0 ${premium ? 'Premium' : 'Free'} Edition`;
  }
  root.querySelectorAll<HTMLElement>('#ads, .b-ad-slot, [data-ad-slot]').forEach((slot) => {
    slot.hidden = premium;
    if (premium && slot.tagName === 'IFRAME') {
      slot.setAttribute('src', 'about:blank');
    }
  });
  presentPremiumWelcome(premiumAccount?.uuid ?? null, advertisements, root);
}
