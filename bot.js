require("dotenv").config();
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

// ============================================================
// [1] CONFIG — 全設定を一箇所に集約
// ============================================================
const CONFIG = {
  claudePath:
    process.env.CLAUDE_PATH ||
    "C:\\Users\\user\\AppData\\Roaming\\npm\\claude.cmd",
  defaultWorkDir:
    process.env.WORK_DIR || "C:\\Users\\user\\discord-claude-bot",
  maxTurns: Number(process.env.MAX_TURNS) || 30,
  timeoutMs: Number(process.env.TIMEOUT_MS) || 0, // 0 = タイムアウト無効
  retryCount: Number(process.env.RETRY_COUNT) || 1,
  retryDelayMs: 3_000,
  chunkSize: 1990,
  progressUpdateIntervalMs: 15_000, // 進捗メッセージ更新間隔（レート制限考慮）
  systemPrompt:
    process.env.SYSTEM_PROMPT ||
    "あなたはDiscord経由で指示を受けるコーディングアシスタントです。" +
      "ファイル操作・コード編集・Bashコマンド実行など必要なツールを自由に使って作業を完遂してください。" +
      "作業完了後は結果を簡潔に報告してください。",
};

// ============================================================
// [2] LOGGER — タイムスタンプ付き構造化ログ
// ============================================================
const logger = {
  _format(level, msg, meta = {}) {
    const ts = new Date().toISOString();
    const metaStr =
      Object.keys(meta).length ? " " + JSON.stringify(meta) : "";
    return `[${ts}] [${level}] ${msg}${metaStr}`;
  },
  info(msg, meta)  { console.log(this._format("INFO ", msg, meta)); },
  warn(msg, meta)  { console.warn(this._format("WARN ", msg, meta)); },
  error(msg, meta) { console.error(this._format("ERROR", msg, meta)); },
};

// ============================================================
// [3] STATE — チャンネルごとの状態管理
// ============================================================
/** @type {Map<string, { workDir: string, busy: boolean, requestId: string|null }>} */
const channelState = new Map();

function getState(channelId) {
  if (!channelState.has(channelId)) {
    channelState.set(channelId, {
      workDir: CONFIG.defaultWorkDir,
      busy: false,
      requestId: null,
    });
  }
  return channelState.get(channelId);
}

// ============================================================
// [4] EMBED HELPERS — 見やすいDiscord Embed生成
// ============================================================
const COLOR = {
  info:    0x5865F2, // Discord Blurple
  success: 0x57F287, // Green
  error:   0xED4245, // Red
  warning: 0xFEE75C, // Yellow
  running: 0xEB459E, // Magenta（処理中）
};

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}分${s % 60}秒` : `${s}秒`;
}

function buildProgressEmbed(prompt, state, startTime) {
  const elapsed = formatDuration(Date.now() - startTime);
  return new EmbedBuilder()
    .setColor(COLOR.running)
    .setTitle("⚙️ Claude Code 処理中...")
    .setDescription(`> ${prompt.slice(0, 200)}${prompt.length > 200 ? "…" : ""}`)
    .addFields(
      { name: "⏱ 経過時間", value: elapsed, inline: true },
      { name: "📁 作業ディレクトリ", value: `\`${state.workDir}\``, inline: true }
    )
    .setFooter({ text: `タイムアウト: なし • Claude Code Bot` })
    .setTimestamp();
}

function buildResultEmbed(prompt, durationMs) {
  return new EmbedBuilder()
    .setColor(COLOR.success)
    .setTitle("✅ 処理完了")
    .setDescription(`> ${prompt.slice(0, 150)}${prompt.length > 150 ? "…" : ""}`)
    .addFields({ name: "⏱ 処理時間", value: formatDuration(durationMs), inline: true })
    .setTimestamp();
}

function buildErrorEmbed(err) {
  const isTimeout = err.message.includes("タイムアウト");
  return new EmbedBuilder()
    .setColor(COLOR.error)
    .setTitle(isTimeout ? "⏰ タイムアウト" : "❌ エラーが発生しました")
    .setDescription(`\`\`\`\n${err.message.slice(0, 800)}\n\`\`\``)
    .setTimestamp();
}

function buildBusyEmbed(state) {
  return new EmbedBuilder()
    .setColor(COLOR.warning)
    .setTitle("⏳ 処理中です")
    .setDescription("現在このチャンネルで別のリクエストを処理中です。\n完了してから再度お試しください。")
    .addFields({ name: "📁 作業ディレクトリ", value: `\`${state.workDir}\`` })
    .setTimestamp();
}

