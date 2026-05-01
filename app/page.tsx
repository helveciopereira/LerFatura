'use client';

/**
 * page.tsx - Página principal do LerFatura
 * Lê faturas de cartão de crédito (Itaú) em PDF e permite categorizar gastos
 * Versão: 1.0.0
 */

import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { FileUp, Terminal, Info, Trash2, BarChart3, Upload, Loader2, Sparkles, X } from 'lucide-react';
import { parseCreditCardPdf, extractPdfRawText, Expense, ExpenseCategory } from '@/lib/pdfUtils';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Combina classes Tailwind sem conflito
function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

// Chave para salvar no localStorage
const STORAGE_KEY = 'lerfatura_expenses_v1';

// Configuração das 4 categorias de gasto
const CATEGORIES: Record<NonNullable<ExpenseCategory>, {
  label: string; nome: string; colorClass: string;
  bgClass: string; textClass: string; borderClass: string;
}> = {
  H: { label: 'H', nome: 'Helvécio', colorClass: 'text-primary', bgClass: 'bg-primary', textClass: 'text-on-primary', borderClass: 'border-primary' },
  A: { label: 'A', nome: 'Alice', colorClass: 'text-secondary', bgClass: 'bg-secondary', textClass: 'text-surface-container', borderClass: 'border-secondary' },
  E: { label: 'E', nome: 'Empresa', colorClass: 'text-tertiary', bgClass: 'bg-tertiary', textClass: 'text-surface-container', borderClass: 'border-tertiary' },
  T: { label: 'T', nome: 'Terceiros', colorClass: 'text-quaternary', bgClass: 'bg-quaternary', textClass: 'text-surface-container', borderClass: 'border-quaternary' },
};

// Formatar valor em reais
const fmtBRL = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

