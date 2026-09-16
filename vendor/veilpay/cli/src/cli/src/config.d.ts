import { type EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
export interface Config {
    readonly privateStateStoreName: string;
    readonly logDir: string;
    readonly zkConfigPath: string;
    readonly generateDust: boolean;
    readonly fundFromFaucet: boolean;
    getEnvironment(): EnvironmentConfiguration;
}
export declare const currentDir: string;
export declare const PREPROD_ENDPOINTS: {
    readonly indexer: "https://indexer.preprod.midnight.network/api/v4/graphql";
    readonly indexerWS: "wss://indexer.preprod.midnight.network/api/v4/graphql/ws";
    readonly node: "https://rpc.preprod.midnight.network";
    readonly nodeWS: "wss://rpc.preprod.midnight.network";
    readonly faucet: "https://midnight-tmnight-preprod.nethermind.dev/";
    readonly proofServer: "https://proof-server.preprod.midnight.network";
};
export declare class PreprodConfig implements Config {
    privateStateStoreName: string;
    logDir: string;
    zkConfigPath: string;
    generateDust: boolean;
    fundFromFaucet: boolean;
    getEnvironment(): EnvironmentConfiguration;
}
export declare class PreviewConfig extends PreprodConfig {
    getEnvironment(): EnvironmentConfiguration;
}
