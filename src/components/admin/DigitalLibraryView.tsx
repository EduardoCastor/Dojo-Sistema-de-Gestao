import React, { useState, useMemo } from 'react';
import {
  Video,
  Plus,
  Search,
  Play,
  Edit2,
  Trash2,
  Lock,
  Globe,
  Archive,
  CheckCircle,
  Clock,
  Layers,
  Filter,
} from 'lucide-react';
import { DigitalLibraryItem, BeltRank, MartialArt, SaveVideoPayload } from '../../types';
import { VideoFormModal } from './VideoFormModal';
import { YouTubePlayerModal } from '../common/YouTubePlayerModal';
import { digitalLibraryService } from '../../services/digitalLibraryService';

interface DigitalLibraryViewProps {
  libraryItems: DigitalLibraryItem[];
  beltRanks: BeltRank[];
  martialArts?: MartialArt[];
  tenantId?: string;
  onAddLibraryItem?: (item: DigitalLibraryItem) => void;
  onRefresh?: () => void;
}

export const DigitalLibraryView: React.FC<DigitalLibraryViewProps> = ({
  libraryItems: initialItems,
  beltRanks,
  martialArts = [],
  tenantId = 'tenant-kodokan',
  onAddLibraryItem,
  onRefresh,
}) => {
  const [items, setItems] = useState<DigitalLibraryItem[]>(initialItems);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedArtFilter, setSelectedArtFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Modals state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingVideo, setEditingVideo] = useState<DigitalLibraryItem | null>(null);
  const [activePlayerVideo, setActivePlayerVideo] = useState<DigitalLibraryItem | null>(null);
  const [deletingVideoId, setDeletingVideoId] = useState<string | null>(null);

  // Sync when initialItems change
  React.useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  // Fallback martial arts if none passed
  const modalities = useMemo(() => {
    if (martialArts && martialArts.length > 0) return martialArts;
    return [
      { id: 'art-judo', name: 'Judô' },
      { id: 'art-bjj', name: 'Jiu-Jítsu' },
    ] as MartialArt[];
  }, [martialArts]);

  // Filtered items
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesSearch =
        item.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (item.authorInstructor && item.authorInstructor.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchesArt =
        selectedArtFilter === 'all' || item.martialArtId === selectedArtFilter;

      const matchesCategory =
        categoryFilter === 'all' || item.category === categoryFilter;

      const itemStatus = item.status || 'published';
      const matchesStatus =
        statusFilter === 'all' || itemStatus === statusFilter;

      return matchesSearch && matchesArt && matchesCategory && matchesStatus;
    });
  }, [items, searchTerm, selectedArtFilter, categoryFilter, statusFilter]);

  // Action handlers
  const handleOpenCreate = () => {
    setEditingVideo(null);
    setIsFormOpen(true);
  };

  const handleOpenEdit = (video: DigitalLibraryItem) => {
    setEditingVideo(video);
    setIsFormOpen(true);
  };

  const handleSaveVideo = async (payload: SaveVideoPayload) => {
    const res = await digitalLibraryService.saveVideo(payload);
    if (res.success) {
      const refreshed = await digitalLibraryService.fetchVideos(tenantId);
      setItems(refreshed);
      if (onRefresh) onRefresh();
    }
  };

  const handleDeleteConfirm = async (videoId: string) => {
    if (!window.confirm('Tem certeza que deseja remover este vídeo da Biblioteca Digital?')) {
      return;
    }
    setDeletingVideoId(videoId);
    try {
      await digitalLibraryService.deleteVideo(tenantId, videoId);
      const refreshed = await digitalLibraryService.fetchVideos(tenantId);
      setItems(refreshed);
      if (onRefresh) onRefresh();
    } finally {
      setDeletingVideoId(null);
    }
  };

  const handleStatusToggle = async (video: DigitalLibraryItem) => {
    const nextStatus =
      video.status === 'published'
        ? 'draft'
        : video.status === 'draft'
        ? 'archived'
        : 'published';

    await digitalLibraryService.updateVideoStatus(tenantId, video.id, nextStatus);
    const refreshed = await digitalLibraryService.fetchVideos(tenantId);
    setItems(refreshed);
    if (onRefresh) onRefresh();
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">
            Biblioteca Digital & Videoaulas do YouTube
          </h2>
          <p className="text-xs text-slate-400">
            Acervo didático de técnicas, katas, preparação física e regras organizado por modalidade e faixa.
          </p>
        </div>

        <button
          onClick={handleOpenCreate}
          className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500 transition-colors shadow cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          <span>Cadastrar Vídeo</span>
        </button>
      </div>

      {/* Overview Stat Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/60">
          <div className="text-[11px] text-slate-400">Total de Vídeos</div>
          <div className="text-xl font-bold text-white font-mono tabular-nums mt-0.5">
            {items.length}
          </div>
        </div>
        <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/60">
          <div className="text-[11px] text-emerald-400">Publicados no Portal</div>
          <div className="text-xl font-bold text-emerald-400 font-mono tabular-nums mt-0.5">
            {items.filter((i) => i.status === 'published' || !i.status).length}
          </div>
        </div>
        <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/60">
          <div className="text-[11px] text-amber-400">Rascunhos Internos</div>
          <div className="text-xl font-bold text-amber-400 font-mono tabular-nums mt-0.5">
            {items.filter((i) => i.status === 'draft').length}
          </div>
        </div>
        <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/60">
          <div className="text-[11px] text-slate-400">Arquivados</div>
          <div className="text-xl font-bold text-slate-300 font-mono tabular-nums mt-0.5">
            {items.filter((i) => i.status === 'archived').length}
          </div>
        </div>
      </div>

      {/* Search and Filters Bar */}
      <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 space-y-3">
        <div className="flex flex-col md:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Pesquisar por título, técnica, descrição ou professor..."
              className="w-full rounded-lg border border-slate-800 bg-slate-950 pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            {/* Filter: Modality */}
            <select
              value={selectedArtFilter}
              onChange={(e) => setSelectedArtFilter(e.target.value)}
              className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 focus:border-red-500 focus:outline-none"
            >
              <option value="all">Todas as Modalidades</option>
              {modalities.map((art) => (
                <option key={art.id} value={art.id}>
                  {art.name}
                </option>
              ))}
            </select>

            {/* Filter: Category */}
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 focus:border-red-500 focus:outline-none"
            >
              <option value="all">Todas as Categorias</option>
              <option value="waza_techniques">Técnicas (Waza)</option>
              <option value="kata">Katas Oficiais</option>
              <option value="rules_referee">Arbitragem</option>
              <option value="physical_prep">Prep. Física</option>
              <option value="philosophy_history">Filosofia</option>
              <option value="general">Geral</option>
            </select>

            {/* Filter: Status */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 focus:border-red-500 focus:outline-none font-semibold"
            >
              <option value="all">Todas as Situações</option>
              <option value="published">Apenas Publicados</option>
              <option value="draft">Apenas Rascunhos</option>
              <option value="archived">Apenas Arquivados</option>
            </select>
          </div>
        </div>
      </div>

      {/* Grid of Video Cards */}
      {filteredItems.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredItems.map((item) => {
            const statusLabel =
              item.status === 'draft'
                ? 'Rascunho'
                : item.status === 'archived'
                ? 'Arquivado'
                : 'Publicado';

            const statusColor =
              item.status === 'draft'
                ? 'text-amber-400 bg-amber-950/80 border-amber-500/30'
                : item.status === 'archived'
                ? 'text-slate-400 bg-slate-800/80 border-slate-700'
                : 'text-emerald-400 bg-emerald-950/80 border-emerald-500/30';

            return (
              <div
                key={item.id}
                className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden hover:border-slate-700 transition-all group"
              >
                <div>
                  {/* Video Thumbnail with Hover Play Button */}
                  <div
                    onClick={() => setActivePlayerVideo(item)}
                    className="relative w-full aspect-video bg-black overflow-hidden cursor-pointer group/thumb"
                  >
                    <img
                      src={
                        item.thumbnailUrl ||
                        (item.youtubeVideoId
                          ? `https://img.youtube.com/vi/${item.youtubeVideoId}/hqdefault.jpg`
                          : '/src/assets/images/martial_arts_technique_1792068010372.jpg')
                      }
                      alt={item.title}
                      className="w-full h-full object-cover group-hover/thumb:scale-105 transition-transform duration-300"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-80 group-hover/thumb:opacity-100 transition-opacity">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-600/90 text-white shadow-lg group-hover/thumb:scale-110 transition-transform">
                        <Play className="h-5 w-5 fill-white ml-0.5" />
                      </div>
                    </div>

                    {/* Status Pill Badge Top Right */}
                    <div className="absolute top-2.5 right-2.5">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded border ${statusColor}`}
                      >
                        {statusLabel}
                      </span>
                    </div>

                    {/* Modality Top Left */}
                    <div className="absolute top-2.5 left-2.5">
                      <span className="text-[10px] font-bold text-white bg-slate-900/80 backdrop-blur-sm px-2 py-0.5 rounded border border-slate-700">
                        {item.martialArtName || 'Arte Marcial'}
                      </span>
                    </div>
                  </div>

                  {/* Body Content */}
                  <div className="p-4 space-y-2">
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span className="capitalize">{item.category.replace('_', ' ')}</span>
                      <span>·</span>
                      <span>{item.authorInstructor || 'Sensei da Academia'}</span>
                    </div>

                    <h3 className="text-sm font-bold text-white group-hover:text-red-400 transition-colors line-clamp-2">
                      {item.title}
                    </h3>

                    {item.description && (
                      <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                        {item.description}
                      </p>
                    )}

                    {/* Belts Access Notice */}
                    <div className="pt-2">
                      {item.allBelts ? (
                        <div className="flex items-center gap-1.5 text-[11px] text-emerald-400/90">
                          <Globe className="h-3.5 w-3.5 shrink-0" />
                          <span>Liberado para todas as faixas</span>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 text-[11px] text-amber-400/90">
                            <Lock className="h-3.5 w-3.5 shrink-0" />
                            <span>Apenas faixas selecionadas:</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {item.targetBeltNames && item.targetBeltNames.length > 0 ? (
                              item.targetBeltNames.map((bn, i) => (
                                <span
                                  key={i}
                                  className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 truncate max-w-[140px]"
                                >
                                  {bn}
                                </span>
                              ))
                            ) : (
                              <span className="text-[10px] text-slate-500">Nenhuma faixa vinculada</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Card Actions Footer */}
                <div className="p-4 border-t border-slate-800/80 flex items-center justify-between text-xs bg-slate-950/40">
                  <button
                    onClick={() => handleStatusToggle(item)}
                    className="text-[11px] text-slate-400 hover:text-white transition-colors cursor-pointer"
                    title="Alternar entre Publicado, Rascunho e Arquivado"
                  >
                    Alternar Situação
                  </button>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleOpenEdit(item)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                      title="Editar dados do vídeo"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteConfirm(item.id)}
                      disabled={deletingVideoId === item.id}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
                      title="Excluir vídeo"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Empty State */
        <div className="p-12 text-center rounded-2xl border border-slate-800 bg-slate-900/40 space-y-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-800 text-slate-400 mx-auto">
            <Video className="h-6 w-6" />
          </div>
          <h3 className="text-sm font-bold text-white">Nenhum vídeo didático encontrado</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            {searchTerm || selectedArtFilter !== 'all' || categoryFilter !== 'all' || statusFilter !== 'all'
              ? 'Nenhum resultado corresponde aos filtros selecionados. Tente ajustar os termos de busca.'
              : 'Cadastre a primeira videoaula do YouTube para iniciar o acervo técnico dos seus alunos.'}
          </p>
          <button
            onClick={handleOpenCreate}
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500 transition-colors shadow cursor-pointer mt-2"
          >
            <Plus className="h-4 w-4" />
            <span>Cadastrar Primeiro Vídeo</span>
          </button>
        </div>
      )}

      {/* Video Registration / Edit Modal */}
      <VideoFormModal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        onSave={handleSaveVideo}
        tenantId={tenantId}
        martialArts={modalities}
        beltRanks={beltRanks}
        initialVideo={editingVideo}
      />

      {/* On-demand YouTube Player Modal */}
      <YouTubePlayerModal
        isOpen={Boolean(activePlayerVideo)}
        video={activePlayerVideo}
        onClose={() => setActivePlayerVideo(null)}
      />
    </div>
  );
};
