import React, { useState, useMemo } from 'react';
import { TrendingUp, Calendar, Info, Layers } from 'lucide-react';
import { PhysicalAssessment } from '../../types';
import { formatDateBR } from '../../utils/formatters';
import { getClassificationBadgeColor } from '../../utils/whoBmiClassification';

interface BmiEvolutionChartProps {
  assessments: PhysicalAssessment[];
  studentBirthDate?: string;
  onOpenNewMeasurement?: () => void;
}

export const BmiEvolutionChart: React.FC<BmiEvolutionChartProps> = ({
  assessments,
  onOpenNewMeasurement,
}) => {
  const [filterMode, setFilterMode] = useState<'last10' | 'all'>('last10');
  const [hoveredPoint, setHoveredPoint] = useState<{
    assessment: PhysicalAssessment;
    x: number;
    y: number;
  } | null>(null);

  // Ordenar cronologicamente de forma ascendente (mais antiga para mais recente)
  const sortedAssessments = useMemo(() => {
    return [...assessments].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
  }, [assessments]);

  // Se houver mais de 10 medições, permitir alternar entre as últimas 10 e todas
  const displayedAssessments = useMemo(() => {
    if (sortedAssessments.length > 10 && filterMode === 'last10') {
      return sortedAssessments.slice(-10);
    }
    return sortedAssessments;
  }, [sortedAssessments, filterMode]);

  // Se não houver medições
  if (assessments.length === 0) {
    return (
      <div className="p-8 rounded-xl border border-slate-800 bg-slate-950/60 text-center space-y-3">
        <div className="inline-flex p-3 rounded-full bg-slate-900 border border-slate-800 text-slate-400">
          <TrendingUp className="h-6 w-6 text-slate-500" />
        </div>
        <h4 className="text-sm font-semibold text-slate-200">Evolução do IMC</h4>
        <p className="text-xs text-slate-400 max-w-sm mx-auto">
          Nenhuma medição antropométrica registrada para este aluno até o momento.
        </p>
        {onOpenNewMeasurement && (
          <button
            onClick={onOpenNewMeasurement}
            className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold shadow transition-colors cursor-pointer"
          >
            Registrar primeira medição
          </button>
        )}
      </div>
    );
  }

  // Dimensões do SVG
  const width = 640;
  const height = 240;
  const padding = { top: 28, right: 30, bottom: 40, left: 45 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Escalas de IMC (mínimo e máximo para visualização)
  const bmiValues = displayedAssessments.map((a) => a.bmi);
  const minBmiRaw = Math.min(...bmiValues);
  const maxBmiRaw = Math.max(...bmiValues);
  const minBmi = Math.max(10, Math.floor(minBmiRaw - 2));
  const maxBmi = Math.max(minBmi + 4, Math.ceil(maxBmiRaw + 2));

  const getY = (val: number) => {
    const ratio = (val - minBmi) / (maxBmi - minBmi || 1);
    return padding.top + chartHeight - ratio * chartHeight;
  };

  const getX = (index: number) => {
    if (displayedAssessments.length === 1) {
      return padding.left + chartWidth / 2;
    }
    return padding.left + (index / (displayedAssessments.length - 1)) * chartWidth;
  };

  const points = displayedAssessments.map((item, idx) => ({
    x: getX(idx),
    y: getY(item.bmi),
    assessment: item,
  }));

  const linePath =
    points.length > 1
      ? points.reduce((acc, curr, idx) => `${acc} ${idx === 0 ? 'M' : 'L'} ${curr.x} ${curr.y}`, '')
      : '';

  const areaPath =
    points.length > 1
      ? `${linePath} L ${points[points.length - 1].x} ${padding.top + chartHeight} L ${points[0].x} ${padding.top + chartHeight} Z`
      : '';

  // Guias de referência padrão de IMC (eixo Y)
  const yTicks = [
    minBmi,
    Math.round(minBmi + (maxBmi - minBmi) * 0.33),
    Math.round(minBmi + (maxBmi - minBmi) * 0.66),
    maxBmi,
  ];

  return (
    <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/70 space-y-3 relative">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-red-950/60 border border-red-500/30 text-red-400">
            <TrendingUp className="h-4 w-4" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white tracking-tight">Evolução do IMC</h4>
            <p className="text-[11px] text-slate-400">
              Trajetória ponderal e índice de massa corporal ao longo do histórico de treinos
            </p>
          </div>
        </div>

        {sortedAssessments.length > 10 && (
          <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-lg border border-slate-800 text-[11px]">
            <button
              type="button"
              onClick={() => setFilterMode('last10')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                filterMode === 'last10'
                  ? 'bg-red-600 text-white font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Últimas 10
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('all')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                filterMode === 'all'
                  ? 'bg-red-600 text-white font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Todas ({sortedAssessments.length})
            </button>
          </div>
        )}
      </div>

      {displayedAssessments.length === 1 && (
        <div className="text-[11px] text-slate-400 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800 flex items-center gap-2">
          <Info className="h-4 w-4 text-sky-400 shrink-0" />
          <span>
            1 medição registrada. Registre novas medições ao longo dos treinos para acompanhar a curva de tendência.
          </span>
        </div>
      )}

      {/* Container responsivo do SVG */}
      <div className="w-full overflow-x-auto relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto min-w-[500px] select-none"
        >
          <defs>
            <linearGradient id="bmiGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#ef4444" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Linhas de Grade e Eixo Y */}
          {yTicks.map((tickVal, i) => {
            const y = getY(tickVal);
            return (
              <g key={i}>
                <line
                  x1={padding.left}
                  y1={y}
                  x2={width - padding.right}
                  y2={y}
                  stroke="#334155"
                  strokeDasharray="3 3"
                  strokeWidth="0.8"
                />
                <text
                  x={padding.left - 8}
                  y={y + 3}
                  textAnchor="end"
                  fill="#94a3b8"
                  fontSize="10"
                  fontFamily="monospace"
                >
                  {tickVal.toFixed(1)}
                </text>
              </g>
            );
          })}

          {/* Linha de base do gráfico */}
          <line
            x1={padding.left}
            y1={padding.top + chartHeight}
            x2={width - padding.right}
            y2={padding.top + chartHeight}
            stroke="#475569"
            strokeWidth="1"
          />

          {/* Preenchimento de área */}
          {areaPath && (
            <path d={areaPath} fill="url(#bmiGradient)" />
          )}

          {/* Linha principal */}
          {linePath && (
            <path
              d={linePath}
              fill="none"
              stroke="#ef4444"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Pontos clicáveis / hover */}
          {points.map((pt, idx) => {
            const isHovered = hoveredPoint?.assessment.id === pt.assessment.id;
            return (
              <g key={pt.assessment.id || idx}>
                {/* Linha vertical no hover */}
                {isHovered && (
                  <line
                    x1={pt.x}
                    y1={padding.top}
                    x2={pt.x}
                    y2={padding.top + chartHeight}
                    stroke="#ef4444"
                    strokeDasharray="2 2"
                    strokeWidth="1"
                    opacity="0.8"
                  />
                )}
                {/* Círculo do ponto */}
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={isHovered ? 6 : 4}
                  fill="#ffffff"
                  stroke="#ef4444"
                  strokeWidth={isHovered ? 3 : 2}
                  className="transition-all cursor-pointer"
                  onMouseEnter={() =>
                    setHoveredPoint({
                      assessment: pt.assessment,
                      x: pt.x,
                      y: pt.y,
                    })
                  }
                  onMouseLeave={() => setHoveredPoint(null)}
                />

                {/* Rótulo de data no eixo X */}
                <text
                  x={pt.x}
                  y={padding.top + chartHeight + 16}
                  textAnchor="middle"
                  fill="#94a3b8"
                  fontSize="9.5"
                  fontFamily="monospace"
                >
                  {formatDateBR(pt.assessment.date).substring(0, 5)}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Tooltip interativo posicionado em HTML absoluto */}
        {hoveredPoint && (
          <div
            className="absolute z-20 pointer-events-none transform -translate-x-1/2 -translate-y-full bg-slate-900/95 border border-slate-700/80 shadow-2xl rounded-lg p-2.5 text-xs text-white min-w-[190px] backdrop-blur-sm"
            style={{
              left: `${(hoveredPoint.x / width) * 100}%`,
              top: `${(hoveredPoint.y / height) * 100}%`,
              marginTop: '-12px',
            }}
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 mb-1.5">
              <span className="font-semibold text-slate-300 flex items-center gap-1">
                <Calendar className="h-3 w-3 text-red-400" />
                {formatDateBR(hoveredPoint.assessment.date)}
              </span>
              <span className="font-mono text-[10px] text-slate-400">
                {hoveredPoint.assessment.ageYearsAtMeasurement != null
                  ? `${hoveredPoint.assessment.ageYearsAtMeasurement}a ${
                      hoveredPoint.assessment.ageMonthsAtMeasurement != null
                        ? `${hoveredPoint.assessment.ageMonthsAtMeasurement}m`
                        : ''
                    }`
                  : ''}
              </span>
            </div>

            <div className="space-y-1 font-mono text-[11px]">
              <div className="flex justify-between">
                <span className="text-slate-400">Peso:</span>
                <span className="text-white font-bold">{hoveredPoint.assessment.weightKg} kg</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Altura:</span>
                <span className="text-white">
                  {hoveredPoint.assessment.heightCm} cm ({(hoveredPoint.assessment.heightCm / 100).toFixed(2)} m)
                </span>
              </div>
              <div className="flex justify-between pt-1 border-t border-slate-800/80 items-center">
                <span className="text-slate-300 font-semibold font-sans">IMC:</span>
                <span className="text-sm font-bold text-emerald-400">
                  {hoveredPoint.assessment.bmi} kg/m²
                </span>
              </div>
            </div>

            {hoveredPoint.assessment.classification && (
              <div className="mt-2 pt-1 border-t border-slate-800 flex items-center justify-between">
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${getClassificationBadgeColor(
                    hoveredPoint.assessment.classification
                  )}`}
                >
                  {hoveredPoint.assessment.classification}
                </span>
                {hoveredPoint.assessment.referenceStandard && (
                  <span className="text-[9px] text-slate-400">
                    {hoveredPoint.assessment.referenceStandard === 'who_growth_reference' ? 'OMS' : 'Adulto'}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1">
        <span>Eixo horizontal: Data da medição</span>
        <span>Eixo vertical: IMC (kg/m²)</span>
      </div>
    </div>
  );
};
