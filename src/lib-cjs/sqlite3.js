"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Sqlite3Transaction = exports.Sqlite3Client = exports._createClient = exports.createClient = void 0;
const libsql_1 = __importDefault(require("libsql"));
const node_buffer_1 = require("node:buffer");
const api_js_1 = require("./api.js");
const config_js_1 = require("./config.js");
const util_js_1 = require("./util.js");
__exportStar(require("./api.js"), exports);
function createClient(config) {
    return _createClient((0, config_js_1.expandConfig)(config, true));
}
exports.createClient = createClient;
/** @private */
function _createClient(config) {
    if (config.scheme !== "file") {
        throw new api_js_1.LibsqlError(`URL scheme ${JSON.stringify(config.scheme + ":")} is not supported by the local sqlite3 client. ` +
            `For more information, please read ${util_js_1.supportedUrlLink}`, "URL_SCHEME_NOT_SUPPORTED");
    }
    const authority = config.authority;
    if (authority !== undefined) {
        const host = authority.host.toLowerCase();
        if (host !== "" && host !== "localhost") {
            throw new api_js_1.LibsqlError(`Invalid host in file URL: ${JSON.stringify(authority.host)}. ` +
                'A "file:" URL with an absolute path should start with one slash ("file:/absolute/path.db") ' +
                'or with three slashes ("file:///absolute/path.db"). ' +
                `For more information, please read ${util_js_1.supportedUrlLink}`, "URL_INVALID");
        }
        if (authority.port !== undefined) {
            throw new api_js_1.LibsqlError("File URL cannot have a port", "URL_INVALID");
        }
        if (authority.userinfo !== undefined) {
            throw new api_js_1.LibsqlError("File URL cannot have username and password", "URL_INVALID");
        }
    }
    const path = config.path;
    const options = {
        authToken: config.authToken,
        syncUrl: config.syncUrl,
    };
    const db = new libsql_1.default(path, options);
    executeStmt(db, "SELECT 1 AS checkThatTheDatabaseCanBeOpened", config.intMode);
    return new Sqlite3Client(path, options, db, config.intMode);
}
exports._createClient = _createClient;
class Sqlite3Client {
    #path;
    #options;
    #db;
    #intMode;
    closed;
    protocol;
    /** @private */
    constructor(path, options, db, intMode) {
        this.#path = path;
        this.#options = options;
        this.#db = db;
        this.#intMode = intMode;
        this.closed = false;
        this.protocol = "file";
    }
    async execute(stmt) {
        this.#checkNotClosed();
        return executeStmt(this.#getDb(), stmt, this.#intMode);
    }
    async batch(stmts, mode = "deferred") {
        this.#checkNotClosed();
        const db = this.#getDb();
        try {
            executeStmt(db, (0, util_js_1.transactionModeToBegin)(mode), this.#intMode);
            const resultSets = stmts.map((stmt) => {
                if (!db.inTransaction) {
                    throw new api_js_1.LibsqlError("The transaction has been rolled back", "TRANSACTION_CLOSED");
                }
                return executeStmt(db, stmt, this.#intMode);
            });
            executeStmt(db, "COMMIT", this.#intMode);
            return resultSets;
        }
        finally {
            if (db.inTransaction) {
                executeStmt(db, "ROLLBACK", this.#intMode);
            }
        }
    }
    async transaction(mode = "write") {
        const db = this.#getDb();
        executeStmt(db, (0, util_js_1.transactionModeToBegin)(mode), this.#intMode);
        this.#db = null; // A new connection will be lazily created on next use
        return new Sqlite3Transaction(db, this.#intMode);
    }
    async executeMultiple(sql) {
        this.#checkNotClosed();
        const db = this.#getDb();
        try {
            return executeMultiple(db, sql);
        }
        finally {
            if (db.inTransaction) {
                executeStmt(db, "ROLLBACK", this.#intMode);
            }
        }
    }
    async sync() {
        this.#checkNotClosed();
        await this.#getDb().sync();
    }
    close() {
        this.closed = true;
        if (this.#db !== null) {
            this.#db.close();
        }
    }
    #checkNotClosed() {
        if (this.closed) {
            throw new api_js_1.LibsqlError("The client is closed", "CLIENT_CLOSED");
        }
    }
    // Lazily creates the database connection and returns it
    #getDb() {
        if (this.#db === null) {
            this.#db = new libsql_1.default(this.#path, this.#options);
        }
        return this.#db;
    }
}
exports.Sqlite3Client = Sqlite3Client;
class Sqlite3Transaction {
    #database;
    #intMode;
    /** @private */
    constructor(database, intMode) {
        this.#database = database;
        this.#intMode = intMode;
    }
    async execute(stmt) {
        this.#checkNotClosed();
        return executeStmt(this.#database, stmt, this.#intMode);
    }
    async batch(stmts) {
        return stmts.map((stmt) => {
            this.#checkNotClosed();
            return executeStmt(this.#database, stmt, this.#intMode);
        });
    }
    async executeMultiple(sql) {
        this.#checkNotClosed();
        return executeMultiple(this.#database, sql);
    }
    async rollback() {
        if (!this.#database.open) {
            return;
        }
        this.#checkNotClosed();
        executeStmt(this.#database, "ROLLBACK", this.#intMode);
    }
    async commit() {
        this.#checkNotClosed();
        executeStmt(this.#database, "COMMIT", this.#intMode);
    }
    close() {
        if (this.#database.inTransaction) {
            executeStmt(this.#database, "ROLLBACK", this.#intMode);
        }
    }
    get closed() {
        return !this.#database.inTransaction;
    }
    #checkNotClosed() {
        if (this.closed) {
            throw new api_js_1.LibsqlError("The transaction is closed", "TRANSACTION_CLOSED");
        }
    }
}
exports.Sqlite3Transaction = Sqlite3Transaction;
function executeStmt(db, stmt, intMode) {
    let sql;
    let args;
    if (typeof stmt === "string") {
        sql = stmt;
        args = [];
    }
    else {
        sql = stmt.sql;
        if (Array.isArray(stmt.args)) {
            args = stmt.args.map((value) => valueToSql(value, intMode));
        }
        else {
            args = {};
            for (const name in stmt.args) {
                const argName = (name[0] === "@" || name[0] === "$" || name[0] === ":")
                    ? name.substring(1) : name;
                args[argName] = valueToSql(stmt.args[name], intMode);
            }
        }
    }
    try {
        const sqlStmt = db.prepare(sql);
        sqlStmt.safeIntegers(true);
        let returnsData = true;
        try {
            sqlStmt.raw(true);
        }
        catch {
            // raw() throws an exception if the statement does not return data
            returnsData = false;
        }
        if (returnsData) {
            const columns = Array.from(sqlStmt.columns().map(col => col.name));
            const columnTypes = Array.from(sqlStmt.columns().map(col => col.type ?? ""));
            const rows = sqlStmt.all(args).map((sqlRow) => {
                return rowFromSql(sqlRow, columns, intMode);
            });
            // TODO: can we get this info from better-sqlite3?
            const rowsAffected = 0;
            const lastInsertRowid = undefined;
            return new util_js_1.ResultSetImpl(columns, columnTypes, rows, rowsAffected, lastInsertRowid);
        }
        else {
            const info = sqlStmt.run(args);
            const rowsAffected = info.changes;
            const lastInsertRowid = BigInt(info.lastInsertRowid);
            return new util_js_1.ResultSetImpl([], [], [], rowsAffected, lastInsertRowid);
        }
    }
    catch (e) {
        throw mapSqliteError(e);
    }
}
function rowFromSql(sqlRow, columns, intMode) {
    const row = {};
    // make sure that the "length" property is not enumerable
    Object.defineProperty(row, "length", { value: sqlRow.length });
    for (let i = 0; i < sqlRow.length; ++i) {
        const value = valueFromSql(sqlRow[i], intMode);
        Object.defineProperty(row, i, { value });
        const column = columns[i];
        if (!Object.hasOwn(row, column)) {
            Object.defineProperty(row, column, { value, enumerable: true });
        }
    }
    return row;
}
function valueFromSql(sqlValue, intMode) {
    if (typeof sqlValue === "bigint") {
        if (intMode === "number") {
            if (sqlValue < minSafeBigint || sqlValue > maxSafeBigint) {
                throw new RangeError("Received integer which cannot be safely represented as a JavaScript number");
            }
            return Number(sqlValue);
        }
        else if (intMode === "bigint") {
            return sqlValue;
        }
        else if (intMode === "string") {
            return "" + sqlValue;
        }
        else {
            throw new Error("Invalid value for IntMode");
        }
    }
    else if (sqlValue instanceof node_buffer_1.Buffer) {
        return sqlValue.buffer;
    }
    return sqlValue;
}
const minSafeBigint = -9007199254740991n;
const maxSafeBigint = 9007199254740991n;
function valueToSql(value, intMode) {
    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new RangeError("Only finite numbers (not Infinity or NaN) can be passed as arguments");
        }
        return value;
    }
    else if (typeof value === "bigint") {
        if (value < minInteger || value > maxInteger) {
            throw new RangeError("bigint is too large to be represented as a 64-bit integer and passed as argument");
        }
        return value;
    }
    else if (typeof value === "boolean") {
        switch (intMode) {
            case "bigint":
                return value ? 1n : 0n;
            case "string":
                return value ? "1" : "0";
            default:
                return value ? 1 : 0;
        }
    }
    else if (value instanceof ArrayBuffer) {
        return node_buffer_1.Buffer.from(value);
    }
    else if (value instanceof Date) {
        return value.valueOf();
    }
    else if (value === undefined) {
        throw new TypeError("undefined cannot be passed as argument to the database");
    }
    else {
        return value;
    }
}
const minInteger = -9223372036854775808n;
const maxInteger = 9223372036854775807n;
function executeMultiple(db, sql) {
    try {
        db.exec(sql);
    }
    catch (e) {
        throw mapSqliteError(e);
    }
}
function mapSqliteError(e) {
    if (e instanceof libsql_1.default.SqliteError) {
        return new api_js_1.LibsqlError(e.message, e.code, e.rawCode, e);
    }
    return e;
}
