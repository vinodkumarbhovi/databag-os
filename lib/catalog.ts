import { CATALOG as RAW, GROUPS as RAW_GROUPS, JOBS as RAW_JOBS, TOOLS as RAW_TOOLS } from '../shared/catalog.mjs';

export type AppInfo = {
  id: string;
  group: string;
  name: string;
  replaces: string;
  description: string;
  action: string;
  status: 'available' | 'planned';
};
export type Tool = { id: string; name: string; apps: string[]; price: number };
export type Job = { id: string; label: string; app: string };

export const CATALOG = RAW as AppInfo[];
export const GROUPS = RAW_GROUPS as string[];
export const TOOLS = RAW_TOOLS as Tool[];
export const JOBS = RAW_JOBS as Job[];
