/**
 * pdfUtils.ts - Utilitários para leitura e extração de dados de faturas PDF
 * 
 * Parser especializado para faturas de cartão Itaú com suporte a:
 * - Layout de duas colunas lado a lado
 * - Detecção da seção "Compras parceladas - próximas faturas"
 * - Detecção de "Total dos lançamentos atuais" para delimitar páginas
 * - Filtragem de pagamentos e textos informativos
 * - Detecção de parcelas (isoladas ou embutidas)
 * 
 * Versão: 2.3
 */

// === TIPOS ===

export type ExpenseCategory = 'H' | 'A' | 'E' | 'T' | null;

export interface Expense {
  id: string;
  date: string;
  description: string;
  installment: string;
  value: number;
  category: ExpenseCategory;
}

interface PdfTextItem {
  text: string;
  x: number;
  y: number;
  page: number;
}

interface LimitesExtracao {
  /** Posição onde "próximas faturas" começa na coluna DIREITA */
  direitaFim: { page: number; y: number } | null;
  /** Página onde "Total dos lançamentos atuais" aparece — última página com despesas */
  paginaComTotal: number;
}

// === CONSTANTES ===

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';
const LIMITE_COLUNA_X = 350;
const REGEX_DATA = /^\d{2}\/\d{2}$/;
const REGEX_VALOR = /^-?\s*\d{1,3}(?:\.\d{3})*,\d{2}$/;
const REGEX_PARCELA_ISOLADA = /^\d{2}\/\d{2}$/;
const REGEX_PARCELA_EMBUTIDA = /(\d{2})\/(\d{2})$/;

/** Marcadores de "próximas faturas" na COLUNA DIREITA */
const MARCADORES_PROXIMAS_DIR = [
  'COMPRAS PARCELADAS - PRÓXIMAS FATURAS',
  'COMPRAS PARCELADAS',
  'PRÓXIMAS FATURAS',
];

/**
 * Palavras que indicam linhas de NÃO-despesa
 * NOTA: Encargos, IOF, Anuidade e similares NÃO são filtrados
 * pois fazem parte do "Total dos lançamentos atuais"
 */
const FILTROS_IGNORAR = [
  // === Pagamentos ===
  'PAGAMENTO EFETUADO', 'PAGAMENTO VIA CONTA', 'PAGAMENTO VIA PIX',
  'PAGAMENTO DO VALOR',
  // === Saldos e totais ===
  'SALDO ANTERIOR', 'TOTAL DOS', 'TOTAL DA FATURA', 'TOTAL PARA',
  'TOTAL DE LANÇAMENTOS', 'TOTAL DOS PAGAMENTOS', 'TOTAL DOS LANÇAMENTOS',
  'TOTAL A PAGAR',
  // === Cabeçalhos de seção ===
  'LANÇAMENTOS PRODUTOS', 'LANÇAMENTOS: COMPRAS', 'LANÇAMENTOS NO CARTÃO',
  'LANÇAMENTOS: PRODUTOS', 'LANÇAMENTOS PRODUTOS E SERVIÇOS',
  // === Continuação ===
  'CONTINUA', 'PRÓXIMA FATURA', 'DEMAIS FATURAS',
  // === Encargos e taxas (sub-seções dentro da coluna direita, já incluídas no subtotal) ===
  'ENCARGOS REFINANCIAMENT', 'ENCARGOS REFINANCIAMENTO',
  // === Cabeçalhos de coluna ===
  'TITULAR', 'ADICIONAL',
  'PRODUTOS/SERVIÇOS', 'VALOR EM R$', 'ESTABELECIMENTO',
  // === Simulações e ofertas ===
  'SIMULAÇÃO', 'PARCELAMENTO',
  'COBRADA OU SERÁ', 'VÁLIDO POR', 'CONTRATAÇÃO',
  'RENDA MÍNIMA', 'COMPROMETE', 'VALOR DA PARCELA',
  'QUANTIDADE DE PARCELAS', 'VALOR TOTAL', 'VALOR JUROS',
  'VALOR TARIFA', 'VALOR COMPRA', 'VALOR SAQUE',
  'VALOR DO IOF', 'CRÉDITO ROTATIVO', 'PAGUE SUA FATURA',
  'OFERTA VÁLIDA', 'SEM SEGURO', 'VALOR SOLICITADO',
  'PARA CONTRATAR', 'IMPORTANTE',
  'TETO DE JUROS', 'FIQUE ATENTO', 'NOVO TETO',
  'LIMITE MÁXIMO', 'DE RETIRADA', 'DE PAGAMENTO',
  'LIMITE DE CRÉDITO', 'LIMITE TOTAL',
  // === Dados pessoais ===
  'HELVECIO WANDERLEY', 'HELVECIO W PEREIRA',
  // === Avisos legais ===
  'CASO VOCÊ PAGUE', 'O PAGAMENTO OBRIGATÓRIO',
  'CONSULTE OUTRAS', 'PREVISÃO DO PRÓXIMO', 'PC -',
  'AO CONTRATAR ESSE', 'VALORES DEVIDOS',
  'JUROS DA COMPRA',
  // === Crediário ===
  'CREDIÁRIO',
];

