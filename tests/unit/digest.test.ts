import { describe, it, expect } from 'vitest';
import { computeDigest, isDigest, assertDigest, createDescriptor } from '../../src/digest.ts';

describe('computeDigest', () => {
  it('returns the known SHA-256 of an empty buffer', () => {
    const digest = computeDigest(new Uint8Array(0));
    expect(digest).toBe('sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('returns the known SHA-256 of "hello"', () => {
    const data = new TextEncoder().encode('hello');
    const digest = computeDigest(data);
    expect(digest).toBe('sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('returns identical digest for identical input', () => {
    const data = new TextEncoder().encode('deterministic');
    expect(computeDigest(data)).toBe(computeDigest(data));
  });
});

describe('isDigest', () => {
  it('returns true for a valid sha256 digest', () => {
    expect(isDigest('sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')).toBe(true);
  });

  it('returns false for missing prefix', () => {
    expect(isDigest('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')).toBe(false);
  });

  it('returns false for wrong prefix', () => {
    expect(isDigest('md5:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')).toBe(false);
  });

  it('returns false for too-short hex', () => {
    expect(isDigest('sha256:abcdef')).toBe(false);
  });

  it('returns false for uppercase hex', () => {
    expect(isDigest('sha256:E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isDigest('')).toBe(false);
  });
});

describe('assertDigest', () => {
  it('does not throw for a valid digest', () => {
    expect(() => {
      assertDigest('sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    }).not.toThrow();
  });

  it('throws for an invalid digest', () => {
    expect(() => {
      assertDigest('not-a-digest');
    }).toThrow('Invalid digest');
  });
});

describe('createDescriptor', () => {
  it('creates a descriptor with correct digest, size, and mediaType', () => {
    const data = new TextEncoder().encode('test content');
    const descriptor = createDescriptor(data, 'application/octet-stream');

    expect(descriptor.mediaType).toBe('application/octet-stream');
    expect(descriptor.size).toBe(data.length);
    expect(isDigest(descriptor.digest)).toBe(true);
    expect(descriptor.digest).toBe(computeDigest(data));
  });

  it('size reflects byte length, not string length', () => {
    // UTF-8 multi-byte character
    const data = new TextEncoder().encode('é'); // é = 2 bytes in UTF-8
    const descriptor = createDescriptor(data, 'text/plain');
    expect(descriptor.size).toBe(2);
  });
});
