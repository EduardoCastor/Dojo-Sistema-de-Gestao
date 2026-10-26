/**
 * Utilitário de validação, extração e normalização de URLs de vídeos do YouTube.
 * TatameHub: Biblioteca Digital de Artes Marciais
 */

export interface YouTubeValidationResult {
  isValid: boolean;
  videoId?: string;
  embedUrl?: string;
  thumbnailUrl?: string;
  maxResThumbnailUrl?: string;
  watchUrl?: string;
  errorMessage?: string;
}

/**
 * Expressão regular para validar e extrair o ID de 11 caracteres de URLs comuns do YouTube:
 * - https://www.youtube.com/watch?v=VIDEO_ID
 * - https://youtu.be/VIDEO_ID
 * - https://www.youtube.com/shorts/VIDEO_ID
 * - https://www.youtube.com/embed/VIDEO_ID
 * - Suporta variações com parâmetros adicionais (?t=..., &list=..., etc.)
 */
const YOUTUBE_REGEX =
  /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})(?:[^\s]*)?/;

/**
 * Valida se uma string é uma URL de vídeo válida do YouTube e extrai seus componentes.
 * Rejeita com mensagem amigável em português se o link não pertencer ao YouTube ou for inválido.
 */
export function validateAndParseYouTubeUrl(url: string): YouTubeValidationResult {
  if (!url || typeof url !== 'string' || !url.trim()) {
    return {
      isValid: false,
      errorMessage: 'Por favor, informe a URL do vídeo do YouTube.',
    };
  }

  const trimmed = url.trim();

  // Verificar se o domínio é do YouTube
  const hasYouTubeDomain =
    /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//i.test(trimmed);

  if (!hasYouTubeDomain) {
    return {
      isValid: false,
      errorMessage:
        'Apenas URLs oficiais do YouTube (youtube.com ou youtu.be) são aceitas na Biblioteca Digital.',
    };
  }

  const match = trimmed.match(YOUTUBE_REGEX);

  if (!match || !match[1]) {
    return {
      isValid: false,
      errorMessage:
        'Não foi possível identificar o código do vídeo. Verifique se o link está no formato youtube.com/watch?v=..., youtu.be/... ou youtube.com/shorts/...',
    };
  }

  const videoId = match[1];

  return {
    isValid: true,
    videoId,
    embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
    thumbnailUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    maxResThumbnailUrl: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
    watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

/**
 * Retorna a URL da miniatura padrão para um ID de vídeo do YouTube.
 */
export function getYouTubeThumbnail(videoId: string, quality: 'hq' | 'maxres' = 'hq'): string {
  if (!videoId) return '';
  return quality === 'maxres'
    ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
    : `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

/**
 * Retorna a URL segura de reprodução incorporada para um ID de vídeo.
 */
export function getYouTubeEmbedUrl(videoId: string, autoPlay: boolean = false): string {
  if (!videoId) return '';
  const params = new URLSearchParams({
    rel: '0',
    modestbranding: '1',
    enablejsapi: '1',
  });
  if (autoPlay) {
    params.set('autoplay', '1');
  }
  return `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`;
}
