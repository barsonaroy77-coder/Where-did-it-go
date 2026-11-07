export const version = 1;

export const statements: string[] = [
  `CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT
  );`,
];

export default {
  version,
  statements,
};
