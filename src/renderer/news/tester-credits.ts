export const releaseTesters = [
  {
    username: 'youknow',
    discord: '@mangoeatersupreme',
    discordDisplayName: '𝗠𝗮𝗻𝗴𝗼𝗗𝗲𝘃🥭',
  },
  {
    username: 'KGDPS_Leonardo23',
    discord: '@kgdps_leonardo2345',
    discordDisplayName: '[ LGDPS ] Leonardo3245',
  },
  {
    username: 'xxnewcuboxx',
    discord: '@xxnewcuboxx',
    discordDisplayName: 'xxnewcuboxx',
  },
  {
    username: 'josenice2686J',
    discord: '@josenice2686.',
    discordDisplayName: 'Josenice2686',
  },
  {
    username: 'Pablo0_0001',
    discord: '@pablo0_01.',
    discordDisplayName: 'Pablo',
  },
  {
    username: 'Nusaxd',
    discord: '@rizzer_47322',
    discordDisplayName: 'Nusa',
  },
  {
    username: 'joaosito098',
    discord: '@joaositojuega_02690',
    discordDisplayName: 'JoaositoJuega',
  },
  {
    username: 'SpokeIsHere',
    discord: '@nidea___',
    discordDisplayName: 'emo c',
  },
  {
    username: 'TheRoken',
    discord: '@theroken_1',
    discordDisplayName: 'TheRoken',
  },
  {
    username: 'djamalbchy',
    discord: '@lleagy',
    discordDisplayName: 'Lleagy',
  },
  {
    username: 'super_YT',
    discord: '@supergamerrojas_ytoficial',
    discordDisplayName: 'Super Gamer rojas_YT Oficial',
  },
  {
    username: 'YojanderGaming',
    discord: '@yojanderxd',
    discordDisplayName: 'YojanderGaming',
  },
  {
    username: 'Galito_2012',
    discord: '@galito_2012',
    discordDisplayName: '+🔴 𝕲𝓪𝓵𝓲𝓽𝓸░২░০░১░২░ 💎 🌆',
  },
  {
    username: 'mayi428',
    discord: '@mati01569',
    discordDisplayName: 'Mati',
  },
  {
    username: 'Maximo_12352',
    discord: '@maximoo04038',
    discordDisplayName: 'Maxiimoo',
  },
  {
    username: '3lwaldi',
    discord: '@3lwaldi',
    discordDisplayName: 'Ⲱⲁ𝓵ⲇⲓⲓⲓ Ⲇⲓⲟ𝛓 ⲇⲉ ⲗⲟ𝛓 Ⲗⲉ𝛄ⲟ𝛓',
  },
  {
    username: 'CarloX2011',
    discord: '@pan_x0123',
    discordDisplayName: 'ᑭᗩ᙭ツ',
  },
  {
    username: 'arinto',
    discord: '@geometrymusic',
    discordDisplayName: 'Arinto',
  },
  {
    username: 'Teterrax',
    discord: '@teterax',
    discordDisplayName: '-°TETERRAX°-',
  },
] as const;

export function mountTesterCredits(
  panel: HTMLElement,
  faceUrl: (username: string) => string,
): void {
  const list = panel.querySelector<HTMLUListElement>('[data-news-testers]');
  if (!list) {
    return;
  }
  const cards = releaseTesters.map((tester) => {
    const card = document.createElement('li');
    card.className = 'release-news__tester';
    card.setAttribute('translate', 'no');
    const face = document.createElement('img');
    face.src = faceUrl(tester.username);
    face.alt = '';
    face.width = 48;
    face.height = 48;
    face.loading = 'lazy';
    face.decoding = 'async';
    const names = document.createElement('div');
    const username = document.createElement('strong');
    username.textContent = tester.username;
    username.dir = 'auto';
    username.setAttribute('aria-label', `Battly: ${tester.username}`);
    const discord = document.createElement('span');
    discord.className = 'release-news__tester-discord';
    const icon = document.createElement('i');
    icon.className = 'fa-brands fa-discord';
    icon.setAttribute('aria-hidden', 'true');
    const discordName = document.createElement('span');
    discordName.textContent = tester.discord;
    discordName.dir = 'auto';
    discordName.title = tester.discordDisplayName;
    discordName.setAttribute(
      'aria-label',
      `Discord: ${tester.discordDisplayName}, ${tester.discord}`,
    );
    discord.append(icon, discordName);
    names.append(username, discord);
    card.append(face, names);
    return card;
  });
  list.replaceChildren(...cards);
}
