# @kube-hive/oci-artifact

Build valid OCI images from a directory. Pure JS, zero runtime dependencies.

The produced images conform to the [OCI Image Spec](https://github.com/opencontainers/image-spec) and can be pushed to any OCI-compliant registry and mounted as volumes in Kubernetes via [Image Volumes](https://kubernetes.io/docs/tasks/configure-pod-container/image-volumes/).

## Install

```bash
npm install @kube-hive/oci-artifact
```

## CLI

```bash
oci-artifact <input-dir> <output.tar>
```

The output is an OCI archive tar that can be pushed with `skopeo`:

```bash
oci-artifact ./my-files ./image.tar
skopeo copy oci-archive:./image.tar docker://registry.example.com/my-image:latest
```

## Library

### Quick start

```typescript
import { buildOCILayout, buildOCIArchive } from '@kube-hive/oci-artifact';

// Write an OCI image layout directory (for use with `skopeo copy oci:./output ...`)
await buildOCILayout({
  inputDir: './my-files',
  outputDir: './oci-output',
});

// Or build an in-memory OCI archive tar
import { writeFile } from 'node:fs/promises';

const archive = await buildOCIArchive({ inputDir: './my-files' });
await writeFile('image.tar', archive);
```

### Options

```typescript
await buildOCILayout({
  inputDir: './my-files',    // Directory to pack into the image layer
  outputDir: './oci-output', // Where to write the OCI layout
  architecture: 'arm64',     // Default: 'amd64'
  os: 'linux',               // Default: 'linux'
  reproducible: true,        // Default: true — deterministic tar (mtime=0, uid/gid=0)
  annotations: {             // Optional OCI annotations on the manifest
    'org.opencontainers.image.title': 'my-artifact',
  },
});
```

### Lower-level API

Each step in the pipeline is independently accessible:

```typescript
import {
  collectEntries,
  createTarArchive,
  createLayer,
  createImageConfig,
  createManifest,
  createIndex,
  computeDigest,
} from '@kube-hive/oci-artifact';

// 1. Collect files from a directory
const entries = await collectEntries('./my-files');

// 2. Create an OCI layer (tar + gzip + digest pair)
const layer = await createLayer(entries);
// layer.diffId       — sha256 of uncompressed tar (goes in config.rootfs.diff_ids)
// layer.descriptor   — descriptor with sha256 of compressed blob (goes in manifest.layers)

// 3. Build config, manifest, index
const config = createImageConfig({ diffIds: [layer.diffId] });
const manifest = createManifest({ config: config.descriptor, layers: [layer.descriptor] });
const index = createIndex({ manifests: [manifest.descriptor] });

// 4. Or create a tar archive directly
const tar = createTarArchive([
  { type: 'directory', name: 'etc' },
  { type: 'file', name: 'etc/config.yaml', data: new TextEncoder().encode('key: value') },
]);
```

## How it works

The library implements a POSIX ustar tar writer from scratch using only Node.js builtins (`crypto`, `zlib`, `fs`). The OCI image is built as:

```
input directory
  -> tar archive (POSIX ustar, reproducible)
    -> gzip compress
      -> layer blob (manifest references compressed digest)
      -> diffId (config references uncompressed digest)
        -> image config JSON
          -> image manifest JSON
            -> image index JSON
              -> OCI layout directory or archive tar
```

The critical invariant for Kubernetes compatibility: `config.rootfs.diff_ids[i]` is the SHA-256 of the **uncompressed** layer tar, while `manifest.layers[i].digest` is the SHA-256 of the **compressed** blob. A mismatch causes containerd to reject the image with "mismatched image rootfs and manifest layers".

## License

Apache-2.0
