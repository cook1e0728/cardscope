import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const registryUrl = new URL('../data/source-registry.json', import.meta.url);
const sourceId = process.argv[2];
const registry = JSON.parse(await readFile(registryUrl, 'utf8'));

if (!sourceId) {
  console.error('Usage: node scripts/crawl-approved-metadata.mjs <source-id>');
  process.exitCode = 1;
} else {
  const source = registry.sources.find(item => item.id === sourceId);
  if (!source) {
    console.error(`Unknown source: ${sourceId}`);
    process.exitCode = 1;
  } else if (source.metadataCollection !== 'approved') {
    console.error(`Collection is disabled for ${source.id}. Record written permission before changing metadataCollection to "approved".`);
    process.exitCode = 2;
  } else if (source.imagePolicy !== 'not-collected') {
    console.error('This collector only supports metadata; image collection is intentionally unsupported.');
    process.exitCode = 2;
  } else {
    console.error('No parser is registered for this approved source yet. Add a source-specific metadata parser after reviewing the permission scope.');
    process.exitCode = 3;
  }
}
