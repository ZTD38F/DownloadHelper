import { constants, createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

function varint(value) {
  let n = BigInt(value);
  const out = [];
  while (n >= 0x80n) {
    out.push(Number((n & 0x7fn) | 0x80n));
    n >>= 7n;
  }
  out.push(Number(n));
  return Buffer.from(out);
}

function bytesField(fieldNumber, bytes) {
  const tag = (BigInt(fieldNumber) << 3n) | 2n;
  return Buffer.concat([varint(tag), varint(bytes.length), Buffer.from(bytes)]);
}

function u32le(value) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(value >>> 0, 0);
  return b;
}

function extensionIdFromCrxId(crxId) {
  let id = '';
  for (const b of crxId) id += String.fromCharCode(97 + (b >> 4), 97 + (b & 15));
  return id;
}

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

const [zipPath, keyPath, crxPath, xmlPath, crxUrl, version] = process.argv.slice(2);
if (!zipPath || !keyPath || !crxPath || !xmlPath || !crxUrl || !version) {
  console.error('Usage: node scripts/pack-crx3.mjs <zip> <private.pem> <out.crx> <updates.xml> <crx-url> <version>');
  process.exit(2);
}

const [zip, privatePem] = await Promise.all([readFile(zipPath), readFile(keyPath)]);
const privateKey = createPrivateKey(privatePem);
const publicDer = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
const crxId = createHash('sha256').update(publicDer).digest().subarray(0, 16);
const extensionId = extensionIdFromCrxId(crxId);

// SignedData { bytes crx_id = 1; }
const signedHeaderData = bytesField(1, crxId);
const signatureInput = Buffer.concat([
  Buffer.from('CRX3 SignedData\0', 'utf8'),
  u32le(signedHeaderData.length),
  signedHeaderData,
  zip,
]);
const signature = sign('sha256', signatureInput, {
  key: privateKey,
  padding: constants.RSA_PKCS1_PADDING,
});

if (!verify('sha256', signatureInput, { key: createPublicKey(privateKey), padding: constants.RSA_PKCS1_PADDING }, signature)) {
  throw new Error('Internal CRX3 signature verification failed');
}

// AsymmetricKeyProof { bytes public_key = 1; bytes signature = 2; }
const proof = Buffer.concat([bytesField(1, publicDer), bytesField(2, signature)]);
// CrxFileHeader { repeated AsymmetricKeyProof sha256_with_rsa = 2; bytes signed_header_data = 10000; }
const header = Buffer.concat([bytesField(2, proof), bytesField(10000, signedHeaderData)]);
const crx = Buffer.concat([Buffer.from('Cr24'), u32le(3), u32le(header.length), header, zip]);
await writeFile(crxPath, crx);

const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">\n  <app appid="${extensionId}">\n    <updatecheck codebase="${xmlEscape(crxUrl)}" version="${xmlEscape(version)}"/>\n  </app>\n</gupdate>\n`;
await writeFile(xmlPath, xml);
console.log(extensionId);
