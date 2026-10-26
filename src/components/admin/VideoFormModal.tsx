import React, { useState, useEffect, useMemo } from 'react';
import { X, Video, Check, AlertCircle, Sparkles, ExternalLink } from 'lucide-react';
import { DigitalLibraryItem, BeltRank, MartialArt, SaveVideoPayload } from '../../types';
import { validateAndParseYouTubeUrl } from '../../utils/youtubeValidator';

interface VideoFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (payload: SaveVideoPayload) => Promise<boolean | void>;
  tenantId: string;
  martialArts: MartialArt[];
  beltRanks: BeltRank[];
  initialVideo?: DigitalLibraryItem | null;
}

export const VideoFormModal: React.FC<VideoFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  tenantId,
  martialArts,
  beltRanks,
  initialVideo,
}) => {
  const isEditing = Boolean(initialVideo);

  // Form states
  const [title, setTitle] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [description, setDescription] = useState('');
  const [martialArtId, setMartialArtId] = useState('');
  const [allBelts, setAllBelts] = useState(false);
  const [targetBeltIds, setTargetBeltIds] = useState<string[]>([]);
  const [category, setCategory] = useState<DigitalLibraryItem['category']>('waza_techniques');
  const [authorInstructor, setAuthorInstructor] = useState('');
  const [displayOrder, setDisplayOrder] = useState(0);
  const [status, setStatus] = useState<'published' | 'draft' | 'archived'>('published');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Live YouTube validation
  const ytParsed = useMemo(() => {
    return validateAndParseYouTubeUrl(youtubeUrl);
  }, [youtubeUrl]);

  // Reset or fill form when initialVideo or isOpen changes
  useEffect(() => {
    if (isOpen) {
      if (initialVideo) {
        setTitle(initialVideo.title || '');
        setYoutubeUrl(initialVideo.mediaUrl || '');
        setDescription(initialVideo.description || '');
        setMartialArtId(initialVideo.martialArtId || martialArts[0]?.id || '');
        setAllBelts(Boolean(initialVideo.allBelts));
        setTargetBeltIds(initialVideo.targetBeltIds || []);
        setCategory(initialVideo.category || 'waza_techniques');
        setAuthorInstructor(initialVideo.authorInstructor || '');
        setDisplayOrder(initialVideo.displayOrder ?? 0);
        setStatus(initialVideo.status || 'published');
      } else {
        setTitle('');
        setYoutubeUrl('');
        setDescription('');
        setMartialArtId(martialArts[0]?.id || '');
        setAllBelts(true);
        setTargetBeltIds([]);
        setCategory('waza_techniques');
        setAuthorInstructor('');
        setDisplayOrder(0);
        setStatus('published');
      }
      setFormError(null);
    }
  }, [isOpen, initialVideo, martialArts]);

  // Belts of the currently selected martial art
  const availableBeltsForArt = useMemo(() => {
    if (!martialArtId) return [];
    return beltRanks.filter((b) => b.martialArtId === martialArtId);
  }, [beltRanks, martialArtId]);

  // Toggle belt selection
  const handleToggleBelt = (beltId: string) => {
    setTargetBeltIds((prev) =>
      prev.includes(beltId) ? prev.filter((id) => id !== beltId) : [...prev, beltId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!title.trim()) {
      setFormError('Por favor, informe o título do vídeo.');
      return;
    }

    if (!ytParsed.isValid || !ytParsed.videoId) {
      setFormError(ytParsed.errorMessage || 'URL de vídeo do YouTube inválida.');
      return;
    }

    if (!martialArtId) {
      setFormError('Selecione a arte marcial correspondente ao conteúdo.');
      return;
    }

    if (!allBelts && targetBeltIds.length === 0) {
      setFormError('Selecione ao menos uma faixa alvo ou marque "Destinado a todas as faixas".');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: SaveVideoPayload = {
        id: initialVideo?.id,
        tenantId,
        martialArtId,
        title: title.trim(),
        description: description.trim(),
        youtubeUrl: youtubeUrl.trim(),
        youtubeVideoId: ytParsed.videoId,
        thumbnailUrl: ytParsed.thumbnailUrl!,
        category,
        authorInstructor: authorInstructor.trim(),
        displayOrder: Number(displayOrder) || 0,
        status,
        allBelts,
        targetBeltIds: allBelts ? [] : targetBeltIds,
      };

      await onSave(payload);
      onClose();
    } catch (err: any) {
      setFormError(err.message || 'Erro ao salvar o vídeo.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-sm overflow-y-auto"
    >
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 sm:p-7 text-slate-100 my-8">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          title="Fechar"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-600/15 border border-red-500/30 text-red-400">
            <Video className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white tracking-tight">
              {isEditing ? 'Editar Vídeo da Biblioteca' : 'Cadastrar Vídeo Didático (YouTube)'}
            </h3>
            <p className="text-xs text-slate-400">
              Gerencie videoaulas pedagógicas, kumi-kata, katas e orientações técnicas para os alunos.
            </p>
          </div>
        </div>

        {formError && (
          <div className="mb-4 flex items-center gap-2 p-3 rounded-xl border border-red-500/40 bg-red-950/40 text-xs text-red-300">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
            <span>{formError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* YouTube URL input with real-time feedback */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Link do Vídeo no YouTube *
            </label>
            <input
              type="text"
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
              placeholder="Ex: https://www.youtube.com/watch?v=dQw4w9WgXcQ ou https://youtu.be/..."
              className={`w-full rounded-lg border bg-slate-950 px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none transition-colors ${
                youtubeUrl && !ytParsed.isValid
                  ? 'border-red-500 focus:border-red-400'
                  : youtubeUrl && ytParsed.isValid
                  ? 'border-emerald-500 focus:border-emerald-400'
                  : 'border-slate-800 focus:border-red-500'
              }`}
              required
            />
            {youtubeUrl && !ytParsed.isValid && (
              <p className="text-[11px] text-red-400 mt-1 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                <span>{ytParsed.errorMessage}</span>
              </p>
            )}
            {youtubeUrl && ytParsed.isValid && (
              <p className="text-[11px] text-emerald-400 mt-1 flex items-center gap-1">
                <Check className="h-3 w-3" />
                <span>Vídeo do YouTube identificado (ID: {ytParsed.videoId})</span>
              </p>
            )}
          </div>

          {/* Automatic Thumbnail & Live Preview Card */}
          {ytParsed.isValid && ytParsed.thumbnailUrl && (
            <div className="p-3 rounded-xl border border-slate-800 bg-slate-950/60 flex items-center gap-4">
              <div className="relative w-32 aspect-video rounded-lg overflow-hidden border border-slate-700 bg-black shrink-0">
                <img
                  src={ytParsed.thumbnailUrl}
                  alt="Miniatura do YouTube"
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    // Fallback to high quality or placeholder
                    (e.target as HTMLImageElement).src = `https://img.youtube.com/vi/${ytParsed.videoId}/0.jpg`;
                  }}
                />
              </div>
              <div className="text-xs space-y-1 min-w-0">
                <span className="text-[10px] uppercase font-bold text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-500/30">
                  Miniatura Capturada
                </span>
                <p className="text-[11px] text-slate-300 truncate">
                  Miniatura oficial extraída automaticamente do YouTube.
                </p>
                <div className="text-[10px] text-slate-500 flex items-center gap-2">
                  <span>ID: {ytParsed.videoId}</span>
                  <span>·</span>
                  <a
                    href={ytParsed.watchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-red-400 hover:underline flex items-center gap-0.5"
                  >
                    Testar link <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* Title */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Título do Vídeo *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Ippon-Seoi-Nage: Mecânica de Entrada e Desequilíbrio"
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Descrição e Instruções Pedagógicas
            </label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descreva os pontos de atenção da técnica, postura de pegada e orientações para o estudo do aluno..."
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:border-red-500 focus:outline-none resize-none"
            />
          </div>

          {/* Modality & Category row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Arte Marcial / Modalidade *
              </label>
              <select
                value={martialArtId}
                onChange={(e) => {
                  setMartialArtId(e.target.value);
                  setTargetBeltIds([]); // Limpar faixas anteriores ao trocar modalidade
                }}
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-red-500 focus:outline-none"
                required
              >
                {martialArts.map((art) => (
                  <option key={art.id} value={art.id}>
                    {art.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Categoria / Assunto *
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as any)}
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-red-500 focus:outline-none"
              >
                <option value="waza_techniques">Técnicas e Golpes (Waza)</option>
                <option value="kata">Formas e Katas Oficiais</option>
                <option value="rules_referee">Regulamento e Arbitragem</option>
                <option value="physical_prep">Condicionamento Físico & Mobilidade</option>
                <option value="philosophy_history">Filosofia, Tradição e História</option>
                <option value="general">Geral / Avisos Didáticos</option>
              </select>
            </div>
          </div>

          {/* Belts Selection Section */}
          <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-white">Graduações Alvo</span>
                <p className="text-[11px] text-slate-400">
                  Defina quais faixas desta modalidade terão acesso a esta videoaula no portal do aluno.
                </p>
              </div>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={allBelts}
                  onChange={(e) => {
                    setAllBelts(e.target.checked);
                    if (e.target.checked) setTargetBeltIds([]);
                  }}
                  className="rounded border-slate-700 bg-slate-800 text-red-600 focus:ring-0 cursor-pointer"
                />
                <span className="text-xs font-medium text-slate-300">
                  Todas as faixas
                </span>
              </label>
            </div>

            {!allBelts && (
              <div>
                {availableBeltsForArt.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 border-t border-slate-800/80 max-h-40 overflow-y-auto">
                    {availableBeltsForArt.map((belt) => {
                      const isSelected = targetBeltIds.includes(belt.id);
                      return (
                        <button
                          type="button"
                          key={belt.id}
                          onClick={() => handleToggleBelt(belt.id)}
                          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-left text-xs transition-colors cursor-pointer ${
                            isSelected
                              ? 'border-red-500/60 bg-red-950/40 text-white'
                              : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          <span
                            className="h-2 w-3 rounded-sm border border-slate-600 shrink-0 shadow-sm"
                            style={{ backgroundColor: belt.colorHex }}
                          />
                          <span className="truncate">{belt.name}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-amber-400/80 pt-1">
                    Nenhuma faixa cadastrada para a modalidade selecionada. Marque "Todas as faixas" ou cadastre faixas no menu Modalidades.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Instructor & Order & Status row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Professor / Canal
              </label>
              <input
                type="text"
                value={authorInstructor}
                onChange={(e) => setAuthorInstructor(e.target.value)}
                placeholder="Ex: Sensei Kenji Yamamoto"
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Ordem de Exibição
              </label>
              <input
                type="number"
                min={0}
                value={displayOrder}
                onChange={(e) => setDisplayOrder(parseInt(e.target.value, 10) || 0)}
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-red-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Situação *
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-red-500 focus:outline-none font-semibold"
              >
                <option value="published">Publicado (Visível aos Alunos)</option>
                <option value="draft">Rascunho (Interno da Equipe)</option>
                <option value="archived">Arquivado (Oculto)</option>
              </select>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !ytParsed.isValid}
              className="flex items-center gap-2 px-5 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow transition-colors cursor-pointer"
            >
              <Check className="h-4 w-4" />
              <span>{isSubmitting ? 'Salvando...' : isEditing ? 'Atualizar Vídeo' : 'Cadastrar Vídeo'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
