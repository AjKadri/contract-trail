export type DatasetTable = {
  database: "bpp" | "states";
  table: string;
  sourcePath: string;
  expectedRows?: number;
};

export const DATASET_ARCHIVES = [64, 118, 106] as const;

export const DATASET_TABLES: readonly DatasetTable[] = [
  {
    database: "bpp",
    table: "bpp_awards",
    sourcePath: "csv_64/full/awards.csv",
    expectedRows: 17_431,
  },
  {
    database: "bpp",
    table: "bpp_awards_suppliers",
    sourcePath: "csv_64/full/awards_suppliers.csv",
  },
  {
    database: "bpp",
    table: "bpp_contracts",
    sourcePath: "csv_64/full/contracts.csv",
  },
  {
    database: "bpp",
    table: "bpp_contracts_items",
    sourcePath: "csv_64/full/contracts_items.csv",
  },
  {
    database: "states",
    table: "osun_awards",
    sourcePath: "csv_118/full/awards.csv",
    expectedRows: 492,
  },
  {
    database: "states",
    table: "osun_awards_suppliers",
    sourcePath: "csv_118/full/awards_suppliers.csv",
  },
  {
    database: "states",
    table: "oyo_main",
    sourcePath: "csv_106/full/main.csv",
    expectedRows: 304,
  },
  {
    database: "states",
    table: "oyo_tender_items",
    sourcePath: "csv_106/full/tender_items.csv",
  },
  {
    database: "states",
    table: "world_bank_cpi",
    sourcePath: "cpi/world_bank_fp_cpi_totl_nga.csv",
  },
];

export const TABLES_BY_DATABASE = {
  bpp: DATASET_TABLES.filter((entry) => entry.database === "bpp"),
  states: DATASET_TABLES.filter((entry) => entry.database === "states"),
} as const;

export const HEADLINE_COUNTS = {
  bpp_awards: 17_431,
  osun_awards: 492,
  oyo_main: 304,
} as const;

export const WORLD_BANK_CPI_SOURCE_URL =
  "https://api.worldbank.org/v2/country/NGA/indicator/FP.CPI.TOTL?format=json&per_page=100";