export default function Home() {
  // === ESTADOS ===
  const [view, setView] = useState<'upload' | 'ledger' | 'summary'>('upload');
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingMsg, setProcessingMsg] = useState('');
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [showLegend, setShowLegend] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [useGemini, setUseGemini] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // === CARREGAR DO LOCALSTORAGE ===
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Expense[];
        if (parsed.length > 0) {
          setExpenses(parsed);
          setView('ledger');
        }
      }
    } catch { /* Ignora erros de parse */ }
  }, []);

  // === SALVAR NO LOCALSTORAGE quando despesas mudam ===
  useEffect(() => {
    if (expenses.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(expenses));
    }
  }, [expenses]);

  // === PROCESSAR PDF ===
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf') {
      setErrorMsg('Apenas arquivos PDF são suportados.');
      return;
    }

    setIsProcessing(true);
    setErrorMsg(null);
    let extractedExpenses: Expense[] = [];

    // Tentar Gemini primeiro (se habilitado)
    if (useGemini) {
      try {
        setProcessingMsg('Extraindo texto do PDF...');
        const rawText = await extractPdfRawText(file);

        setProcessingMsg('Processando com IA Gemini...');
        const res = await fetch('/api/parse-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pdfText: rawText }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.expenses?.length > 0) {
            extractedExpenses = data.expenses;
            console.log(`[Gemini] ${extractedExpenses.length} despesas extraídas`);
          }
        } else {
          const errData = await res.json().catch(() => ({}));
          console.warn('[Gemini] Falha:', errData.error || res.statusText);
        }
      } catch (err: any) {
        console.warn('[Gemini] Erro, usando fallback local:', err.message);
      }
    }

    // Fallback: parser local se Gemini falhou ou está desabilitado
    if (extractedExpenses.length === 0) {
      try {
        setProcessingMsg('Processando PDF localmente...');
        extractedExpenses = await parseCreditCardPdf(file);
      } catch (err: any) {
        setErrorMsg(err.message || 'Erro ao processar PDF.');
      }
    }

    if (extractedExpenses.length > 0) {
      setExpenses(extractedExpenses);
      setView('ledger');
    } else if (!errorMsg) {
      setErrorMsg('Nenhuma despesa encontrada. Verifique o formato do PDF.');
    }

    setIsProcessing(false);
    setProcessingMsg('');
    // Limpar input para permitir reenvio do mesmo arquivo
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [useGemini, errorMsg]);

  // === MUDAR CATEGORIA ===
  const handleCategoryChange = useCallback((id: string, category: ExpenseCategory) => {
    setExpenses(prev => prev.map(exp =>
      exp.id === id ? { ...exp, category: exp.category === category ? null : category } : exp
    ));
  }, []);

  // === LIMPAR DADOS ===
  const clearData = useCallback(() => {
    setExpenses([]);
    setView('upload');
    setErrorMsg(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  // === DADOS CALCULADOS PARA RESUMO ===
  const summaryData = useMemo(() => {
    const totals: Record<string, number> = { H: 0, A: 0, E: 0, T: 0, none: 0 };
    expenses.forEach(exp => { totals[exp.category || 'none'] += exp.value; });
    const totalSpent = expenses.reduce((a, c) => a + c.value, 0);
    const pct = (k: string) => totalSpent ? (totals[k] / totalSpent) * 100 : 0;
    return { totals, totalSpent, pct };
  }, [expenses]);

  // =========================================================
  // === RENDERIZAÇÃO ===
  // =========================================================
  return (
    <main className="flex flex-col min-h-screen max-w-7xl mx-auto">

      {/* ===== HEADER ===== */}
      <header className="fixed top-0 w-full max-w-7xl h-[var(--spacing-nav-height)] flex items-center px-[var(--spacing-edge-margin)] z-50 justify-between bg-surface/95 border-b border-outline-variant backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <Terminal className="w-5 h-5 text-primary" />
          <h1 className="font-nav-title text-primary uppercase tracking-widest text-sm font-bold">FATURA<span className="text-outline">_v1.0</span></h1>
        </div>

        {/* Botões de navegação */}
        {view !== 'upload' && (
          <div className="flex items-center gap-1">
            {/* Botão Enviar PDF */}
            <button onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 uppercase text-[11px] font-bold tracking-widest px-3 py-1.5 text-outline hover:text-primary hover:bg-primary/10 transition-all rounded">
              <Upload className="w-3.5 h-3.5" /> PDF
            </button>
            {/* Botão Ledger/Tabela */}
            <button onClick={() => setView('ledger')}
              className={cn("uppercase text-[11px] font-bold tracking-widest px-3 py-1.5 transition-all rounded",
                view === 'ledger' ? 'text-primary bg-primary/10' : 'text-outline hover:text-on-surface')}>
              Extrato
            </button>
            {/* Botão Resumo */}
            <button onClick={() => setView('summary')}
              className={cn("flex items-center gap-1.5 uppercase text-[11px] font-bold tracking-widest px-3 py-1.5 transition-all rounded",
                view === 'summary' ? 'text-primary bg-primary/10' : 'text-outline hover:text-on-surface')}>
              <BarChart3 className="w-3.5 h-3.5" /> Resumo
            </button>
          </div>
        )}

        {view !== 'upload' ? (
          <button onClick={clearData} className="p-2 text-outline hover:text-error hover:bg-error/10 transition-all rounded" title="Limpar Dados">
            <Trash2 className="w-4.5 h-4.5" />
          </button>
        ) : <div className="w-9" />}
      </header>

      {/* ===== CONTEÚDO PRINCIPAL ===== */}
      <div className="flex-1 mt-[var(--spacing-nav-height)] flex flex-col">

        {/* --- TELA DE UPLOAD --- */}
        {view === 'upload' && (
          <div className="flex-1 flex flex-col items-center justify-center p-[var(--spacing-edge-margin)] md:p-6 animate-fade-in">
            <div className="w-full max-w-xl mx-auto flex flex-col items-center gap-6">
              {/* Área de drop/clique */}
              <div className="w-full bg-surface-container border border-outline-variant p-10 md:p-16 flex flex-col items-center relative group cursor-pointer hover:border-primary/60 transition-all duration-300 rounded-lg"
                onClick={() => !isProcessing && fileInputRef.current?.click()}>
                <div className="absolute inset-3 md:inset-6 border-2 border-dashed border-primary/20 group-hover:border-primary/50 transition-colors duration-300 pointer-events-none rounded-lg" />
                <div className="relative z-10 flex flex-col items-center text-center gap-6">
                  <div className={cn("w-20 h-20 bg-surface border border-outline-variant flex items-center justify-center rounded-xl group-hover:bg-primary/10 transition-all duration-300",
                    isProcessing && "animate-pulse-subtle")}>
                    {isProcessing ? <Loader2 className="w-10 h-10 text-primary animate-spin-slow" /> : <FileUp className="w-10 h-10 text-primary" />}
                  </div>
                  <div className="space-y-3">
                    <h2 className="font-nav-title text-xl text-on-surface uppercase tracking-tight">
                      {isProcessing ? 'Processando...' : 'Enviar Fatura PDF'}
                    </h2>
                    <p className="font-data-mono text-xs text-outline uppercase tracking-widest">
                      {isProcessing ? processingMsg : 'Clique para selecionar sua fatura do Itaú'}
                    </p>
                  </div>
                  {errorMsg && (
                    <div className="mt-2 p-3 border border-error/50 bg-error/10 text-error font-body-main text-sm max-w-sm rounded-lg">
                      {errorMsg}
                    </div>
                  )}
                </div>
              </div>

              {/* Toggle Gemini */}
              <label className="flex items-center gap-3 cursor-pointer group">
                <div className={cn("w-10 h-5 rounded-full transition-colors relative",
                  useGemini ? 'bg-primary' : 'bg-outline-variant')}
                  onClick={() => setUseGemini(!useGemini)}>
                  <div className={cn("absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform shadow",
                    useGemini ? 'translate-x-5' : 'translate-x-0.5')} />
                </div>
                <span className="font-data-mono text-xs text-outline group-hover:text-on-surface-variant transition-colors flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" /> IA Gemini {useGemini ? 'ativada' : 'desativada'}
                </span>
              </label>
            </div>
            <input type="file" ref={fileInputRef} className="hidden" accept="application/pdf" onChange={handleFileUpload} />
          </div>
        )}

        {/* --- TELA DE EXTRATO (TABELA DE DESPESAS) --- */}
        {view === 'ledger' && (
          <div className="flex flex-col h-full animate-fade-in">
            {/* Sub-header com info */}
            <div className="flex items-center justify-between px-[var(--spacing-edge-margin)] h-[40px] border-b border-outline-variant bg-surface-container/50 shrink-0 z-10 sticky top-[var(--spacing-nav-height)]">
              <span className="font-data-mono text-[11px] text-outline uppercase tracking-widest">
                {expenses.length} despesas · {fmtBRL(summaryData.totalSpent)}
              </span>
              <button onClick={() => setShowLegend(true)} className="flex items-center gap-1.5 group cursor-pointer p-1">
                <span className="font-data-mono text-[10px] text-outline hidden md:inline-block opacity-0 group-hover:opacity-100 transition-opacity">
                  Legenda
                </span>
                <Info className="w-4 h-4 text-secondary opacity-60 group-hover:opacity-100 transition-opacity" />
              </button>
            </div>

            {/* Cabeçalho da tabela */}
            <div className="flex items-center px-[var(--spacing-edge-margin)] h-[32px] border-b border-outline-variant bg-surface-container-high/50 text-[10px] font-data-mono text-outline uppercase tracking-widest">
              <div className="w-[52px] shrink-0">Data</div>
              <div className="flex-1 min-w-0">Descrição</div>
              <div className="w-[55px] shrink-0 text-center hidden sm:block">Parcela</div>
              <div className="w-[80px] md:w-[95px] shrink-0 text-right">Valor</div>
              <div className="w-[130px] shrink-0 text-center ml-2">Quem</div>
            </div>

            {/* Lista de despesas */}
            <div className="flex-1 overflow-y-auto w-full">
              {expenses.map((expense, i) => (
                <div key={expense.id}
                  className={cn("expense-row min-h-[var(--spacing-row-height)] flex items-center px-[var(--spacing-edge-margin)] border-b border-outline-variant/60 py-1.5 gap-1",
                    i % 2 === 0 ? '' : 'bg-surface-container/30')}
                  style={{ animationDelay: `${Math.min(i * 15, 500)}ms` }}>

                  {/* Data */}
                  <div className="w-[52px] shrink-0 font-data-mono text-xs text-outline">{expense.date}</div>

                  {/* Descrição + Parcela (mobile) */}
                  <div className="flex-1 flex flex-col justify-center min-w-0 pr-1">
                    <span className="font-body-main text-sm text-on-surface truncate" title={expense.description}>
                      {expense.description}
                    </span>
                    <span className="font-data-mono text-[10px] text-outline uppercase tracking-wider sm:hidden">
                      {expense.installment}
                    </span>
                  </div>

                  {/* Parcela (desktop) */}
                  <div className="w-[55px] shrink-0 text-center font-data-mono text-[11px] text-outline hidden sm:block">
                    {expense.installment}
                  </div>

                  {/* Valor */}
                  <div className="text-right font-data-mono text-xs md:text-sm text-on-surface shrink-0 w-[80px] md:w-[95px]">
                    {fmtBRL(expense.value)}
                  </div>

                  {/* Botões de Categoria */}
                  <div className="flex gap-1 shrink-0 ml-2">
                    {(['H', 'A', 'E', 'T'] as NonNullable<ExpenseCategory>[]).map(cat => {
                      const sel = expense.category === cat;
                      const c = CATEGORIES[cat];
                      return (
                        <button key={cat}
                          onClick={() => handleCategoryChange(expense.id, cat)}
                          className={cn("category-btn w-7 h-7 rounded-full border flex items-center justify-center font-data-mono text-[11px] font-bold",
                            sel ? `${c.bgClass} ${c.textClass} ${c.borderClass} shadow-lg` : 'border-outline-variant text-outline hover:border-on-surface-variant hover:text-on-surface-variant bg-surface-container-high'
                          )} title={c.nome}>
                          {cat}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* --- TELA DE RESUMO --- */}
        {view === 'summary' && (
          <div className="flex flex-col p-[var(--spacing-edge-margin)] md:p-6 gap-6 overflow-y-auto w-full max-w-3xl mx-auto animate-fade-slide-up">
            {/* Card Total */}
            <section className="bg-surface-container border-l-4 border-l-primary border border-outline-variant p-6 flex flex-col justify-end min-h-[120px] relative overflow-hidden rounded-lg group hover:border-primary/40 transition-colors">
              <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity pointer-events-none">
                <Terminal className="w-28 h-28 text-primary" />
              </div>
              <h2 className="font-data-mono text-xs uppercase tracking-widest text-outline mb-1 z-10">Total da Fatura</h2>
              <div className="font-nav-title text-4xl tracking-tighter text-primary z-10">{fmtBRL(summaryData.totalSpent)}</div>
            </section>

            {/* Distribuição por Categoria */}
            <section>
              <h3 className="font-data-mono text-xs uppercase tracking-widest text-outline mb-4 border-b border-outline-variant pb-2">
                Distribuição por Pessoa
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {(Object.entries(CATEGORIES) as [NonNullable<ExpenseCategory>, typeof CATEGORIES['H']][]).map(([key, info]) => {
                  const sum = summaryData.totals[key] || 0;
                  const pct = summaryData.pct(key);
                  return (
                    <div key={key} className="bg-surface-container border border-outline-variant p-4 flex flex-col gap-3 hover:border-on-surface-variant/50 transition-colors rounded-lg">
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2.5">
                          <div className={cn("w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shadow", info.bgClass, info.textClass)}>{key}</div>
                          <span className="font-body-main text-sm text-on-surface">{info.nome}</span>
                        </div>
                        <span className={cn("font-data-mono text-xs", info.colorClass)}>{pct.toFixed(1)}%</span>
                      </div>
                      <div className="h-1.5 w-full bg-surface rounded-full overflow-hidden">
                        <div className={cn("h-full rounded-full animate-progress-grow", info.bgClass)} style={{ width: `${pct}%` }} />
                      </div>
                      <div className="font-data-mono text-sm text-on-surface text-right">{fmtBRL(sum)}</div>
                    </div>
                  );
                })}

                {/* Não categorizado */}
                {summaryData.totals.none > 0 && (
                  <div className="bg-surface-container border border-warning/30 p-4 flex flex-col gap-3 rounded-lg md:col-span-2">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full border border-warning text-warning flex items-center justify-center font-bold text-xs bg-warning/10">?</div>
                        <span className="font-body-main text-sm text-warning">Não Categorizado</span>
                      </div>
                      <span className="font-data-mono text-xs text-warning">{summaryData.pct('none').toFixed(1)}%</span>
                    </div>
                    <div className="h-1.5 w-full bg-surface rounded-full overflow-hidden">
                      <div className="h-full bg-warning rounded-full animate-progress-grow" style={{ width: `${summaryData.pct('none')}%` }} />
                    </div>
                    <div className="font-data-mono text-sm text-warning text-right">{fmtBRL(summaryData.totals.none)}</div>
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </div>

      {/* ===== MODAL DE LEGENDA ===== */}
      {showLegend && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in">
          <div className="absolute inset-0 bg-surface/80 modal-overlay" onClick={() => setShowLegend(false)} />
          <div className="relative z-10 bg-surface-container border border-outline-variant w-full max-w-md flex flex-col shadow-2xl rounded-xl overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-outline-variant">
              <h3 className="font-nav-title uppercase text-sm tracking-widest text-on-surface">Legenda de Categorias</h3>
              <button onClick={() => setShowLegend(false)} className="p-1.5 text-outline hover:text-on-surface hover:bg-surface-container-high rounded-lg transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 flex flex-col gap-4">
              {(Object.entries(CATEGORIES) as [string, typeof CATEGORIES['H']][]).map(([cat, info]) => (
                <div key={cat} className="flex items-center gap-4 border-b border-outline-variant/50 pb-4 last:border-0 last:pb-0">
                  <div className={cn("w-10 h-10 rounded-full flex items-center justify-center font-data-mono text-sm font-bold shadow-lg", info.bgClass, info.textClass)}>{cat}</div>
                  <div className="flex-1">
                    <div className="font-body-main text-sm text-on-surface">{info.nome}</div>
                    <div className="font-data-mono text-[10px] text-outline uppercase">Clique no círculo para atribuir</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-4 bg-surface-container-high border-t border-outline-variant">
              <button onClick={() => setShowLegend(false)} className="w-full py-2.5 bg-primary text-on-primary font-nav-title text-sm uppercase tracking-widest hover:bg-primary-hover transition-colors rounded-lg">
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Input file oculto (acessível quando já está na view ledger) */}
      {view !== 'upload' && (
        <input type="file" ref={fileInputRef} className="hidden" accept="application/pdf" onChange={handleFileUpload} />
      )}
    </main>
  );
}
