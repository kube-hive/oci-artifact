import { describe, it, expect } from 'vitest';
import { createImageConfig } from '../../src/config.ts';
import { computeDigest } from '../../src/digest.ts';
import { MEDIA_TYPE } from '../../src/types.ts';
import type { Digest } from '../../src/types.ts';

const FAKE_DIFF_ID = 'sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789' as Digest;

describe('createImageConfig', () => {
  it('produces valid JSON with required fields', () => {
    const { content } = createImageConfig({ diffIds: [FAKE_DIFF_ID] });
    const config = JSON.parse(new TextDecoder().decode(content));

    expect(config.architecture).toBe('amd64');
    expect(config.os).toBe('linux');
    expect(config.rootfs.type).toBe('layers');
    expect(config.rootfs.diff_ids).toEqual([FAKE_DIFF_ID]);
  });

  it('respects custom architecture and os', () => {
    const { content } = createImageConfig({
      diffIds: [FAKE_DIFF_ID],
      architecture: 'arm64',
      os: 'linux',
    });
    const config = JSON.parse(new TextDecoder().decode(content));

    expect(config.architecture).toBe('arm64');
  });

  it('descriptor has correct mediaType', () => {
    const { descriptor } = createImageConfig({ diffIds: [FAKE_DIFF_ID] });
    expect(descriptor.mediaType).toBe(MEDIA_TYPE.CONFIG);
  });

  it('descriptor digest matches content hash', () => {
    const { content, descriptor } = createImageConfig({ diffIds: [FAKE_DIFF_ID] });
    expect(descriptor.digest).toBe(computeDigest(content));
  });

  it('descriptor size matches content length', () => {
    const { content, descriptor } = createImageConfig({ diffIds: [FAKE_DIFF_ID] });
    expect(descriptor.size).toBe(content.length);
  });

  it('supports multiple diff_ids', () => {
    const secondId = 'sha256:1111111111111111111111111111111111111111111111111111111111111111' as Digest;
    const { content } = createImageConfig({ diffIds: [FAKE_DIFF_ID, secondId] });
    const config = JSON.parse(new TextDecoder().decode(content));

    expect(config.rootfs.diff_ids).toHaveLength(2);
    expect(config.rootfs.diff_ids[0]).toBe(FAKE_DIFF_ID);
    expect(config.rootfs.diff_ids[1]).toBe(secondId);
  });

  it('produces compact JSON (no whitespace)', () => {
    const { content } = createImageConfig({ diffIds: [FAKE_DIFF_ID] });
    const json = new TextDecoder().decode(content);
    expect(json).not.toMatch(/\n/);
    expect(json).not.toMatch(/  /);
  });
});
