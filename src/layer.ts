import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { createTarArchive, collectEntries } from './tar.ts';
import { computeDigest, createDescriptor } from './digest.ts';
import { MEDIA_TYPE } from './types.ts';
import type { TarEntry, LayerResult } from './types.ts';

const gzipAsync = promisify(gzip);

interface LayerOptions {
  readonly reproducible?: boolean;
}

export async function createLayer(entries: readonly TarEntry[], options?: LayerOptions): Promise<LayerResult> {
  const uncompressed = createTarArchive(entries, { reproducible: options?.reproducible ?? true });
  const diffId = computeDigest(uncompressed);
  const compressed = new Uint8Array(await gzipAsync(uncompressed));
  const descriptor = createDescriptor(compressed, MEDIA_TYPE.LAYER_TAR_GZIP);

  return { compressed, uncompressed, diffId, descriptor };
}

export async function createLayerFromDirectory(dirPath: string, options?: LayerOptions): Promise<LayerResult> {
  const entries = await collectEntries(dirPath);
  return createLayer(entries, options);
}
