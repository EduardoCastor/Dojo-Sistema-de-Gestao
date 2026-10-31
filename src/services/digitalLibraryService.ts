import { supabase, isSupabaseConfigured } from './supabase';
import { DigitalLibraryItem, SaveVideoPayload } from '../types';
import { DataStore } from '../data/storage';
import { validateAndParseYouTubeUrl } from '../utils/youtubeValidator';

export function isValidUUID(id: string): boolean {
  if (!id) return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

export const digitalLibraryService = {
  /**
   * Busca todos os vídeos cadastrados no tenant (para a área administrativa).
   * Suporta Supabase com fallback transparente para DataStore local.
   */
  async fetchVideos(tenantId: string): Promise<DigitalLibraryItem[]> {
    if (!tenantId) return [];

    if (isSupabaseConfigured() && supabase && isValidUUID(tenantId)) {
      try {
        const { data, error } = await supabase
          .from('digital_library_videos')
          .select(`
            id,
            tenant_id,
            martial_art_id,
            title,
            description,
            youtube_url,
            youtube_video_id,
            thumbnail_url,
            category,
            author_instructor,
            display_order,
            status,
            all_belts,
            created_by_user_id,
            created_at,
            updated_at,
            martial_arts (id, name),
            digital_library_video_belts (
              belt_rank_id,
              belt_ranks (id, name)
            )
          `)
          .eq('tenant_id', tenantId)
          .order('display_order', { ascending: true })
          .order('created_at', { ascending: false });

        if (!error && data) {
          const mapped: DigitalLibraryItem[] = data.map((row: any) => {
            const targetBeltNames: string[] = [];
            const targetBeltIds: string[] = [];

            if (row.digital_library_video_belts && Array.isArray(row.digital_library_video_belts)) {
              row.digital_library_video_belts.forEach((vb: any) => {
                if (vb.belt_rank_id) {
                  targetBeltIds.push(vb.belt_rank_id);
                  if (vb.belt_ranks?.name) {
                    targetBeltNames.push(vb.belt_ranks.name);
                  }
                }
              });
            }

            return {
              id: row.id,
              tenantId: row.tenant_id,
              title: row.title,
              category: row.category,
              mediaType: 'video',
              mediaUrl: row.youtube_url,
              youtubeVideoId: row.youtube_video_id,
              thumbnailUrl: row.thumbnail_url,
              description: row.description || '',
              martialArtId: row.martial_art_id,
              martialArtName: row.martial_arts?.name || '',
              targetBeltNames: row.all_belts ? ['Todas as Faixas'] : targetBeltNames,
              targetBeltIds,
              allBelts: Boolean(row.all_belts),
              authorInstructor: row.author_instructor || '',
              publishedDate: (row.created_at || '').split('T')[0] || new Date().toISOString().split('T')[0],
              accessScope: row.all_belts ? 'tenant_all' : 'restricted_belt',
              viewCount: 0,
              displayOrder: row.display_order ?? 0,
              status: row.status as 'published' | 'draft' | 'archived',
              createdByUserId: row.created_by_user_id,
              createdAt: row.created_at,
              updatedAt: row.updated_at,
            };
          });

          // Sincronizar com DataStore para fallback consistente
          if (mapped.length > 0) {
            DataStore.saveLibraryItems(mapped);
          }
          return mapped;
        }
      } catch (err) {
        console.warn('Erro ao carregar vídeos da biblioteca via Supabase:', err);
      }
    }

    // Fallback: carregar itens do DataStore local
    return DataStore.getLibraryItems(tenantId);
  },

  /**
   * Consulta os vídeos pedagógicos aos quais o aluno específico tem direito de acesso.
   * Regras:
   * 1. Vídeo publicado (status = 'published');
   * 2. Aluno matriculado / ativo na arte marcial;
   * 3. Liberado para todas as faixas (allBelts = true) OU correspondente à faixa atual do aluno.
   */
  async fetchStudentAccessibleVideos(
    tenantId: string,
    studentId: string,
    context?: {
      studentGraduations?: Array<{ martialArtId?: string; beltId?: string; beltName?: string }>;
      studentEnrollments?: Array<{ martialArtId?: string; status?: string }>;
      martialArts?: Array<{ id: string; name: string }>;
    }
  ): Promise<DigitalLibraryItem[]> {
    if (!tenantId || !studentId) return [];

    if (isSupabaseConfigured() && supabase && isValidUUID(tenantId) && isValidUUID(studentId)) {
      try {
        const { data, error } = await supabase.rpc('get_student_accessible_videos', {
          p_tenant_id: tenantId,
          p_student_id: studentId,
        });

        if (!error && Array.isArray(data) && data.length > 0) {
          return data.map((row: any) => ({
            id: row.video_id,
            tenantId: row.tenant_id,
            title: row.title,
            category: row.category,
            mediaType: 'video',
            mediaUrl: row.youtube_url,
            youtubeVideoId: row.youtube_video_id,
            thumbnailUrl: row.thumbnail_url,
            description: row.description || '',
            martialArtId: row.martial_art_id,
            martialArtName: row.martial_art_name || '',
            targetBeltNames: row.all_belts ? ['Todas as Faixas'] : (row.target_belt_names || []),
            targetBeltIds: row.target_belt_ids || [],
            allBelts: Boolean(row.all_belts),
            authorInstructor: row.author_instructor || '',
            publishedDate: (row.created_at || '').split('T')[0] || new Date().toISOString().split('T')[0],
            accessScope: row.all_belts ? 'tenant_all' : 'restricted_belt',
            viewCount: 0,
            displayOrder: row.display_order ?? 0,
            status: 'published',
            createdAt: row.created_at,
          }));
        }
      } catch (err) {
        console.warn('Aviso ao consultar vídeos via RPC get_student_accessible_videos:', err);
      }
    }

    // Fallback: carregar todos os vídeos do tenant (do Supabase ou DataStore) e aplicar filtragem
    let allTenantVideos = await this.fetchVideos(tenantId);
    if (!allTenantVideos || allTenantVideos.length === 0) {
      allTenantVideos = DataStore.getLibraryItems(tenantId);
    }
    const publishedVideos = allTenantVideos.filter(v => v.status === 'published' || !v.status);

    // Identificar artes marciais ativas do aluno
    const activeMartialArtIds = new Set<string>();
    if (context?.studentEnrollments && context.studentEnrollments.length > 0) {
      context.studentEnrollments.forEach(en => {
        if (en.status === 'active' && en.martialArtId) {
          activeMartialArtIds.add(en.martialArtId);
        }
      });
    }

    // Considerar graduações registradas como indicador de prática
    if (context?.studentGraduations && context.studentGraduations.length > 0) {
      context.studentGraduations.forEach(g => {
        if (g.martialArtId) {
          activeMartialArtIds.add(g.martialArtId);
        }
      });
    }

    // Se o aluno ainda não tiver matrículas específicas mapeadas nos props, buscar do storage
    if (activeMartialArtIds.size === 0) {
      const enrollments = DataStore.getEnrollments(tenantId).filter(
        e => e.studentId === studentId && e.status === 'active'
      );
      enrollments.forEach(e => {
        const cls = DataStore.getClasses(tenantId).find(c => c.id === e.classGroupId);
        if (cls?.martialArtId) {
          activeMartialArtIds.add(cls.martialArtId);
        }
      });

      const student = DataStore.getStudents(tenantId).find(s => s.id === studentId);
      if (student?.currentGraduations) {
        student.currentGraduations.forEach(g => {
          if (g.martialArtId) activeMartialArtIds.add(g.martialArtId);
        });
      }
    }

    // Mapear faixas atuais do aluno por modalidade
    const studentBeltsByArt = new Map<string, { beltId?: string; beltName?: string }>();
    if (context?.studentGraduations && context.studentGraduations.length > 0) {
      context.studentGraduations.forEach(g => {
        if (g.martialArtId) {
          studentBeltsByArt.set(g.martialArtId, { beltId: g.beltId, beltName: g.beltName });
        }
      });
    } else {
      const student = DataStore.getStudents(tenantId).find(s => s.id === studentId);
      if (student?.currentGraduations) {
        student.currentGraduations.forEach(g => {
          if (g.martialArtId) {
            studentBeltsByArt.set(g.martialArtId, { beltId: g.beltId, beltName: g.beltName });
          }
        });
      }
    }

    // Filtragem de acesso seguro e proporcional ao aluno da academia
    return publishedVideos.filter(video => {
      // 1. Se o vídeo pertence a uma modalidade específica e o aluno possui modalidades ativas definidas,
      // verificar compatibilidade de modalidade
      if (video.martialArtId && activeMartialArtIds.size > 0 && !activeMartialArtIds.has(video.martialArtId)) {
        return false;
      }

      // 2. Se for liberado para todas as faixas (allBelts = true) ou acesso geral
      if (video.allBelts || video.accessScope === 'tenant_all' || video.accessScope === 'public' || (!video.targetBeltIds?.length && !video.targetBeltNames?.length)) {
        return true;
      }

      // 3. Se for restrito a faixas específicas, verificar correspondência com a faixa do aluno
      const studentBelt = video.martialArtId ? studentBeltsByArt.get(video.martialArtId) : undefined;
      if (!studentBelt) {
        // Se a restrição é de faixas e o aluno não tem faixa cadastrada para a modalidade,
        // liberar apenas se o vídeo for para todas as faixas (já tratado acima)
        return false;
      }

      const matchById = video.targetBeltIds && studentBelt.beltId && video.targetBeltIds.includes(studentBelt.beltId);
      const matchByName = video.targetBeltNames && studentBelt.beltName && video.targetBeltNames.some(
        name => name.toLowerCase() === studentBelt.beltName?.toLowerCase()
      );

      return Boolean(matchById || matchByName);
    });
  },

  /**
   * Salva ou edita um vídeo com validação estrita da URL do YouTube e persistência.
   */
  async saveVideo(payload: SaveVideoPayload): Promise<{ success: boolean; videoId?: string; error?: string }> {
    // 1. Validação da URL do YouTube
    const ytValidation = validateAndParseYouTubeUrl(payload.youtubeUrl);
    if (!ytValidation.isValid || !ytValidation.videoId) {
      return {
        success: false,
        error: ytValidation.errorMessage || 'URL de vídeo do YouTube inválida.',
      };
    }

    // Garantir ID e miniaturas normalizadas
    const normalizedVideoId = ytValidation.videoId;
    const normalizedThumbnail = ytValidation.thumbnailUrl!;
    const videoId = payload.id || `video-${Date.now()}`;

    // 2. Persistência no Supabase via RPC se configurado
    if (isSupabaseConfigured() && supabase && isValidUUID(payload.tenantId)) {
      try {
        const { data, error } = await supabase.rpc('save_digital_library_video', {
          p_tenant_id: payload.tenantId,
          p_video_id: isValidUUID(payload.id || '') ? payload.id : null,
          p_martial_art_id: isValidUUID(payload.martialArtId) ? payload.martialArtId : null,
          p_title: payload.title.trim(),
          p_description: payload.description || '',
          p_youtube_url: payload.youtubeUrl.trim(),
          p_youtube_video_id: normalizedVideoId,
          p_thumbnail_url: normalizedThumbnail,
          p_category: payload.category,
          p_author_instructor: payload.authorInstructor || '',
          p_display_order: payload.displayOrder ?? 0,
          p_status: payload.status,
          p_all_belts: payload.allBelts,
          p_belt_rank_ids: payload.targetBeltIds.filter(id => isValidUUID(id)),
        });

        if (error) {
          console.warn('Aviso ao persistir via RPC save_digital_library_video:', error);
        }
      } catch (rpcErr) {
        console.warn('Falha na chamada RPC Supabase save_digital_library_video:', rpcErr);
      }
    }

    // 3. Persistência no DataStore local
    const currentVideos = DataStore.getLibraryItems(payload.tenantId);
    const existingIndex = currentVideos.findIndex(v => v.id === videoId);

    // Buscar nomes das faixas para legibilidade
    const allBeltRanks = DataStore.getBeltRanks(payload.tenantId);
    const targetBeltNames = payload.allBelts
      ? ['Todas as Faixas']
      : payload.targetBeltIds
          .map(id => allBeltRanks.find(b => b.id === id)?.name)
          .filter(Boolean) as string[];

    const allMartialArts = DataStore.getMartialArts(payload.tenantId);
    const martialArtName = allMartialArts.find(m => m.id === payload.martialArtId)?.name || 'Artes Marciais';

    const newItem: DigitalLibraryItem = {
      id: videoId,
      tenantId: payload.tenantId,
      title: payload.title.trim(),
      category: payload.category,
      mediaType: 'video',
      mediaUrl: payload.youtubeUrl.trim(),
      youtubeVideoId: normalizedVideoId,
      thumbnailUrl: normalizedThumbnail,
      description: payload.description || '',
      martialArtId: payload.martialArtId,
      martialArtName,
      targetBeltNames,
      targetBeltIds: payload.targetBeltIds,
      allBelts: payload.allBelts,
      authorInstructor: payload.authorInstructor || 'Instrutor Técnico',
      publishedDate: new Date().toISOString().split('T')[0],
      accessScope: payload.allBelts ? 'tenant_all' : 'restricted_belt',
      viewCount: existingIndex >= 0 ? currentVideos[existingIndex].viewCount : 0,
      displayOrder: payload.displayOrder ?? 0,
      status: payload.status,
      updatedAt: new Date().toISOString(),
    };

    if (existingIndex >= 0) {
      currentVideos[existingIndex] = { ...currentVideos[existingIndex], ...newItem };
    } else {
      currentVideos.unshift(newItem);
    }

    DataStore.saveLibraryItems(currentVideos);

    return {
      success: true,
      videoId,
    };
  },

  /**
   * Exclui um vídeo da biblioteca.
   */
  async deleteVideo(tenantId: string, videoId: string): Promise<{ success: boolean; error?: string }> {
    if (!tenantId || !videoId) {
      return { success: false, error: 'Identificadores inválidos para exclusão.' };
    }

    if (isSupabaseConfigured() && supabase && isValidUUID(tenantId) && isValidUUID(videoId)) {
      try {
        const { error } = await supabase.rpc('delete_digital_library_video', {
          p_tenant_id: tenantId,
          p_video_id: videoId,
        });
        if (error) {
          console.warn('Erro ao excluir vídeo via RPC delete_digital_library_video:', error);
        }
      } catch (err) {
        console.warn('Falha RPC ao excluir vídeo:', err);
      }
    }

    // Atualizar DataStore local
    const currentVideos = DataStore.getLibraryItems(tenantId);
    const updated = currentVideos.filter(v => v.id !== videoId);
    DataStore.saveLibraryItems(updated);

    return { success: true };
  },

  /**
   * Atualiza a situação de publicação do vídeo (rascunho, publicado, arquivado).
   */
  async updateVideoStatus(
    tenantId: string,
    videoId: string,
    status: 'published' | 'draft' | 'archived'
  ): Promise<{ success: boolean; error?: string }> {
    if (!tenantId || !videoId) return { success: false };

    if (isSupabaseConfigured() && supabase && isValidUUID(tenantId) && isValidUUID(videoId)) {
      try {
        await supabase
          .from('digital_library_videos')
          .update({ status, updated_at: new Date().toISOString() })
          .eq('tenant_id', tenantId)
          .eq('id', videoId);
      } catch (err) {
        console.warn('Erro ao atualizar status do vídeo no Supabase:', err);
      }
    }

    const currentVideos = DataStore.getLibraryItems(tenantId);
    const target = currentVideos.find(v => v.id === videoId);
    if (target) {
      target.status = status;
      target.updatedAt = new Date().toISOString();
      DataStore.saveLibraryItems(currentVideos);
    }

    return { success: true };
  },
};
