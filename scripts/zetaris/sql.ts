export type DatasourceConfig = {
  name: string;
  description: string;
  database: string;
};

export const DATASOURCES: readonly DatasourceConfig[] = [
  {
    name: "bpp_pg",
    description: "BPP federal OCDS",
    database: "bpp",
  },
  {
    name: "states_pg",
    description: "Osun and Oyo OCDS",
    database: "states",
  },
];

export const EXPECTED_ZETARIS_TABLES = {
  bpp_pg: ["bpp_awards", "bpp_awards_suppliers"],
  states_pg: ["osun_awards", "osun_awards_suppliers", "oyo_main", "oyo_tender_items"],
} as const;

export function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function buildCreateDatasourceSql(
  config: DatasourceConfig,
  postgresPassword: string,
): string {
  return [
    `CREATE DATASOURCE ${config.name}`,
    `DESCRIBE BY ${sqlLiteral(config.description)}`,
    "OPTIONS",
    "(jdbcdriver 'org.postgresql.Driver',",
    `jdbcurl ${sqlLiteral(`jdbc:postgresql://ct-pg:5432/${config.database}`)},`,
    "username 'postgres',",
    `password ${sqlLiteral(postgresPassword)},`,
    "fetchsize '1000')",
  ].join(" ");
}

export function buildRegisterTablesSql(datasource: string): string {
  return `REGISTER DATASOURCE TABLES FROM ${datasource}`;
}

export function buildShowTablesSql(datasource: string): string {
  return `SHOW DATASOURCE TABLES ${datasource}`;
}
