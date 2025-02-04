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

// ================== CVB 核心类 ==================
export class Cvb {
  private content: string;
  private metadata: Record<string, string>;
  private files: Record<string, string>;

  constructor(cvbContent: string) {
    const { cvbContent: content, metadata, files } = this.parse(cvbContent);
    this.content = content;
    this.metadata = metadata;
    this.files = files;
  }

  getMetadata(): Record<string, string> {
    return this.metadata;
  }

  setMetaData(key: string, metadata : string) {
    this.metadata[key] = metadata;
  }

  getFiles(): Record<string, string> {
    return this.files;
  }

  getUserRequest(): string {
    return this.metadata['@用户需求'] || '';
  }

  getTimestamp(): string {
    return this.metadata['@时间戳'] || '';
  }

  toString(): string {
    return this.content;
  }

  private parse(cvbContent: string): {
    cvbContent: string;
    metadata: Record<string, string>;
    files: Record<string, string>;
  } {
    // 匹配## BEGIN_CVB在行首的位置
    const cvbStartRegex = /^## BEGIN_CVB(\s|$)/m;
    const cvbStartMatch = cvbStartRegex.exec(cvbContent);
    if (!cvbStartMatch) {
      throw new Error('Invalid CVB format: missing BEGIN_CVB marker.');
    }
    const cvbStartIndex = cvbStartMatch.index;

    // 匹配## END_CVB在行首的位置
    const cvbEndRegex = /^## END_CVB(\s|$)/m;
    const cvbEndMatch = cvbEndRegex.exec(cvbContent);
    if (!cvbEndMatch) {
      throw new Error('Invalid CVB format: missing END_CVB marker.');
    }
    const cvbEndIndex = cvbEndMatch.index;

    // 提取CVB内容，包括## BEGIN_CVB和## END_CVB
    const cvbContentStr = cvbContent.slice(cvbStartIndex, cvbEndIndex + cvbEndMatch[0].length);

    // 提取元数据部分
    const metaRegex = /^## META\n([\s\S]*?)^## END_META(\s|$)/m;
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

  static getFormatDescription(): string {
    return `
  CVB 格式介绍:
  - 文件以 "## BEGIN_CVB" 开头，以 "## END_CVB" 结尾。
  - 元数据部分以 "## META" 开头，以 "## END_META" 结尾，包含用户需求和时间戳。
  - 每个文件以 "## FILE:文件路径" 开头，紧接着是 Markdown 格式的代码块，包含文件内容。
  - 多个文件按顺序拼接在一起。
    `;
  }
}

// ================== TCVB 差量格式 ==================
abstract class CvbOperation {
  constructor(
    public readonly filePath: string,
    public readonly type: 'replace' | 'insert' | 'delete'
  ) {}
}

class ReplaceOperation extends CvbOperation {
  constructor(
    filePath: string,
    public readonly beforeAnchor: string,
    public readonly afterAnchor: string,
    public readonly oldContent: string,
    public readonly newContent: string
  ) {
    super(filePath, 'replace');
  }
}

class InsertOperation extends CvbOperation {
  constructor(
    filePath: string,
    public readonly beforeAnchor: string,
    public readonly afterAnchor: string,
    public readonly content: string
  ) {
    super(filePath, 'insert');
  }
}

class DeleteOperation extends CvbOperation {
  constructor(
    filePath: string,
    public readonly beforeAnchor: string,
    public readonly afterAnchor: string,
    public readonly oldContent: string
  ) {
    super(filePath, 'delete');
  }
}

export class TCVB {
  private operations: CvbOperation[] = [];

  constructor(tcvbContent: string) {
    this.parse(tcvbContent);
  }

  private parse(content: string) {
    const fileBlockRegex = /^## FILE:(.*?)\n([\s\S]*?)(?=^## FILE:|^## END_TCVB)/gm;
    let fileMatch: RegExpExecArray | null;
    
    while ((fileMatch = fileBlockRegex.exec(content)) !== null) {
      const filePath = filePathNormalize(fileMatch[1]);
      const operationsBlock = fileMatch[2];
      
      const operationRegex = /^## OPERATION:(\w+)(?:\s+FILE:(.*?))?\n([\s\S]*?)(?=^## OPERATION:|^## FILE:|^## END_TCVB)/gm;
      let opMatch: RegExpExecArray | null;

      while ((opMatch = operationRegex.exec(operationsBlock)) !== null) {
        const type = opMatch[1].toLowerCase();
        const explicitFilePath = opMatch[2] ? filePathNormalize(opMatch[2]) : null;
        const operationContent = opMatch[3].trim();

        const finalFilePath = explicitFilePath || filePath;
        this.parseOperation(finalFilePath, type, operationContent);
      }
    }
  }

