import { Type } from "@google/genai";

export const SALES_SCHEMA = {
  CABRAL: [
    { key: 'anoperiodo', label: 'Ano/Período', required: true },
    { key: 'cnpj', label: 'CNPJ', required: true },
    { key: 'razaoSocial', label: 'Razão Social', required: true },
    { key: 'categoria', label: 'Categoria', required: false },
    { key: 'cidade', label: 'Cidade', required: false },
    { key: 'canal', label: 'Canal', required: false },
    { key: 'totalVenda', label: 'Total Venda', required: true },
  ],
  MASTTER: [
    { key: 'cnpj', label: 'CNPJ', required: true },
    { key: 'codigoCliente', label: 'Código Cliente', required: false },
    { key: 'razaoSocial', label: 'Razão Social', required: true },
    { key: 'codigoVendedor', label: 'Código Vendedor', required: false },
    { key: 'nomeVendedor', label: 'Nome Vendedor', required: false },
    { key: 'supervisor', label: 'Supervisor', required: false },
    { key: 'codigoProduto', label: 'Código Produto', required: false },
    { key: 'nomeProduto', label: 'Nome Produto', required: false },
    { key: 'valorVenda', label: 'Valor Venda', required: true },
    { key: 'anoperiodo', label: 'Ano/Período', required: true },
    { key: 'categoria', label: 'Categoria', required: false },
    { key: 'canal', label: 'Canal', required: false },
  ],
  CLIENTES_MASTTER: [
    { key: 'cnpj', label: 'CNPJ', required: true },
    { key: 'razaoSocial', label: 'Razão Social', required: true },
    { key: 'codigoCliente', label: 'Código Cliente', required: true },
    { key: 'cidade', label: 'Cidade', required: false },
  ],
  ROTEIRO: [
    { key: 'codigoRepresentante', label: 'Cód. Representante', required: false },
    { key: 'nomeRepresentante', label: 'Nome Representante', required: false },
    { key: 'codigoCliente', label: 'Código Cliente', required: true },
    { key: 'razaoSocial', label: 'Razão Social', required: false },
    { key: 'cnpj', label: 'CNPJ', required: true },
    { key: 'cidade', label: 'Cidade', required: false },
    { key: 'codigoSupervisor', label: 'Cód. Supervisor', required: false },
    { key: 'nomeSupervisor', label: 'Nome Supervisor', required: false },
  ]
};

export type SchemaKey = keyof typeof SALES_SCHEMA;
