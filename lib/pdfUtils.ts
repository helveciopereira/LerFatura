/**
 * pdfUtils.ts - Utilitários para leitura e extração de dados de faturas PDF
 * 
 * Parser especializado para faturas de cartão Itaú com suporte a:
 * - Layout de duas colunas lado a lado (ambas com lançamentos atuais)
 * - Detecção de seção "Compras parceladas - próximas faturas" (excluída)
 * - Detecção inteligente de parcelas (isoladas ou embutidas na descrição)
 * - Filtragem robusta de cabeçalhos, rodapés, categorias e avisos legais
 * - Extração de texto bruto para processamento via IA Gemini
 * 
 * Versão: 1.1
 */

// === TIPOS E INTERFACES ===

/** Categorias possíveis para cada gasto */
export type ExpenseCategory = 'H' | 'A' | 'E' | 'T' | null;

/** Estrutura de uma despesa extraída da fatura */
export interface Expense {
  id: string;
  date: string;        // DD/MM
  description: string; // Nome do estabelecimento
  installment: string; // "03/10" ou "À vista"
  value: number;       // Valor em reais (sempre positivo)
  category: ExpenseCategory;
}

/** Item de texto extraído do PDF com posição e página */
interface PdfTextItem {
  text: string;
  x: number;    // Posição horizontal (coluna)
  y: number;    // Posição vertical (linha, maior = mais acima)
  page: number; // Número da página
}

// === CONSTANTES ===

/**
 * Limite de X para separar coluna esquerda e direita.
 * Itens com x < 350 são coluna esquerda, x >= 350 são coluna direita.
 * Este valor funciona consistentemente em todas as páginas do PDF Itaú.
 */
const LIMITE_COLUNA_X = 350;

/** Regex para data no formato DD/MM */
const REGEX_DATA = /^\d{2}\/\d{2}$/;

/** Regex para valor monetário brasileiro (ex: 1.234,56 ou -1.234,56 ou - 0,06) */
const REGEX_VALOR = /^-?\s*\d{1,3}(?:\.\d{3})*,\d{2}$/;

/** Regex para parcela isolada no formato NN/NN */
const REGEX_PARCELA_ISOLADA = /^\d{2}\/\d{2}$/;

/** Regex para parcela embutida no final (ex: "AMAZONMKTPLC*BIOTE02/08") */
const REGEX_PARCELA_EMBUTIDA = /(\d{2})\/(\d{2})$/;

/**
 * Marcadores de seção que indicam o INÍCIO de "próximas faturas"
 * Tudo que vier DEPOIS destes marcadores na coluna direita é excluído
 */
const MARCADORES_PROXIMAS_FATURAS = [
  'COMPRAS PARCELADAS - PRÓXIMAS FATURAS',
  'COMPRAS PARCELADAS',
  'PRÓXIMAS FATURAS',
  'TOTAL PARA PRÓXIMAS FATURAS',
];

/**
 * Palavras que indicam linhas de NÃO-despesa (cabeçalhos, totais, etc.)
 */
