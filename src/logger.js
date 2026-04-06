// ============================================================
// 構造化ロガー
// タイムスタンプ + レベル + メッセージ + メタデータ
// ============================================================

function format(level, msg, meta = {}) {
  const ts = new Date().toISOString();
  const metaStr =
    Object.keys(meta).length > 0
      ? " " + JSON.stringify(meta)
      : "";
  return `[${ts}] [${level.padEnd(5)}] ${msg}${metaStr}`;
}

const logger = {
  debug(msg, meta) {
    if (process.env.LOG_LEVEL === "debug") {
      console.debug(format("DEBUG", msg, meta));
    }
  },
  info(msg, meta) {
    console.log(format("INFO", msg, meta));
  },
  warn(msg, meta) {
    console.warn(format("WARN ", msg, meta));
  },
  error(msg, meta) {
    console.error(format("ERROR", msg, meta));
  },
};

module.exports = logger;
