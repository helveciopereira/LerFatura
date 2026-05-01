/**
 * Rota API para processamento de faturas PDF usando Gemini AI
 * 
 * Esta rota recebe o texto bruto extraído do PDF e usa o Gemini
 * para interpretar e estruturar os dados de despesas de forma
 * inteligente, lidando com variações de formato que o parser
 * baseado em regex não consegue processar.
 * 
 * Versão: 1.0.0
 */

import { GoogleGenAI } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';

// Inicializar cliente Gemini com a chave da API
const apiKey = process.env.GEMINI_API_KEY;

/**
 * Prompt de sistema para instruir o Gemini sobre como extrair despesas
 * O Gemini recebe o texto bruto do PDF e deve retornar JSON estruturado
 */
const SYSTEM_PROMPT = `Você é um assistente especializado em extrair despesas de faturas de cartão de crédito do banco Itaú.

REGRAS IMPORTANTES:
1. Extraia APENAS as despesas/compras listadas na fatura
2. NÃO inclua: pagamentos efetuados, saldos, totais, anuidades, estornos, encargos, juros, IOF, taxas, limites de crédito, simulações
3. NÃO inclua linhas que começam com "Próxima fatura", "Demais faturas", "Total para próximas faturas"
4. NÃO inclua valores negativos (são estornos/créditos)
5. A fatura pode ter DUAS colunas: "Lançamentos atuais" (esquerda) e "Compras parceladas - próximas faturas" (direita). Extraia APENAS a coluna ESQUERDA (lançamentos atuais do mês)
6. Para parcelas, extraia o formato "XX/YY" onde XX é a parcela atual e YY é o total de parcelas
7. Se não houver indicação de parcela, considere "À vista"
8. Valores estão no formato brasileiro: 1.234,56

FORMATO DE SAÍDA (JSON):
Retorne APENAS um array JSON válido, sem markdown, sem \`\`\`, sem explicação:
[
  {
    "date": "DD/MM",
    "description": "NOME DO ESTABELECIMENTO",
    "installment": "XX/YY" ou "À vista",
    "value": 123.45
  }
]

ATENÇÃO: O valor deve ser um número decimal (ponto como separador). Exemplo: 1234.56 (não "1.234,56")`;

/**
 * Handler POST para processar o texto do PDF via Gemini
 * 
 * @param request - Requisição contendo { pdfText: string }
 * @returns Resposta com array de despesas ou erro
 */
export async function POST(request: NextRequest) {
  try {
    // Verificar se a chave da API está configurada
    if (!apiKey || apiKey === 'SUA_CHAVE_API_AQUI') {
      return NextResponse.json(
        { error: 'Chave da API Gemini não configurada. Configure GEMINI_API_KEY no .env.local' },
        { status: 500 }
      );
    }

    // Extrair texto do corpo da requisição
    const body = await request.json();
    const { pdfText } = body;

    if (!pdfText || typeof pdfText !== 'string') {
      return NextResponse.json(
        { error: 'Texto do PDF não fornecido ou inválido' },
        { status: 400 }
      );
    }

    // Inicializar o Gemini
    const genai = new GoogleGenAI({ apiKey });

    // Enviar para o Gemini processar
    const response = await genai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { text: SYSTEM_PROMPT },
            { text: `\nTexto da fatura:\n\n${pdfText}` },
          ],
        },
      ],
      config: {
        temperature: 0.1,  // Baixa temperatura para resultados mais consistentes
        maxOutputTokens: 8192,
      },
    });

    // Extrair o texto da resposta
    const responseText = response.text?.trim() || '';
    
    console.log('[Gemini API] Resposta recebida, tamanho:', responseText.length);

    // Tentar fazer parse do JSON retornado
    // O Gemini pode retornar o JSON envolto em ```json ... ```
    let jsonText = responseText;
    
    // Remover markdown code blocks se presentes
    const jsonMatch = responseText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1];
    }

    // Fazer parse do JSON
    const despesas = JSON.parse(jsonText);
    
    if (!Array.isArray(despesas)) {
      throw new Error('Resposta do Gemini não é um array válido');
    }

    // Validar e normalizar cada despesa
    const despesasValidas = despesas
      .filter((d: any) => 
        d.date && d.description && typeof d.value === 'number' && d.value > 0
      )
      .map((d: any, index: number) => ({
        id: `gem_${index + 1}_${Date.now()}`,
        date: d.date,
        description: String(d.description).substring(0, 45),
        installment: d.installment || 'À vista',
        value: Number(d.value),
        category: null,
      }));

    console.log(`[Gemini API] ${despesasValidas.length} despesas extraídas com sucesso`);

    return NextResponse.json({ expenses: despesasValidas });

  } catch (error: any) {
    console.error('[Gemini API] Erro:', error);
    
    // Retornar erro específico para facilitar debug
    const mensagem = error.message?.includes('JSON') 
      ? 'Erro ao interpretar resposta do Gemini. Tente novamente.'
      : error.message || 'Erro interno ao processar com IA';
    
    return NextResponse.json(
      { error: mensagem },
      { status: 500 }
    );
  }
}