const REGEX_CATEGORIA_LOCAL = /^[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇÜ]{3,}\s+\.[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇÜ\s]+$/i;

// === FUNÇÕES PRINCIPAIS ===

export async function parseCreditCardPdf(file: File): Promise<Expense[]> {
  if (typeof window === 'undefined') throw new Error('Não é possível processar PDF no servidor');

  try {
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = `${BASE_PATH}/pdf.worker.min.mjs`;

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    console.log(`[pdfUtils v2.3] PDF: ${pdf.numPages} páginas`);

    const todosItens: PdfTextItem[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      for (const item of textContent.items as any[]) {
        if (!item.str || item.str.trim() === '') continue;
        todosItens.push({
          text: item.str.trim(),
          x: Math.round(item.transform[4]),
          y: Math.round(item.transform[5]),
          page: i,
        });
      }
    }

    const linhas = agruparPorLinha(todosItens);
    const limites = determinarLimites(linhas);
    
    console.log(`[pdfUtils v2.3] Direita fim: ${limites.direitaFim ? `P${limites.direitaFim.page} Y${limites.direitaFim.y}` : '-'}`);
    console.log(`[pdfUtils v2.3] Página com total: ${limites.paginaComTotal}`);

    const despesas = extrairTodasDespesas(linhas, limites);
    const total = despesas.reduce((a, c) => a + c.value, 0);
    console.log(`[pdfUtils v2.3] ${despesas.length} despesas, R$ ${total.toFixed(2)}`);
    
    return despesas;
  } catch (error) {
    console.error('[pdfUtils v2.3] Erro:', error);
    throw new Error('Falha ao ler o PDF. Formato não suportado ou arquivo corrompido.');
  }
}

export async function extractPdfRawText(file: File): Promise<string> {
  if (typeof window === 'undefined') throw new Error('Não é possível processar PDF no servidor');
  try {
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = `${BASE_PATH}/pdf.worker.min.mjs`;
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const todosItens: PdfTextItem[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      for (const item of textContent.items as any[]) {
        if (!item.str || item.str.trim() === '') continue;
        todosItens.push({ text: item.str.trim(), x: Math.round(item.transform[4]), y: Math.round(item.transform[5]), page: i });
      }
    }
    return agruparPorLinha(todosItens).map(l => l.map(i => i.text).join(' ')).join('\n');
  } catch (error) {
    console.error('[pdfUtils v2.3] Erro:', error);
    throw new Error('Falha ao extrair texto do PDF.');
  }
}

// === FUNÇÕES AUXILIARES ===

function agruparPorLinha(itens: PdfTextItem[]): PdfTextItem[][] {
  const sorted = [...itens].sort((a, b) => a.page !== b.page ? a.page - b.page : b.y - a.y);
  const linhas: PdfTextItem[][] = [];
  let la: PdfTextItem[] = [];
  let yA = -999, pA = -1;
  for (const item of sorted) {
    if (item.page !== pA || Math.abs(item.y - yA) > 4) {
      if (la.length) linhas.push(la.sort((a, b) => a.x - b.x));
      la = [];
    }
    la.push(item);
    yA = item.y;
    pA = item.page;
  }
  if (la.length) linhas.push(la.sort((a, b) => a.x - b.x));
  return linhas;
}

/**
 * Determina limites:
 * 1. direitaFim: onde "Compras parceladas - próximas faturas" aparece na coluna DIREITA
 * 2. paginaComTotal: página onde "Total dos lançamentos atuais" aparece
 *    → coluna esquerda processa até o FIM dessa página (inclui todos os itens da pág)
 *    → páginas APÓS essa são ignoradas
 */
function determinarLimites(linhas: PdfTextItem[][]): LimitesExtracao {
  let direitaFim: { page: number; y: number } | null = null;
  let paginaComTotal = 999; // padrão: processar tudo
  
  for (const linha of linhas) {
    // Procurar "próximas faturas" na coluna DIREITA
    if (!direitaFim) {
      const itensDireita = linha.filter(it => it.x >= LIMITE_COLUNA_X);
      if (itensDireita.length > 0) {
        const textoDireita = itensDireita.map(it => it.text).join(' ').toUpperCase();
        if (MARCADORES_PROXIMAS_DIR.some(m => textoDireita.includes(m))) {
          direitaFim = { page: itensDireita[0].page, y: itensDireita[0].y };
        }
      }
    }
    
    // Procurar "Total dos lançamentos atuais" (marca a página-limite)
    if (paginaComTotal === 999) {
      const textoCompleto = linha.map(it => it.text).join(' ').toUpperCase();
      if (textoCompleto.includes('TOTAL DOS LANÇAMENTOS ATUAIS')) {
        paginaComTotal = linha[0].page;
      }
    }
    
    if (direitaFim && paginaComTotal !== 999) break;
  }
  
  return { direitaFim, paginaComTotal };
}