function buildHelpEmbed(state) {
  return new EmbedBuilder()
    .setColor(COLOR.info)
    .setTitle("🤖 Claude Code Discord Bot — ヘルプ")
    .setDescription("メンションして日本語で指示してください！")
    .addFields(
      {
        name: "💬 使用例",
        value: [
          "`@Bot hello.txt を作ってHelloと書いて`",
          "`@Bot 現在のディレクトリのファイル一覧を教えて`",
          "`@Bot main.js にコンソールログを追加して`",
        ].join("\n"),
      },
      {
        name: "🔧 特殊コマンド",
        value: [
          "`!setdir <パス>` — 作業ディレクトリを変更",
          "`!dir` / `!pwd` — 現在の作業ディレクトリを表示",
          "`!status` — チャンネルの状態を確認",
          "`!help` — このヘルプを表示",
        ].join("\n"),
      },
      {
        name: "📁 現在の作業ディレクトリ",
        value: `\`${state.workDir}\``,
      }
    )
    .setFooter({ text: `最大ターン数: ${CONFIG.maxTurns} • タイムアウト: なし` })
    .setTimestamp();
}

function buildDirEmbed(state) {
  return new EmbedBuilder()
    .setColor(COLOR.info)
    .setTitle("📁 現在の作業ディレクトリ")
    .setDescription(`\`${state.workDir}\``)
    .setTimestamp();
}

function buildStatusEmbed(state) {
  return new EmbedBuilder()
    .setColor(state.busy ? COLOR.running : COLOR.success)
    .setTitle("📊 チャンネルステータス")
    .addFields(
      { name: "状態", value: state.busy ? "⚙️ 処理中" : "✅ 待機中", inline: true },
      { name: "📁 作業ディレクトリ", value: `\`${state.workDir}\``, inline: false }
    )
    .setTimestamp();
}

// ============================================================
// [5] DISCORD UTILS — チャンク送信（コードブロック境界考慮）
// ============================================================
function splitRespectingCodeBlocks(text, maxLen) {
  const chunks = [];
  let remaining = text;
  let insideCodeBlock = false;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    // maxLen の範囲内で最後の ``` を探す
    let splitAt = maxLen;
    const slice = remaining.slice(0, maxLen);
    const lastNewline = slice.lastIndexOf("\n");

    // コードブロックを数える
    const backtickMatches = slice.match(/```/g) || [];
    if (backtickMatches.length % 2 !== 0) {
      // コードブロックが途中で切れる → ``` の前で分割
      const lastBacktick = slice.lastIndexOf("```");
      splitAt = lastBacktick > 0 ? lastBacktick : (lastNewline > 0 ? lastNewline : maxLen);
    } else {
      splitAt = lastNewline > 0 ? lastNewline + 1 : maxLen;
    }

    let chunk = remaining.slice(0, splitAt).trimEnd();

    // コードブロックが奇数個なら閉じる
    const openBlocks = (chunk.match(/```/g) || []).length;
    if (openBlocks % 2 !== 0) {
      chunk += "\n```";
      insideCodeBlock = true;
    }

    chunks.push(chunk);

    // 次のチャンクの先頭にコードブロックを開く
    remaining = remaining.slice(splitAt).trimStart();
    if (insideCodeBlock && remaining.length > 0) {
      remaining = "```\n" + remaining;
      insideCodeBlock = false;
    }
  }

  return chunks.filter((c) => c.length > 0);
}

async function sendChunked(channel, text, replyToMsg = null) {
  if (!text) {
    if (replyToMsg) await replyToMsg.reply({ content: "✅ 完了しました（出力なし）" });
    return;
  }

  const chunks = splitRespectingCodeBlocks(text, CONFIG.chunkSize);

  for (let i = 0; i < chunks.length; i++) {
    if (i === 0 && replyToMsg) {
      await replyToMsg.reply({ content: chunks[i] });
    } else {
      await channel.send({ content: chunks[i] });
    }
  }
}

