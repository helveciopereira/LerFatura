// Teste final com valores negativos
import { readFileSync } from 'fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

async function testar() {
  const buffer = readFileSync('Fatura_Itau_modelo.pdf');
  const data = new Uint8Array(buffer);
  const pdf = await getDocument({ data }).promise;

  const todosItens = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    for (const item of textContent.items) {
      if (!item.str || item.str.trim() === '') continue;
      todosItens.push({ text: item.str.trim(), x: Math.round(item.transform[4]), y: Math.round(item.transform[5]), page: i });
    }
  }

  const sorted = [...todosItens].sort((a, b) => { if (a.page !== b.page) return a.page - b.page; return b.y - a.y; });
  const linhas = [];
  let la = [], ya = -999, pa = -1;
  for (const item of sorted) {
    if ((item.page !== pa || Math.abs(item.y - ya) > 4) && la.length > 0) { linhas.push(la.sort((a, b) => a.x - b.x)); la = []; }
    la.push(item); ya = item.y; pa = item.page;
  }
  if (la.length > 0) linhas.push(la.sort((a, b) => a.x - b.x));

  const LIM = 350;
  let limP = null;
  for (const l of linhas) {
    const d = l.filter(i => i.x >= LIM);
    if (!d.length) continue;
    const t = d.map(i => i.text).join(' ').toUpperCase();
    if (['COMPRAS PARCELADAS', 'PRÓXIMAS FATURAS'].some(m => t.includes(m))) { limP = { page: d[0].page, y: d[0].y }; break; }
  }

  const ef = i => { if (!limP) return false; if (i.page > limP.page) return true; return i.page === limP.page && i.y <= limP.y; };
  const RD = /^\d{2}\/\d{2}$/, RV = /^-?\s*\d{1,3}(?:\.\d{3})*,\d{2}$/, RP = /^\d{2}\/\d{2}$/, RPE = /(\d{2})\/(\d{2})$/;
  const FILTROS = ['PAGAMENTO EFETUADO','SALDO ANTERIOR','TOTAL DOS','TOTAL DA FATURA','TOTAL PARA','TOTAL DE LANÇAMENTOS','TOTAL DOS PAGAMENTOS','TOTAL DOS LANÇAMENTOS','LANÇAMENTOS PRODUTOS','LANÇAMENTOS: COMPRAS','LANÇAMENTOS NO CARTÃO','LANÇAMENTOS: PRODUTOS','CONTINUA','PRÓXIMA FATURA','DEMAIS FATURAS','TITULAR','ADICIONAL','LIMITE','DATA','PRODUTOS/SERVIÇOS','VALOR EM R$','ESTABELECIMENTO','ENCARGOS','JUROS','IOF','MULTA','CET','SIMULAÇÃO','PARCELAMENTO','HELVECIO WANDERLEY','HELVECIO W PEREIRA','CASO VOCÊ PAGUE','O PAGAMENTO OBRIGATÓRIO','PAGAMENTO DO VALOR','CONSULTE OUTRAS','PREVISÃO DO PRÓXIMO','PC -'];
  const RC = /^[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇÜ]{3,}\s+\.[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇÜ\s]+$/i;
  const dI = t => FILTROS.some(f => t.toUpperCase().includes(f));

  function ext(itens) {
    if (itens.length < 2 || !RD.test(itens[0].text)) return null;
    if (!RV.test(itens[itens.length - 1].text)) return null;
    const v = parseFloat(itens[itens.length - 1].text.replace(/\s/g, '').replace(/\./g, '').replace(',', '.'));
    if (isNaN(v) || v === 0) return null;
    const m = itens.slice(1, itens.length - 1);
    if (!m.length) return null;
    let par = 'À vista', desc = [...m];
    for (let i = m.length - 1; i >= 0; i--) {
      if (RP.test(m[i].text)) { const p = m[i].text.split('/'); const n1 = parseInt(p[0]), n2 = parseInt(p[1]);
        if (n1 >= 1 && n1 <= n2 && n2 > 1 && n2 <= 99) { par = m[i].text; desc = m.filter((_, j) => j !== i); break; } } }
    if (par === 'À vista' && desc.length > 0) {
      const mt = desc[desc.length - 1].text.match(RPE);
      if (mt) { const n1 = parseInt(mt[1]), n2 = parseInt(mt[2]);
        if (n1 >= 1 && n1 <= n2 && n2 > 1 && n2 <= 99) { par = mt[0]; const t = desc[desc.length - 1].text.slice(0, -5).trim();
          if (t.length > 0) desc[desc.length - 1] = { text: t }; else desc.pop(); } } }
    let d = desc.map(i => i.text).join(' ').replace(/\s{2,}/g, ' ').trim();
    if (d.length < 2 || dI(d) || RC.test(d)) return null;
    return { date: itens[0].text, desc: d.substring(0, 40), par, val: v };
  }

  const desp = [];
  for (const linha of linhas) {
    const esq = linha.filter(i => i.x < LIM), dir = linha.filter(i => i.x >= LIM);
    const de = ext(esq); if (de) desp.push({ ...de, col: 'ESQ' });
    if (dir.length > 0 && !ef(dir[0])) { const dd = ext(dir); if (dd) desp.push({ ...dd, col: 'DIR' }); }
  }

  const total = desp.reduce((s, d) => s + d.val, 0);
  const positivos = desp.filter(d => d.val > 0);
  const negativos = desp.filter(d => d.val < 0);

  console.log(`=== RESULTADO FINAL v1.1 ===`);
  console.log(`Total despesas: ${desp.length} (${positivos.length} positivas + ${negativos.length} estornos)`);
  console.log(`TOTAL:    R$ ${total.toFixed(2)}`);
  console.log(`ESPERADO: R$ 45.686,87`);
  console.log(`DIFERENÇA: R$ ${(total - 45686.87).toFixed(2)}`);
  console.log(`MATCH: ${Math.abs(total - 45686.87) < 0.05 ? '✅ PERFEITO!' : '❌ AJUSTE NECESSÁRIO'}`);

  if (negativos.length > 0) {
    console.log('\n--- Estornos/Créditos ---');
    for (const d of negativos) console.log(`[${d.col}] ${d.date} | ${d.desc.padEnd(40)} | R$ ${d.val.toFixed(2)}`);
  }
}

testar().catch(console.error);
