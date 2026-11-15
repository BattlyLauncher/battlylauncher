import type {
  MinecraftLaunchEngine,
  MinecraftLaunchEvent,
  MinecraftLaunchWindow,
} from '../../shared/minecraft/launch-contract';
import type { MinecraftCorePackage } from '../../shared/minecraft/core-package';
import type { JsonValue } from '../../shared/storage/legacy-storage';

export interface MinecraftAuthorization {
  readonly accessToken: string;
  readonly clientToken: string;
  readonly name: string;
  readonly type: 'battly' | 'microsoft' | 'offline';
  readonly userProperties?: unknown;
  readonly uuid: string;
}

export interface MinecraftLaunchOptions {
  readonly environment?: Readonly<Record<string, string>>;
  readonly authorization: MinecraftAuthorization;
  readonly core?: {
    readonly beforeLaunch: JsonValue;
    readonly descriptor: MinecraftCorePackage;
    readonly downloadConcurrency: number;
    readonly ignored: readonly string[];
    readonly loader: {
      readonly build: string;
      readonly enabled: boolean;
      readonly path?: string;
      readonly type: string;
    };
    readonly resourceUrl: string | null;
    readonly timeoutMs: number;
    readonly verify: boolean;
  };
  readonly engine: MinecraftLaunchEngine;
  readonly forgePath?: string;
  readonly gameArguments: readonly string[];
  readonly gameDirectory: string;
  readonly instanceId?: string;
  readonly installOptiForge?: boolean;
  readonly installOnly?: boolean;
  readonly javaArguments: readonly string[];
  readonly javaPath?: string;
  readonly memory: {
    readonly maximumMiB: number;
    readonly minimumMiB: number;
  };
  readonly root: string;
  readonly version: {
    readonly customId?: string;
    readonly id: string;
    readonly type: string;
  };
  readonly window: MinecraftLaunchWindow;
}

export interface MinecraftLaunchExit {
  readonly code: number | null;
  readonly signal: string | null;
}

export interface MinecraftLaunchHandle {
  readonly completion: Promise<MinecraftLaunchExit>;
  cancel(): boolean;
}

export type MinecraftLaunchEventSink = (event: MinecraftLaunchEvent) => void;

export interface MinecraftLauncherAdapter {
  readonly engine: MinecraftLaunchEngine;
  launch(
    options: MinecraftLaunchOptions,
    emit: MinecraftLaunchEventSink,
  ): Promise<MinecraftLaunchHandle>;
}
