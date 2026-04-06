// ============================================================
// 添付ファイルダウンロードサービス
// - ファイルサイズ制限
// - パストラバーサル対策
// ============================================================
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { config } = require("../config");
const logger = require("../logger");

/**
 * URLからファイルをダウンロードして destDir に保存
 * @param {string} url ダウンロード元URL
 * @param {string} destDir 保存先ディレクトリ
 * @param {string} originalName 元ファイル名
 * @returns {Promise<{safeName: string, destPath: string}>}
 */
function downloadFile(url, destDir, originalName) {
  return new Promise((resolve, reject) => {
    const safeName =
      path
        .basename(originalName || "attachment")
        .replace(/[^a-zA-Z0-9._-]/g, "_") || "attachment";

    // パストラバーサル対策
    const destPath = path.resolve(destDir, safeName);
    if (!destPath.startsWith(path.resolve(destDir) + path.sep)) {
      return reject(new Error("不正なファイルパスが検出されました"));
    }

    const proto = url.startsWith("https") ? https : http;
    const file = fs.createWriteStream(destPath);
    let downloadedSize = 0;
    let settled = false;

    const req = proto.get(url, (res) => {
      // Discordの添付ファイルはリダイレクトしないが念のためチェック
      if (res.statusCode >= 300 && res.statusCode < 400) {
        file.close();
        fs.unlink(destPath, () => {});
        return reject(new Error(`リダイレクト未対応: ${res.statusCode}`));
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(destPath, () => {});
        return reject(new Error(`HTTPエラー: ${res.statusCode}`));
      }

      res.on("data", (chunk) => {
        downloadedSize += chunk.length;
        if (downloadedSize > config.MAX_FILE_SIZE) {
          settled = true;
          req.destroy();
          file.close();
          fs.unlink(destPath, () => {});
          reject(
            new Error(
              `ファイルサイズが上限（${Math.floor(config.MAX_FILE_SIZE / 1024 / 1024)}MB）を超えています`
            )
          );
        }
      });

      res.pipe(file);

      file.on("finish", () => {
        if (!settled) {
          file.close(() => {
            logger.info(`ダウンロード完了: ${safeName}`, {
              size: downloadedSize,
            });
            resolve({ safeName, destPath });
          });
        }
      });
    });

    req.on("error", (err) => {
      if (!settled) {
        fs.unlink(destPath, () => {});
        reject(err);
      }
    });

    file.on("error", (err) => {
      if (!settled) {
        fs.unlink(destPath, () => {});
        reject(err);
      }
    });
  });
}

module.exports = { downloadFile };