const FILTROS_IGNORAR = [
  'PAGAMENTO EFETUADO', 'SALDO ANTERIOR', 'TOTAL DOS',
  'TOTAL DA FATURA', 'TOTAL PARA', 'TOTAL DE LANÇAMENTOS',
  'TOTAL DOS PAGAMENTOS', 'TOTAL DOS LANÇAMENTOS',
  'LANÇAMENTOS PRODUTOS', 'LANÇAMENTOS: COMPRAS', 'LANÇAMENTOS NO CARTÃO',
  'LANÇAMENTOS: PRODUTOS',
  'CONTINUA', 'PRÓXIMA FATURA', 'DEMAIS FATURAS',
  'TITULAR', 'ADICIONAL', 'LIMITE',
  'DATA', 'PRODUTOS/SERVIÇOS', 'VALOR EM R$', 'ESTABELECIMENTO',
  'ENCARGOS', 'JUROS', 'IOF', 'MULTA', 'CET',
  'SIMULAÇÃO', 'PARCELAMENTO',
  'COBRADA OU SERÁ', 'VÁLIDO POR', 'CONTRATAÇÃO',
  'RENDA MÍNIMA', 'COMPROMETE', 'VALOR DA PARCELA',
  'QUANTIDADE DE PARCELAS', 'VALOR TOTAL', 'VALOR JUROS',
  'VALOR TARIFA', 'VALOR COMPRA', 'VALOR SAQUE',
  'VALOR DO IOF', 'CRÉDITO ROTATIVO', 'PAGUE SUA FATURA',
  'OFERTA VÁLIDA', 'SEM SEGURO', 'VALOR SOLICITADO',
  'TOTAL A PAGAR', 'PARA CONTRATAR', 'IMPORTANTE',
  'TETO DE JUROS', 'FIQUE ATENTO', 'NOVO TETO',
  'LIMITE MÁXIMO', 'DE RETIRADA', 'DE PAGAMENTO',
  'HELVECIO WANDERLEY', 'HELVECIO W PEREIRA',
  'CASO VOCÊ PAGUE', 'O PAGAMENTO OBRIGATÓRIO',
  'PAGAMENTO DO VALOR', 'CONSULTE OUTRAS',
  'PREVISÃO DO PRÓXIMO', 'PC -',
];

/**
 * Regex para categorias de local/estabelecimento
 * Ex: "ALIMENTAÇÃO .SAO LUIS", "MORADIA .SAO LUIS", "DIVERSOS .SAO PAULO"
 * 
 * Exige ESPAÇO antes do ponto para não filtrar nomes como:
 * - "APPLE.COM/BILL" (sem espaço antes do ponto)
 * - "SITE HAVAN.COM" (sem espaço antes do ponto)
 */
const REGEX_CATEGORIA_LOCAL = /^[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇÜ]{3,}\s+\.[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇÜ\s]+$/i;

// === FUNÇÃO PRINCIPAL ===

/**
 * Carrega um arquivo PDF de fatura Itaú e extrai todas as despesas
 * dos "lançamentos atuais" (excluindo "próximas faturas")
 * 
 * @param file - Arquivo PDF selecionado pelo usuário
 * @returns Array de despesas extraídas
 */
export async function parseCreditCardPdf(file: File): Promise<Expense[]> {
  if (typeof window === 'undefined') {
    throw new Error('Não é possível processar PDF no servidor');
  }

  try {
    // Importar pdfjs-dist dinamicamente (necessário para Next.js)
    const pdfjsLib = await import('pdfjs-dist');
    
    // Configurar o worker do PDF.js usando arquivo local (evita problemas de CDN)
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    
    console.log(`[pdfUtils] PDF carregado: ${pdf.numPages} páginas`);

    // Extrair todos os itens de texto com coordenadas
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

    // Agrupar itens por linha (mesma coordenada Y dentro de tolerância)
    const linhas = agruparPorLinha(todosItens);
    
    // Encontrar onde começa a seção "próximas faturas" na coluna direita
    const limiteProxFaturas = encontrarLimiteProximasFaturas(linhas);
    
    console.log(`[pdfUtils] Limite próximas faturas: ` +
      (limiteProxFaturas 
        ? `página ${limiteProxFaturas.page}, Y=${limiteProxFaturas.y}` 
        : 'não encontrado'));

    // Extrair despesas das duas colunas
    const despesas = extrairTodasDespesas(linhas, limiteProxFaturas);
    
    console.log(`[pdfUtils] Total: ${despesas.length} despesas extraídas`);
    
    return despesas;

  } catch (error) {
    console.error('[pdfUtils] Erro ao processar PDF:', error);
    throw new Error('Falha ao ler o PDF. Formato não suportado ou arquivo corrompido.');
  }
}

/**
 * Extrai o texto bruto do PDF como string para enviar ao Gemini
 */
