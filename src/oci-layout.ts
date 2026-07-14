import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createLayerFromDirectory } from './layer.ts';
import { createImageConfig } from './config.ts';
import { createManifest, createIndex } from './manifest.ts';
import { createTarArchive } from './tar.ts';
import type { BuildOCILayoutOptions, OCIDescriptor } from './types.ts';

const OCI_LAYOUT_JSON = '{"imageLayoutVersion":"1.0.0"}';

function blobPath(descriptor: OCIDescriptor): string {
  return `blobs/sha256/${descriptor.digest.slice('sha256:'.length)}`;
}

export async function buildOCILayout(options: BuildOCILayoutOptions): Promise<void> {
  const { inputDir, outputDir, architecture, os, annotations, reproducible } = options;

  const layer = await createLayerFromDirectory(inputDir, { reproducible: reproducible ?? true });
  const { content: configContent, descriptor: configDescriptor } = createImageConfig({
    diffIds: [layer.diffId],
    architecture,
    os,
  });
  const { content: manifestContent, descriptor: manifestDescriptor } = createManifest({
    config: configDescriptor,
    layers: [layer.descriptor],
    annotations,
  });
  const { content: indexContent } = createIndex({
    manifests: [manifestDescriptor],
  });

  const blobsDir = join(outputDir, 'blobs', 'sha256');
  await mkdir(blobsDir, { recursive: true });

  await Promise.all([
    writeFile(join(outputDir, 'oci-layout'), OCI_LAYOUT_JSON),
    writeFile(join(outputDir, 'index.json'), indexContent),
    writeFile(join(outputDir, blobPath(layer.descriptor)), layer.compressed),
    writeFile(join(outputDir, blobPath(configDescriptor)), configContent),
    writeFile(join(outputDir, blobPath(manifestDescriptor)), manifestContent),
  ]);
}

export async function buildOCIArchive(
  options: Omit<BuildOCILayoutOptions, 'outputDir'>,
): Promise<Uint8Array> {
  const { inputDir, architecture, os, annotations, reproducible } = options;

  const layer = await createLayerFromDirectory(inputDir, { reproducible: reproducible ?? true });
  const { content: configContent, descriptor: configDescriptor } = createImageConfig({
    diffIds: [layer.diffId],
    architecture,
    os,
  });
  const { content: manifestContent, descriptor: manifestDescriptor } = createManifest({
    config: configDescriptor,
    layers: [layer.descriptor],
    annotations,
  });
  const { content: indexContent } = createIndex({
    manifests: [manifestDescriptor],
  });

  const encoder = new TextEncoder();

  return createTarArchive([
    { type: 'file', name: 'oci-layout', data: encoder.encode(OCI_LAYOUT_JSON) },
    { type: 'file', name: 'index.json', data: indexContent },
    { type: 'directory', name: 'blobs' },
    { type: 'directory', name: 'blobs/sha256' },
    { type: 'file', name: blobPath(configDescriptor), data: configContent },
    { type: 'file', name: blobPath(layer.descriptor), data: layer.compressed },
    { type: 'file', name: blobPath(manifestDescriptor), data: manifestContent },
  ]);
}
