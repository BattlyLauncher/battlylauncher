const { build: base, version, battlyUpdate } = require('./package.json');
require('./public scripts/patch-release-config.cjs').releaseConfig(require('./package.json'));
const [owner, repo] = battlyUpdate.repository.split('/');

module.exports = {
  ...base,
  publish: [
    {
      provider: 'github',
      owner,
      repo,
      channel: battlyUpdate.channel === 'beta' ? 'beta' : 'latest',
    },
  ],
  productName: 'BattlyLauncher',
  directories: { output: `artifacts/releases/release-flatpak-${version}` },
  linux: { ...base.linux, target: [{ target: 'flatpak', arch: ['x64'] }] },
  flatpak: {
    artifactName: 'Battly-Launcher-${version}-x86_64.${ext}',
    runtime: 'org.freedesktop.Platform',
    sdk: 'org.freedesktop.Sdk',
    runtimeVersion: '25.08',
    base: 'org.electronjs.Electron2.BaseApp',
    baseVersion: '25.08',
    branch: 'stable',
    modules: [
      {
        name: 'flite',
        'config-opts': ['--enable-shared', '--with-audio=pulseaudio'],
        'no-parallel-make': true,
        sources: [
          {
            type: 'git',
            url: 'https://github.com/festvox/flite.git',
            tag: 'v2.2',
            commit: 'e9e2e37c329dbe98bfeb27a1828ef9a71fa84f88',
          },
        ],
      },
    ],
    finishArgs: [
      '--share=network',
      '--share=ipc',
      '--socket=x11',
      '--socket=wayland',
      '--device=dri',
      '--socket=pulseaudio',
      '--persist=.battly',
      '--talk-name=org.freedesktop.Notifications',
      '--talk-name=org.freedesktop.secrets',
      '--talk-name=org.kde.kwalletd5',
      '--talk-name=org.kde.kwalletd6',
    ],
  },
};
