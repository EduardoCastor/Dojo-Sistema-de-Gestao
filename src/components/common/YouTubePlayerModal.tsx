import React, { useEffect } from 'react';
import { X, ExternalLink, ShieldAlert, Video } from 'lucide-react';
import { DigitalLibraryItem } from '../../types';
import { getYouTubeEmbedUrl } from '../../utils/youtubeValidator';

interface YouTubePlayerModalProps {
  video: DigitalLibraryItem | null;
  isOpen: boolean;
  onClose: () => void;
}

export const YouTubePlayerModal: React.FC<YouTubePlayerModalProps> = ({
  video,
  isOpen,
  onClose,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !video) return null;

  const embedUrl = video.youtubeVideoId
    ? getYouTubeEmbedUrl(video.youtubeVideoId, true)
    : video.mediaUrl.includes('embed')
    ? video.mediaUrl
    : '';

  const externalUrl = video.youtubeVideoId
    ? `https://www.youtube.com/watch?v=${video.youtubeVideoId}`
    : video.mediaUrl;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/85 backdrop-blur-sm animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/70">
          <div className="flex items-center gap-3 pr-4 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-600/15 border border-red-500/30 text-red-400">
              <Video className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-bold text-white truncate">
                {video.title}
              </h3>
              <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                <span>{video.martialArtName || 'Arte Marcial'}</span>
                <span>·</span>
                <span className="capitalize">{video.category.replace('_', ' ')}</span>
                {video.authorInstructor && (
                  <>
                    <span>·</span>
                    <span>Instrutor: {video.authorInstructor}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <a
              href={externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 hover:text-white border border-slate-700 transition-colors"
              title="Abrir diretamente na plataforma do YouTube"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Abrir no YouTube</span>
            </a>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              title="Fechar reprodutor"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Video Player Container */}
        <div className="relative w-full aspect-video bg-black flex items-center justify-center">
          {embedUrl ? (
            <iframe
              src={embedUrl}
              title={video.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              className="w-full h-full border-0"
            />
          ) : (
            <div className="text-center p-8 space-y-3">
              <ShieldAlert className="h-10 w-10 text-amber-400 mx-auto" />
              <p className="text-sm text-slate-300 font-semibold">
                Reprodução incorporada não disponível para esta mídia.
              </p>
              <a
                href={externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold"
              >
                <ExternalLink className="h-4 w-4" />
                <span>Assistir no YouTube</span>
              </a>
            </div>
          )}
        </div>

        {/* Footer & Pedagogical Notice */}
        <div className="p-4 sm:p-5 bg-slate-950/80 border-t border-slate-800 space-y-3">
          {video.description && (
            <p className="text-xs text-slate-300 leading-relaxed max-w-3xl">
              {video.description}
            </p>
          )}

          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-2 border-t border-slate-800/80 text-[11px] text-slate-400">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">Público-alvo:</span>
              <span className="text-slate-200 font-medium">
                {video.allBelts
                  ? 'Todas as Faixas da Modalidade'
                  : video.targetBeltNames?.join(', ') || 'Faixas Específicas'}
              </span>
            </div>

            <div className="flex items-center gap-1.5 text-slate-400">
              <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span>
                Se o vídeo não carregar, seu canal pode ter bloqueado incorporação em sites externos.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