/**
 * Extrai despesas:
 * - Coluna ESQUERDA: processa todas as linhas até o final da paginaComTotal
 * - Coluna DIREITA: processa até direitaFim (marcador de próximas faturas)
 */
function extrairTodasDespesas(linhas: PdfTextItem[][], limites: LimitesExtracao): Expense[] {
  const despesas: Expense[] = [];
  let contador = 1;

  for (const linha of linhas) {
    const pagina = linha[0].page;
    
    // Pular páginas APÓS a página do total
    if (pagina > limites.paginaComTotal) continue;
    
    const esquerda = linha.filter(it => it.x < LIMITE_COLUNA_X);
    const direita = linha.filter(it => it.x >= LIMITE_COLUNA_X);

    // Coluna ESQUERDA: processar até o final da paginaComTotal
    const despEsq = tentarExtrairDespesa(esquerda, `E${contador}`);
    if (despEsq) {
      despesas.push(despEsq);
      contador++;
    }

    // Coluna DIREITA: processar apenas ANTES de "próximas faturas"
    if (direita.length > 0 && !direitaNaSecaoFutura(direita[0], limites.direitaFim)) {
      const despDir = tentarExtrairDespesa(direita, `D${contador}`);
      if (despDir) {
        despesas.push(despDir);
        contador++;
      }
    }
  }

  // Remover duplicatas: o Itaú lista alguns estornos em 2 páginas diferentes
  // Usa chave de data + descrição + valor para identificar duplicatas
  const unicos: Expense[] = [];
  const vistos = new Set<string>();
  
  for (const desp of despesas) {
    const chave = `${desp.date}|${desp.description}|${desp.value.toFixed(2)}`;
    if (!vistos.has(chave)) {
      vistos.add(chave);
      unicos.push(desp);
    }
  }

  return unicos;
}

function direitaNaSecaoFutura(item: PdfTextItem, limite: { page: number; y: number } | null): boolean {
  if (!limite) return false;
  if (item.page > limite.page) return true;
  if (item.page === limite.page && item.y <= limite.y) return true;
  return false;
}

function tentarExtrairDespesa(itens: PdfTextItem[], prefixoId: string): Expense | null {
  if (itens.length < 2) return null;

  const primeiro = itens[0];
  if (!REGEX_DATA.test(primeiro.text)) return null;

  const ultimo = itens[itens.length - 1];
  if (!REGEX_VALOR.test(ultimo.text)) return null;

  const valorStr = ultimo.text.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const valor = parseFloat(valorStr);
  if (isNaN(valor) || valor === 0) return null;

  const itensDoMeio = itens.slice(1, itens.length - 1);
  if (itensDoMeio.length === 0) return null;

  let parcela = 'À vista';
  let itensDesc = [...itensDoMeio];

  for (let i = itensDoMeio.length - 1; i >= 0; i--) {
    const item = itensDoMeio[i];
    if (REGEX_PARCELA_ISOLADA.test(item.text)) {
      const partes = item.text.split('/');
      const n1 = parseInt(partes[0]);
      const n2 = parseInt(partes[1]);
      if (n1 >= 1 && n1 <= n2 && n2 > 1 && n2 <= 99) {
        parcela = item.text;
        itensDesc = itensDoMeio.filter((_, idx) => idx !== i);
        break;
      }
    }
  }

  if (parcela === 'À vista' && itensDesc.length > 0) {
    const ultimoDesc = itensDesc[itensDesc.length - 1];
    const matchEmbutida = ultimoDesc.text.match(REGEX_PARCELA_EMBUTIDA);
    if (matchEmbutida) {
      const n1 = parseInt(matchEmbutida[1]);
      const n2 = parseInt(matchEmbutida[2]);
      if (n1 >= 1 && n1 <= n2 && n2 > 1 && n2 <= 99) {
        parcela = matchEmbutida[0];
        const textoLimpo = ultimoDesc.text.slice(0, -5).trim();
        if (textoLimpo.length > 0) {
          itensDesc[itensDesc.length - 1] = { ...ultimoDesc, text: textoLimpo };
        } else {
          itensDesc.pop();
        }
      }
    }
  }

  let descricao = itensDesc.map(it => it.text).join(' ').replace(/\s{2,}/g, ' ').trim();
  if (descricao.length < 2) return null;
  if (deveIgnorar(descricao)) return null;
  if (REGEX_CATEGORIA_LOCAL.test(descricao)) return null;
  if (descricao.length > 40) descricao = descricao.substring(0, 40);

  return {
    id: `${prefixoId}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    date: primeiro.text,
    description: descricao,
    installment: parcela,
    value: valor,
    category: null,
  };
}

function deveIgnorar(texto: string): boolean {
  const upper = texto.toUpperCase();
  return FILTROS_IGNORAR.some(filtro => upper.includes(filtro));
}
