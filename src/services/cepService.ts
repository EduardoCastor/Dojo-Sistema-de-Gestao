/**
 * Serviço de Consulta de CEP brasileiro via ViaCEP (https://viacep.com.br/)
 * 
 * Funcionalidades:
 * - Sanitização e validação estrita de CEP (exatamente 8 dígitos numéricos)
 * - Formatação visual '00000-000'
 * - Cache em memória na sessão para evitar requisições de rede duplicadas
 * - Tratamento defensivo de erros (offline, timeout, CEP não encontrado com HTTP 200 { erro: true })
 * - Suporte a cancelamento de requisição via AbortSignal para controle de race conditions
 */

export interface ViaCepRawResponse {
  cep?: string;
  logradouro?: string;
  complemento?: string;
  unidade?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  estado?: string;
  regiao?: string;
  ibge?: string;
  gia?: string;
  ddd?: string;
  siafi?: string;
  erro?: boolean | string;
}

export interface CleanAddressData {
  cep: string;          // Formatado: '01001-000'
  rawCep: string;       // Apenas dígitos: '01001000'
  street: string;       // Logradouro (rua, avenida, etc.)
  logradouro: string;   // Alias PT-BR
  complement?: string;  // Complemento (ex: lado ímpar)
  neighborhood: string; // Bairro
  bairro: string;       // Alias PT-BR
  city: string;         // Localidade / Município
  localidade: string;   // Alias PT-BR
  state: string;        // UF (ex: 'SP')
  uf: string;           // Alias PT-BR
  stateName?: string;   // Nome por extenso (ex: 'São Paulo')
  ibgeCode?: string;    // Código IBGE do município
}

export interface CepLookupResult {
  success: boolean;
  data?: CleanAddressData;
  error?: string;
  cached?: boolean;
  isAborted?: boolean;
}

// Cache em memória para a sessão da aplicação
const cepCache = new Map<string, CleanAddressData>();

/**
 * Remove qualquer caractere não numérico do CEP.
 */
export const cleanCep = (value: string | undefined | null): string => {
  if (!value) return '';
  return value.replace(/\D/g, '');
};

/**
 * Formata um CEP no padrão brasileiro '00000-000'.
 */
export const formatCep = (value: string | undefined | null): string => {
  const digits = cleanCep(value).slice(0, 8);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5, 8)}`;
};

/**
 * Valida se a string possui exatamente 8 dígitos numéricos válidos.
 */
export const isValidCep = (value: string | undefined | null): boolean => {
  const digits = cleanCep(value);
  return digits.length === 8 && !/^(\d)\1{7}$/.test(digits); // descarta números repetidos como 00000000
};

/**
 * Consulta os dados de endereço pelo CEP utilizando o ViaCEP.
 * 
 * @param rawCep CEP informado pelo usuário (com ou sem hífen)
 * @param signal AbortSignal opcional para cancelar requisições anteriores
 */
export const fetchAddressByCep = async (
  rawCep: string,
  signal?: AbortSignal
): Promise<CepLookupResult> => {
  const digits = cleanCep(rawCep);

  if (digits.length !== 8) {
    return {
      success: false,
      error: 'CEP incompleto. Digite os 8 dígitos numéricos.',
    };
  }

  // Verifica cache em memória
  if (cepCache.has(digits)) {
    return {
      success: true,
      data: cepCache.get(digits)!,
      cached: true,
    };
  }

  try {
    const url = `https://viacep.com.br/ws/${digits}/json/`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal,
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Serviço de CEP temporariamente indisponível (HTTP ${response.status}). Preencha manualmente.`,
      };
    }

    const json: ViaCepRawResponse = await response.json();

    // ViaCEP retorna HTTP 200 com { erro: true } ou { erro: "true" } quando o CEP não é localizado
    if (json.erro === true || json.erro === 'true' || json.erro === '1') {
      return {
        success: false,
        error: 'CEP não encontrado. Verifique o número digitado ou preencha o endereço manualmente.',
      };
    }

    const cleanData: CleanAddressData = {
      cep: formatCep(json.cep || digits),
      rawCep: digits,
      street: (json.logradouro || '').trim(),
      logradouro: (json.logradouro || '').trim(),
      complement: (json.complemento || '').trim(),
      neighborhood: (json.bairro || '').trim(),
      bairro: (json.bairro || '').trim(),
      city: (json.localidade || '').trim(),
      localidade: (json.localidade || '').trim(),
      state: (json.uf || '').trim().toUpperCase(),
      uf: (json.uf || '').trim().toUpperCase(),
      stateName: (json.estado || '').trim(),
      ibgeCode: json.ibge || undefined,
    };

    // Armazena no cache da sessão
    cepCache.set(digits, cleanData);

    return {
      success: true,
      data: cleanData,
      cached: false,
    };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      // Requisição abortada porque o usuário digitou um novo CEP
      return {
        success: false,
        isAborted: true,
        error: 'Consulta cancelada por nova digitação.',
      };
    }

    return {
      success: false,
      error: 'Não foi possível consultar o CEP no momento. Você pode preencher o endereço manualmente.',
    };
  }
};

/**
 * Limpa o cache de CEPs em memória (útil para testes).
 */
export const clearCepCache = (): void => {
  cepCache.clear();
};
