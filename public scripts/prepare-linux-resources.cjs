const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
module.exports = async (context) => {
  if (context.electronPlatformName !== 'linux') return;
  const root = context.packager.projectDir;
  const targets = [
    ['frpc/linux-x64/frpc', 'a89129b922f91f1327853a46da65136c52ad421c85315299d333ec06da3f3bbb'],
  ];
  for (const [relative, expected] of targets) {
    const file = path.join(root, 'build-resources', relative);
    const content = await fs.readFile(file);
    if (createHash('sha256').update(content).digest('hex') !== expected)
      throw Error(`Invalid Linux component: ${relative}`);
    await fs.chmod(file, 0o755);
  }
};
