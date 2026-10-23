/**
 * TatameHub — Classificação Antropométrica e IMC
 * 
 * Referências Oficiais Internacionais Utilizadas:
 * 1. Adultos (>= 20 anos):
 *    - Organização Mundial da Saúde (OMS / WHO)
 *    - Padrão internacional de corte (18.5, 25.0, 30.0, 35.0, 40.0)
 * 2. Crianças e Adolescentes (5 a 19 anos):
 *    - WHO Growth Reference Data for 5-19 years (2007) — Indicador BMI-for-age
 * 3. Menores de 5 anos (0 a 60 meses):
 *    - WHO Child Growth Standards (2006) — Indicador BMI-for-age
 * 4. Idosos (>= 60 anos):
 *    - Alerta de triagem geriátrica (cautela clínica e referência auxiliar Lipschitz / OPAS)
 */

export interface ExactAgeResult {
  years: number;
  months: number;
  days: number;
  totalMonths: number;
  formattedText: string;
  formatted: string;
  isValid: boolean;
  isBeforeBirth?: boolean;
}

export type BmiCategory =
  | 'severe_thinness'
  | 'thinness'
  | 'normal'
  | 'overweight'
  | 'obese_1'
  | 'obese_2'
  | 'obese_3';

export interface BmiClassificationResult {
  bmi: number;
  classification: string;
  category: BmiCategory;
  referenceStandard: string;
  referenceStandardLabel: string;
  ageYears: number;
  ageYearsAtMeasurement?: number;
  ageMonths: number;
  ageMonthsAtMeasurement?: number;
  exactAgeText: string;
  isPediatric: boolean;
  isSenior: boolean;
  isElderly?: boolean;
  warning?: string;
  colorClass: string;
  bgClass: string;
  borderClass: string;
  missingDataReason?: string;
}

/**
 * Calcula a idade exata (anos, meses e dias) entre a data de nascimento e a data da medição.
 */
export function calculateExactAge(
  birthDateStr?: string | null,
  measurementDateStr?: string | null
): ExactAgeResult {
  if (!birthDateStr) {
    return {
      years: 0,
      months: 0,
      days: 0,
      totalMonths: 0,
      formattedText: 'Data de nascimento não informada',
      formatted: 'Data de nascimento não informada',
      isValid: false,
    };
  }

  try {
    const birth = new Date(birthDateStr + (birthDateStr.length === 10 ? 'T12:00:00' : ''));
    if (isNaN(birth.getTime())) {
      return {
        years: 0,
        months: 0,
        days: 0,
        totalMonths: 0,
        formattedText: 'Data de nascimento inválida',
        formatted: 'Data de nascimento inválida',
        isValid: false,
      };
    }

    const measureDate = measurementDateStr
      ? new Date(measurementDateStr + (measurementDateStr.length === 10 ? 'T12:00:00' : ''))
      : new Date();
    if (isNaN(measureDate.getTime())) {
      return {
        years: 0,
        months: 0,
        days: 0,
        totalMonths: 0,
        formattedText: 'Data de medição inválida',
        formatted: 'Data de medição inválida',
        isValid: false,
      };
    }

    if (measureDate < birth) {
      return {
        years: 0,
        months: 0,
        days: 0,
        totalMonths: 0,
        formattedText: 'Data de medição anterior ao nascimento',
        formatted: 'Data de medição anterior ao nascimento',
        isValid: false,
        isBeforeBirth: true,
      };
    }

    let years = measureDate.getFullYear() - birth.getFullYear();
    let months = measureDate.getMonth() - birth.getMonth();
    let days = measureDate.getDate() - birth.getDate();

    if (days < 0) {
      months--;
      const prevMonth = new Date(measureDate.getFullYear(), measureDate.getMonth(), 0);
      days += prevMonth.getDate();
    }

    if (months < 0) {
      years--;
      months += 12;
    }

    const totalMonths = years * 12 + months;

    let formattedText = '';
    if (years === 0) {
      formattedText = `${months} ${months === 1 ? 'mês' : 'meses'}`;
    } else if (months === 0) {
      formattedText = `${years} ${years === 1 ? 'ano' : 'anos'}`;
    } else {
      formattedText = `${years} ${years === 1 ? 'ano' : 'anos'} e ${months} ${months === 1 ? 'mês' : 'meses'}`;
    }

    return {
      years,
      months,
      days,
      totalMonths,
      formattedText,
      formatted: formattedText,
      isValid: true,
      isBeforeBirth: false,
    };
  } catch {
    return {
      years: 0,
      months: 0,
      days: 0,
      totalMonths: 0,
      formattedText: 'Erro ao calcular idade',
      formatted: 'Erro ao calcular idade',
      isValid: false,
    };
  }
}

