import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
const buf = new Uint8Array(readFileSync(join(__dirname, '..', 'Fatura_Itau_modelo.pdf')));
const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

// Pág 4 completa
const pg = await pdf.getPage(4);
const tc = await pg.getTextContent();
const items = tc.items.filter(x => x.str && x.str.trim()).map(x => ({
  text: x.str.trim(), x: Math.round(x.transform[4]), y: Math.round(x.transform[5])
}));

// Ordenar por Y decrescente
items.sort((a, b) => b.y - a.y);

console.log('\nPág 4 do PDF MODELO:\n');
let lastY = 999;
for (const it of items) {
  if (Math.abs(it.y - lastY) > 2) console.log(`--- Y=${it.y} ---`);
  const col = it.x < 350 ? 'ESQ' : 'DIR';
  console.log(`  ${col} x=${String(it.x).padStart(3)} : ${it.text}`);
  lastY = it.y;
}
