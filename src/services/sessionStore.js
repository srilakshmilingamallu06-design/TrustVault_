const session = require('express-session');
const { getDb } = require('../database');

class SqliteSessionStore extends session.Store {
  constructor(options = {}) {
    super();
    this.cleanupIntervalMs = options.cleanupIntervalMs || 15 * 60 * 1000;
    this.disableCleanup = options.disableCleanup || false;

    if (!this.disableCleanup) {
      this.timer = setInterval(() => this.cleanup(), this.cleanupIntervalMs);
      if (this.timer.unref) {
        this.timer.unref();
      }
    }
  }

  get(sid, callback) {
    try {
      const db = getDb();
      const row = db.prepare('SELECT sess, expired FROM sessions WHERE sid = ?').get(sid);
      if (!row) {
        return callback(null, null);
      }
      if (Date.now() > row.expired) {
        this.destroy(sid, () => callback(null, null));
        return;
      }
      const sess = JSON.parse(row.sess);
      callback(null, sess);
    } catch (err) {
      callback(err);
    }
  }

  set(sid, sess, callback) {
    try {
      const db = getDb();
      let maxAge = 24 * 60 * 60 * 1000;
      if (sess && sess.cookie && sess.cookie.maxAge) {
        maxAge = sess.cookie.maxAge;
      }
      const expired = Date.now() + maxAge;
      const sessStr = JSON.stringify(sess);

      db.prepare(`
        INSERT INTO sessions (sid, sess, expired)
        VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expired = excluded.expired
      `).run(sid, sessStr, expired);

      if (callback) callback(null);
    } catch (err) {
      if (callback) callback(err);
    }
  }

  destroy(sid, callback) {
    try {
      const db = getDb();
      db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      if (callback) callback(null);
    } catch (err) {
      if (callback) callback(err);
    }
  }

  touch(sid, sess, callback) {
    try {
      const db = getDb();
      let maxAge = 24 * 60 * 60 * 1000;
      if (sess && sess.cookie && sess.cookie.maxAge) {
        maxAge = sess.cookie.maxAge;
      }
      const expired = Date.now() + maxAge;
      db.prepare('UPDATE sessions SET expired = ? WHERE sid = ?').run(expired, sid);
      if (callback) callback(null);
    } catch (err) {
      if (callback) callback(err);
    }
  }

  cleanup() {
    try {
      const db = getDb();
      db.prepare('DELETE FROM sessions WHERE expired < ?').run(Date.now());
    } catch (err) {
      // Ignore background cleanup errors
    }
  }

  close() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

module.exports = SqliteSessionStore;
