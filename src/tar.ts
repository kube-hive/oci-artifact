import { readdir, readFile, readlink } from 'node:fs/promises';
import { join, relative, posix } from 'node:path';
import type { TarEntry, TarFileEntry, TarDirectoryEntry, TarSymlinkEntry } from './types.ts';

const BLOCK_SIZE = 512;
const ENCODER = new TextEncoder();

const EPOCH = new Date(0);
const DEFAULT_FILE_MODE = 0o644;
const DEFAULT_DIR_MODE = 0o755;
const DEFAULT_SYMLINK_MODE = 0o777;

interface TarCreateOptions {
  readonly reproducible?: boolean;
}

function writeString(buf: Uint8Array, str: string, offset: number, length: number): void {
  const encoded = ENCODER.encode(str);
  const toCopy = Math.min(encoded.length, length);
  buf.set(encoded.subarray(0, toCopy), offset);
}

function writeOctal(buf: Uint8Array, value: number, offset: number, fieldWidth: number): void {
  const str = value.toString(8).padStart(fieldWidth - 1, '0');
  for (let i = 0; i < fieldWidth - 1; i++) {
    buf[offset + i] = str.charCodeAt(i);
  }
  buf[offset + fieldWidth - 1] = 0;
}

function splitPath(fullPath: string): { prefix: string; name: string } {
  if (fullPath.length <= 100) {
    return { prefix: '', name: fullPath };
  }

  const maxPrefixEnd = Math.min(fullPath.length, 155);
  let splitIdx = -1;
  for (let i = maxPrefixEnd; i >= 1; i--) {
    if (fullPath[i] === '/') {
      const nameLen = fullPath.length - i - 1;
      if (nameLen <= 100) {
        splitIdx = i;
        break;
      }
    }
  }

  if (splitIdx === -1) {
    throw new Error(`Path too long for ustar format (${fullPath.length} chars): ${fullPath}`);
  }

  return {
    prefix: fullPath.substring(0, splitIdx),
    name: fullPath.substring(splitIdx + 1),
  };
}

function ceilToBlock(n: number): number {
  return n === 0 ? 0 : Math.ceil(n / BLOCK_SIZE) * BLOCK_SIZE;
}

function entryMode(entry: TarEntry): number {
  if (entry.mode !== undefined) return entry.mode;
  switch (entry.type) {
    case 'file': return DEFAULT_FILE_MODE;
    case 'directory': return DEFAULT_DIR_MODE;
    case 'symlink': return DEFAULT_SYMLINK_MODE;
  }
}

function entryTypeflag(entry: TarEntry): number {
  switch (entry.type) {
    case 'file': return 0x30;      // ASCII '0'
    case 'directory': return 0x35; // ASCII '5'
    case 'symlink': return 0x32;   // ASCII '2'
  }
}

function normalizeName(entry: TarEntry): string {
  let name = entry.name;

  if (entry.type === 'directory' && !name.endsWith('/')) {
    name += '/';
  }

  if (entry.type !== 'directory' && name.endsWith('/')) {
    name = name.slice(0, -1);
  }

  return name;
}

