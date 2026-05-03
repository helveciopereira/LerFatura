/**
 * API Route: /api/analyze
 * 
 * Rota server-side que recebe despesas extraídas do PDF e usa o Gemini
 * para categorizá-las automaticamente entre H, A, E, T.
 * 
 * A API key do Gemini fica APENAS no servidor (variável de ambiente GEMINI_API_KEY)
 * e NUNCA é exposta ao navegador do usuário.
 * 
 * Versão: 1.0
 */

import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

/**
 * Interface da despesa recebida do frontend
 */
interface ExpenseInput {
  id: string;
  date: string;
  description: string;
  installment: string;
  value: number;
}

/**
 * Interface da categorização retornada pelo Gemini
 */
interface CategoryResult {
  id: string;
  category: 'H' | 'A' | 'E' | 'T';
  reasoning?: string;
}

export async function POST(request: NextRequest) {
  try {
    // Verificar se a chave da API está configurada
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY não configurada no servidor. Configure nas variáveis de ambiente do Vercel.' },
        { status: 500 }
      );
    }

    // Ler o corpo da requisição
    const body = await request.json();
    const { expenses, categories } = body as {
      expenses: ExpenseInput[];
      categories: Record<string, { nome: string; descricao: string }>;
    };

    if (!expenses || !Array.isArray(expenses) || expenses.length === 0) {
      return NextResponse.json(
        { error: 'Nenhuma despesa fornecida para análise.' },
        { status: 400 }
      );
    }

    // Inicializar o cliente Gemini
    const genai = new GoogleGenAI({ apiKey });

    // Montar a lista de despesas formatada para o prompt
    const listaFormatada = expenses.map(e =>
      `- ID: ${e.id} | Data: ${e.date} | Desc: ${e.description} | Parcela: ${e.installment} | Valor: R$ ${e.value.toFixed(2)}`
    ).join('\n');

    // Montar descrições das categorias
    const descCategorias = Object.entries(categories).map(
      ([key, info]) => `  ${key} = ${info.nome}: ${info.descricao}`
    ).join('\n');

    // Prompt otimizado para categorização
    const prompt = `Você é um assistente financeiro especializado em categorizar despesas de cartão de crédito.

## Categorias disponíveis:
${descCategorias}

## Despesas para categorizar:
${listaFormatada}

## Instruções:
1. Analise cada despesa pela descrição do estabelecimento
2. Atribua UMA categoria (H, A, E, T) para cada despesa
3. Retorne APENAS um JSON válido, sem markdown, no formato:
[
  {"id": "ID_DA_DESPESA", "category": "LETRA"},
  ...
]

IMPORTANTE: Retorne SOMENTE o JSON, sem texto antes ou depois. Não use \`\`\`json.`;

    // Chamar o Gemini
    const response = await genai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: prompt,
    });

    // Extrair o texto da resposta
    const responseText = response.text?.trim() || '';
    
    // Limpar possíveis wrappers markdown
    let jsonText = responseText;
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    // Parsear o JSON
    let categorizations: CategoryResult[];
    try {
      categorizations = JSON.parse(jsonText);
    } catch {
      console.error('[API analyze] JSON inválido do Gemini:', responseText);
      return NextResponse.json(
        { error: 'Resposta do Gemini não é um JSON válido. Tente novamente.' },
        { status: 502 }
      );
    }

    // Validar a estrutura
    if (!Array.isArray(categorizations)) {
      return NextResponse.json(
        { error: 'Formato de resposta inválido do Gemini.' },
        { status: 502 }
      );
    }

    // Filtrar apenas categorias válidas
    const validCategories = new Set(['H', 'A', 'E', 'T']);
    const resultados = categorizations
      .filter(c => c.id && validCategories.has(c.category))
      .map(c => ({ id: c.id, category: c.category }));

    return NextResponse.json({
      success: true,
      categorizations: resultados,
      total: resultados.length,
    });

  } catch (error: any) {
    console.error('[API analyze] Erro:', error);
    return NextResponse.json(
      { error: error.message || 'Erro interno ao processar com o Gemini.' },
      { status: 500 }
    );
  }
}
