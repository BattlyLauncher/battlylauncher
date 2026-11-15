export function configureOfficialInstaller(
  config: { owner?: unknown; repo?: unknown },
  version: string,
  architecture: string,
  environment: NodeJS.ProcessEnv = process.env,
): void {
  const valid = (value: unknown): value is string =>
    typeof value === 'string' && /^[A-Za-z0-9_.-]+$/.test(value) && !['.', '..'].includes(value);
  if (!valid(config.owner) || !valid(config.repo)) {
    throw Error('Invalid installer repository');
  }
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) {
    throw Error('Invalid installer version');
  }
  if (!['x64', 'ia32', 'arm64'].includes(architecture)) {
    throw Error('Invalid installer architecture');
  }
  environment.BATTLY_INSTALLER_UPDATE_REPOSITORY = `${config.owner}/${config.repo}`;
  environment.BATTLY_INSTALLER_UPDATE_TAG = `v${version}`;
  environment.BATTLY_INSTALLER_UPDATE_ARCH = architecture === 'ia32' ? 'ia32' : 'x64';
}
