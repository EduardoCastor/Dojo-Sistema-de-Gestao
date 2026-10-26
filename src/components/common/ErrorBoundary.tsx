import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Trash2 } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary capturou erro não tratado:', error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleResetCache = () => {
    try {
      // Limpa dados temporários que possam estar corrompidos
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('tatamehub_')) {
          toRemove.push(k);
        }
      }
      toRemove.forEach((k) => localStorage.removeItem(k));
    } catch (e) {
      console.warn('Erro ao limpar localStorage:', e);
    }
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
          <div className="max-w-xl w-full rounded-2xl border border-red-900/50 bg-slate-900/90 p-6 shadow-2xl backdrop-blur-sm">
            <div className="flex items-center gap-3 text-red-500 mb-4">
              <div className="p-2 rounded-xl bg-red-950/60 border border-red-800/40">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white tracking-tight">Ocorreu uma falha na renderização</h2>
                <p className="text-xs text-slate-400">Tatame Club detectou uma interrupção inesperada.</p>
              </div>
            </div>

            <div className="mb-4 p-3 rounded-lg bg-black/60 border border-slate-800 font-mono text-xs text-red-400 overflow-x-auto">
              <div className="font-bold">{this.state.error?.name || 'Erro'}: {this.state.error?.message}</div>
              {this.state.error?.stack && (
                <pre className="mt-2 text-[10px] text-slate-500 whitespace-pre-wrap max-h-40 overflow-y-auto">
                  {this.state.error.stack}
                </pre>
              )}
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-end gap-2 pt-2">
              <button
                onClick={this.handleResetCache}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-slate-700 bg-slate-800 text-xs text-slate-300 hover:text-white hover:bg-slate-700 transition-colors cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5 text-amber-400" />
                <span>Restaurar Padrões & Recarregar</span>
              </button>
              <button
                onClick={() => window.location.reload()}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-xs font-semibold text-white transition-colors cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Recarregar Página</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
