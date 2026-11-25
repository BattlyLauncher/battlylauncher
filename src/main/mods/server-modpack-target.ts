import type { InstanceSummary } from '../../shared/minecraft/instance';

export interface ServerModpackTarget {
  readonly name?: string;
  readonly acceptPath: (path: string) => boolean;
  readonly checkMetadata: (pack: InstanceSummary) => Promise<void>;
}
