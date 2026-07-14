import { stat, writeFile } from 'node:fs/promises';
import { buildOCIArchive } from './oci-layout.ts';
import { computeDigest } from './digest.ts';

async function main(): Promise<void> {
  const [inputDir, outputTar] = process.argv.slice(2);

  if (!inputDir || !outputTar) {
    console.error('Usage: oci-artifact <input-dir> <output-tar>');
    process.exit(1);
  }

  const info = await stat(inputDir).catch(() => null);
  if (!info?.isDirectory()) {
    console.error(`Not a directory: ${inputDir}`);
    process.exit(1);
  }

  const archive = await buildOCIArchive({ inputDir });
  await writeFile(outputTar, archive);

  const digest = computeDigest(archive);
  console.log(`${digest}  ${archive.length} bytes  ${outputTar}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
