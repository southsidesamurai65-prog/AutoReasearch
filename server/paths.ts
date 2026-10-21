import path from 'node:path'

export const DATA_DIR = path.resolve(process.env.AUTO_DATA_DIR ?? 'data')
export const CONFIG_PATH = path.join(DATA_DIR, 'config.json')
export const STATE_PATH = path.join(DATA_DIR, 'state.json')
export const RUNS_DIR = path.join(DATA_DIR, 'runs')
export const DEFAULT_WORKSPACE = path.join(DATA_DIR, 'workspace')
