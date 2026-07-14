declare const DigestBrand: unique symbol;

export type Digest = `sha256:${string}` & { readonly [DigestBrand]: never };

export const MEDIA_TYPE = {
  MANIFEST: 'application/vnd.oci.image.manifest.v1+json',
  INDEX: 'application/vnd.oci.image.index.v1+json',
  CONFIG: 'application/vnd.oci.image.config.v1+json',
  LAYER_TAR_GZIP: 'application/vnd.oci.image.layer.v1.tar+gzip',
  LAYER_TAR: 'application/vnd.oci.image.layer.v1.tar',
} as const;

export type MediaType = (typeof MEDIA_TYPE)[keyof typeof MEDIA_TYPE];

export interface OCIDescriptor {
  readonly mediaType: string;
  readonly digest: Digest;
  readonly size: number;
  readonly annotations?: Readonly<Record<string, string>>;
}

export interface OCIImageConfig {
  readonly architecture: string;
  readonly os: string;
  readonly rootfs: {
    readonly type: 'layers';
    readonly diff_ids: readonly Digest[];
  };
}

export interface OCIManifest {
  readonly schemaVersion: 2;
  readonly mediaType: typeof MEDIA_TYPE.MANIFEST;
  readonly config: OCIDescriptor;
  readonly layers: readonly OCIDescriptor[];
  readonly annotations?: Readonly<Record<string, string>>;
}

export interface OCIIndex {
  readonly schemaVersion: 2;
  readonly mediaType: typeof MEDIA_TYPE.INDEX;
  readonly manifests: readonly OCIDescriptor[];
}

interface TarEntryBase {
  readonly name: string;
  readonly mode?: number;
  readonly mtime?: Date;
  readonly uid?: number;
  readonly gid?: number;
  readonly uname?: string;
  readonly gname?: string;
}

export interface TarFileEntry extends TarEntryBase {
  readonly type: 'file';
  readonly data: Uint8Array;
}

export interface TarDirectoryEntry extends TarEntryBase {
  readonly type: 'directory';
}

export interface TarSymlinkEntry extends TarEntryBase {
  readonly type: 'symlink';
  readonly linkTarget: string;
}

export type TarEntry = TarFileEntry | TarDirectoryEntry | TarSymlinkEntry;

export interface LayerResult {
  readonly compressed: Uint8Array;
  readonly uncompressed: Uint8Array;
  readonly diffId: Digest;
  readonly descriptor: OCIDescriptor;
}

export interface BuildOCILayoutOptions {
  readonly inputDir: string;
  readonly outputDir: string;
  readonly architecture?: string;
  readonly os?: string;
  readonly annotations?: Record<string, string>;
  readonly reproducible?: boolean;
}
