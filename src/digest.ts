import { createHash } from 'node:crypto';
import type { Digest, OCIDescriptor } from './types.ts';

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

export function computeDigest(data: Uint8Array): Digest {
  const hex = createHash('sha256').update(data).digest('hex');
  return `sha256:${hex}` as Digest;
}

export function isDigest(value: string): value is Digest {
  return DIGEST_RE.test(value);
}

export function assertDigest(value: string): asserts value is Digest {
  if (!isDigest(value)) {
    throw new Error(`Invalid digest: ${value}`);
  }
}

export function createDescriptor(content: Uint8Array, mediaType: string): OCIDescriptor {
  return {
    mediaType,
    digest: computeDigest(content),
    size: content.length,
  };
}
