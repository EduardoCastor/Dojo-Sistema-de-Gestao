import { useState, useRef, useCallback, useEffect } from 'react';
import {
  fetchAddressByCep,
  cleanCep,
  formatCep,
  isValidCep,
  CleanAddressData,
} from '../services/cepService';

export interface UseCepLookupOptions {
  onAddressFound?: (address: CleanAddressData) => void;
  onStartSearch?: () => void;
  onError?: (errorMessage: string) => void;
  autoClearFeedbackDelayMs?: number; // Padrão: 4000ms
}

export interface UseCepLookupReturn {
  isLoading: boolean;
  error: string | null;
  successMessage: string | null;
  lastSearchedCep: string;
  searchCep: (rawCep: string, force?: boolean) => Promise<CleanAddressData | null>;
  handleCepChange: (
    eOrValue: React.ChangeEvent<HTMLInputElement> | string,
    onValueChange?: (formattedCep: string) => void
  ) => string;
  handleCepBlur: (rawCep: string) => void;
  resetStatus: () => void;
}

export const useCepLookup = (options: UseCepLookupOptions = {}): UseCepLookupReturn => {
  const {
    onAddressFound,
    onStartSearch,
    onError,
    autoClearFeedbackDelayMs = 4000,
  } = options;

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [lastSearchedCep, setLastSearchedCep] = useState<string>('');

  const abortControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const successTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Limpa timeout ao desmontar
  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const resetStatus = useCallback(() => {
    setError(null);
    setSuccessMessage(null);
    if (successTimeoutRef.current) {
      clearTimeout(successTimeoutRef.current);
      successTimeoutRef.current = null;
    }
  }, []);

  const searchCep = useCallback(
    async (rawCep: string, force = false): Promise<CleanAddressData | null> => {
      const digits = cleanCep(rawCep);

      if (digits.length !== 8) {
        // Se incompleto, não pesquisa
        return null;
      }

      // Evita pesquisa redundante se for o mesmo CEP já pesquisado com sucesso
      if (!force && digits === lastSearchedCep && !error) {
        return null;
      }

      // Cancela requisição anterior se estiver em andamento
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      // Identificador sequencial para impedir que respostas fora de ordem sobrescrevam o estado
      const currentRequestId = ++requestIdRef.current;

      setIsLoading(true);
      setError(null);
      setSuccessMessage(null);
      onStartSearch?.();

      try {
        const result = await fetchAddressByCep(digits, controller.signal);

        // Se uma requisição mais recente já foi iniciada, descarta esta resposta
        if (currentRequestId !== requestIdRef.current) {
          return null;
        }

        setIsLoading(false);

        if (!result.success || !result.data) {
          const errMsg = result.error || 'CEP não localizado.';
          setError(errMsg);
          onError?.(errMsg);
          return null;
        }

        setLastSearchedCep(digits);
        setError(null);
        setSuccessMessage('Endereço localizado com sucesso');

        if (successTimeoutRef.current) {
          clearTimeout(successTimeoutRef.current);
        }
        successTimeoutRef.current = setTimeout(() => {
          setSuccessMessage(null);
        }, autoClearFeedbackDelayMs);

        onAddressFound?.(result.data);
        return result.data;
      } catch (err: any) {
        if (currentRequestId !== requestIdRef.current) {
          return null;
        }
        setIsLoading(false);
        const errMsg = 'Erro na busca do CEP. Preencha manualmente.';
        setError(errMsg);
        onError?.(errMsg);
        return null;
      }
    },
    [lastSearchedCep, error, onStartSearch, onError, onAddressFound, autoClearFeedbackDelayMs]
  );

  const handleCepChange = useCallback(
    (
      eOrValue: React.ChangeEvent<HTMLInputElement> | string,
      onValueChange?: (formattedCep: string) => void
    ): string => {
      const raw = typeof eOrValue === 'string' ? eOrValue : eOrValue.target.value;
      const formatted = formatCep(raw);

      if (onValueChange) {
        onValueChange(formatted);
      }

      const digits = cleanCep(formatted);
      if (digits.length < 8) {
        resetStatus();
      } else if (digits.length === 8 && digits !== lastSearchedCep) {
        // Dispara busca automática ao completar os 8 dígitos
        searchCep(digits);
      }

      return formatted;
    },
    [lastSearchedCep, resetStatus, searchCep]
  );

  const handleCepBlur = useCallback(
    (rawCep: string) => {
      const digits = cleanCep(rawCep);
      if (digits.length === 8 && digits !== lastSearchedCep) {
        searchCep(digits);
      }
    },
    [lastSearchedCep, searchCep]
  );

  return {
    isLoading,
    error,
    successMessage,
    lastSearchedCep,
    searchCep,
    handleCepChange,
    handleCepBlur,
    resetStatus,
  };
};