  private parseOperation(filePath: string, type: string, content: string) {
    try {
      switch (type) {
        case 'replace':
          this.parseReplace(filePath, content);
          break;
        case 'insert':
          this.parseInsert(filePath, content);
          break;
        case 'delete':
          this.parseDelete(filePath, content);
          break;
        default:
          throw new Error(`Unknown operation type: ${type}`);
      }
    } catch (e) {
      console.error(`Failed to parse ${type} operation for ${filePath}: ${e}`);
    }
  }

  private parseReplace(filePath: string, content: string) {
    const sections = this.parseSections(content, ['BEFORE_ANCHOR', 'AFTER_ANCHOR', 'OLD_CONTENT', 'NEW_CONTENT']);
    this.operations.push(new ReplaceOperation(
      filePath,
      sections.BEFORE_ANCHOR,
      sections.AFTER_ANCHOR,
      sections.OLD_CONTENT,
      sections.NEW_CONTENT
    ));
  }

  private parseInsert(filePath: string, content: string) {
    const sections = this.parseSections(content, ['BEFORE_ANCHOR', 'AFTER_ANCHOR', 'INSERT_CONTENT']);
    this.operations.push(new InsertOperation(
      filePath,
      sections.BEFORE_ANCHOR,
      sections.AFTER_ANCHOR,
      sections.INSERT_CONTENT
    ));
  }

  private parseDelete(filePath: string, content: string) {
    const sections = this.parseSections(content, ['BEFORE_ANCHOR', 'AFTER_ANCHOR', 'DELETE_CONTENT']);
    this.operations.push(new DeleteOperation(
      filePath,
      sections.BEFORE_ANCHOR,
      sections.AFTER_ANCHOR,
      sections.DELETE_CONTENT
    ));
  }

