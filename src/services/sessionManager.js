// ============================================================
// セッション管理
// - チャンネル別の作業ディレクトリ
// - チャンネル別の Claude セッションID（会話継続）
// - 同時実行制限（チャンネルロック + グローバル上限）
// ============================================================
const { config } = require("../config");
const logger = require("../logger");

class SessionManager {
  constructor() {
    /** @type {Map<string, string>} channelId -> workDir */
    this.directories = new Map();

    /** @type {Map<string, string>} channelId -> Claude sessionId */
    this.sessionIds = new Map();

    /** @type {Map<string, Promise>} channelId -> 実行中Promise */
    this.locks = new Map();

    /** 現在のグローバル実行数 */
    this.globalCount = 0;
  }

  // ── ディレクトリ管理 ──────────────────────────────────────

  /** チャンネルの作業ディレクトリを取得 (未設定ならデフォルト) */
  getDir(channelId) {
    return this.directories.get(channelId) || config.DEFAULT_WORK_DIR;
  }

  /** チャンネルの作業ディレクトリを設定 */
  setDir(channelId, dir) {
    this.directories.set(channelId, dir);
    logger.info(`作業ディレクトリ変更 [channel=${channelId}]`, { dir });
  }

  // ── セッションID管理 ──────────────────────────────────────

  /** チャンネルの Claude セッションIDを取得 */
  getSessionId(channelId) {
    return this.sessionIds.get(channelId) || null;
  }

  /** チャンネルの Claude セッションIDを保存 */
  setSessionId(channelId, sessionId) {
    if (sessionId) {
      this.sessionIds.set(channelId, sessionId);
      logger.info(`セッションID保存 [channel=${channelId}]`, { sessionId });
    }
  }

  /** チャンネルのセッション（会話履歴）をリセット */
  clearSession(channelId) {
    const had = this.sessionIds.has(channelId);
    this.sessionIds.delete(channelId);
    if (had) {
      logger.info(`セッションリセット [channel=${channelId}]`);
    }
    return had;
  }

  // ── ロック管理 ────────────────────────────────────────────

  /** チャンネルが処理中かどうか */
  isLocked(channelId) {
    return this.locks.has(channelId);
  }

  /** グローバル同時実行数が上限に達しているか */
  isFull() {
    return this.globalCount >= config.MAX_CONCURRENT;
  }

  /**
   * チャンネルロックを取得して fn を実行
   * @param {string} channelId
   * @param {() => Promise<any>} fn
   */
  async run(channelId, fn) {
    if (this.locks.has(channelId)) {
      throw new Error(
        "⏳ このチャンネルでは現在処理中です。完了後に再度お試しください。"
      );
    }
    if (this.globalCount >= config.MAX_CONCURRENT) {
      throw new Error(
        `⚠️ 同時実行数の上限（${config.MAX_CONCURRENT}件）に達しています。しばらくお待ちください。`
      );
    }

    this.globalCount++;
    logger.info(`セッション開始 [channel=${channelId}]`, {
      globalCount: this.globalCount,
    });

    const promise = fn().finally(() => {
      this.locks.delete(channelId);
      this.globalCount--;
      logger.info(`セッション終了 [channel=${channelId}]`, {
        globalCount: this.globalCount,
      });
    });

    this.locks.set(channelId, promise);
    return promise;
  }
}

module.exports = new SessionManager();