/**
 * Tabela simplificada consolidada dos pontos de corte em Desvios Padrão (DP) da OMS (2007 e 2006)
 * para IMC por idade e sexo.
 */
export interface WhoBmiCutoff {
  sdNeg3: number;
  sdNeg2: number;
  sdNeg1: number;
  median: number;
  sdPlus1: number;
  sdPlus2: number;
  sdPlus3: number;
}

export const WHO_BOYS_BMI_CUTOFFS: Record<number, WhoBmiCutoff> = {
  0: { sdNeg3: 11.1, sdNeg2: 12.2, sdNeg1: 13.4, median: 14.8, sdPlus1: 16.3, sdPlus2: 18.1, sdPlus3: 20.2 },
  1: { sdNeg3: 13.0, sdNeg2: 14.1, sdNeg1: 15.3, median: 16.8, sdPlus1: 18.4, sdPlus2: 20.3, sdPlus3: 22.5 },
  2: { sdNeg3: 12.8, sdNeg2: 13.9, sdNeg1: 15.0, median: 16.4, sdPlus1: 17.9, sdPlus2: 19.6, sdPlus3: 21.6 },
  3: { sdNeg3: 12.4, sdNeg2: 13.5, sdNeg1: 14.6, median: 15.9, sdPlus1: 17.4, sdPlus2: 19.0, sdPlus3: 20.9 },
  4: { sdNeg3: 12.1, sdNeg2: 13.2, sdNeg1: 14.3, median: 15.5, sdPlus1: 17.0, sdPlus2: 18.6, sdPlus3: 20.5 },
  5: { sdNeg3: 12.1, sdNeg2: 13.0, sdNeg1: 14.1, median: 15.3, sdPlus1: 16.6, sdPlus2: 18.3, sdPlus3: 20.2 },
  6: { sdNeg3: 12.1, sdNeg2: 13.0, sdNeg1: 14.1, median: 15.3, sdPlus1: 16.8, sdPlus2: 18.5, sdPlus3: 20.6 },
  7: { sdNeg3: 12.3, sdNeg2: 13.1, sdNeg1: 14.2, median: 15.5, sdPlus1: 17.0, sdPlus2: 19.0, sdPlus3: 21.3 },
  8: { sdNeg3: 12.4, sdNeg2: 13.3, sdNeg1: 14.4, median: 15.7, sdPlus1: 17.4, sdPlus2: 19.7, sdPlus3: 22.2 },
  9: { sdNeg3: 12.6, sdNeg2: 13.5, sdNeg1: 14.6, median: 16.1, sdPlus1: 17.9, sdPlus2: 20.5, sdPlus3: 23.3 },
  10: { sdNeg3: 12.8, sdNeg2: 13.7, sdNeg1: 14.9, median: 16.4, sdPlus1: 18.5, sdPlus2: 21.4, sdPlus3: 24.5 },
  11: { sdNeg3: 13.1, sdNeg2: 14.1, sdNeg1: 15.3, median: 16.9, sdPlus1: 19.2, sdPlus2: 22.5, sdPlus3: 25.8 },
  12: { sdNeg3: 13.4, sdNeg2: 14.5, sdNeg1: 15.8, median: 17.5, sdPlus1: 20.0, sdPlus2: 23.6, sdPlus3: 27.2 },
  13: { sdNeg3: 13.8, sdNeg2: 14.9, sdNeg1: 16.4, median: 18.2, sdPlus1: 20.8, sdPlus2: 24.8, sdPlus3: 28.7 },
  14: { sdNeg3: 14.3, sdNeg2: 15.5, sdNeg1: 17.0, median: 19.0, sdPlus1: 21.8, sdPlus2: 25.9, sdPlus3: 30.1 },
  15: { sdNeg3: 14.7, sdNeg2: 16.0, sdNeg1: 17.6, median: 19.8, sdPlus1: 22.7, sdPlus2: 27.0, sdPlus3: 31.5 },
  16: { sdNeg3: 15.1, sdNeg2: 16.5, sdNeg1: 18.2, median: 20.5, sdPlus1: 23.5, sdPlus2: 27.9, sdPlus3: 32.7 },
  17: { sdNeg3: 15.4, sdNeg2: 16.9, sdNeg1: 18.8, median: 21.1, sdPlus1: 24.3, sdPlus2: 28.8, sdPlus3: 33.7 },
  18: { sdNeg3: 15.7, sdNeg2: 17.3, sdNeg1: 19.2, median: 21.7, sdPlus1: 24.9, sdPlus2: 29.5, sdPlus3: 34.6 },
  19: { sdNeg3: 15.8, sdNeg2: 17.6, sdNeg1: 19.6, median: 22.2, sdPlus1: 25.4, sdPlus2: 30.0, sdPlus3: 35.4 },
};

