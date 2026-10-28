import React from 'react';
import { Loader2, MapPin, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { useCepLookup } from '../../hooks/useCepLookup';
import { CleanAddressData, formatCep } from '../../services/cepService';

export interface CepInputProps {
  value: string;
  onChange: (value: string) => void;
  onAddressFound?: (address: CleanAddressData) => void;
  onAddressResolved?: (address: CleanAddressData) => void;
  label?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  id?: string;
  nextInputRef?: React.RefObject<HTMLInputElement | null>;
  showHelperStatus?: boolean;
  compact?: boolean;
}

export const CepInput: React.FC<CepInputProps> = ({
  value,
  onChange,
  onAddressFound,
  onAddressResolved,
  label = 'CEP',
  placeholder = '00000-000',
  required = false,
  disabled = false,
  className = '',
  inputClassName = '',
  id,
  nextInputRef,
  showHelperStatus = true,
  compact = false,
}) => {
  const {
    isLoading,
    error,
    successMessage,
    handleCepChange,
    handleCepBlur,
    searchCep,
    resetStatus,
  } = useCepLookup({
    onAddressFound: (address) => {
      onAddressFound?.(address);
      onAddressResolved?.(address);
      if (nextInputRef?.current) {
        setTimeout(() => {
          nextInputRef.current?.focus();
        }, 100);
      }
    },
  });

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleCepChange(e, onChange);
  };

  const onInputBlur = () => {
    handleCepBlur(value);
  };

  const handleRetry = () => {
    resetStatus();
    searchCep(value, true);
  };

  return (
    <div className={`space-y-1 ${className}`}>
      {label && (
        <label
          htmlFor={id}
          className={`block text-slate-300 font-medium ${compact ? 'text-[11px]' : 'text-xs'}`}
        >
          {label} {required && <span className="text-red-400">*</span>}
        </label>
      )}

      <div className="relative">
        <input
          id={id}
          type="text"
          value={formatCep(value)}
          onChange={onInputChange}
          onBlur={onInputBlur}
          placeholder={placeholder}
          disabled={disabled || isLoading}
          maxLength={9}
          className={`w-full rounded-lg border border-slate-700 bg-slate-800 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none font-mono ${
            compact ? 'px-2.5 py-1.5 text-xs pr-8' : 'px-3 py-2 text-xs pr-9'
          } ${disabled ? 'opacity-60 cursor-not-allowed' : ''} ${
            error ? 'border-amber-500/70' : successMessage ? 'border-emerald-500/70' : ''
          } ${inputClassName}`}
        />

        <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none">
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-red-400" />
          ) : successMessage ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          ) : error ? (
            <AlertCircle className="h-4 w-4 text-amber-400" />
          ) : (
            <MapPin className="h-3.5 w-3.5 text-slate-500" />
          )}
        </div>
      </div>

      {showHelperStatus && (
        <div className="min-h-[16px] text-[11px] leading-tight">
          {isLoading && (
            <span className="text-slate-400 flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin text-red-400" />
              <span>Buscando endereço...</span>
            </span>
          )}

          {!isLoading && successMessage && (
            <span className="text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" />
              <span>{successMessage}</span>
            </span>
          )}

          {!isLoading && error && (
            <div className="text-amber-400/90 flex items-center justify-between gap-1 flex-wrap">
              <span className="flex items-center gap-1">
                <AlertCircle className="h-3 w-3 shrink-0" />
                <span>{error}</span>
              </span>
              <button
                type="button"
                onClick={handleRetry}
                className="text-slate-300 hover:text-white underline cursor-pointer inline-flex items-center gap-0.5 ml-1 font-sans"
              >
                <RefreshCw className="h-2.5 w-2.5" />
                <span>Tentar de novo</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
