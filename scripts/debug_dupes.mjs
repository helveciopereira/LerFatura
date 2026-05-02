import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

const buf = new Uint8Array(readFileSync(join(__dirname, '..', 'Fatura_Itau_20260501-190348.pdf')));
const doc = await pdfjsLib.getDocument({ data: buf }).promise;

// Buscar TODOS os itens com texto "MERCADOLIVRE2" ou estornos de 23/03
const itens = [];
for (let i = 1; i <= doc.numPages; i++) {
  const pg = await doc.getPage(i);
  const tc = await pg.getTextContent();
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const text = it.str.trim();
    const x = Math.round(it.transform[4]);
    const y = Math.round(it.transform[5]);
    
    if (text.includes('MERCADOLIVRE2') || text.includes('MP3PRODUTOS') ||
        text.includes('LINK MAGBAN') || text.includes('BOUTONBouton') ||
        text.includes('MERCADOLIVREEBLCOMERC') || text === 'CEA SLS 439 -CT' ||
        text.includes('Redução Mensalidade')) {
      console.log(`P${i} Y=${y} x=${x} col=${x<350?'ESQ':'DIR'} : "${text}"`);
    }
  }
}
