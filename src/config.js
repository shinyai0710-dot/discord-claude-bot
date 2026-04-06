// ============================================================
// 設定の一元管理
// 起動時に必須環境変数をバリデーション
// ============================================================
require("dotenv").config();
const path = require("path");

const config = {
  // Discord
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  CLIENT_ID: process.env.CLIENT_ID || "",
  GUILD_ID: process.env.GUILD_ID || "", // 省略時はグローバルコマンド登録

  // Claude Code CLI（Windows: フルパス、Linux/Mac: コマンド名のみ）
  CLAUDE_PATH:
    process.env.CLAUDE_PATH ||
    (process.platform === "win32"
      ? "C:\\Users\\user\\AppData\\Roaming\\npm\\claude.cmd"
      : "claude"),

  // 作業ディレクトリ（チャンネル未設定時のデフォルト）
  DEFAULT_WORK_DIR:
    process.env.WORK_DIR ||
    (process.platform === "win32"
      ? "C:\\Users\\user\\discord-claude-bot"
      : "/tmp/discord-bot-workdir"),

  // 使用モデル (例: claude-haiku-4-5, claude-sonnet-4-5)
  CLAUDE_MODEL: process.env.CLAUDE_MODEL || "claude-haiku-4-5",

  // Claude Code 実行パラメータ
  MAX_TURNS: parseInt(process.env.MAX_TURNS || "30", 10),
  TIMEOUT_MS: parseInt(process.env.TIMEOUT_MS || "0", 10),

  // 同時実行数の上限
  MAX_CONCURRENT: parseInt(process.env.MAX_CONCURRENT || "3", 10),

  // 添付ファイル上限 (デフォルト 10MB)
  MAX_FILE_SIZE: parseInt(
    process.env.MAX_FILE_SIZE || String(10 * 1024 * 1024),
    10
  ),

  // アクセス制御 (空の場合は全員許可)
  ALLOWED_USER_IDS: process.env.ALLOWED_USER_IDS
    ? process.env.ALLOWED_USER_IDS.split(",").map((s) => s.trim()).filter(Boolean)
    : [],
  ALLOWED_ROLE_IDS: process.env.ALLOWED_ROLE_IDS
    ? process.env.ALLOWED_ROLE_IDS.split(",").map((s) => s.trim()).filter(Boolean)
    : [],

  // true の場合 --dangerously-skip-permissions を使用
  // false の場合 --allowedTools で制限
  ALLOW_DANGEROUS_MODE: process.env.ALLOW_DANGEROUS_MODE === "true",
  ALLOWED_TOOLS:
    process.env.ALLOWED_TOOLS ||
    "Read,Write,Edit,Glob,Grep,Bash,LS",

  // システムプロンプト
  SYSTEM_PROMPT:
    process.env.SYSTEM_PROMPT ||
    "あなたはDiscordで動作する万能アシスタントです。" +
    "コーディング・ファイル操作・調査・質問回答・文章作成・データ分析など、どんな依頼にも柔軟に対応してください。" +
    "必要に応じてツール（Read, Write, Edit, Bash, Glob, Grep など）を積極的に使って作業を完遂してください。" +
    "会話の文脈を常に意識し、前のやり取りを踏まえて回答してください。" +
    "曖昧な指示は最善を尽くして解釈し、作業してください。" +
    "【返答形式】結果を1500文字以内で簡潔に報告してください。長い説明やコード全文の引用は避け、何をしたか・結果だけを端的に伝えること。",
};

/**
 * 起動時バリデーション
 * 必須環境変数が未設定の場合は即座にエラー終了
 */
function validate() {
  const errors = [];

  if (!config.DISCORD_TOKEN) {
    errors.push("DISCORD_TOKEN が設定されていません (.env を確認してください)");
  }

  if (errors.length > 0) {
    for (const e of errors) console.error(`[CONFIG ERROR] ${e}`);
    process.exit(1);
  }
}

module.exports = { config, validate };