export const WHO_GIRLS_BMI_CUTOFFS: Record<number, WhoBmiCutoff> = {
  0: { sdNeg3: 10.9, sdNeg2: 12.0, sdNeg1: 13.2, median: 14.6, sdPlus1: 16.1, sdPlus2: 17.9, sdPlus3: 20.0 },
  1: { sdNeg3: 12.7, sdNeg2: 13.8, sdNeg1: 15.0, median: 16.4, sdPlus1: 18.0, sdPlus2: 19.9, sdPlus3: 22.0 },
  2: { sdNeg3: 12.5, sdNeg2: 13.5, sdNeg1: 14.6, median: 16.0, sdPlus1: 17.5, sdPlus2: 19.2, sdPlus3: 21.2 },
  3: { sdNeg3: 12.1, sdNeg2: 13.1, sdNeg1: 14.2, median: 15.5, sdPlus1: 17.0, sdPlus2: 18.7, sdPlus3: 20.6 },
  4: { sdNeg3: 11.8, sdNeg2: 12.8, sdNeg1: 13.9, median: 15.2, sdPlus1: 16.7, sdPlus2: 18.4, sdPlus3: 20.4 },
  5: { sdNeg3: 11.8, sdNeg2: 12.7, sdNeg1: 13.8, median: 15.2, sdPlus1: 16.9, sdPlus2: 18.9, sdPlus3: 21.3 },
  6: { sdNeg3: 11.7, sdNeg2: 12.7, sdNeg1: 13.9, median: 15.3, sdPlus1: 17.0, sdPlus2: 19.2, sdPlus3: 21.9 },
  7: { sdNeg3: 11.8, sdNeg2: 12.7, sdNeg1: 14.0, median: 15.4, sdPlus1: 17.3, sdPlus2: 19.8, sdPlus3: 22.7 },
  8: { sdNeg3: 11.9, sdNeg2: 12.9, sdNeg1: 14.1, median: 15.7, sdPlus1: 17.7, sdPlus2: 20.6, sdPlus3: 23.9 },
  9: { sdNeg3: 12.1, sdNeg2: 13.1, sdNeg1: 14.4, median: 16.1, sdPlus1: 18.3, sdPlus2: 21.5, sdPlus3: 25.2 },
  10: { sdNeg3: 12.4, sdNeg2: 13.5, sdNeg1: 14.8, median: 16.6, sdPlus1: 19.0, sdPlus2: 22.6, sdPlus3: 26.6 },
  11: { sdNeg3: 12.7, sdNeg2: 13.9, sdNeg1: 15.3, median: 17.2, sdPlus1: 19.9, sdPlus2: 23.7, sdPlus3: 28.0 },
  12: { sdNeg3: 13.2, sdNeg2: 14.4, sdNeg1: 16.0, median: 18.0, sdPlus1: 20.8, sdPlus2: 25.0, sdPlus3: 29.5 },
  13: { sdNeg3: 13.6, sdNeg2: 14.9, sdNeg1: 16.6, median: 18.8, sdPlus1: 21.8, sdPlus2: 26.2, sdPlus3: 31.0 },
  14: { sdNeg3: 14.0, sdNeg2: 15.4, sdNeg1: 17.2, median: 19.6, sdPlus1: 22.7, sdPlus2: 27.3, sdPlus3: 32.3 },
  15: { sdNeg3: 14.4, sdNeg2: 15.9, sdNeg1: 17.8, median: 20.2, sdPlus1: 23.5, sdPlus2: 28.2, sdPlus3: 33.3 },
  16: { sdNeg3: 14.6, sdNeg2: 16.2, sdNeg1: 18.2, median: 20.7, sdPlus1: 24.1, sdPlus2: 28.9, sdPlus3: 34.0 },
  17: { sdNeg3: 14.7, sdNeg2: 16.4, sdNeg1: 18.4, median: 21.0, sdPlus1: 24.5, sdPlus2: 29.3, sdPlus3: 34.4 },
  18: { sdNeg3: 14.7, sdNeg2: 16.4, sdNeg1: 18.6, median: 21.3, sdPlus1: 24.8, sdPlus2: 29.5, sdPlus3: 34.7 },
  19: { sdNeg3: 14.7, sdNeg2: 16.5, sdNeg1: 18.7, median: 21.4, sdPlus1: 25.0, sdPlus2: 29.7, sdPlus3: 34.7 },
};

