import { createHash, createPublicKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const pem = await readFile(process.argv[2] || '.keys/downloadhelper.pem');
const der = createPublicKey(pem).export({ type: 'spki', format: 'der' });
const bytes = createHash('sha256').update(der).digest().subarray(0, 16);
let id = '';
for (const b of bytes) id += String.fromCharCode(97 + (b >> 4), 97 + (b & 15));
console.log(id);