  private parseSections(content: string, expectedSections: string[]): Record<string, string> {
    const result: Record<string, string> = {};
    let currentSection: string | null = null;
    let buffer: string[] = [];

    for (const line of content.split('\n')) {
      const sectionMatch = line.match(/^## ([A-Z_]+)/);
      if (sectionMatch) {
        if (currentSection) {
          result[currentSection] = buffer.join('\n').trim();
          buffer = [];
        }
        currentSection = sectionMatch[1];
        if (!expectedSections.includes(currentSection)) {
          throw new Error(`Unexpected section: ${currentSection}`);
        }
      } else if (currentSection) {
        buffer.push(line);
      }
    }

    if (currentSection) {
      result[currentSection] = buffer.join('\n').trim();
    }

    // Validate required sections
    for (const section of expectedSections) {
      if (!(section in result)) {
        throw new Error(`Missing required section: ${section}`);
      }
    }

    return result;
  }

  getOperations(): CvbOperation[] {
    return [...this.operations];
  }

  static getFormatDescription(): string {
    return `
TCVB 格式规范（版本2.0）：

## BEGIN_TCVB
[文件块1]
[文件块2]
...
## END_TCVB

文件块格式：
## FILE:<文件路径>
[操作1]
[操作2]
...

操作类型：
1. 替换操作（REPLACE）:
## OPERATION:REPLACE
## BEFORE_ANCHOR
[前锚点内容]
## AFTER_ANCHOR
[后锚点内容]
## OLD_CONTENT
[被替换内容]
## NEW_CONTENT
[新内容]

2. 插入操作（INSERT）:
## OPERATION:INSERT
## BEFORE_ANCHOR
[插入位置前锚点]
## AFTER_ANCHOR
[插入位置后锚点]
## INSERT_CONTENT
[插入内容]

3. 删除操作（DELETE）:
## OPERATION:DELETE
## BEFORE_ANCHOR
[被删内容前锚点]
## AFTER_ANCHOR
[被删内容后锚点]
## DELETE_CONTENT
[被删除内容]

高级特性：
1. 文件路径复用：同一文件下的多个操作共享FILE声明
2. 混合操作：允许在文件块内任意顺序组合操作类型
3. 精准锚点：使用至少3行唯一文本作为锚点
4. 跨文件操作：可通过## OPERATION:TYPE FILE:path 临时指定其他文件

示例：
## BEGIN_TCVB
## FILE:src/app.js
## OPERATION:REPLACE
## BEFORE_ANCHOR
function legacy() {
  console.log('old');
## AFTER_ANCHOR
}

## OLD_CONTENT
  return 100;
## NEW_CONTENT
  return 200;

## OPERATION:INSERT
## BEFORE_ANCHOR
// == 配置开始 ==
## AFTER_ANCHOR
// == 配置结束 ==
## INSERT_CONTENT
  timeout: 3000,

## FILE:README.md
## OPERATION:DELETE
## BEFORE_ANCHOR
<!-- DEPRECATED SECTION -->
## AFTER_ANCHOR
<!-- END DEPRECATED -->
## DELETE_CONTENT
...旧内容...
## END_TCVB
`;
  }
}

// ================== 合并函数 ==================
export function mergeCvb(baseCvb: Cvb, tcvb: TCVB): Cvb {
  const mergedFiles = new Map<string, string>(Object.entries(baseCvb.getFiles()));

  // 按文件分组操作
  const operationsByFile = new Map<string, CvbOperation[]>();
  for (const op of tcvb.getOperations()) {
    if (!operationsByFile.has(op.filePath)) {
      operationsByFile.set(op.filePath, []);
    }
    operationsByFile.get(op.filePath)!.push(op);
  }

  // 处理每个文件的修改
  for (const [filePath, operations] of operationsByFile) {
    let content = mergedFiles.get(filePath) || '';
    
    // 按操作顺序执行修改
    for (const op of operations) {
      if (op instanceof ReplaceOperation) {
        content = applyReplace(content, op);
      } else if (op instanceof InsertOperation) {
        content = applyInsert(content, op);
      } else if (op instanceof DeleteOperation) {
        content = applyDelete(content, op);
      }
    }
    
    mergedFiles.set(filePath, content);
  }

  // 重新生成CVB内容
  return rebuildCvb(baseCvb, mergedFiles);
}

function applyReplace(content: string, op: ReplaceOperation): string {
  const pattern = buildPattern(op.beforeAnchor, op.oldContent, op.afterAnchor);
  const replacement = `${op.beforeAnchor}${op.newContent}${op.afterAnchor}`;
  return content.replace(pattern, replacement);
}

function applyInsert(content: string, op: InsertOperation): string {
  const pattern = buildPattern(op.beforeAnchor, '', op.afterAnchor);
  const replacement = `${op.beforeAnchor}${op.content}${op.afterAnchor}`;
  return content.replace(pattern, replacement);
}

function applyDelete(content: string, op: DeleteOperation): string {
  const pattern = buildPattern(op.beforeAnchor, op.oldContent, op.afterAnchor);
  return content.replace(pattern, `${op.beforeAnchor}${op.afterAnchor}`);
}

function buildPattern(before: string, content: string, after: string): RegExp {
  return new RegExp(
    `${escapeRegExp(before)}${escapeRegExp(content)}${escapeRegExp(after)}`,
    'gs' // 使用dotall模式匹配换行
  );
}

function rebuildCvb(baseCvb: Cvb, files: Map<string, string>): Cvb {
  let newContent = `## BEGIN_CVB\n## META\n`;
  
  // 保留元数据
  const metadata = baseCvb.getMetadata();
  for (const [key, value] of Object.entries(metadata)) {
    newContent += `${key}: ${value}\n`;
  }
  newContent += `## END_META\n\n`;

  // 重建文件内容
  for (const [filePath, content] of files) {
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const lang = languageMapping[ext] || 'text';
    newContent += `## FILE:${filePath}\n\`\`\`${lang}\n${content}\n\`\`\`\n\n`;
  }

  newContent += `## END_CVB`;
  const cvb = new Cvb(newContent);

  cvb.setMetaData("时间戳", generateTimestamp());
  return cvb;
}

// ================== 工具函数 ==================
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function filePathNormalize(rawPath: string): string {
  return path.normalize(rawPath.replace(/^[\\/]+/, ''));
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

    // 添加 CVB 结束标记
    cvbContent += `## END_CVB\n`;
    
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
  const cvb = new Cvb(cvbContent);
  const files = cvb.getFiles();

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