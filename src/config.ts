import { createDescriptor } from './digest.ts';
import { MEDIA_TYPE } from './types.ts';
import type { Digest, OCIDescriptor, OCIImageConfig } from './types.ts';

export interface CreateConfigOptions {
  readonly diffIds: readonly Digest[];
  readonly architecture?: string;
  readonly os?: string;
}

export function createImageConfig(options: CreateConfigOptions): {
  readonly content: Uint8Array;
  readonly descriptor: OCIDescriptor;
} {
  const config: OCIImageConfig = {
    architecture: options.architecture ?? 'amd64',
    os: options.os ?? 'linux',
    rootfs: {
      type: 'layers',
      diff_ids: options.diffIds,
    },
  };

  const content = new TextEncoder().encode(JSON.stringify(config));
  const descriptor = createDescriptor(content, MEDIA_TYPE.CONFIG);

  return { content, descriptor };
}
