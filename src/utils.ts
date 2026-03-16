/**
 * Utility functions for the Sales Comparison System
 */

/**
 * Normalizes a CNPJ string by removing non-digits and padding with leading zeros.
 */
export function normalizeCNPJ(cnpj: string | number): string {
  const cleaned = String(cnpj).replace(/\D/g, '');
  return cleaned.padStart(14, '0');
}

/**
 * Formats a CNPJ for display (XX.XXX.XXX/XXXX-XX).
 */
export function formatCNPJ(cnpj: string): string {
  const normalized = normalizeCNPJ(cnpj);
  return normalized.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

/**
 * Extracts the period number from a string like "2024P06" -> 6
 */
export function getPeriodNumber(period: string): number {
  const match = period.match(/P(\d+)$/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Extracts the year from a string like "2024P06" -> 2024
 */
export function getYear(period: string): number {
  const match = period.match(/^(\d{4})/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Aligns periods between Cabral and Mastter.
 * Example: Cabral 2024P06 aligns with Mastter 2025P06
 */
export function alignPeriods(cabralPeriods: string[], mastterPeriods: string[]): { cabral: string; mastter: string }[] {
  const sortedCabral = [...new Set(cabralPeriods)].sort();
  const sortedMastter = [...new Set(mastterPeriods)].sort();

  const alignment: { cabral: string; mastter: string }[] = [];
  
  // Create maps of suffix -> full period string
  const cabralMap: Record<string, string> = {};
  sortedCabral.forEach(p => {
    const suffix = p.match(/P\d+$/)?.[0];
    if (suffix) cabralMap[suffix] = p;
  });

  const mastterMap: Record<string, string> = {};
  sortedMastter.forEach(p => {
    const suffix = p.match(/P\d+$/)?.[0];
    if (suffix) mastterMap[suffix] = p;
  });

  // Get all unique suffixes and sort them numerically
  const allSuffixes = [...new Set([...Object.keys(cabralMap), ...Object.keys(mastterMap)])].sort((a, b) => {
    const numA = parseInt(a.replace('P', ''), 10);
    const numB = parseInt(b.replace('P', ''), 10);
    return numA - numB;
  });

  allSuffixes.forEach(suffix => {
    if (cabralMap[suffix] && mastterMap[suffix]) {
      alignment.push({
        cabral: cabralMap[suffix],
        mastter: mastterMap[suffix]
      });
    }
  });
  
  return alignment;
}

export interface ClientData {
  cnpj: string;
  razaoSocial: string;
  cidade: string;
  canal: string;
  canalReclassificado?: string;
  categoria: string;
  nomeRepresentante: string;
  nomeSupervisor: string;
  vendasCabral: Record<string, number>;
  vendasMastter: Record<string, number>;
  totalCabral: number;
  totalMastter: number;
  mediaCabral: number;
  mediaMastter: number;
  receitaData?: {
    razaoSocial: string;
    cidade: string;
  };
}

export const FAIXAS = {
  FAIXA_1: { label: 'Faixa 1 (> 5.000)', min: 5000, max: Infinity },
  FAIXA_2: { label: 'Faixa 2 (1.000 - 4.999,99)', min: 1000, max: 4999.99 },
  OUTROS: { label: 'Outros (< 1.000)', min: 0, max: 999.99 }
};

export const CANAIS = ['ALIMENTAR', 'ESPECIALIZADOS'];

/**
 * Tries to find a matching column name for a given field key.
 */
export function findBestMatch(fieldKey: string, columns: string[]): string {
  const normalizedColumns = columns.map(c => ({
    original: c,
    normalized: c.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '')
  }));

  const synonyms: Record<string, string[]> = {
    anoperiodo: ['anoperiodo', 'periodo', 'data', 'mes', 'ano', 'competencia'],
    cnpj: ['cnpj', 'cpfcnpj', 'documento', 'doc'],
    razaoSocial: ['razaosocial', 'cliente', 'nome', 'nomecliente', 'razao', 'empresa', 'fantasia'],
    totalVenda: ['totalvenda', 'valor', 'total', 'faturamento', 'venda', 'valortotal', 'valorvenda'],
    valorVenda: ['valorvenda', 'valor', 'total', 'faturamento', 'venda', 'valortotal', 'totalvenda'],
    cidade: ['cidade', 'municipio', 'localidade', 'uf'],
    canal: ['canal', 'tipo', 'segmento', 'setor'],
    categoria: ['categoria', 'grupo', 'familia'],
    codigoCliente: ['codigocliente', 'codcliente', 'idcliente', 'codigo'],
    codigoVendedor: ['codigovendedor', 'codvendedor', 'idvendedor'],
    nomeVendedor: ['nomevendedor', 'vendedor', 'representante', 'nomerepresentante'],
    nomeRepresentante: ['nomerepresentante', 'representante', 'vendedor', 'nomevendedor'],
    supervisor: ['supervisor', 'gerente', 'nomesupervisor'],
    nomeSupervisor: ['nomesupervisor', 'supervisor', 'gerente'],
    codigoProduto: ['codigoproduto', 'codproduto', 'idproduto'],
    nomeProduto: ['nomeproduto', 'produto', 'descricao'],
    codigoRepresentante: ['codigorepresentante', 'codrep', 'idrep']
  };

  const targets = synonyms[fieldKey] || [fieldKey.toLowerCase()];

  // 1. Try exact normalized match
  for (const target of targets) {
    const match = normalizedColumns.find(c => c.normalized === target);
    if (match) return match.original;
  }

  // 2. Try partial match (inclusion)
  for (const target of targets) {
    const match = normalizedColumns.find(c => c.normalized.includes(target) || target.includes(c.normalized));
    if (match) return match.original;
  }

  return '';
}