export async function extractPdfRawText(file: File): Promise<string> {
  if (typeof window === 'undefined') {
    throw new Error('Não é possível processar PDF no servidor');
  }

  try {
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    
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
    return linhas.map(l => l.map(i => i.text).join(' ')).join('\n');

  } catch (error) {
    console.error('[pdfUtils] Erro ao extrair texto bruto:', error);
    throw new Error('Falha ao extrair texto do PDF.');
  }
}

// === FUNÇÕES AUXILIARES ===

/**
 * Agrupa itens de texto por coordenada Y (mesma linha visual no PDF)
 * Itens com Y dentro de ±4px são considerados da mesma linha.
 * Retorna array de linhas, cada uma com itens ordenados por X.
 */
function agruparPorLinha(itens: PdfTextItem[]): PdfTextItem[][] {
  // Ordenar por página e depois Y descendente (topo → base)
  const sorted = [...itens].sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    return b.y - a.y;
  });

  const linhas: PdfTextItem[][] = [];
  let linhaAtual: PdfTextItem[] = [];
  let yAtual = -999;
  let pageAtual = -1;

  for (const item of sorted) {
    // Nova linha se mudou de página OU diferença de Y > 4px
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

  return linhas;
}

/**
 * Encontra a posição (página + Y) onde começa a seção
 * "Compras parceladas - próximas faturas" na coluna direita.
 * Tudo DEPOIS deste ponto na coluna direita deve ser excluído.
 */
function encontrarLimiteProximasFaturas(
  linhas: PdfTextItem[][]
): { page: number; y: number } | null {
  for (const linha of linhas) {
    // Verificar apenas itens da coluna direita
    const itensDireita = linha.filter(it => it.x >= LIMITE_COLUNA_X);
    if (itensDireita.length === 0) continue;
    
    const textoCombinado = itensDireita.map(it => it.text).join(' ').toUpperCase();
    
    // Verificar se contém algum marcador de "próximas faturas"
    if (MARCADORES_PROXIMAS_FATURAS.some(m => textoCombinado.includes(m))) {
      return { page: itensDireita[0].page, y: itensDireita[0].y };
    }
  }
  
  return null;
}

/**
 * Verifica se um item da coluna direita está DEPOIS do limite
 * de "próximas faturas" (ou seja, deve ser excluído)
 */
function estaNaSecaoFutura(
  item: PdfTextItem, 
  limite: { page: number; y: number } | null
): boolean {
  if (!limite) return false; // Sem limite = inclui tudo
  
  // Após o limite se: mesma página com Y menor, ou página posterior
  if (item.page > limite.page) return true;
  if (item.page === limite.page && item.y <= limite.y) return true;
  
  return false;
}

/**
 * Extrai despesas de AMBAS as colunas, excluindo a seção "próximas faturas"
 */
function extrairTodasDespesas(
  linhas: PdfTextItem[][],
  limiteProxFaturas: { page: number; y: number } | null
): Expense[] {
  const despesas: Expense[] = [];
  let contador = 1;

  for (const linha of linhas) {
    // Separar itens em coluna esquerda e direita
    const esquerda = linha.filter(it => it.x < LIMITE_COLUNA_X);
    const direita = linha.filter(it => it.x >= LIMITE_COLUNA_X);

    // Processar coluna ESQUERDA (sempre lançamentos atuais)
    const despEsq = tentarExtrairDespesa(esquerda, `E${contador}`);
    if (despEsq) {
      despesas.push(despEsq);
      contador++;
    }

    // Processar coluna DIREITA (somente se ANTES de "próximas faturas")
    if (direita.length > 0) {
      // Verificar se o primeiro item da direita está na seção futura
      if (!estaNaSecaoFutura(direita[0], limiteProxFaturas)) {
        const despDir = tentarExtrairDespesa(direita, `D${contador}`);
        if (despDir) {
          despesas.push(despDir);
          contador++;
        }
      }
    }
  }

  return despesas;
}

