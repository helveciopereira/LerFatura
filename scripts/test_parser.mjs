/**
 * Teste do parser v2.3
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

const LIMITE_COLUNA_X = 350;
const REGEX_DATA = /^\d{2}\/\d{2}$/;
const REGEX_VALOR = /^-?\s*\d{1,3}(?:\.\d{3})*,\d{2}$/;
const REGEX_PARCELA_ISOLADA = /^\d{2}\/\d{2}$/;
const REGEX_PARCELA_EMBUTIDA = /(\d{2})\/(\d{2})$/;
const MARCADORES_PROXIMAS_DIR = ['COMPRAS PARCELADAS - PRÓXIMAS FATURAS','COMPRAS PARCELADAS','PRÓXIMAS FATURAS'];
const FILTROS_IGNORAR = [
  'PAGAMENTO EFETUADO','PAGAMENTO VIA CONTA','PAGAMENTO VIA PIX','PAGAMENTO DO VALOR',
  'SALDO ANTERIOR','TOTAL DOS','TOTAL DA FATURA','TOTAL PARA',
  'TOTAL DE LANÇAMENTOS','TOTAL DOS PAGAMENTOS','TOTAL DOS LANÇAMENTOS','TOTAL A PAGAR',
  'LANÇAMENTOS PRODUTOS','LANÇAMENTOS: COMPRAS','LANÇAMENTOS NO CARTÃO',
  'LANÇAMENTOS: PRODUTOS','LANÇAMENTOS PRODUTOS E SERVIÇOS',
  'CONTINUA','PRÓXIMA FATURA','DEMAIS FATURAS',
  'ENCARGOS REFINANCIAMENT','ENCARGOS REFINANCIAMENTO',
  'TITULAR','ADICIONAL',
  'PRODUTOS/SERVIÇOS','VALOR EM R$','ESTABELECIMENTO',
  'SIMULAÇÃO','PARCELAMENTO','COBRADA OU SERÁ','VÁLIDO POR','CONTRATAÇÃO',
  'RENDA MÍNIMA','COMPROMETE','VALOR DA PARCELA','QUANTIDADE DE PARCELAS','VALOR TOTAL','VALOR JUROS',
  'VALOR TARIFA','VALOR COMPRA','VALOR SAQUE','VALOR DO IOF','CRÉDITO ROTATIVO','PAGUE SUA FATURA',
  'OFERTA VÁLIDA','SEM SEGURO','VALOR SOLICITADO','PARA CONTRATAR','IMPORTANTE',
  'TETO DE JUROS','FIQUE ATENTO','NOVO TETO','LIMITE MÁXIMO','DE RETIRADA','DE PAGAMENTO',
  'LIMITE DE CRÉDITO','LIMITE TOTAL',
  'HELVECIO WANDERLEY','HELVECIO W PEREIRA',
  'CASO VOCÊ PAGUE','O PAGAMENTO OBRIGATÓRIO','CONSULTE OUTRAS','PREVISÃO DO PRÓXIMO','PC -',
  'AO CONTRATAR ESSE','VALORES DEVIDOS','JUROS DA COMPRA','CREDIÁRIO',
];
const REGEX_CATEGORIA_LOCAL = /^[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇÜ]{3,}\s+\.[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇÜ\s]+$/i;

function agrupar(itens) {
  const s = [...itens].sort((a,b)=>a.page!==b.page?a.page-b.page:b.y-a.y);
  const l=[]; let la=[],yA=-999,pA=-1;
  for(const i of s){if(i.page!==pA||Math.abs(i.y-yA)>4){if(la.length)l.push(la.sort((a,b)=>a.x-b.x));la=[];}la.push(i);yA=i.y;pA=i.page;}
  if(la.length)l.push(la.sort((a,b)=>a.x-b.x)); return l;
}

function limites(linhas) {
  let df=null, pct=999;
  for(const l of linhas){
    if(!df){const d=l.filter(i=>i.x>=350);if(d.length){const t=d.map(i=>i.text).join(' ').toUpperCase();if(MARCADORES_PROXIMAS_DIR.some(m=>t.includes(m)))df={page:d[0].page,y:d[0].y};}}
    if(pct===999){const t=l.map(i=>i.text).join(' ').toUpperCase();if(t.includes('TOTAL DOS LANÇAMENTOS ATUAIS'))pct=l[0].page;}
    if(df&&pct!==999)break;
  }
  return{direitaFim:df,paginaComTotal:pct};
}

function dirFutura(item,lim){if(!lim)return false;return item.page>lim.page||(item.page===lim.page&&item.y<=lim.y);}
function ign(t){const u=t.toUpperCase();return FILTROS_IGNORAR.some(f=>u.includes(f));}

function extrair(itens,id){
  if(itens.length<2)return null;
  if(!REGEX_DATA.test(itens[0].text))return null;
  if(!REGEX_VALOR.test(itens[itens.length-1].text))return null;
  const v=parseFloat(itens[itens.length-1].text.replace(/\s/g,'').replace(/\./g,'').replace(',','.'));
  if(isNaN(v)||v===0)return null;
  const m=itens.slice(1,-1);if(!m.length)return null;
  let p='À vista',d=[...m];
  for(let i=m.length-1;i>=0;i--){if(REGEX_PARCELA_ISOLADA.test(m[i].text)){const[n1,n2]=m[i].text.split('/').map(Number);if(n1>=1&&n1<=n2&&n2>1&&n2<=99){p=m[i].text;d=m.filter((_,j)=>j!==i);break;}}}
  if(p==='À vista'&&d.length){const mm=d[d.length-1].text.match(REGEX_PARCELA_EMBUTIDA);if(mm){const[n1,n2]=[parseInt(mm[1]),parseInt(mm[2])];if(n1>=1&&n1<=n2&&n2>1&&n2<=99){p=mm[0];const t=d[d.length-1].text.slice(0,-5).trim();if(t.length)d[d.length-1]={...d[d.length-1],text:t};else d.pop();}}}
  let desc=d.map(i=>i.text).join(' ').replace(/\s{2,}/g,' ').trim();
  if(desc.length<2||ign(desc)||REGEX_CATEGORIA_LOCAL.test(desc))return null;
  if(desc.length>40)desc=desc.substring(0,40);
  return{id,date:itens[0].text,description:desc,installment:p,value:v,category:null};
}

function extrairTodas(linhas,lim){
  const desp=[];let c=1;
  for(const l of linhas){
    const pg=l[0].page;
    if(pg>lim.paginaComTotal)continue;
    const esq=l.filter(i=>i.x<350),dir=l.filter(i=>i.x>=350);
    const de=extrair(esq,`E${c}`);if(de){desp.push(de);c++;}
    if(dir.length&&!dirFutura(dir[0],lim.direitaFim)){const dd=extrair(dir,`D${c}`);if(dd){desp.push(dd);c++;}}
  }
  return desp;
}

function deduplicate(despesas) {
  const unicos = [];
  const vistos = new Set();
  for (const d of despesas) {
    const chave = `${d.date}|${d.description}|${d.value.toFixed(2)}`;
    if (!vistos.has(chave)) { vistos.add(chave); unicos.push(d); }
  }
  return unicos;
}

const pdfs=[
  {path:join(__dirname,'..','Fatura_Itau_modelo.pdf'),total:45686.87},
  {path:join(__dirname,'..','Fatura_Itau_20260501-190348.pdf'),total:45962.14},
];

for(const pdf of pdfs){
  const buf=new Uint8Array(readFileSync(pdf.path));
  const doc=await pdfjsLib.getDocument({data:buf}).promise;
  console.log(`\n📄 ${pdf.path.split('\\').pop()} (${doc.numPages} págs)`);
  const itens=[];
  for(let i=1;i<=doc.numPages;i++){const pg=await doc.getPage(i);const tc=await pg.getTextContent();tc.items.filter(x=>x.str&&x.str.trim()).forEach(x=>itens.push({text:x.str.trim(),x:Math.round(x.transform[4]),y:Math.round(x.transform[5]),page:i}));}
  const linhas=agrupar(itens);
  const lim=limites(linhas);
  console.log(`   Direita fim: ${lim.direitaFim?`P${lim.direitaFim.page} Y${lim.direitaFim.y}`:'-'}`);
  console.log(`   Pág com total: ${lim.paginaComTotal}`);
  const despesas=deduplicate(extrairTodas(linhas,lim));
  const soma=despesas.reduce((a,d)=>a+d.value,0);
  console.log(`   ${despesas.length} despesas, R$ ${soma.toFixed(2)}`);
  const diff=Math.abs(soma-pdf.total);
  console.log(diff<0.02?`   ✅ CORRETO! (esperado R$ ${pdf.total.toFixed(2)})`:`   ❌ INCORRETO! Esperado R$ ${pdf.total.toFixed(2)}, diff R$ ${diff.toFixed(2)}`);
  console.log(`   Primeiras 3:`);
  despesas.slice(0,3).forEach(d=>console.log(`     ${d.date} ${d.description.padEnd(40)} ${d.installment.padStart(7)} R$ ${d.value.toFixed(2).padStart(10)}`));
  console.log(`   Últimas 3:`);
  despesas.slice(-3).forEach(d=>console.log(`     ${d.date} ${d.description.padEnd(40)} ${d.installment.padStart(7)} R$ ${d.value.toFixed(2).padStart(10)}`));
  const est=despesas.filter(d=>d.value<0);
  if(est.length){console.log(`   Estornos (${est.length}):`);est.forEach(d=>console.log(`     ${d.date} ${d.description} R$ ${d.value.toFixed(2)}`));}
}
console.log('\n🏁 v2.3');
