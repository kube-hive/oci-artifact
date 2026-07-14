import { createDescriptor } from './digest.ts';
import { MEDIA_TYPE } from './types.ts';
import type { OCIDescriptor, OCIManifest, OCIIndex } from './types.ts';

export function createManifest(options: {
  readonly config: OCIDescriptor;
  readonly layers: readonly OCIDescriptor[];
  readonly annotations?: Record<string, string>;
}): {
  readonly content: Uint8Array;
  readonly descriptor: OCIDescriptor;
} {
  const manifest: OCIManifest = {
    schemaVersion: 2,
    mediaType: MEDIA_TYPE.MANIFEST,
    config: options.config,
    layers: options.layers,
    ...(options.annotations && { annotations: options.annotations }),
  };

  const content = new TextEncoder().encode(JSON.stringify(manifest));
  const descriptor = createDescriptor(content, MEDIA_TYPE.MANIFEST);

  return { content, descriptor };
}

export function createIndex(options: {
  readonly manifests: readonly OCIDescriptor[];
}): {
  readonly content: Uint8Array;
  readonly descriptor: OCIDescriptor;
} {
  const index: OCIIndex = {
    schemaVersion: 2,
    mediaType: MEDIA_TYPE.INDEX,
    manifests: options.manifests,
  };

  const content = new TextEncoder().encode(JSON.stringify(index));
  const descriptor = createDescriptor(content, MEDIA_TYPE.INDEX);

  return { content, descriptor };
}
