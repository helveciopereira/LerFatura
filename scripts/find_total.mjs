import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
const buf = new Uint8Array(readFileSync(join(__dirname, '..', 'Fatura_Itau_modelo.pdf')));
const doc = await pdfjsLib.getDocument({ data: buf }).promise;
for (let i = 1; i <= doc.numPages; i++) {
  const pg = await doc.getPage(i);
  const tc = await pg.getTextContent();
  for (const it of tc.items) {
    if (it.str && it.str.toLowerCase().includes('total dos')) {
      console.log(`P${i} Y=${Math.round(it.transform[5])} x=${Math.round(it.transform[4])} : "${it.str}"`);
    }
    if (it.str && it.str.toLowerCase().includes('total para')) {
      console.log(`P${i} Y=${Math.round(it.transform[5])} x=${Math.round(it.transform[4])} : "${it.str}"`);
    }
  }
}
