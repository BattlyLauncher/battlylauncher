const minimum = { major: 22, minor: 13, patch: 0 };

const current = process.versions.node.split('.').map((part) => Number.parseInt(part, 10));
const [major = 0, minor = 0, patch = 0] = current;

const supported =
  major > minimum.major ||
  (major === minimum.major &&
    (minor > minimum.minor || (minor === minimum.minor && patch >= minimum.patch)));

if (!supported) {
  console.error(`\nNo se puede empaquetar Battly con Node ${process.versions.node}.`);
  console.error('electron-builder 26 necesita Node 22.13.0 o posterior en este proyecto.');
  console.error('\nEn Windows con NVM:');
  console.error('  nvm install 22');
  console.error('  nvm use 22');
  console.error('  npm ci');
  console.error('  npm run build:win:installer\n');
  process.exit(1);
}

console.log(`Runtime de empaquetado compatible: Node ${process.versions.node}`);
