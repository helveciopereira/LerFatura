/**
 * Debug de estornos duplicados no PDF 2
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

const pdfPath = join(__dirname, '..', 'Fatura_Itau_20260501-190348.pdf');
const buffer = readFileSync(pdfPath);
const data = new Uint8Array(buffer);
const pdf = await pdfjsLib.getDocument({ data }).promise;

const todosItens = [];
for (let i = 1; i <= pdf.numPages; i++) {
  const page = await pdf.getPage(i);
  const textContent = await page.getTextContent();
  for (const item of textContent.items) {
    if (!item.str || item.str.trim() === '') continue;
    todosItens.push({
      text: item.str.trim(),
      x: Math.round(item.transform[4]),
      y: Math.round(item.transform[5]),
      page: i,
    });
  }
}

// Agrupar por linha
const sorted = [...todosItens].sort((a, b) => {
  if (a.page !== b.page) return a.page - b.page;
  return b.y - a.y;
});
const linhas = [];
let linhaAtual = [];
let yAtual = -999;
let pageAtual = -1;
for (const item of sorted) {
  const novaLinha = item.page !== pageAtual || Math.abs(item.y - yAtual) > 4;
  if (novaLinha && linhaAtual.length > 0) {
    linhas.push(linhaAtual.sort((a, b) => a.x - b.x));
    linhaAtual = [];
  }
  linhaAtual.push(item);
  yAtual = item.y;
  pageAtual = item.page;
}
if (linhaAtual.length > 0) {
  linhas.push(linhaAtual.sort((a, b) => a.x - b.x));
}

// Procurar linhas com estornos (valores negativos) na pág 4
console.log('\n=== Linhas com valores negativos (pág 3-4) ===\n');
const REGEX_VALOR = /^-?\s*\d{1,3}(?:\.\d{3})*,\d{2}$/;

for (const linha of linhas) {
  if (linha[0].page < 3 || linha[0].page > 4) continue;
  
  const esq = linha.filter(it => it.x < 350);
  const dir = linha.filter(it => it.x >= 350);
  
  const temNegativoEsq = esq.some(it => REGEX_VALOR.test(it.text) && it.text.includes('-'));
  const temNegativoDir = dir.some(it => REGEX_VALOR.test(it.text) && it.text.includes('-'));
  
  if (temNegativoEsq || temNegativoDir) {
    console.log(`P${linha[0].page} Y${String(linha[0].y).padStart(3)}`);
    if (esq.length > 0) console.log(`  ESQ: ${esq.map(it => `${it.text}(x=${it.x})`).join(' ')}`);
    if (dir.length > 0) console.log(`  DIR: ${dir.map(it => `${it.text}(x=${it.x})`).join(' ')}`);
    console.log('');
  }
}

// Procurar linhas com IOF e ENCARGOS
console.log('\n=== Linhas com IOF, ENCARGOS, ANUIDADE (pág 4) ===\n');
for (const linha of linhas) {
  if (linha[0].page !== 4) continue;
  const texto = linha.map(it => it.text).join(' ').toUpperCase();
  if (texto.includes('IOF') || texto.includes('ENCARGOS') || texto.includes('ANUIDADE') || texto.includes('REDUÇÃO')) {
    const esq = linha.filter(it => it.x < 350);
    const dir = linha.filter(it => it.x >= 350);
    console.log(`Y${String(linha[0].y).padStart(3)}`);
    if (esq.length > 0) console.log(`  ESQ: ${esq.map(it => it.text).join(' ')}`);
    if (dir.length > 0) console.log(`  DIR: ${dir.map(it => it.text).join(' ')}`);
    console.log('');
  }
}

// Procurar BRASTEMP
console.log('\n=== Linha BRASTEMP ===\n');
for (const linha of linhas) {
  const texto = linha.map(it => it.text).join(' ').toUpperCase();
  if (texto.includes('BRASTEMP')) {
    const esq = linha.filter(it => it.x < 350);
    const dir = linha.filter(it => it.x >= 350);
    console.log(`P${linha[0].page} Y${String(linha[0].y).padStart(3)}`);
    if (esq.length > 0) console.log(`  ESQ: ${esq.map(it => `${it.text}(x=${it.x})`).join(' ')}`);
    if (dir.length > 0) console.log(`  DIR: ${dir.map(it => `${it.text}(x=${it.x})`).join(' ')}`);
    console.log('');
  }
}
