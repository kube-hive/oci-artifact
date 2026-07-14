import { describe, it, expect } from 'vitest';
import { createTarArchive, collectEntries } from '../../src/tar.ts';
import { execSync } from 'node:child_process';
import { mkdtemp, writeFile, mkdir, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { TarFileEntry, TarDirectoryEntry, TarSymlinkEntry, TarEntry } from '../../src/types.ts';

function readString(buf: Uint8Array, offset: number, length: number): string {
  let end = offset;
  while (end < offset + length && buf[end] !== 0) end++;
  return new TextDecoder().decode(buf.subarray(offset, end));
}

function readOctal(buf: Uint8Array, offset: number, length: number): number {
  const str = readString(buf, offset, length).trim();
  return str.length === 0 ? 0 : parseInt(str, 8);
}

describe('createTarArchive', () => {
  describe('header field positions', () => {
    const entry: TarFileEntry = {
      type: 'file',
      name: 'hello.txt',
      data: new TextEncoder().encode('Hello, World!'),
    };

    const tar = createTarArchive([entry]);

    it('writes name at offset 0 (100 bytes)', () => {
      expect(readString(tar, 0, 100)).toBe('hello.txt');
    });

    it('writes mode at offset 100 (8 bytes)', () => {
      expect(readOctal(tar, 100, 8)).toBe(0o644);
    });

    it('writes uid at offset 108 (8 bytes)', () => {
      expect(readOctal(tar, 108, 8)).toBe(0);
    });

    it('writes gid at offset 116 (8 bytes)', () => {
      expect(readOctal(tar, 116, 8)).toBe(0);
    });

    it('writes size at offset 124 (12 bytes)', () => {
      expect(readOctal(tar, 124, 12)).toBe(13); // "Hello, World!" = 13 bytes
    });

    it('writes mtime at offset 136 (12 bytes) as 0 in reproducible mode', () => {
      expect(readOctal(tar, 136, 12)).toBe(0);
    });

    it('writes typeflag at offset 156 as ASCII "0" for files', () => {
      expect(tar[156]).toBe(0x30);
    });

    it('writes magic "ustar\\0" at offset 257', () => {
      expect(readString(tar, 257, 6)).toBe('ustar');
      expect(tar[262]).toBe(0); // NUL terminator
    });

    it('writes version "00" at offset 263', () => {
      expect(tar[263]).toBe(0x30);
      expect(tar[264]).toBe(0x30);
    });

    it('writes uname "root" at offset 265', () => {
      expect(readString(tar, 265, 32)).toBe('root');
    });

    it('writes gname "root" at offset 297', () => {
      expect(readString(tar, 297, 32)).toBe('root');
    });

    it('writes devmajor at offset 329 as octal zero', () => {
      expect(readOctal(tar, 329, 8)).toBe(0);
    });

    it('writes devminor at offset 337 as octal zero', () => {
      expect(readOctal(tar, 337, 8)).toBe(0);
    });
  });

  describe('checksum', () => {
    it('writes checksum in "%06o\\0 " format at offset 148', () => {
      const entry: TarFileEntry = {
        type: 'file',
        name: 'test.txt',
        data: new TextEncoder().encode('data'),
      };
      const tar = createTarArchive([entry]);

      // Read the checksum field bytes
      const chksumField = tar.subarray(148, 156);
      // Last two bytes should be NUL and space
      expect(chksumField[6]).toBe(0);    // NUL
      expect(chksumField[7]).toBe(0x20); // space

      // First 6 bytes should be octal digits
      for (let i = 0; i < 6; i++) {
        const ch = chksumField[i]!;
        expect(ch).toBeGreaterThanOrEqual(0x30); // '0'
        expect(ch).toBeLessThanOrEqual(0x37);    // '7'
      }

      // Verify the checksum value is correct
      const storedSum = parseInt(readString(tar, 148, 6), 8);
      let computedSum = 0;
      for (let i = 0; i < 512; i++) {
        if (i >= 148 && i < 156) {
          computedSum += 0x20; // treat checksum field as spaces
        } else {
          computedSum += tar[i]!;
        }
      }
      expect(storedSum).toBe(computedSum);
    });
  });

  describe('directory entries', () => {
    it('appends trailing slash to directory names', () => {
      const entry: TarDirectoryEntry = { type: 'directory', name: 'mydir' };
      const tar = createTarArchive([entry]);
      expect(readString(tar, 0, 100)).toBe('mydir/');
    });

    it('preserves existing trailing slash', () => {
      const entry: TarDirectoryEntry = { type: 'directory', name: 'mydir/' };
      const tar = createTarArchive([entry]);
      expect(readString(tar, 0, 100)).toBe('mydir/');
    });

    it('sets typeflag to "5" for directories', () => {
      const entry: TarDirectoryEntry = { type: 'directory', name: 'mydir' };
      const tar = createTarArchive([entry]);
      expect(tar[156]).toBe(0x35);
    });

    it('sets size to 0 for directories', () => {
      const entry: TarDirectoryEntry = { type: 'directory', name: 'mydir' };
      const tar = createTarArchive([entry]);
      expect(readOctal(tar, 124, 12)).toBe(0);
    });

    it('uses mode 0755 by default for directories', () => {
      const entry: TarDirectoryEntry = { type: 'directory', name: 'mydir' };
      const tar = createTarArchive([entry]);
      expect(readOctal(tar, 100, 8)).toBe(0o755);
    });
  });

  describe('symlink entries', () => {
    it('sets typeflag to "2" for symlinks', () => {
      const entry: TarSymlinkEntry = { type: 'symlink', name: 'link', linkTarget: 'target.txt' };
      const tar = createTarArchive([entry]);
      expect(tar[156]).toBe(0x32);
    });

    it('writes link target at offset 157', () => {
      const entry: TarSymlinkEntry = { type: 'symlink', name: 'link', linkTarget: 'some/target' };
      const tar = createTarArchive([entry]);
      expect(readString(tar, 157, 100)).toBe('some/target');
    });
  });

  describe('end of archive', () => {
    it('ends with at least 1024 zero bytes', () => {
      const entry: TarFileEntry = {
        type: 'file',
        name: 'small.txt',
        data: new TextEncoder().encode('x'),
      };
      const tar = createTarArchive([entry]);

      // The tar should have: 512 (header) + 512 (data block) + 1024 (end) = 2048
      expect(tar.length).toBe(2048);

      // Last 1024 bytes should be all zeros
      const endBlock = tar.subarray(tar.length - 1024);
      for (let i = 0; i < 1024; i++) {
        expect(endBlock[i]).toBe(0);
      }
    });
  });

  describe('data blocks', () => {
    it('pads file data to 512-byte boundary', () => {
      const entry: TarFileEntry = {
        type: 'file',
        name: 'test.txt',
        data: new TextEncoder().encode('hello'), // 5 bytes
      };
      const tar = createTarArchive([entry]);

      // header (512) + data block (512, padded from 5) + end (1024) = 2048
      expect(tar.length).toBe(2048);

      // Verify data content
      expect(new TextDecoder().decode(tar.subarray(512, 517))).toBe('hello');

      // Verify padding is zeros
      for (let i = 517; i < 1024; i++) {
        expect(tar[i]).toBe(0);
      }
    });

    it('handles file data exactly at 512-byte boundary', () => {
      const data = new Uint8Array(512).fill(0x41); // 512 'A's
      const entry: TarFileEntry = { type: 'file', name: 'exact.bin', data };
      const tar = createTarArchive([entry]);

      // header (512) + data (512, no padding needed) + end (1024) = 2048
      expect(tar.length).toBe(2048);
    });

    it('handles empty file', () => {
      const entry: TarFileEntry = { type: 'file', name: 'empty.txt', data: new Uint8Array(0) };
      const tar = createTarArchive([entry]);

      // header (512) + no data + end (1024) = 1536
      expect(tar.length).toBe(1536);
      expect(readOctal(tar, 124, 12)).toBe(0);
    });
  });

  describe('sorting', () => {
    it('sorts entries lexicographically by normalized name', () => {
      const entries: TarEntry[] = [
        { type: 'file', name: 'z.txt', data: new Uint8Array(0) },
        { type: 'directory', name: 'a' },
        { type: 'file', name: 'm.txt', data: new Uint8Array(0) },
      ];
      const tar = createTarArchive(entries);

      expect(readString(tar, 0, 100)).toBe('a/');
      expect(readString(tar, 512, 100)).toBe('m.txt');
      expect(readString(tar, 1024, 100)).toBe('z.txt');
    });
  });

  describe('reproducibility', () => {
    it('produces identical output for the same input', () => {
      const entries: TarEntry[] = [
        { type: 'directory', name: 'dir' },
        { type: 'file', name: 'dir/file.txt', data: new TextEncoder().encode('content') },
      ];
      const tar1 = createTarArchive(entries);
      const tar2 = createTarArchive(entries);
      expect(tar1).toEqual(tar2);
    });

    it('zeros mtime in reproducible mode', () => {
      const entry: TarFileEntry = {
        type: 'file',
        name: 'test.txt',
        data: new Uint8Array(0),
        mtime: new Date('2024-01-01T00:00:00Z'),
      };
      const tar = createTarArchive([entry], { reproducible: true });
      expect(readOctal(tar, 136, 12)).toBe(0);
    });

    it('preserves mtime when not reproducible', () => {
      const mtime = new Date('2024-06-15T12:00:00Z');
      const entry: TarFileEntry = {
        type: 'file',
        name: 'test.txt',
        data: new Uint8Array(0),
        mtime,
      };
      const tar = createTarArchive([entry], { reproducible: false });
      expect(readOctal(tar, 136, 12)).toBe(Math.floor(mtime.getTime() / 1000));
    });
  });

  describe('long paths', () => {
    it('splits paths longer than 100 chars into prefix + name', () => {
      const longDir = 'a'.repeat(50);
      const longName = `${longDir}/${'b'.repeat(49)}.txt`;
      // total = 50 + 1 + 53 = 104 chars

      const entry: TarFileEntry = { type: 'file', name: longName, data: new Uint8Array(0) };
      const tar = createTarArchive([entry]);

      const prefix = readString(tar, 345, 155);
      const name = readString(tar, 0, 100);
      expect(`${prefix}/${name}`).toBe(longName);
    });

    it('throws for paths that cannot be split', () => {
      const tooLong = 'x'.repeat(256); // no slash, too long for name field
      const entry: TarFileEntry = { type: 'file', name: tooLong, data: new Uint8Array(0) };
      expect(() => createTarArchive([entry])).toThrow('Path too long for ustar format');
    });
  });

  describe('binary data', () => {
    it('preserves binary content with NUL bytes and high bytes', () => {
      const data = new Uint8Array([0x00, 0x01, 0x7f, 0x80, 0xfe, 0xff]);
      const entry: TarFileEntry = { type: 'file', name: 'bin.dat', data };
      const tar = createTarArchive([entry]);

      const extracted = tar.subarray(512, 512 + 6);
      expect(extracted).toEqual(data);
    });
  });

  describe('roundtrip with system tar', () => {
    it('produces a tar that the system tar command can list', async () => {
      const entries: TarEntry[] = [
        { type: 'directory', name: 'subdir' },
        { type: 'file', name: 'hello.txt', data: new TextEncoder().encode('Hello!') },
        { type: 'file', name: 'subdir/nested.txt', data: new TextEncoder().encode('Nested') },
      ];
      const tarBytes = createTarArchive(entries);

      const tmpDir = await mkdtemp(join(tmpdir(), 'tar-test-'));
      const tarPath = join(tmpDir, 'test.tar');
      await writeFile(tarPath, tarBytes);

      try {
        const listing = execSync(`tar tf ${tarPath}`, { encoding: 'utf8' });
        const lines = listing.trim().split('\n').sort();
        expect(lines).toEqual(['hello.txt', 'subdir/', 'subdir/nested.txt']);
      } finally {
        await rm(tmpDir, { recursive: true });
      }
    });

    it('extracts correct file content', async () => {
      const content = 'Test content for extraction';
      const entries: TarEntry[] = [
        { type: 'file', name: 'data.txt', data: new TextEncoder().encode(content) },
      ];
      const tarBytes = createTarArchive(entries);

      const tmpDir = await mkdtemp(join(tmpdir(), 'tar-test-'));
      const tarPath = join(tmpDir, 'test.tar');
      const extractDir = join(tmpDir, 'extract');
      await writeFile(tarPath, tarBytes);
      await mkdir(extractDir);

      try {
        execSync(`tar xf ${tarPath} -C ${extractDir}`);
        const extracted = execSync(`cat ${join(extractDir, 'data.txt')}`, { encoding: 'utf8' });
        expect(extracted).toBe(content);
      } finally {
        await rm(tmpDir, { recursive: true });
      }
    });
  });
});

describe('collectEntries', () => {
  it('collects files and directories from a directory', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'collect-test-'));
    await mkdir(join(tmpDir, 'subdir'));
    await writeFile(join(tmpDir, 'root.txt'), 'root content');
    await writeFile(join(tmpDir, 'subdir', 'nested.txt'), 'nested content');

    try {
      const entries = await collectEntries(tmpDir);
      const names = entries.map(e => e.name).sort();

      expect(names).toContain('root.txt');
      expect(names).toContain('subdir/');
      expect(names).toContain('subdir/nested.txt');

      const rootFile = entries.find(e => e.name === 'root.txt');
      expect(rootFile?.type).toBe('file');
      if (rootFile?.type === 'file') {
        expect(new TextDecoder().decode(rootFile.data)).toBe('root content');
      }

      const subdir = entries.find(e => e.name === 'subdir/');
      expect(subdir?.type).toBe('directory');
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it('handles symlinks', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'collect-test-'));
    await writeFile(join(tmpDir, 'target.txt'), 'target');
    await symlink('target.txt', join(tmpDir, 'link.txt'));

    try {
      const entries = await collectEntries(tmpDir);
      const link = entries.find(e => e.name === 'link.txt');

      expect(link?.type).toBe('symlink');
      if (link?.type === 'symlink') {
        expect(link.linkTarget).toBe('target.txt');
      }
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it('ensures parent directories are included for deeply nested files', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'collect-test-'));
    await mkdir(join(tmpDir, 'a', 'b', 'c'), { recursive: true });
    await writeFile(join(tmpDir, 'a', 'b', 'c', 'deep.txt'), 'deep');

    try {
      const entries = await collectEntries(tmpDir);
      const names = entries.map(e => e.name).sort();

      expect(names).toContain('a/');
      expect(names).toContain('a/b/');
      expect(names).toContain('a/b/c/');
      expect(names).toContain('a/b/c/deep.txt');
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it('produces a valid tar when combined with createTarArchive', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'collect-test-'));
    await mkdir(join(tmpDir, 'input', 'sub'), { recursive: true });
    await writeFile(join(tmpDir, 'input', 'file1.txt'), 'content1');
    await writeFile(join(tmpDir, 'input', 'sub', 'file2.txt'), 'content2');

    try {
      const entries = await collectEntries(join(tmpDir, 'input'));
      const tarBytes = createTarArchive(entries);

      const tarPath = join(tmpDir, 'roundtrip.tar');
      await writeFile(tarPath, tarBytes);

      const listing = execSync(`tar tf ${tarPath}`, { encoding: 'utf8' });
      const lines = listing.trim().split('\n').sort();
      expect(lines).toEqual(['file1.txt', 'sub/', 'sub/file2.txt']);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });
});
