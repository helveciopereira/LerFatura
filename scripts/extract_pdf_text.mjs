// Script para extrair PÁGINA 3 completa
import { readFileSync } from 'fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

async function extractText() {
  const buffer = readFileSync('Fatura_Itau_modelo.pdf');
  const data = new Uint8Array(buffer);
  const pdf = await getDocument({ data }).promise;
  
  console.log(`\n===== PÁGINA 3 - COMPLETA =====\n`);
  const page = await pdf.getPage(3);
  const textContent = await page.getTextContent();
  
  const lines = {};
  for (const item of textContent.items) {
    if (!item.str || item.str.trim() === '') continue;
    const y = Math.round(item.transform[5]);
    const x = Math.round(item.transform[4]);
    if (!lines[y]) lines[y] = [];
    lines[y].push({ text: item.str, x });
  }
  
  const sortedYs = Object.keys(lines).map(Number).sort((a, b) => b - a);
  
  for (const y of sortedYs) {
    const lineItems = lines[y].sort((a, b) => a.x - b.x);
    const esq = lineItems.filter(i => i.x < 350);
    const dir = lineItems.filter(i => i.x >= 350);
    
    const esqText = esq.length ? `ESQ: ${esq.map(i => `[${i.x}]"${i.text}"`).join(' ')}` : '';
    const dirText = dir.length ? `DIR: ${dir.map(i => `[${i.x}]"${i.text}"`).join(' ')}` : '';
    
    console.log(`[Y:${y}] ${esqText}${esqText && dirText ? '  ||  ' : ''}${dirText}`);
  }
}

extractText().catch(console.error);
