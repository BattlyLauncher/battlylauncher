/** Release news can precede login; launcher features require a saved account. */
export function resolveLauncherPanel(requested: string, hasAccount: boolean): string {
  if (!hasAccount) {
    return requested === 'news' ? 'news' : 'login';
  }
  return requested === 'welcome' || requested === 'language' ? 'home' : requested;
}
