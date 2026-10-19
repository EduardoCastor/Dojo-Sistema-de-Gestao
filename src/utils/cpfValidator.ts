/**
 * Utilitário profissional de validação e formatação de CPF (Cadastro de Pessoas Físicas)
 * Alinhado às regras oficiais da Receita Federal do Brasil (cálculo de módulo 11).
 */

/**
 * Remove todos os caracteres não numéricos de uma string de CPF.
 */
export function cleanCPF(cpf?: string | null): string {
  if (!cpf) return '';
  return String(cpf).replace(/\D/g, '');
}

export interface CPFValidationResult {
  isValid: boolean;
  error?: string;
  cleanCpf: string;
  formattedCpf?: string;
}

/**
 * Valida rigorosamente se um CPF é matematicamente válido.
 * 
 * Regras:
 * 1. Deve conter exatamente 11 dígitos numéricos após limpeza.
 * 2. Não pode ser formado por uma sequência de dígitos idênticos (ex: 00000000000, 11111111111).
 * 3. Primeiro dígito verificador deve coincidir com o cálculo do módulo 11 dos 9 primeiros dígitos.
 * 4. Segundo dígito verificador deve coincidir com o cálculo do módulo 11 dos 10 primeiros dígitos.
 */
export function validateCPF(cpfInput?: string | null): CPFValidationResult {
  const clean = cleanCPF(cpfInput);

  if (!clean) {
    return {
      isValid: false,
      error: 'O CPF é obrigatório.',
      cleanCpf: '',
    };
  }

  if (clean.length !== 11) {
    return {
      isValid: false,
      error: `O CPF deve conter exatamente 11 dígitos numéricos (informados: ${clean.length}).`,
      cleanCpf: clean,
    };
  }

  // Rejeita sequências de dígitos idênticos (000.000.000-00, 111.111.111-11, etc.)
  if (/^(\d)\1{10}$/.test(clean)) {
    return {
      isValid: false,
      error: 'CPF inválido: sequência com todos os dígitos repetidos não é permitida.',
      cleanCpf: clean,
    };
  }

  // 1º Dígito Verificador (pesos de 10 a 2)
  let sum1 = 0;
  for (let i = 0; i < 9; i++) {
    sum1 += parseInt(clean.charAt(i), 10) * (10 - i);
  }
  let rest1 = (sum1 * 10) % 11;
  if (rest1 === 10 || rest1 === 11) rest1 = 0;

  if (rest1 !== parseInt(clean.charAt(9), 10)) {
    return {
      isValid: false,
      error: 'CPF inválido: os dígitos verificadores informados estão incorretos.',
      cleanCpf: clean,
    };
  }

  // 2º Dígito Verificador (pesos de 11 a 2)
  let sum2 = 0;
  for (let i = 0; i < 10; i++) {
    sum2 += parseInt(clean.charAt(i), 10) * (11 - i);
  }
  let rest2 = (sum2 * 10) % 11;
  if (rest2 === 10 || rest2 === 11) rest2 = 0;

  if (rest2 !== parseInt(clean.charAt(10), 10)) {
    return {
      isValid: false,
      error: 'CPF inválido: os dígitos verificadores informados estão incorretos.',
      cleanCpf: clean,
    };
  }

  return {
    isValid: true,
    cleanCpf: clean,
    formattedCpf: formatCPF(clean),
  };
}

/**
 * Formata um CPF para o padrão 000.000.000-00.
 */
export function formatCPF(cpf?: string | null): string {
  if (!cpf) return '-';
  const clean = cleanCPF(cpf);
  if (clean.length !== 11) return cpf;
  return clean.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

/**
 * Aplica máscara progressiva de CPF enquanto o usuário digita.
 */
export function maskCPFInput(value: string): string {
  const clean = cleanCPF(value).slice(0, 11);
  if (clean.length <= 3) return clean;
  if (clean.length <= 6) return clean.replace(/(\d{3})(\d{1,3})/, '$1.$2');
  if (clean.length <= 9) return clean.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
  return clean.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
}

export { formatPhoneBR, formatDateBR } from './formatters';