// ============================================================
// [6] FILE DOWNLOADER — fetch ベースでシンプル化
// ============================================================
async function downloadFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ダウンロード失敗: ${url}`);
  const buf = await res.arrayBuffer();
  fs.writeFileSync(destPath, Buffer.from(buf));
  return destPath;
}

// ============================================================
// [7] CLAUDE RUNNER — spawn 実行 + リトライ
// ============================================================
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runClaudeCode(prompt, cwd) {
  return new Promise((resolve, reject) => {
    // \r\n → \n に正規化（Windows改行が引数に混入する問題を防ぐ）
    const normalizedPrompt = prompt.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    const args = [
      "-p", normalizedPrompt,
      "--max-turns", String(CONFIG.maxTurns),
      "--system-prompt", CONFIG.systemPrompt,
      "--output-format", "text",
      "--dangerously-skip-permissions",
    ];

    // Windowsでは .cmd を cmd.exe 経由で実行。配列引数でインジェクションを防ぐ
    const proc = spawn("cmd.exe", ["/c", CONFIG.claudePath, ...args], {
      cwd,
      shell: false,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => { stdout += data.toString(); });
    proc.stderr.on("data", (data) => { stderr += data.toString(); });

    // timeoutMs が 0 の場合はタイムアウト無効
    const timer = CONFIG.timeoutMs > 0
      ? setTimeout(() => {
          proc.kill();
          reject(new Error(`タイムアウト（${CONFIG.timeoutMs / 1000}秒）`));
        }, CONFIG.timeoutMs)
      : null;

    proc.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (code !== 0 && !stdout) {
        reject(new Error(stderr.slice(0, 500) || `終了コード: ${code}`));
      } else {
        resolve(stdout.trim());
      }
    });

    proc.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });
}

async function runClaudeCodeWithRetry(prompt, cwd) {
  let lastError;
  const maxAttempts = CONFIG.retryCount + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await runClaudeCode(prompt, cwd);
    } catch (err) {
      lastError = err;
      const isTimeout = err.message.includes("タイムアウト");
      // タイムアウトはリトライしない（同じ結果になる可能性が高い）
      if (isTimeout || attempt >= maxAttempts) break;
      logger.warn(`リトライ ${attempt}/${CONFIG.retryCount}`, { error: err.message });
      await sleep(CONFIG.retryDelayMs);
    }
  }

  throw lastError;
}

// ============================================================
// [8] COMMANDS — レジストリパターンで拡張しやすく
// ============================================================
/** @type {Map<string, (msg: Message, args: string, state: object) => Promise<void>>} */
const commands = new Map();

function registerCommand(names, handler) {
  for (const name of names) {
    commands.set(name.toLowerCase(), handler);
  }
}

function resolveCommand(text) {
  const firstWord = text.split(/\s+/)[0].toLowerCase();
  if (!firstWord.startsWith("!")) return null;
  return commands.get(firstWord) || null;
}

// !help
registerCommand(["!help"], async (message, _args, state) => {
  await message.reply({ embeds: [buildHelpEmbed(state)] });
});

// !dir / !pwd
registerCommand(["!dir", "!pwd"], async (message, _args, state) => {
  await message.reply({ embeds: [buildDirEmbed(state)] });
});

// !status
registerCommand(["!status"], async (message, _args, state) => {
  await message.reply({ embeds: [buildStatusEmbed(state)] });
});

// !setdir
registerCommand(["!setdir"], async (message, args, state) => {
  const newDir = args.trim();
  if (!newDir) {
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLOR.error)
          .setTitle("❌ パスを指定してください")
          .setDescription("例: `!setdir C:\\Users\\user\\myproject`")
          .setTimestamp(),
      ],
    });
    return;
  }
  state.workDir = newDir;
  logger.info("作業ディレクトリ変更", {
    channel: message.channel.id,
    dir: newDir,
    user: message.author.tag,
  });
  await message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLOR.success)
        .setTitle("📁 作業ディレクトリを変更しました")
        .setDescription(`\`${newDir}\``)
        .setTimestamp(),
    ],
  });
});

