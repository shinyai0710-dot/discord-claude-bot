// ============================================================
// Claude Code CLIラッパー
// spawn で実行、シェルインジェクション対策済み
// --output-format json でセッションIDを取得し会話を継続
// ============================================================
const { spawn } = require("child_process");
const { config } = require("../config");
const logger = require("../logger");

/**
 * Claude Code CLI を実行してテキスト結果とセッションIDを返す
 * @param {string} prompt
 * @param {string} cwd 作業ディレクトリ
 * @param {string|null} sessionId 継続セッションID（nullなら新規）
 * @returns {Promise<{ result: string, sessionId: string|null }>}
 */
function runClaudeCode(prompt, cwd, sessionId = null) {
  return new Promise((resolve, reject) => {
    const args = [
      "-p", prompt,
      "--max-turns", String(config.MAX_TURNS),
      "--model", config.CLAUDE_MODEL,
      "--output-format", "json",
    ];

    // セッション継続 or 新規
    if (sessionId) {
      args.push("--resume", sessionId);
    } else {
      args.push("--system-prompt", config.SYSTEM_PROMPT);
    }

    if (config.ALLOW_DANGEROUS_MODE) {
      args.push("--dangerously-skip-permissions");
    } else {
      args.push("--allowedTools", config.ALLOWED_TOOLS);
    }

    const startedAt = Date.now();
    logger.info("Claude Code 開始", {
      cwd,
      promptLength: prompt.length,
      dangerousMode: config.ALLOW_DANGEROUS_MODE,
      resuming: !!sessionId,
    });

    // OS に応じて起動方法を切り替え（Windows: cmd.exe 経由、Linux/Mac: 直接実行）
    const isWindows = process.platform === "win32";
    const spawnCmd = isWindows ? "cmd.exe" : config.CLAUDE_PATH;
    const spawnArgs = isWindows ? ["/c", config.CLAUDE_PATH, ...args] : args;

    const proc = spawn(spawnCmd, spawnArgs, {
      cwd,
      shell: false,
      windowsHide: isWindows,
      env: {
        ...process.env,
        API_TIMEOUT_MS: String(24 * 60 * 60 * 1000),
      },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    // TIMEOUT_MS=0 の場合はタイムアウト無効
    const timer = config.TIMEOUT_MS > 0
      ? setTimeout(() => {
          proc.kill();
          setTimeout(() => {
            try { proc.kill("SIGKILL"); } catch {}
          }, 3000);
          reject(new Error(`⏱️ タイムアウト（${config.TIMEOUT_MS / 1000}秒）しました。`));
        }, config.TIMEOUT_MS)
      : null;

    proc.on("close", (code) => {
      if (timer) clearTimeout(timer);
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

      logger.info("Claude Code 終了", {
        code,
        elapsed: `${elapsed}s`,
        stdoutLength: stdout.length,
        stderrLength: stderr.length,
      });

      if (code !== 0 && !stdout.trim()) {
        reject(new Error(stderr.slice(0, 500) || `終了コード: ${code}`));
        return;
      }

      // JSON パース → result & session_id を抽出
      try {
        const jsonData = JSON.parse(stdout.trim());
        const resultText = jsonData.result ?? "";
        const newSessionId = jsonData.session_id ?? null;

        if (jsonData.is_error) {
          reject(new Error(resultText || "Claude Code がエラーを返しました"));
          return;
        }

        logger.info("セッションID取得", { sessionId: newSessionId });
        resolve({ result: resultText, sessionId: newSessionId });
      } catch {
        // JSON パース失敗時はテキストをそのまま返す（後方互換）
        logger.warn("JSON パース失敗、テキストモードで返却");
        resolve({ result: stdout.trim(), sessionId: null });
      }
    });

    proc.on("error", (err) => {
      if (timer) clearTimeout(timer);
      logger.error("Claude Code プロセスエラー", { message: err.message });
      reject(err);
    });
  });
}

module.exports = { runClaudeCode };
