import { type Logger } from 'pino';
import { type Config } from './config.js';
export declare const currentDir: string;
export declare const run: (config: Config, argv: string[], logger: Logger) => Promise<void>;
export declare const main: (config: Config) => Promise<void>;
