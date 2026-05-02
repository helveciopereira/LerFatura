/**
 * Script de debug para visualizar linhas brutas do PDF
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

// Mostrar todas as linhas com coordenadas
console.log(`\n📄 PDF 2: ${pdf.numPages} páginas, ${linhas.length} linhas\n`);

for (const linha of linhas) {
  const pag = linha[0].page;
  const y = linha[0].y;
  
  // Separar esquerda e direita
  const esq = linha.filter(it => it.x < 350);
  const dir = linha.filter(it => it.x >= 350);
  
  const esqTexto = esq.map(it => `${it.text}(${it.x})`).join(' ');
  const dirTexto = dir.map(it => `${it.text}(${it.x})`).join(' ');
  
  // Filtrar: só linhas que contêm data ou palavras-chave
  const textoCompleto = linha.map(it => it.text).join(' ').toUpperCase();
  const temData = /^\d{2}\/\d{2}$/.test(linha[0]?.text || '') || 
                  dir.some(it => /^\d{2}\/\d{2}$/.test(it.text));
  const temPagamento = textoCompleto.includes('PAGAMENTO');
  const temTotal = textoCompleto.includes('TOTAL');
  const temProximas = textoCompleto.includes('PRÓXIMAS') || textoCompleto.includes('PARCELADAS');
  const temReducao = textoCompleto.includes('REDUÇÃO') || textoCompleto.includes('MENSALIDADE');
  
  if (temData || temPagamento || temTotal || temProximas || temReducao) {
    let marker = '  ';
    if (temPagamento) marker = '💸';
    if (temTotal) marker = '📊';
    if (temProximas) marker = '🚫';
    if (temReducao) marker = '🔄';
    
    console.log(`${marker} P${pag} Y${String(y).padStart(3)} | ESQ: ${esqTexto || '(vazio)'}`);
    if (dirTexto) {
      console.log(`   ${''.padStart(9)} | DIR: ${dirTexto}`);
    }
  }
}
