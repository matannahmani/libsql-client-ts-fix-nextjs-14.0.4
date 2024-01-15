import Database from "libsql";
import type { Config, IntMode, Client, Transaction, TransactionMode, ResultSet, InStatement } from "./api.js";
import type { ExpandedConfig } from "./config.js";
export * from "./api.js";
export declare function createClient(config: Config): Client;
/** @private */
export declare function _createClient(config: ExpandedConfig): Client;
export declare class Sqlite3Client implements Client {
    #private;
    closed: boolean;
    protocol: "file";
    /** @private */
    constructor(path: string, options: Database.Options, db: Database.Database, intMode: IntMode);
    execute(stmt: InStatement): Promise<ResultSet>;
    batch(stmts: Array<InStatement>, mode?: TransactionMode): Promise<Array<ResultSet>>;
    transaction(mode?: TransactionMode): Promise<Transaction>;
    executeMultiple(sql: string): Promise<void>;
    sync(): Promise<void>;
    close(): void;
}
export declare class Sqlite3Transaction implements Transaction {
    #private;
    /** @private */
    constructor(database: Database.Database, intMode: IntMode);
    execute(stmt: InStatement): Promise<ResultSet>;
    batch(stmts: Array<InStatement>): Promise<Array<ResultSet>>;
    executeMultiple(sql: string): Promise<void>;
    rollback(): Promise<void>;
    commit(): Promise<void>;
    close(): void;
    get closed(): boolean;
}
