import { describe, it, expect } from 'vitest';
import { createManifest, createIndex } from '../../src/manifest.ts';
import { computeDigest } from '../../src/digest.ts';
import { MEDIA_TYPE } from '../../src/types.ts';
import type { Digest, OCIDescriptor } from '../../src/types.ts';

const fakeDescriptor = (mediaType: string): OCIDescriptor => ({
  mediaType,
  digest: 'sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789' as Digest,
  size: 1234,
});

describe('createManifest', () => {
  it('produces valid JSON with required fields', () => {
    const config = fakeDescriptor(MEDIA_TYPE.CONFIG);
    const layer = fakeDescriptor(MEDIA_TYPE.LAYER_TAR_GZIP);
    const { content } = createManifest({ config, layers: [layer] });

    const manifest = JSON.parse(new TextDecoder().decode(content));
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.mediaType).toBe(MEDIA_TYPE.MANIFEST);
    expect(manifest.config).toEqual(config);
    expect(manifest.layers).toEqual([layer]);
  });

  it('includes annotations when provided', () => {
    const config = fakeDescriptor(MEDIA_TYPE.CONFIG);
    const layer = fakeDescriptor(MEDIA_TYPE.LAYER_TAR_GZIP);
    const annotations = { 'org.opencontainers.image.title': 'test' };
    const { content } = createManifest({ config, layers: [layer], annotations });

    const manifest = JSON.parse(new TextDecoder().decode(content));
    expect(manifest.annotations).toEqual(annotations);
  });

  it('omits annotations when not provided', () => {
    const config = fakeDescriptor(MEDIA_TYPE.CONFIG);
    const layer = fakeDescriptor(MEDIA_TYPE.LAYER_TAR_GZIP);
    const { content } = createManifest({ config, layers: [layer] });

    const manifest = JSON.parse(new TextDecoder().decode(content));
    expect(manifest.annotations).toBeUndefined();
  });

  it('descriptor has correct mediaType', () => {
    const config = fakeDescriptor(MEDIA_TYPE.CONFIG);
    const layer = fakeDescriptor(MEDIA_TYPE.LAYER_TAR_GZIP);
    const { descriptor } = createManifest({ config, layers: [layer] });

    expect(descriptor.mediaType).toBe(MEDIA_TYPE.MANIFEST);
  });

  it('descriptor digest matches content hash', () => {
    const config = fakeDescriptor(MEDIA_TYPE.CONFIG);
    const layer = fakeDescriptor(MEDIA_TYPE.LAYER_TAR_GZIP);
    const { content, descriptor } = createManifest({ config, layers: [layer] });

    expect(descriptor.digest).toBe(computeDigest(content));
  });

  it('produces compact JSON', () => {
    const config = fakeDescriptor(MEDIA_TYPE.CONFIG);
    const layer = fakeDescriptor(MEDIA_TYPE.LAYER_TAR_GZIP);
    const { content } = createManifest({ config, layers: [layer] });
    const json = new TextDecoder().decode(content);
    expect(json).not.toMatch(/\n/);
  });
});

describe('createIndex', () => {
  it('produces valid JSON with required fields', () => {
    const manifestDesc = fakeDescriptor(MEDIA_TYPE.MANIFEST);
    const { content } = createIndex({ manifests: [manifestDesc] });

    const index = JSON.parse(new TextDecoder().decode(content));
    expect(index.schemaVersion).toBe(2);
    expect(index.mediaType).toBe(MEDIA_TYPE.INDEX);
    expect(index.manifests).toEqual([manifestDesc]);
  });

  it('descriptor has correct mediaType', () => {
    const manifestDesc = fakeDescriptor(MEDIA_TYPE.MANIFEST);
    const { descriptor } = createIndex({ manifests: [manifestDesc] });

    expect(descriptor.mediaType).toBe(MEDIA_TYPE.INDEX);
  });

  it('descriptor digest matches content hash', () => {
    const manifestDesc = fakeDescriptor(MEDIA_TYPE.MANIFEST);
    const { content, descriptor } = createIndex({ manifests: [manifestDesc] });

    expect(descriptor.digest).toBe(computeDigest(content));
  });
});
