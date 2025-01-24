import * as fs from 'fs';
import * as path from 'path';
import * as jschardet from 'jschardet'; // 编码检测库
import * as iconv from 'iconv-lite'; // 编码转换库
import * as vscode from 'vscode';
import { generateFilenameFromRequest } from './deepseekApi';

// 语言映射表
const languageMapping: { [key: string]: string } = {
  'cpp': 'c++',
  'hpp': 'c++',
  'h': 'c++',
  'lua': 'lua',
  'ls': 'lua',
  'lh': 'lua',
  'py': 'python',
  'ts': 'typescript',
  'js': 'javascript'
};

/**
 * 返回 CVB 格式介绍的静态字符串
 * @returns CVB 格式介绍
 */
export function getCvbFormatDescription(): string {
  return `
CVB 格式介绍:
- 文件以 "## BEGIN_CVB" 开头，以 "## END_CVB" 结尾。
- 元数据部分以 "## META" 开头，以 "## END_META" 结尾，包含用户需求和时间戳。
- 每个文件以 "## FILE:文件路径" 开头，紧接着是 Markdown 格式的代码块，包含文件内容。
- 多个文件按顺序拼接在一起。
  `;
}

/**
 * 检测文件编码并转换为 UTF-8
 * @param filePath 文件路径
 * @returns 转换后的 UTF-8 内容
 */
function readFileWithEncoding(filePath: string): string {
  const buffer = fs.readFileSync(filePath);
  const detected = jschardet.detect(buffer);
  let encoding = detected.encoding.toLowerCase();

  // 如果检测结果为 ascii，进一步判断是否为 GBK
  if (encoding === 'ascii') {
    if (isLikelyGBK(buffer)) {
      encoding = 'gbk';
    } else {
      encoding = 'utf-8'; // 默认使用 UTF-8
    }
  }

  // 根据编码进行转换
  if (encoding === 'utf-8') {
    return buffer.toString('utf-8');
  }

  if (encoding === 'gbk' || encoding === 'gb2312' || encoding === 'windows-1252') {
    return iconv.decode(buffer, 'gbk');
  }

  throw new Error(`Unsupported encoding: ${encoding}`);
}

/**
 * 判断 buffer 是否可能是 GBK 编码
 * @param buffer 文件内容的 buffer
 * @returns 是否为 GBK 编码
 */
function isLikelyGBK(buffer: Buffer): boolean {
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] >= 0x81 && buffer[i] <= 0xFE) {
      if (i + 1 < buffer.length && (buffer[i + 1] >= 0x40 && buffer[i + 1] <= 0xFE)) {
        return true;
      }
    }
  }
  return false;
}

export function generateTimestamp(): string {
    const now = new Date();
    const year = now.getFullYear().toString().slice(-2);
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const hour = now.getHours().toString().padStart(2, '0');
    const minute = now.getMinutes().toString().padStart(2, '0');
    const second = now.getSeconds().toString().padStart(2, '0');
    return `${year}${month}${day}${hour}${minute}${second}`;
}

/**
 * 生成 CVB 格式的文件
 * @param filePaths 文件路径数组
 * @param userRequest 用户输入的重构需求
 * @returns 生成的 CVB 文件路径
 */
export async function generateCvb(filePaths: string[], userRequest: string): Promise<string> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        throw new Error('No workspace folder found.');
    }

    const workspacePath = workspaceFolders[0].uri.fsPath;

    // Create temporary directory (if not exists)
    const tmpDir = path.join(workspacePath, '.CodeReDesignWorkSpace');
    if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
    }

    // Generate CVB header
    const timestamp = generateTimestamp();
    let cvbContent = `## BEGIN_CVB\n`;
    cvbContent += `## META\n`;
    cvbContent += `@用户需求: ${userRequest}\n`;
    cvbContent += `@时间戳: ${timestamp}\n`;
    cvbContent += `## END_META\n\n`;

    // Generate CVB body (file contents)
    for (const filePath of filePaths) {
        try {
            const fileContent = readFileWithEncoding(filePath);
            const ext = path.extname(filePath).slice(1).toLowerCase();
            const lang = languageMapping[ext] || 'text';
            cvbContent += `## FILE:${filePath}\n`;
            cvbContent += '```' + lang + '\n';
            cvbContent += fileContent + '\n';
            cvbContent += '```\n\n';
        } catch (error) {
            console.error(`Failed to read file ${filePath}:`, error);
        }
    }

    // Get summary of user request for filename
    let summary = await generateFilenameFromRequest (userRequest);
    if (!summary || summary.length === 0) {
        summary = 'default';
    }

    // Create the base filename
    let baseFileName = `${timestamp}_${summary}.cvb`;

    // Ensure the filename is unique
    let fileName = baseFileName;
    let i = 1;
    while (fs.existsSync(path.join(tmpDir, fileName))) {
        fileName = `${timestamp}_${summary}_${i}.cvb`;
        i++;
    }

    // Full path for the CVB file
    const cvbFilePath = path.join(tmpDir, fileName);

    // Write CVB content to file
    fs.writeFileSync(cvbFilePath, cvbContent, 'utf-8');

    return cvbFilePath;
}

