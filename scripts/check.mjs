import { access, readFile } from 'node:fs/promises';
const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
if (manifest.manifest_version !== 3) throw new Error('Manifest must be MV3');
for (const file of ['../extension/background.js','../extension/offscreen/factory.html','../extension/worker/download-worker.js','../extension/ui/popup.html']) await access(new URL(file, import.meta.url));
if (!manifest.permissions.includes('offscreen')) throw new Error('offscreen permission missing');
if (!manifest.permissions.includes('declarativeNetRequest')) throw new Error('DNR permission missing');
console.log('Static checks OK');
