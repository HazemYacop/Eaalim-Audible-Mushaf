import session from "express-session";
import { pool } from "./db.js";

const DEFAULT_TTL = 24 * 60 * 60 * 1000; // 1 day

export default class PGSessionStore extends session.Store {
  constructor(opts = {}) {
    super();
    this.ttl = opts.ttl || DEFAULT_TTL;
    this.cleanupInterval = opts.cleanupInterval || 60 * 60 * 1000; // 1h
    this._startCleanup();
  }

  async _query(text, params) {
    const client = await pool.connect();
    try {
      return await client.query(text, params);
    } finally {
      client.release();
    }
  }

  async get(sid, cb) {
    try {
      const { rows } = await this._query(
        "SELECT sess FROM session WHERE sid=$1 AND expire > NOW()",
        [sid]
      );
      cb(null, rows[0] ? rows[0].sess : null);
    } catch (err) {
      cb(err);
    }
  }

  async set(sid, sess, cb) {
    const expire = new Date(Date.now() + this.ttl);
    try {
      await this._query(
        `INSERT INTO session(sid, sess, expire)
         VALUES($1,$2,$3)
         ON CONFLICT (sid) DO UPDATE SET sess=$2, expire=$3`,
        [sid, sess, expire]
      );
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  async destroy(sid, cb) {
    try {
      await this._query("DELETE FROM session WHERE sid=$1", [sid]);
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  _startCleanup() {
    this._stopCleanup();
    this._interval = setInterval(() => {
      this._query("DELETE FROM session WHERE expire < NOW()").catch(() => {});
    }, this.cleanupInterval);
    this._interval.unref();
  }

  _stopCleanup() {
    if (this._interval) clearInterval(this._interval);
  }
}

await pool.query(
  `CREATE TABLE IF NOT EXISTS session (
    sid varchar PRIMARY KEY,
    sess json NOT NULL,
    expire timestamp(6) NOT NULL
  )`
);