// ============================================================
// [9] MESSAGE HANDLER — メインルーティング
// ============================================================
async function handleClaudeRequest(message, prompt, state) {
  // 排他制御: 同一チャンネルの並行リクエストを拒否
  if (state.busy) {
    await message.reply({ embeds: [buildBusyEmbed(state)] });
    return;
  }

  state.busy = true;
  state.requestId = message.id;
  const startTime = Date.now();

  logger.info("Claude実行開始", {
    channel: message.channel.name || message.channel.id,
    user: message.author.tag,
    cwd: state.workDir,
    prompt: prompt.slice(0, 80),
  });

  // 添付ファイルをダウンロード
  const downloadedFiles = [];
  if (message.attachments.size > 0) {
    for (const [, attachment] of message.attachments) {
      const safeName = path
        .basename(attachment.name)
        .replace(/[^a-zA-Z0-9._-]/g, "_");
      const destPath = path.join(state.workDir, safeName);
      try {
        await downloadFile(attachment.url, destPath);
        downloadedFiles.push(safeName);
        logger.info("添付ファイルDL完了", { file: safeName });
      } catch (e) {
        logger.error("添付ファイルDL失敗", { file: safeName, error: e.message });
      }
    }
  }

  // 添付ファイル情報をプロンプトに追記
  let finalPrompt = prompt;
  if (downloadedFiles.length > 0) {
    finalPrompt +=
      `\n\n（作業ディレクトリに以下のファイルをダウンロード済みです: ${downloadedFiles.join(", ")}）`;
  }

  // 進捗メッセージを即座に送信
  let progressMsg;
  try {
    progressMsg = await message.reply({
      embeds: [buildProgressEmbed(prompt, state, startTime)],
    });
  } catch {
    // reply が失敗した場合は channel.send で代替
    progressMsg = await message.channel.send({
      embeds: [buildProgressEmbed(prompt, state, startTime)],
    });
  }

  // 定期的に進捗メッセージを更新（経過時間表示）
  const progressInterval = setInterval(async () => {
    progressMsg
      .edit({ embeds: [buildProgressEmbed(prompt, state, startTime)] })
      .catch(() => {}); // メッセージ削除済みなどの場合は無視
  }, CONFIG.progressUpdateIntervalMs);

  try {
    const result = await runClaudeCodeWithRetry(finalPrompt, state.workDir);
    const durationMs = Date.now() - startTime;

    logger.info("Claude実行完了", {
      channel: message.channel.name || message.channel.id,
      durationMs,
    });

    clearInterval(progressInterval);

    // 結果テキストを分割
    const chunks = result ? splitRespectingCodeBlocks(result, CONFIG.chunkSize) : [];

    // 進捗メッセージを完了Embed + 最初のチャンクに更新（1メッセージにまとめる）
    await progressMsg
      .edit({
        content: chunks.length > 0 ? chunks[0] : null,
        embeds: [buildResultEmbed(prompt, durationMs)],
      })
      .catch(() => {});

    // 残りのチャンク（2つ目以降）だけ追加送信
    for (let i = 1; i < chunks.length; i++) {
      await message.channel.send({ content: chunks[i] });
    }
  } catch (err) {
    const durationMs = Date.now() - startTime;

    logger.error("Claude実行エラー", {
      channel: message.channel.name || message.channel.id,
      durationMs,
      error: err.message,
    });

    clearInterval(progressInterval);

    await progressMsg
      .edit({ embeds: [buildErrorEmbed(err)] })
      .catch(() => {});
  } finally {
    state.busy = false;
    state.requestId = null;
  }
}

// ============================================================
// [10] DISCORD CLIENT
// ============================================================
const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

discord.on("ready", () => {
  logger.info(`Bot起動: ${discord.user.tag}`);
  logger.info(`デフォルト作業ディレクトリ: ${CONFIG.defaultWorkDir}`);
  logger.info(`設定: maxTurns=${CONFIG.maxTurns}, timeout=${CONFIG.timeoutMs / 1000}s, retry=${CONFIG.retryCount}`);
});

discord.on("messageCreate", async (message) => {
  // Bot自身のメッセージは無視
  if (message.author.bot) return;

  // メンションがない場合は無視
  if (!message.mentions.has(discord.user)) return;

  // メンション部分を除去してユーザーの入力を取得
  const userMessage = message.content.replace(/<@!?\d+>/g, "").trim();

  const state = getState(message.channel.id);

  // 空メッセージ → ヘルプ表示
  if (!userMessage) {
    await message.reply({ embeds: [buildHelpEmbed(state)] });
    return;
  }

  // ! コマンドの解決
  const commandHandler = resolveCommand(userMessage);
  if (commandHandler) {
    // コマンド名の後ろの部分を args として渡す
    const args = userMessage.slice(userMessage.split(/\s+/)[0].length).trim();
    try {
      await commandHandler(message, args, state);
    } catch (err) {
      logger.error("コマンド実行エラー", { command: userMessage, error: err.message });
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLOR.error)
            .setTitle("❌ コマンドエラー")
            .setDescription(`\`\`\`\n${err.message.slice(0, 500)}\n\`\`\``)
            .setTimestamp(),
        ],
      });
    }
    return;
  }

  // ! で始まる不明なコマンド
  if (userMessage.startsWith("!")) {
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLOR.warning)
          .setTitle("⚠️ 不明なコマンド")
          .setDescription(`\`${userMessage.split(/\s+/)[0]}\` は未定義のコマンドです。`)
          .addFields({ name: "ヘルプ", value: "`!help` でコマンド一覧を確認できます。" })
          .setTimestamp(),
      ],
    });
    return;
  }

  // Claude Code リクエスト
  await handleClaudeRequest(message, userMessage, state);
});

// ============================================================
// [11] BOOT
// ============================================================
discord.login(process.env.DISCORD_TOKEN);
