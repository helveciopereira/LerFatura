import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
const buf = new Uint8Array(readFileSync(join(__dirname, '..', 'Fatura_Itau_20260501-190348.pdf')));
const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

// Ver coluna direita da pág 3
for (let p = 3; p <= 3; p++) {
  const pg = await pdf.getPage(p);
  const tc = await pg.getTextContent();
  const items = tc.items.filter(x => x.str && x.str.trim()).map(x => ({
    text: x.str.trim(),
    x: Math.round(x.transform[4]),
    y: Math.round(x.transform[5]),
  }));
  const dir = items.filter(x => x.x >= 350).sort((a, b) => b.y - a.y);
  console.log(`\nP${p} COLUNA DIREITA (${dir.length} itens):\n`);
  dir.forEach(d => console.log(`  Y${String(d.y).padStart(3)} x=${d.x} : ${d.text}`));
}