/**
 * 解析 CVB 格式内容
 * @param cvbContent CVB 内容
 * @returns 包含 CVB 字符串、元数据和文件内容的对象
 */
export function parseCvb(cvbContent: string): {
  cvbContent: string;
  metadata: Record<string, string>;
  files: Record<string, string>;
} {
  // 匹配## BEGIN_CVB在行首的位置
  const cvbStartRegex = /^## BEGIN_CVB/m;
  const cvbStartMatch = cvbStartRegex.exec(cvbContent);
  if (!cvbStartMatch) {
    throw new Error('Invalid CVB format: missing BEGIN_CVB marker.');
  }
  const cvbStartIndex = cvbStartMatch.index;

  // 匹配## END_CVB在行首的位置
  const cvbEndRegex = /^## END_CVB/m;
  const cvbEndMatch = cvbEndRegex.exec(cvbContent);
  if (!cvbEndMatch) {
    throw new Error('Invalid CVB format: missing END_CVB marker.');
  }
  const cvbEndIndex = cvbEndMatch.index;

  // 提取CVB内容，包括## BEGIN_CVB和## END_CVB
  const cvbContentStr = cvbContent.slice(cvbStartIndex, cvbEndIndex + cvbEndMatch[0].length);

  // 提取元数据部分
  const metaRegex = /^## META\n([\s\S]*?)^## END_META/m;
  const metaMatch = metaRegex.exec(cvbContentStr);
  if (!metaMatch) {
    throw new Error('Invalid CVB format: missing META section.');
  }
  const metadata: Record<string, string> = {};
  const metaContent = metaMatch[1].trim().split('\n');
  metaContent.forEach(line => {
    const parts = line.split(':');
    if (parts.length >= 2) {
      const key = parts.shift()?.trim();
      const value = parts.join(':').trim();
      if (key) {
        metadata[key] = value;
      }
    }
  });

  // 提取文件内容部分
  const files: Record<string, string> = {};
  const fileRegex = /^## FILE:(.*?)\n([\s\S]*?)(?=^## FILE:|^## END_CVB)/gm;
  let match: RegExpExecArray | null;

  while ((match = fileRegex.exec(cvbContentStr)) !== null) {
    const filePath = match[1];
    let fileContent = match[2].trim();
    // 去除代码块标记
    const codeBlockRegex = /^```.*\n([\s\S]*?)\n```$/m;
    const codeBlockMatch = codeBlockRegex.exec(fileContent);
    if (codeBlockMatch) {
      fileContent = codeBlockMatch[1];
    }
    files[filePath] = fileContent;
  }

  return {
    cvbContent: cvbContentStr,
    metadata,
    files,
  };
}

/**
 * 将 CVB 文件内容应用到当前工作目录
 * @param cvbContent CVB 文件内容
 */
export function applyCvbToWorkspace(cvbContent: string): void {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    throw new Error('No workspace folder found.');
  }

  const workspacePath = workspaceFolders[0].uri.fsPath;

  // 解析 CVB 文件内容
  const { files } = parseCvb(cvbContent);

  // 遍历文件内容
  for (const [filePath, fileContent] of Object.entries(files)) {
    // 解析文件路径
    const normalizedFilePath = path.normalize(filePath);

    // 安全检查：确保文件路径不会超出当前工作目录
    const absoluteFilePath = path.resolve(workspacePath, normalizedFilePath);
    if (!absoluteFilePath.startsWith(workspacePath)) {
      throw new Error(`Invalid file path: ${filePath}. File path is outside the workspace.`);
    }

    // 创建目录（如果不存在）
    const dirPath = path.dirname(absoluteFilePath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    // 写入文件
    fs.writeFileSync(absoluteFilePath, fileContent, 'utf-8');
  }

  vscode.window.showInformationMessage('CVB applied successfully!');
}