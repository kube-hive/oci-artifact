import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildOCILayout, buildOCIArchive } from '../../src/oci-layout.ts';
import { mkdtemp, writeFile, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

describe('buildOCILayout', () => {
  let tmpDir: string;
  let inputDir: string;
  let outputDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'oci-integration-'));
    inputDir = join(tmpDir, 'input');
    outputDir = join(tmpDir, 'output');
    await mkdir(inputDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  it('creates valid OCI layout directory structure', async () => {
    await writeFile(join(inputDir, 'hello.txt'), 'Hello, World!');

    await buildOCILayout({ inputDir, outputDir });

    const ociLayout = JSON.parse(await readFile(join(outputDir, 'oci-layout'), 'utf8'));
    expect(ociLayout.imageLayoutVersion).toBe('1.0.0');

    const index = JSON.parse(await readFile(join(outputDir, 'index.json'), 'utf8'));
    expect(index.schemaVersion).toBe(2);
    expect(index.manifests).toHaveLength(1);

    const manifestDigest = index.manifests[0].digest.replace('sha256:', '');
    const manifest = JSON.parse(
      await readFile(join(outputDir, 'blobs', 'sha256', manifestDigest), 'utf8'),
    );
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.layers).toHaveLength(1);

    const configDigest = manifest.config.digest.replace('sha256:', '');
    const config = JSON.parse(
      await readFile(join(outputDir, 'blobs', 'sha256', configDigest), 'utf8'),
    );
    expect(config.rootfs.type).toBe('layers');
    expect(config.rootfs.diff_ids).toHaveLength(1);
  });

  it('passes skopeo inspect validation', async () => {
    await writeFile(join(inputDir, 'data.json'), '{"key":"value"}');
    await mkdir(join(inputDir, 'subdir'));
    await writeFile(join(inputDir, 'subdir', 'nested.txt'), 'Nested content');

    await buildOCILayout({ inputDir, outputDir });

    const result = execSync(`skopeo inspect oci:${outputDir}`, { encoding: 'utf8' });
    const inspected = JSON.parse(result);

    expect(inspected.Layers).toHaveLength(1);
    expect(inspected.LayersData[0].MIMEType).toBe(
      'application/vnd.oci.image.layer.v1.tar+gzip',
    );
  });

  it('layer content can be extracted and matches input', async () => {
    const content = 'test file content for extraction';
    await writeFile(join(inputDir, 'test.txt'), content);

    await buildOCILayout({ inputDir, outputDir });

    const index = JSON.parse(await readFile(join(outputDir, 'index.json'), 'utf8'));
    const manifestDigest = index.manifests[0].digest.replace('sha256:', '');
    const manifest = JSON.parse(
      await readFile(join(outputDir, 'blobs', 'sha256', manifestDigest), 'utf8'),
    );
    const layerDigest = manifest.layers[0].digest.replace('sha256:', '');
    const layerPath = join(outputDir, 'blobs', 'sha256', layerDigest);

    const extractDir = join(tmpDir, 'extract');
    await mkdir(extractDir);

    execSync(`tar xzf ${layerPath} -C ${extractDir}`);
    const extracted = await readFile(join(extractDir, 'test.txt'), 'utf8');
    expect(extracted).toBe(content);
  });

  it('produces reproducible output', async () => {
    await writeFile(join(inputDir, 'file.txt'), 'reproducible');

    const output1 = join(tmpDir, 'output1');
    const output2 = join(tmpDir, 'output2');

    await buildOCILayout({ inputDir, outputDir: output1 });
    await buildOCILayout({ inputDir, outputDir: output2 });

    const index1 = await readFile(join(output1, 'index.json'), 'utf8');
    const index2 = await readFile(join(output2, 'index.json'), 'utf8');
    expect(index1).toBe(index2);
  });

  it('supports custom architecture', async () => {
    await writeFile(join(inputDir, 'file.txt'), 'arm test');

    await buildOCILayout({ inputDir, outputDir, architecture: 'arm64' });

    const result = execSync(`skopeo inspect oci:${outputDir}`, { encoding: 'utf8' });
    const inspected = JSON.parse(result);
    expect(inspected.Architecture).toBe('arm64');
  });

  it('can be copied to containers-storage via skopeo', async () => {
    await writeFile(join(inputDir, 'payload.txt'), 'kubernetes volume content');
    await mkdir(join(inputDir, 'config'));
    await writeFile(join(inputDir, 'config', 'settings.yaml'), 'key: value\n');

    await buildOCILayout({ inputDir, outputDir });

    const tag = `localhost/oci-artifact-test:integration-${Date.now()}`;

    try {
      execSync(`skopeo copy oci:${outputDir} containers-storage:${tag}`, {
        encoding: 'utf8',
        stdio: 'pipe',
      });

      const inspectResult = execSync(`podman inspect ${tag}`, { encoding: 'utf8' });
      const inspected = JSON.parse(inspectResult);
      expect(inspected[0].RootFS.Layers).toHaveLength(1);
    } finally {
      try {
        execSync(`podman rmi ${tag}`, { stdio: 'pipe' });
      } catch {
        // cleanup best-effort
      }
    }
  });
});

describe('buildOCIArchive', () => {
  let tmpDir: string;
  let inputDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'oci-archive-'));
    inputDir = join(tmpDir, 'input');
    await mkdir(inputDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  it('produces a tar containing the OCI layout', async () => {
    await writeFile(join(inputDir, 'hello.txt'), 'Hello from archive!');

    const archive = await buildOCIArchive({ inputDir });

    const archivePath = join(tmpDir, 'archive.tar');
    await writeFile(archivePath, archive);

    const listing = execSync(`tar tf ${archivePath}`, { encoding: 'utf8' });
    const files = listing.trim().split('\n').sort();

    expect(files).toContain('oci-layout');
    expect(files).toContain('index.json');
    expect(files).toContain('blobs/');
    expect(files).toContain('blobs/sha256/');
    expect(files.filter(f => f.startsWith('blobs/sha256/') && f !== 'blobs/sha256/')).toHaveLength(3);
  });

  it('archive can be extracted and passes skopeo inspect', async () => {
    await writeFile(join(inputDir, 'data.txt'), 'archive data');

    const archive = await buildOCIArchive({ inputDir });

    const archivePath = join(tmpDir, 'archive.tar');
    const extractDir = join(tmpDir, 'extracted');
    await writeFile(archivePath, archive);
    await mkdir(extractDir);

    execSync(`tar xf ${archivePath} -C ${extractDir}`);

    const result = execSync(`skopeo inspect oci:${extractDir}`, { encoding: 'utf8' });
    const inspected = JSON.parse(result);
    expect(inspected.Layers).toHaveLength(1);
  });
});
