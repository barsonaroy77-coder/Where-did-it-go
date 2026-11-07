import migration0001 from './0001_init';

export interface Migration {
  version: number;
  statements: string[];
}

export const migrations: Migration[] = [
  migration0001,
];
