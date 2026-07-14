import { describe, it, expect } from 'vitest';
import { createLayer, createLayerFromDirectory } from '../../src/layer.ts';
import { computeDigest, isDigest } from '../../src/digest.ts';
import { MEDIA_TYPE } from '../../src/types.ts';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { TarFileEntry } from '../../src/types.ts';

const gunzipAsync = promisify(gunzip);

describe('createLayer', () => {
  it('returns a valid LayerResult', async () => {
    const entries: TarFileEntry[] = [
      { type: 'file', name: 'hello.txt', data: new TextEncoder().encode('Hello') },
    ];
    const result = await createLayer(entries);

    expect(result.compressed).toBeInstanceOf(Uint8Array);
    expect(result.uncompressed).toBeInstanceOf(Uint8Array);
    expect(isDigest(result.diffId)).toBe(true);
    expect(isDigest(result.descriptor.digest)).toBe(true);
  });

  it('diffId is SHA-256 of uncompressed tar', async () => {
    const entries: TarFileEntry[] = [
      { type: 'file', name: 'test.txt', data: new TextEncoder().encode('test') },
    ];
    const result = await createLayer(entries);

    const expectedDiffId = computeDigest(result.uncompressed);
    expect(result.diffId).toBe(expectedDiffId);
  });

  it('descriptor digest is SHA-256 of compressed blob', async () => {
    const entries: TarFileEntry[] = [
      { type: 'file', name: 'test.txt', data: new TextEncoder().encode('test') },
    ];
    const result = await createLayer(entries);

    const expectedDigest = computeDigest(result.compressed);
    expect(result.descriptor.digest).toBe(expectedDigest);
  });

  it('diffId differs from compressed digest', async () => {
    const entries: TarFileEntry[] = [
      { type: 'file', name: 'test.txt', data: new TextEncoder().encode('some content') },
    ];
    const result = await createLayer(entries);

    expect(result.diffId).not.toBe(result.descriptor.digest);
  });

  it('descriptor size matches compressed blob size', async () => {
    const entries: TarFileEntry[] = [
      { type: 'file', name: 'test.txt', data: new TextEncoder().encode('data') },
    ];
    const result = await createLayer(entries);

    expect(result.descriptor.size).toBe(result.compressed.length);
  });

  it('descriptor mediaType is tar+gzip', async () => {
    const entries: TarFileEntry[] = [
      { type: 'file', name: 'test.txt', data: new Uint8Array(0) },
    ];
    const result = await createLayer(entries);

    expect(result.descriptor.mediaType).toBe(MEDIA_TYPE.LAYER_TAR_GZIP);
  });

  it('decompressed content matches uncompressed tar', async () => {
    const entries: TarFileEntry[] = [
      { type: 'file', name: 'test.txt', data: new TextEncoder().encode('verify decompress') },
    ];
    const result = await createLayer(entries);

    const decompressed = new Uint8Array(await gunzipAsync(result.compressed));
    expect(decompressed).toEqual(result.uncompressed);
  });

  it('decompressing and hashing yields the diffId', async () => {
    const entries: TarFileEntry[] = [
      { type: 'file', name: 'verify.txt', data: new TextEncoder().encode('round-trip check') },
    ];
    const result = await createLayer(entries);

    const decompressed = new Uint8Array(await gunzipAsync(result.compressed));
    const digest = computeDigest(decompressed);
    expect(digest).toBe(result.diffId);
  });
});

describe('createLayerFromDirectory', () => {
  it('creates a layer from a directory on disk', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'layer-test-'));
    await mkdir(join(tmpDir, 'sub'));
    await writeFile(join(tmpDir, 'file.txt'), 'file content');
    await writeFile(join(tmpDir, 'sub', 'nested.txt'), 'nested');

    try {
      const result = await createLayerFromDirectory(tmpDir);

      expect(result.compressed.length).toBeGreaterThan(0);
      expect(isDigest(result.diffId)).toBe(true);
      expect(result.descriptor.mediaType).toBe(MEDIA_TYPE.LAYER_TAR_GZIP);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });
});