/**
 * Tenta extrair uma despesa de um conjunto de itens de uma coluna.
 * 
 * Estrutura esperada na fatura Itaú:
 * [DATA] [DESCRIÇÃO...] [PARCELA?] [VALOR]
 * 
 * - DATA: Primeiro item, formato DD/MM
 * - VALOR: Último item, formato numérico brasileiro
 * - PARCELA: Pode ser um item isolado (NN/NN) ou embutido no final da descrição
 * - DESCRIÇÃO: Tudo entre a data e o valor (excluindo parcela se isolada)
 */
function tentarExtrairDespesa(
  itens: PdfTextItem[],
  prefixoId: string
): Expense | null {
  if (itens.length < 2) return null;

  // 1. Primeiro item deve ser uma DATA (DD/MM)
  const primeiro = itens[0];
  if (!REGEX_DATA.test(primeiro.text)) return null;

  // 2. Último item deve ser um VALOR
  const ultimo = itens[itens.length - 1];
  if (!REGEX_VALOR.test(ultimo.text)) return null;

  // 3. Converter e validar valor
  //    Valores negativos são estornos/créditos e devem ser incluídos
  //    pois reduzem o total da fatura
  const valorStr = ultimo.text.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const valor = parseFloat(valorStr);
  if (isNaN(valor) || valor === 0) return null;

  // 4. Itens do meio = descrição + possível parcela
  const itensDoMeio = itens.slice(1, itens.length - 1);
  if (itensDoMeio.length === 0) return null;

  // 5. Montar descrição e detectar parcela
  let parcela = 'À vista';
  let itensDesc = [...itensDoMeio];

  // Verificar se algum item do meio é uma parcela isolada (NN/NN)
  // Geralmente é o penúltimo ou último item do meio
  for (let i = itensDoMeio.length - 1; i >= 0; i--) {
    const item = itensDoMeio[i];
    if (REGEX_PARCELA_ISOLADA.test(item.text)) {
      const partes = item.text.split('/');
      const n1 = parseInt(partes[0]);
      const n2 = parseInt(partes[1]);
      
      // Validar: parcela atual <= total, e total > 1
      if (n1 >= 1 && n1 <= n2 && n2 > 1 && n2 <= 99) {
        parcela = item.text;
        itensDesc = itensDoMeio.filter((_, idx) => idx !== i);
        break;
      }
    }
  }

  // Se não encontrou parcela isolada, verificar se está embutida no último item
  if (parcela === 'À vista' && itensDesc.length > 0) {
    const ultimoDesc = itensDesc[itensDesc.length - 1];
    const matchEmbutida = ultimoDesc.text.match(REGEX_PARCELA_EMBUTIDA);
    
    if (matchEmbutida) {
      const n1 = parseInt(matchEmbutida[1]);
      const n2 = parseInt(matchEmbutida[2]);
      
      if (n1 >= 1 && n1 <= n2 && n2 > 1 && n2 <= 99) {
        parcela = matchEmbutida[0];
        // Remover parcela do texto
        const textoLimpo = ultimoDesc.text.slice(0, -5).trim();
        if (textoLimpo.length > 0) {
          itensDesc[itensDesc.length - 1] = { ...ultimoDesc, text: textoLimpo };
        } else {
          itensDesc.pop();
        }
      }
    }
  }

  // 6. Montar descrição final
  let descricao = itensDesc.map(it => it.text).join(' ').replace(/\s{2,}/g, ' ').trim();
  
  // Validação: descrição deve ter conteúdo significativo
  if (descricao.length < 2) return null;

  // 7. Filtrar linhas que não são despesas reais
  if (deveIgnorar(descricao)) return null;
  if (REGEX_CATEGORIA_LOCAL.test(descricao)) return null;

  // 8. Limitar tamanho da descrição para a tabela
  if (descricao.length > 40) {
    descricao = descricao.substring(0, 40);
  }

  return {
    id: `${prefixoId}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    date: primeiro.text,
    description: descricao,
    installment: parcela,
    value: valor,
    category: null,
  };
}

/**
 * Verifica se uma descrição deve ser ignorada (não é uma despesa real)
 */
function deveIgnorar(texto: string): boolean {
  const upper = texto.toUpperCase();
  return FILTROS_IGNORAR.some(filtro => upper.includes(filtro));
}