function buildHeader(entry: TarEntry, reproducible: boolean): Uint8Array {
  const header = new Uint8Array(BLOCK_SIZE);

  const name = normalizeName(entry);
  const { prefix, name: shortName } = splitPath(name);

  const mtime = reproducible ? 0 : Math.floor((entry.mtime ?? EPOCH).getTime() / 1000);
  const uid = reproducible ? 0 : (entry.uid ?? 0);
  const gid = reproducible ? 0 : (entry.gid ?? 0);
  const uname = reproducible ? 'root' : (entry.uname ?? 'root');
  const gname = reproducible ? 'root' : (entry.gname ?? 'root');
  const mode = entryMode(entry);
  const size = entry.type === 'file' ? entry.data.length : 0;

  writeString(header, shortName, 0, 100);
  writeOctal(header, mode, 100, 8);
  writeOctal(header, uid, 108, 8);
  writeOctal(header, gid, 116, 8);
  writeOctal(header, size, 124, 12);
  writeOctal(header, mtime, 136, 12);

  // checksum placeholder: 8 spaces
  for (let i = 148; i < 156; i++) {
    header[i] = 0x20;
  }

  header[156] = entryTypeflag(entry);

  if (entry.type === 'symlink') {
    writeString(header, entry.linkTarget, 157, 100);
  }

  // magic: "ustar\0"
  writeString(header, 'ustar\0', 257, 6);
  // version: "00" (no NUL terminator)
  header[263] = 0x30;
  header[264] = 0x30;

  writeString(header, uname, 265, 32);
  writeString(header, gname, 297, 32);

  writeOctal(header, 0, 329, 8); // devmajor
  writeOctal(header, 0, 337, 8); // devminor

  if (prefix.length > 0) {
    writeString(header, prefix, 345, 155);
  }

  // compute checksum
  let sum = 0;
  for (let i = 0; i < BLOCK_SIZE; i++) {
    sum += header[i]!;
  }

  // write checksum: "%06o\0 "
  const chkStr = sum.toString(8).padStart(6, '0');
  for (let i = 0; i < 6; i++) {
    header[148 + i] = chkStr.charCodeAt(i);
  }
  header[154] = 0;    // NUL
  header[155] = 0x20;  // space

  return header;
}

export function createTarArchive(entries: readonly TarEntry[], options?: TarCreateOptions): Uint8Array {
  const reproducible = options?.reproducible ?? true;

  const sorted = [...entries].sort((a, b) => {
    const nameA = normalizeName(a);
    const nameB = normalizeName(b);
    return nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
  });

  let totalSize = 0;
  for (const entry of sorted) {
    totalSize += BLOCK_SIZE; // header
    if (entry.type === 'file') {
      totalSize += ceilToBlock(entry.data.length);
    }
  }
  totalSize += 1024; // two end-of-archive zero blocks

  const buffer = new Uint8Array(totalSize);
  let offset = 0;

  for (const entry of sorted) {
    const header = buildHeader(entry, reproducible);
    buffer.set(header, offset);
    offset += BLOCK_SIZE;

    if (entry.type === 'file' && entry.data.length > 0) {
      buffer.set(entry.data, offset);
      offset += ceilToBlock(entry.data.length);
    }
  }

  // remaining bytes are already zero (end-of-archive blocks)
  return buffer;
}

export async function collectEntries(dirPath: string): Promise<TarEntry[]> {
  const dirents = await readdir(dirPath, { recursive: true, withFileTypes: true });
  const entries: TarEntry[] = [];
  const seenDirs = new Set<string>();

  for (const dirent of dirents) {
    const fullPath = join(dirent.parentPath, dirent.name);
    const relPath = relative(dirPath, fullPath).split('\\').join(posix.sep);

    if (dirent.isDirectory()) {
      seenDirs.add(relPath);
      entries.push({
        type: 'directory',
        name: relPath + '/',
      } satisfies TarDirectoryEntry);
    } else if (dirent.isSymbolicLink()) {
      ensureParentDirs(relPath, seenDirs, entries);
      const linkTarget = await readlink(fullPath);
      entries.push({
        type: 'symlink',
        name: relPath,
        linkTarget: linkTarget.split('\\').join(posix.sep),
      } satisfies TarSymlinkEntry);
    } else if (dirent.isFile()) {
      ensureParentDirs(relPath, seenDirs, entries);
      const data = await readFile(fullPath);
      entries.push({
        type: 'file',
        name: relPath,
        data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      } satisfies TarFileEntry);
    }
  }

  return entries;
}

function ensureParentDirs(relPath: string, seenDirs: Set<string>, entries: TarEntry[]): void {
  const parts = relPath.split(posix.sep);
  for (let i = 1; i < parts.length; i++) {
    const parentDir = parts.slice(0, i).join(posix.sep);
    if (!seenDirs.has(parentDir)) {
      seenDirs.add(parentDir);
      entries.push({
        type: 'directory',
        name: parentDir + '/',
      } satisfies TarDirectoryEntry);
    }
  }
}