// Aliases para compatibilidade de testes
export const WHO_BOYS_5_19 = WHO_BOYS_BMI_CUTOFFS;
export const WHO_GIRLS_5_19 = WHO_GIRLS_BMI_CUTOFFS;

/**
 * Classifica o IMC conforme referências internacionais oficiais (OMS Pediátrica e OMS Adultos).
 * Suporta chamada como objeto de parâmetros ou parâmetros posicionais:
 * - classifyBmi({ weightKg, heightCm, birthDate, gender, measurementDate })
 * - classifyBmi(bmi, birthDate, gender, measurementDate)
 */
export function classifyBmi(
  arg1: any,
  arg2?: any,
  arg3?: any,
  arg4?: any
): BmiClassificationResult {
  let bmi = 0;
  let weightKg: number | undefined;
  let heightCm: number | undefined;
  let birthDate: string | null | undefined;
  let gender: string | undefined;
  let measurementDate: string | null | undefined;

  if (typeof arg1 === 'object' && arg1 !== null) {
    weightKg = arg1.weightKg;
    heightCm = arg1.heightCm;
    bmi = arg1.bmi || 0;
    birthDate = arg1.birthDate;
    gender = arg1.gender;
    measurementDate = arg1.measurementDate || arg1.date;
  } else if (typeof arg1 === 'number') {
    if (typeof arg2 === 'number') {
      weightKg = arg1;
      heightCm = arg2;
      birthDate = arg3;
      gender = arg4;
    } else {
      bmi = arg1;
      birthDate = arg2;
      gender = arg3;
      measurementDate = arg4;
    }
  }

  // Se peso e altura informados mas não bmi
  if ((!bmi || isNaN(bmi) || bmi <= 0) && weightKg && heightCm && heightCm > 0) {
    const heightM = heightCm / 100;
    bmi = Number((weightKg / (heightM * heightM)).toFixed(1));
  }

  if (bmi <= 0 && (!weightKg || !heightCm || weightKg <= 0 || heightCm <= 0)) {
    return {
      bmi: 0,
      classification: 'Dados biométricos insuficientes',
      category: 'normal',
      referenceStandard: 'none',
      referenceStandardLabel: 'Não avaliado',
      ageYears: 0,
      ageYearsAtMeasurement: 0,
      ageMonths: 0,
      ageMonthsAtMeasurement: 0,
      exactAgeText: '-',
      isPediatric: false,
      isSenior: false,
      colorClass: 'text-slate-400',
      bgClass: 'bg-slate-800',
      borderClass: 'border-slate-700',
      missingDataReason: 'Peso e altura devem ser valores positivos maiores que zero.',
    };
  }

  // 2. Determinação da Idade na data da medição
  const ageResult = calculateExactAge(birthDate, measurementDate);

  if (!ageResult.isValid) {
    // Aluno sem data de nascimento: aplicar referência geral de adultos
    let adultClass = 'Eutrofia (Peso adequado)';
    let cat: BmiCategory = 'normal';
    let colorClass = 'text-emerald-400';
    let bgClass = 'bg-emerald-950/60';
    let borderClass = 'border-emerald-500/40';

    if (bmi < 18.5) {
      adultClass = 'Magreza';
      cat = 'thinness';
      colorClass = 'text-amber-400';
      bgClass = 'bg-amber-950/60';
      borderClass = 'border-amber-500/40';
    } else if (bmi >= 25 && bmi < 30) {
      adultClass = 'Sobrepeso';
      cat = 'overweight';
      colorClass = 'text-amber-400';
      bgClass = 'bg-amber-950/60';
      borderClass = 'border-amber-500/40';
    } else if (bmi >= 30 && bmi < 35) {
      adultClass = 'Obesidade Grau I';
      cat = 'obese_1';
      colorClass = 'text-orange-400';
      bgClass = 'bg-orange-950/60';
      borderClass = 'border-orange-500/40';
    } else if (bmi >= 35 && bmi < 40) {
      adultClass = 'Obesidade Grau II';
      cat = 'obese_2';
      colorClass = 'text-red-400';
      bgClass = 'bg-red-950/60';
      borderClass = 'border-red-500/40';
    } else if (bmi >= 40) {
      adultClass = 'Obesidade Grau III';
      cat = 'obese_3';
      colorClass = 'text-purple-400';
      bgClass = 'bg-purple-950/60';
      borderClass = 'border-purple-500/40';
    }

    return {
      bmi,
      classification: adultClass,
      category: cat,
      referenceStandard: 'who_adult',
      referenceStandardLabel: 'Padrão Adulto OMS (Referência Provisória)',
      ageYears: 0,
      ageYearsAtMeasurement: 0,
      ageMonths: 0,
      ageMonthsAtMeasurement: 0,
      exactAgeText: 'Data de nascimento não cadastrada',
      isPediatric: false,
      isSenior: false,
      warning: 'Data de nascimento não informada. Foi aplicada a referência geral de adultos como estimativa provisória.',
      colorClass,
      bgClass,
      borderClass,
      missingDataReason: 'É necessário preencher a data de nascimento no cadastro do aluno para calcular a idade exata e aplicar o padrão pediátrico OMS.',
    };
  }

  const { years, months, formattedText } = ageResult;
  const isPediatric = years < 20;
  const isSenior = years >= 60;

  // 3. Classificação Pediátrica (0 a 19 anos) pela OMS
  if (isPediatric) {
    const isFemale = gender === 'female';
    const cutoffsTable = isFemale ? WHO_GIRLS_BMI_CUTOFFS : WHO_BOYS_BMI_CUTOFFS;
    const clampedYear = Math.min(19, Math.max(0, years));
    const cutoffs = cutoffsTable[clampedYear] || cutoffsTable[19];

    const refStandard = years < 5 ? 'who_child_growth_standards' : 'who_growth_reference';
    const refLabel = years < 5
      ? 'Padrão Infantil OMS 2006 (0 a 5 anos)'
      : 'Referência de Crescimento OMS 2007 (5 a 19 anos)';

    if (years >= 5) {
      // Regras OMS 5-19 anos:
      // < -3 DP: Magreza acentuada
      // entre -3 DP e -2 DP: Magreza
      // entre -2 DP e +1 DP: Eutrofia (Peso adequado)
      // > +1 DP a +2 DP: Sobrepeso
      // > +2 DP a +3 DP: Obesidade
      // > +3 DP: Obesidade grave
      if (bmi < cutoffs.sdNeg3) {
        return {
          bmi,
          classification: 'Magreza acentuada',
          category: 'severe_thinness',
          referenceStandard: refStandard,
          referenceStandardLabel: refLabel,
          ageYears: years,
          ageYearsAtMeasurement: years,
          ageMonths: months,
          ageMonthsAtMeasurement: months,
          exactAgeText: formattedText,
          isPediatric: true,
          isSenior: false,
          colorClass: 'text-rose-400',
          bgClass: 'bg-rose-950/60',
          borderClass: 'border-rose-500/40',
        };
      }
      if (bmi < cutoffs.sdNeg2) {
        return {
          bmi,
          classification: 'Magreza',
          category: 'thinness',
          referenceStandard: refStandard,
          referenceStandardLabel: refLabel,
          ageYears: years,
          ageYearsAtMeasurement: years,
          ageMonths: months,
          ageMonthsAtMeasurement: months,
          exactAgeText: formattedText,
          isPediatric: true,
          isSenior: false,
          colorClass: 'text-amber-400',
          bgClass: 'bg-amber-950/60',
          borderClass: 'border-amber-500/40',
        };
      }
      if (bmi <= cutoffs.sdPlus1) {
        return {
          bmi,
          classification: 'Eutrofia (Peso adequado)',
          category: 'normal',
          referenceStandard: refStandard,
          referenceStandardLabel: refLabel,
          ageYears: years,
          ageYearsAtMeasurement: years,
          ageMonths: months,
          ageMonthsAtMeasurement: months,
          exactAgeText: formattedText,
          isPediatric: true,
          isSenior: false,
          colorClass: 'text-emerald-400',
          bgClass: 'bg-emerald-950/60',
          borderClass: 'border-emerald-500/40',
        };
      }
      if (bmi <= cutoffs.sdPlus2) {
        return {
          bmi,
          classification: 'Sobrepeso',
          category: 'overweight',
          referenceStandard: refStandard,
          referenceStandardLabel: refLabel,
          ageYears: years,
          ageYearsAtMeasurement: years,
          ageMonths: months,
          ageMonthsAtMeasurement: months,
          exactAgeText: formattedText,
          isPediatric: true,
          isSenior: false,
          colorClass: 'text-amber-400',
          bgClass: 'bg-amber-950/60',
          borderClass: 'border-amber-500/40',
        };
      }
      if (bmi <= cutoffs.sdPlus3) {
        return {
          bmi,
          classification: 'Obesidade',
          category: 'obese_1',
          referenceStandard: refStandard,
          referenceStandardLabel: refLabel,
          ageYears: years,
          ageYearsAtMeasurement: years,
          ageMonths: months,
          ageMonthsAtMeasurement: months,
          exactAgeText: formattedText,
          isPediatric: true,
          isSenior: false,
          colorClass: 'text-red-400',
          bgClass: 'bg-red-950/60',
          borderClass: 'border-red-500/40',
        };
      }
      return {
        bmi,
        classification: 'Obesidade grave',
        category: 'obese_2',
        referenceStandard: refStandard,
        referenceStandardLabel: refLabel,
        ageYears: years,
        ageYearsAtMeasurement: years,
        ageMonths: months,
        ageMonthsAtMeasurement: months,
        exactAgeText: formattedText,
        isPediatric: true,
        isSenior: false,
        colorClass: 'text-purple-400',
        bgClass: 'bg-purple-950/60',
        borderClass: 'border-purple-500/40',
      };
    } else {
      // Regras OMS 0-5 anos:
      if (bmi < cutoffs.sdNeg3) {
        return {
          bmi,
          classification: 'Magreza acentuada',
          category: 'severe_thinness',
          referenceStandard: refStandard,
          referenceStandardLabel: refLabel,
          ageYears: years,
          ageYearsAtMeasurement: years,
          ageMonths: months,
          ageMonthsAtMeasurement: months,
          exactAgeText: formattedText,
          isPediatric: true,
          isSenior: false,
          colorClass: 'text-rose-400',
          bgClass: 'bg-rose-950/60',
          borderClass: 'border-rose-500/40',
        };
      }
      if (bmi < cutoffs.sdNeg2) {
        return {
          bmi,
          classification: 'Magreza',
          category: 'thinness',
          referenceStandard: refStandard,
          referenceStandardLabel: refLabel,
          ageYears: years,
          ageYearsAtMeasurement: years,
          ageMonths: months,
          ageMonthsAtMeasurement: months,
          exactAgeText: formattedText,
          isPediatric: true,
          isSenior: false,
          colorClass: 'text-amber-400',
          bgClass: 'bg-amber-950/60',
          borderClass: 'border-amber-500/40',
        };
      }
      if (bmi <= cutoffs.sdPlus1) {
        return {
          bmi,
          classification: 'Eutrofia (Peso adequado)',
          category: 'normal',
          referenceStandard: refStandard,
          referenceStandardLabel: refLabel,
          ageYears: years,
          ageYearsAtMeasurement: years,
          ageMonths: months,
          ageMonthsAtMeasurement: months,
          exactAgeText: formattedText,
          isPediatric: true,
          isSenior: false,
          colorClass: 'text-emerald-400',
          bgClass: 'bg-emerald-950/60',
          borderClass: 'border-emerald-500/40',
        };
      }
      if (bmi <= cutoffs.sdPlus2) {
        return {
          bmi,
          classification: 'Risco de sobrepeso',
          category: 'overweight',
          referenceStandard: refStandard,
          referenceStandardLabel: refLabel,
          ageYears: years,
          ageYearsAtMeasurement: years,
          ageMonths: months,
          ageMonthsAtMeasurement: months,
          exactAgeText: formattedText,
          isPediatric: true,
          isSenior: false,
          colorClass: 'text-amber-400',
          bgClass: 'bg-amber-950/60',
          borderClass: 'border-amber-500/40',
        };
      }
      if (bmi <= cutoffs.sdPlus3) {
        return {
          bmi,
          classification: 'Sobrepeso',
          category: 'obese_1',
          referenceStandard: refStandard,
          referenceStandardLabel: refLabel,
          ageYears: years,
          ageYearsAtMeasurement: years,
          ageMonths: months,
          ageMonthsAtMeasurement: months,
          exactAgeText: formattedText,
          isPediatric: true,
          isSenior: false,
          colorClass: 'text-red-400',
          bgClass: 'bg-red-950/60',
          borderClass: 'border-red-500/40',
        };
      }
      return {
        bmi,
        classification: 'Obesidade infantil',
        category: 'obese_2',
        referenceStandard: refStandard,
        referenceStandardLabel: refLabel,
        ageYears: years,
        ageYearsAtMeasurement: years,
        ageMonths: months,
        ageMonthsAtMeasurement: months,
        exactAgeText: formattedText,
        isPediatric: true,
        isSenior: false,
        colorClass: 'text-purple-400',
        bgClass: 'bg-purple-950/60',
        borderClass: 'border-purple-500/40',
      };
    }
  }

  // 4. Classificação Adultos (>= 20 anos) pela OMS
  let adultClass = 'Eutrofia (Peso adequado)';
  let cat: BmiCategory = 'normal';
  let colorClass = 'text-emerald-400';
  let bgClass = 'bg-emerald-950/60';
  let borderClass = 'border-emerald-500/40';

  if (bmi < 18.5) {
    adultClass = 'Magreza';
    cat = 'thinness';
    colorClass = 'text-amber-400';
    bgClass = 'bg-amber-950/60';
    borderClass = 'border-amber-500/40';
  } else if (bmi >= 25 && bmi < 30) {
    adultClass = 'Sobrepeso';
    cat = 'overweight';
    colorClass = 'text-amber-400';
    bgClass = 'bg-amber-950/60';
    borderClass = 'border-amber-500/40';
  } else if (bmi >= 30 && bmi < 35) {
    adultClass = 'Obesidade Grau I';
    cat = 'obese_1';
    colorClass = 'text-orange-400';
    bgClass = 'bg-orange-950/60';
    borderClass = 'border-orange-500/40';
  } else if (bmi >= 35 && bmi < 40) {
    adultClass = 'Obesidade Grau II';
    cat = 'obese_2';
    colorClass = 'text-red-400';
    bgClass = 'bg-red-950/60';
    borderClass = 'border-red-500/40';
  } else if (bmi >= 40) {
    adultClass = 'Obesidade Grau III';
    cat = 'obese_3';
    colorClass = 'text-purple-400';
    bgClass = 'bg-purple-950/60';
    borderClass = 'border-purple-500/40';
  }

  let warning: string | undefined;
  if (isSenior) {
    warning =
      'Alerta de triagem geriátrica: Em pessoas com 60 anos ou mais, os pontos de corte padrão de adultos devem ser interpretados com cautela clínica (critério de Lipschitz/OPAS recomenda atenção especial à sarcopenia e perda de massa magra).';
  }

  return {
    bmi,
    classification: adultClass,
    category: cat,
    referenceStandard: 'who_adult',
    referenceStandardLabel: isSenior ? 'Padrão Adulto OMS (Interpretação Geriátrica)' : 'Padrão Adulto OMS',
    ageYears: years,
    ageYearsAtMeasurement: years,
    ageMonths: months,
    ageMonthsAtMeasurement: months,
    exactAgeText: formattedText,
    isPediatric: false,
    isSenior,
    isElderly: isSenior,
    warning,
    colorClass,
    bgClass,
    borderClass,
  };
}

/**
 * Retorna classes CSS de cores para badges com base na classificação textual.
 */
export function getClassificationBadgeColor(classification?: string): string {
  if (!classification) return 'bg-slate-800 text-slate-400 border-slate-700';

  const text = classification.toLowerCase();

  if (text.includes('adequado') || text.includes('eutrofia')) {
    return 'bg-emerald-950/80 text-emerald-400 border-emerald-500/40';
  }
  if (text.includes('sobrepeso') || text.includes('risco')) {
    return 'bg-amber-950/80 text-amber-400 border-amber-500/40';
  }
  if (text.includes('grau i') || (text.includes('obesidade') && !text.includes('grave') && !text.includes('grau ii') && !text.includes('grau iii'))) {
    return 'bg-orange-950/80 text-orange-400 border-orange-500/40';
  }
  if (text.includes('grau ii') || text.includes('grave') || text.includes('grau iii')) {
    return 'bg-red-950/80 text-red-400 border-red-500/40';
  }
  if (text.includes('magreza') || text.includes('baixo peso')) {
    return 'bg-sky-950/80 text-sky-400 border-sky-500/40';
  }

  return 'bg-slate-800 text-slate-300 border-slate-700';
}
