import { networkAvailable } from '../network/connectivity';
import type { MinecraftLaunchOptions } from './launcher-adapter';

/** Keep the saved identity/UUID (and world inventories), but never make an offline
 * single-player launch depend on the remote authentication agent. Saved tokens are untouched. */
export function prepareOfflineLaunch(options: MinecraftLaunchOptions): MinecraftLaunchOptions {
  if (networkAvailable()) {
    return options;
  }
  return {
    ...options,
    authorization: { ...options.authorization, accessToken: '0', type: 'offline' },
    javaArguments: options.javaArguments.filter(
      (argument) =>
        !/^-javaagent:(?:.*[/\\])?authlib-injector\.jar(?:=|$)/i.test(argument) &&
        !/^-Dauthlibinjector\./i.test(argument) &&
        !/^-Xbootclasspath\/a:(?:.*[/\\])?authlib-injector\.jar$/i.test(argument),
    ),
    ...(options.core ? { core: { ...options.core, resourceUrl: null, beforeLaunch: null } } : {}),
  };
}
