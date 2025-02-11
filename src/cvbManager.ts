import * as fs from 'fs';
import * as path from 'path';
import * as jschardet from 'jschardet'; // 编码检测库
import * as iconv from 'iconv-lite'; // 编码转换库
import * as vscode from 'vscode';
import { generateFilenameFromRequest } from './deepseekApi';

// 语言映射表
const g_objLanguageMapping: { [key: string]: string } = {
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
export class Cvb
{
  private m_strContent : string;
  private m_recMetadata : Record<string, string>;
  private m_recFiles : Record<string, string>;

  constructor(cvbContent: string)
  {
    const { cvbContent: m_strContent, metadata: m_recMetadata, files: m_recFiles } = this.parse(cvbContent);
    this.m_strContent = m_strContent;
    this.m_recMetadata = m_recMetadata;
    this.m_recFiles = m_recFiles;
  }

  public getMetadata() : Record<string, string>
  {
    return this.m_recMetadata;
  }

  public setMetaData(strKey: string, strValue: string) : void
  {
    this.m_recMetadata[strKey] = strValue;
  }

  public getFiles() : Record<string, string>
  {
    return this.m_recFiles;
  }

  public getUserRequest() : string
  {
    return this.m_recMetadata['@用户需求'] || '';
  }

  public getTimestamp() : string
  {
    return this.m_recMetadata['@时间戳'] || '';
  }

  public toString() : string
  {
    return this.m_strContent;
  }

  private parse(strCvbContent: string) : { cvbContent: string, metadata: Record<string, string>, files: Record<string, string> }
  {
    // 查找 CVB 开始与结束标记
    const regCvbStart: RegExp = /^## BEGIN_CVB(\s|$)/m;
    const arrStartMatch = regCvbStart.exec(strCvbContent);
    if (!arrStartMatch)
    {
      throw new Error('Invalid CVB format: missing BEGIN_CVB marker.');
    }
    const iCvbStartIndex = arrStartMatch.index;

    const regCvbEnd: RegExp = /^## END_CVB(\s|$)/m;
    const arrEndMatch = regCvbEnd.exec(strCvbContent);
    if (!arrEndMatch)
    {
      throw new Error('Invalid CVB format: missing END_CVB marker.');
    }
    const iCvbEndIndex = arrEndMatch.index;

    // 提取 CVB 部分内容
    const strCvbContentPart = strCvbContent.slice(iCvbStartIndex, iCvbEndIndex + arrEndMatch[0].length);

    // 解析 META 部分
    const regMeta: RegExp = /^## META\n([\s\S]*?)^## END_META(\s|$)/m;
    const arrMetaMatch = regMeta.exec(strCvbContentPart);
    if (!arrMetaMatch)
    {
      throw new Error('Invalid CVB format: missing META section.');
    }
    const recMetadata: Record<string, string> = { };
    const arrMetaLines = arrMetaMatch[1].trim().split('\n');
    for (const strLine of arrMetaLines)
    {
      const arrParts = strLine.split(':');
      if (arrParts.length >= 2)
      {
        const strKey = arrParts.shift()?.trim();
        const strValue = arrParts.join(':').trim();
        if (strKey)
        {
          recMetadata[strKey] = strValue;
        }
      }
    }

    // 解析文件部分
    const recFiles: Record<string, string> = { };
    const regFile: RegExp = /^## FILE:([^<\r\n]+)\n([\s\S]*?)(?=^## FILE:|^## END_CVB)/gm;
    let arrFileMatch: RegExpExecArray | null;
    while ((arrFileMatch = regFile.exec(strCvbContentPart)) !== null)
    {
      const strFilePath: string = filePathNormalize(arrFileMatch[1]);
      let strFileContent: string = arrFileMatch[2].trim();
      // 去除代码块标记
      const regCodeBlock: RegExp = /^```.*\n([\s\S]*?)\n```$/m;
      const arrCodeMatch = regCodeBlock.exec(strFileContent);
      if (arrCodeMatch)
      {
        strFileContent = arrCodeMatch[1];
      }
      recFiles[strFilePath] = strFileContent;
    }

    return {
      cvbContent: strCvbContentPart,
      metadata: recMetadata,
      files: recFiles
    };
  }

  public static getFormatDescription() : string
  {
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

// 抽象操作类，使用匈牙利命名法
abstract class TcvbOperation
{
  constructor(
    public readonly m_strFilePath: string,
    public readonly m_strType: 'exact-replace' | 'global-replace' | 'create'
  )
  {
  }
}

// 1. 单个替换操作（EXACT-REPLACE）
class ExactReplaceOperation extends TcvbOperation
{
  public m_strBeforeAnchor: string;
  public m_strAfterAnchor: string;
  public m_strOldContent: string;
  public m_strNewContent: string;

  constructor(
    m_strFilePath: string,
    m_strBeforeAnchor: string,
    m_strAfterAnchor: string,
    m_strOldContent: string,
    m_strNewContent: string
  )
  {
    super(m_strFilePath, 'exact-replace');
    this.m_strBeforeAnchor = m_strBeforeAnchor;
    this.m_strAfterAnchor = m_strAfterAnchor;
    this.m_strOldContent = m_strOldContent;
    this.m_strNewContent = m_strNewContent;
  }
}

// 2. 全局替换操作（GLOBAL-REPLACE）
class GlobalReplaceOperation extends TcvbOperation
{
  public m_strOldContent: string;
  public m_strNewContent: string;

  constructor(
    m_strFilePath: string,
    m_strOldContent: string,
    m_strNewContent: string
  )
  {
    super(m_strFilePath, 'global-replace');
    this.m_strOldContent = m_strOldContent;
    this.m_strNewContent = m_strNewContent;
  }
}

// 3. 创建操作（CREATE）——新写文件，后面直接跟正文内容即可
class CreateOperation extends TcvbOperation
{
  public m_strContent: string;

  constructor(
    m_strFilePath: string,
    m_strContent: string
  )
  {
    super(m_strFilePath, 'create');
    this.m_strContent = m_strContent;
  }
}

export class TCVB
{
  private m_arrOperations: TcvbOperation[] = [ ];

  constructor(tcStrContent: string)
  {
    this.parse(tcStrContent);
  }

  private parse(tcStrContent: string) : void
  {
    // 匹配文件块，每个文件块以 "## FILE:" 开头
    const regFileBlock: RegExp = /^## FILE:(.*?)\n([\s\S]*?)(?=^## FILE:|^## END_TCVB)/gm;
    let arrFileMatch: RegExpExecArray | null;
    while ((arrFileMatch = regFileBlock.exec(tcStrContent)) !== null)
    {
      const strFilePath: string = filePathNormalize(arrFileMatch[1]);
      const strOperationsBlock: string = arrFileMatch[2];
      // 支持操作类型中含有 "-" 符号（如 exact-replace 等）
      const regOperation: RegExp = /^## OPERATION:([\w-]+)\n([\s\S]*?)(?=^## OPERATION:|(?![\s\S]))/gm;
      let arrOpMatch: RegExpExecArray | null;
      while ((arrOpMatch = regOperation.exec(strOperationsBlock)) !== null)
      {
        const strType: string = arrOpMatch[1].toLowerCase();
        const strOpContent: string = arrOpMatch[2].trim();
        this.parseOperation(strFilePath, strType, strOpContent);
      }
    }
  }

  private parseOperation(strFilePath: string, strType: string, strContent: string) : void
  {
    try
    {
      switch (strType)
      {
        case 'global-replace':
          this.parseGlobalReplace(strFilePath, strContent);
          break;
        case 'exact-replace':
            this.parseExactReplace(strFilePath, strContent);
            break;
        case 'create':
          this.parseCreate(strFilePath, strContent);
          break;
        default:
          throw new Error(`未知的操作类型: ${strType}`);
      }
    }
    catch (err)
    {
      console.error(`解析 ${strType} 操作时出错, 文件: ${strFilePath}, 错误: ${err}`);
    }
  }

  // Exact-REPLACE 操作解析：要求 BEFORE_ANCHOR、AFTER_ANCHOR、OLD_CONTENT、NEW_CONTENT 四个段落
  private parseExactReplace(strFilePath: string, strContent: string) : void
  {
    const recSections = this.parseSections(strContent, ['BEFORE_ANCHOR', 'AFTER_ANCHOR', 'OLD_CONTENT', 'NEW_CONTENT']);
    this.m_arrOperations.push(new ExactReplaceOperation(
      strFilePath,
      recSections['BEFORE_ANCHOR'],
      recSections['AFTER_ANCHOR'],
      recSections['OLD_CONTENT'],
      recSections['NEW_CONTENT']
    ));
  }

  // GLOBAL-REPLACE 操作解析：仅要求 OLD_CONTENT 与 NEW_CONTENT
  private parseGlobalReplace(strFilePath: string, strContent: string) : void
  {
    const recSections = this.parseSections(strContent, ['OLD_CONTENT', 'NEW_CONTENT']);
    this.m_arrOperations.push(new GlobalReplaceOperation(
      strFilePath,
      recSections['OLD_CONTENT'],
      recSections['NEW_CONTENT']
    ));
  }

  // CREATE 操作解析：直接将正文内容作为新文件内容，可选地去除 Markdown 代码块
  private parseCreate(strFilePath: string, strContent: string) : void
  {
    let strNewContent: string = strContent;
    const regCodeBlock: RegExp = /^```.*\n([\s\S]*?)\n```$/m;
    const arrMatch = regCodeBlock.exec(strNewContent);
    if (arrMatch)
    {
      strNewContent = arrMatch[1];
    }
    this.m_arrOperations.push(new CreateOperation(
      strFilePath,
      strNewContent
    ));
  }

  // 辅助方法：剥离 Markdown 代码块外部包裹的 ``` 标记
  private RemoveMarkdownCodeBlock(strContent: string) : string
  {
      let strTrimmedContent: string = strContent.trim();
      const arrLines: string[] = strTrimmedContent.split('\n');
      
      if (arrLines.length >= 2)
      {
          const strFirstLine: string = arrLines[0].trim();
          const strLastLine: string = arrLines[arrLines.length - 1].trim();
          
          // 检查第一行和最后一行是否为代码块标记
          if (strFirstLine.startsWith("```") && strLastLine.startsWith("```"))
          {
              // 去除第一行和最后一行后，重新拼接内容
              arrLines.shift();
              arrLines.pop();
              strTrimmedContent = arrLines.join('\n').trim();
          }
      }
      
      return strTrimmedContent;
  }

  // 辅助方法：解析操作正文中的各个段落（段落标记格式为 "## 段落名称"）
  private parseSections(strContent: string, arrExpectedSections: string[]) : Record<string, string>
  {
      const recResult: Record<string, string> = { };
      let strCurrentSection: string | null = null;
      const arrBuffer: string[] = [ ];
      const arrLines: string[] = strContent.split('\n');
      
      for (const strLine of arrLines)
      {
          const arrSectionMatch = strLine.match(/^## ([A-Z_]+)/);
          
          if (arrSectionMatch)
          {
              if (strCurrentSection)
              {
                  // 拼接当前段落内容，并剥离 Markdown 代码块包裹的 ``` 标记
                  recResult[strCurrentSection] = this.RemoveMarkdownCodeBlock(arrBuffer.join('\n').trim());
                  arrBuffer.length = 0;
              }
              
              strCurrentSection = arrSectionMatch[1];
              
              if (arrExpectedSections.indexOf(strCurrentSection) === -1)
              {
                  throw new Error(`意外的段落: ${strCurrentSection}`);
              }
          }
          else if (strCurrentSection)
          {
              arrBuffer.push(strLine);
          }
      }
      
      // 处理最后一个段落
      if (strCurrentSection)
      {
          recResult[strCurrentSection] = this.RemoveMarkdownCodeBlock(arrBuffer.join('\n').trim());
      }
      
      // 检查是否缺少必需的段落
      for (const strSection of arrExpectedSections)
      {
          if (!(strSection in recResult))
          {
              throw new Error(`缺失必需的段落: ${strSection}`);
          }
      }
      
      return recResult;
  }

  public getOperations() : TcvbOperation[]
  {
    return [ ...this.m_arrOperations ];
  }

  public static getFormatDescription() : string
  {
    return `
TCVB 格式规范：

## BEGIN_TCVB
[文件块1]
[文件块2]
...
## END_TCVB

文件块格式：
## FILE:<文件绝对路径>
[操作1]
[操作2]
...

操作类型：

1. 全局替换操作(GLOBAL-REPLACE):
## OPERATION:GLOBAL-REPLACE
## OLD_CONTENT
[markdown代码块:被全局替换的内容]
## NEW_CONTENT
[markdown代码块:新内容]

2. 精确替换操作(EXACT-REPLACE),用于替换全局替换无法精准定位的情况:
## OPERATION:EXACT-REPLACE
## OLD_CONTENT
[markdown代码块:被替换内容]
## NEW_CONTENT
[markdown代码块:新内容]
## BEFORE_ANCHOR
[markdown代码块:OLD_CONTENT之前的几行内容, 用来划定范围上半段锚点，避免有多个类似匹配, 不能和OLD_CONTENT重合]
## AFTER_ANCHOR
[markdown代码块:OLD_CONTENT之后的几行内容, 用来划定范围下半段锚点，避免有多个类似匹配, 不能和OLD_CONTENT重合]

3. 创建操作(CREATE):
## OPERATION:CREATE
[markdown代码块:直接跟正文内容，表示新文件的全部内容]

注意：
1. 所有OPERATION操作以行为单位
2. 一个'## FILE'下可以有多个'## OPERATION'
3. 锚点为连续的多行内容：使用至少3行唯一文本作为锚点，用来标定范围，防止混淆(如果需要可以超过3行)
4. [markdown代码块], 一定要用\`\`\` ... \`\`\` 包裹,仔细检查不要漏掉。
5. 注意TCVB和CVB的区别。CVB是完整的内容，而TCVB是用来生成差量同步的，通过多个OPERATION去操作已有CVB合成新CVB
6. 插入和删除操作都可以转化为替换操作
7. 用来匹配的锚点必须和原始传入的数据完全一致，不能有缺失，不能丢弃注释。
`;
  }
}

// ================== 合并函数 ==================

export function mergeCvb(baseCvb: Cvb, tcvb: TCVB) : Cvb
{
  // 先将 baseCvb 中的所有文件内容存入 Map
  const mapMergedFiles: Map<string, string> = new Map<string, string>(Object.entries(baseCvb.getFiles()));

  // 按文件分组 TCVB 操作
  const mapOperationsByFile: Map<string, TcvbOperation[]> = new Map<string, TcvbOperation[]>();
  for (const op of tcvb.getOperations())
  {
    if (!mapOperationsByFile.has(op.m_strFilePath))
    {
      mapOperationsByFile.set(op.m_strFilePath, [ ]);
    }
    mapOperationsByFile.get(op.m_strFilePath)!.push(op);
  }

  try {
      // 对每个文件执行所有操作（按顺序执行）
      for (const [strFilePath, arrOperations] of mapOperationsByFile)
      {
          let strContent: string = mapMergedFiles.get(strFilePath) || '';
          for (const op of arrOperations)
          {
            if (op instanceof ExactReplaceOperation)
            {
              strContent = applyExactReplace(strContent, op);
            }
            else if (op instanceof GlobalReplaceOperation)
            {
              strContent = applyGlobalReplace(strContent, op);
            }
            else if (op instanceof CreateOperation)
            {
              // CREATE 操作：直接以新内容覆盖原有内容
              strContent = op.m_strContent;
            }
          }
          mapMergedFiles.set(strFilePath, strContent);
      }
  }
  catch (err: any) {
    throw new Error(`合并CVB失败: ${err.message}`);
  }

  return rebuildCvb(baseCvb, mapMergedFiles);
}

function applyExactReplace(strContent: string, op: ExactReplaceOperation): string {
  // 构建匹配模式：前锚点 + 中间内容1 + 旧内容 + 中间内容2 + 后锚点
  const regPattern = buildPattern(op.m_strBeforeAnchor, op.m_strOldContent, op.m_strAfterAnchor);
  // 替换为：前锚点 + 中间内容1 + 新内容 + 中间内容2 + 后锚点
  const strReplacement = op.m_strBeforeAnchor + '$1' + op.m_strNewContent + '$2' + op.m_strAfterAnchor;

  regPattern.lastIndex = 0; // 重置正则表达式的状态
  if (!regPattern.test(strContent)) {
    console.log("以下表达式:\n" + regPattern + "\n 无法匹配:\n");
    throw new Error(`Exact-replace操作失败：文件 "${op.m_strFilePath}" 中未找到匹配项。请检查前后锚点及旧内容是否正确。`);
  }
  regPattern.lastIndex = 0; // 再次重置以备替换

  return strContent.replace(regPattern, strReplacement);
}

function applyGlobalReplace(strContent: string, op: GlobalReplaceOperation) : string
{
  if ( op.m_strOldContent === "" )
  {
    throw new Error(`全局替换为空`);
  }

  const regPattern: RegExp = new RegExp(normalizeLineWhitespace(escapeRegExp(op.m_strOldContent)), 'gs');

  regPattern.lastIndex = 0;
  if (!regPattern.test(strContent)) {
    console.log("以下表达式:\n" + regPattern + "\n 无法匹配");
    throw new Error(`全局替换失败：文件 "${op.m_strFilePath}" 中未找到旧内容 "${op.m_strOldContent}"。`);
  }
  regPattern.lastIndex = 0;

  return strContent.replace(regPattern, op.m_strNewContent);
}

// 根据前锚点、内容、后锚点构建正则表达式（dotall 模式）
function buildPattern(strBefore: string, strContent: string, strAfter: string): RegExp {
  return new RegExp(
    normalizeLineWhitespace(escapeRegExp(strBefore)) + 
    '([\\s\\S]*?)' +   // 捕获前锚点与旧内容之间的任意字符（非贪婪）
    normalizeLineWhitespace(escapeRegExp(strContent)) + 
    '([\\s\\S]*?)' +   // 捕获旧内容与后锚点之间的任意字符（非贪婪）
    normalizeLineWhitespace(escapeRegExp(strAfter)), 
    'gs'  // 全局匹配且允许跨行
  );
}

function rebuildCvb(baseCvb: Cvb, mapFiles: Map<string, string>) : Cvb
{
  let strNewContent: string = `## BEGIN_CVB\n## META\n`;

  const recMetadata = baseCvb.getMetadata();
  for (const [strKey, strValue] of Object.entries(recMetadata))
  {
    strNewContent += `${strKey}: ${strValue}\n`;
  }
  strNewContent += `## END_META\n\n`;

  for (const [strFilePath, strContent] of mapFiles)
  {
    const strExt: string = path.extname(strFilePath).slice(1).toLowerCase();
    const strLang: string = g_objLanguageMapping[strExt] || 'text';
    strNewContent += `## FILE:${strFilePath}\n\`\`\`${strLang}\n${strContent}\n\`\`\`\n\n`;
  }

  strNewContent += `## END_CVB`;
  const cvb = new Cvb(strNewContent);

  cvb.setMetaData("时间戳", generateTimestamp());
  return cvb;
}

// ================== 工具函数 ==================

function escapeRegExp(str: string) : string
{
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeLineWhitespace(anchor: string): string {
  return anchor.split('\n')
    .map(line => {
      // 对每一行的空白字符做更精确的处理
      return `\\s*${line.trim()}\\s*`; // 保留行首和行尾的空白字符处理
    })
    .join('\n'); // 行与行之间允许有空白字符（空格、换行符等）
}

function filePathNormalize(strRawPath: string) : string
{
  return path.normalize(strRawPath.replace(/^[\\/]+/, '').trim());
}

/**
 * 检测文件编码并转换为 UTF-8
 */
function readFileWithEncoding(strFilePath: string) : string
{
  const bufFile = fs.readFileSync(strFilePath);
  const objDetected = jschardet.detect(bufFile);
  let strEncoding: string = objDetected.encoding.toLowerCase();

  if (strEncoding === 'ascii')
  {
    if (isLikelyGBK(bufFile))
    {
      strEncoding = 'gbk';
    }
    else
    {
      strEncoding = 'utf-8';
    }
  }

  if (strEncoding === 'utf-8')
  {
    return bufFile.toString('utf-8');
  }
  if (strEncoding === 'gbk' || strEncoding === 'gb2312' || strEncoding === 'windows-1252')
  {
    return iconv.decode(bufFile, 'gbk');
  }

  throw new Error(`Unsupported encoding: ${strEncoding}`);
}

function isLikelyGBK(buf: Buffer) : boolean
{
  for (let i = 0; i < buf.length; i++)
  {
    if (buf[i] >= 0x81 && buf[i] <= 0xFE)
    {
      if (i + 1 < buf.length && (buf[i + 1] >= 0x40 && buf[i + 1] <= 0xFE))
      {
        return true;
      }
    }
  }
  return false;
}

export function generateTimestamp() : string
{
  const dtNow = new Date();
  const strYear = dtNow.getFullYear().toString().slice(-2);
  const strMonth = (dtNow.getMonth() + 1).toString().padStart(2, '0');
  const strDay = dtNow.getDate().toString().padStart(2, '0');
  const strHour = dtNow.getHours().toString().padStart(2, '0');
  const strMinute = dtNow.getMinutes().toString().padStart(2, '0');
  const strSecond = dtNow.getSeconds().toString().padStart(2, '0');
  return `${strYear}${strMonth}${strDay}${strHour}${strMinute}${strSecond}`;
}

/**
 * 生成 CVB 格式的文件
 */
export async function generateCvb(arrFilePaths: string[], strUserRequest: string) : Promise<string>
{
  const arrWorkspaceFolders = vscode.workspace.workspaceFolders;
  if (!arrWorkspaceFolders)
  {
    throw new Error('No workspace folder found.');
  }

  const strWorkspacePath = arrWorkspaceFolders[0].uri.fsPath;
  const strTmpDir = path.join(strWorkspacePath, '.CodeReDesignWorkSpace');
  if (!fs.existsSync(strTmpDir))
  {
    fs.mkdirSync(strTmpDir, { recursive: true });
  }

  const strTimestamp = generateTimestamp();
  let strCvbContent: string = `## BEGIN_CVB\n`;
  strCvbContent += `## META\n`;
  strCvbContent += `@用户需求: ${strUserRequest}\n`;
  strCvbContent += `@时间戳: ${strTimestamp}\n`;
  strCvbContent += `## END_META\n\n`;

  for (const strFilePath of arrFilePaths)
  {
    try
    {
      const strFileContent = readFileWithEncoding(strFilePath);
      const strExt = path.extname(strFilePath).slice(1).toLowerCase();
      const strLang = g_objLanguageMapping[strExt] || 'text';
      strCvbContent += `## FILE:${strFilePath}\n`;
      strCvbContent += '```' + strLang + '\n';
      strCvbContent += strFileContent + '\n';
      strCvbContent += '```\n\n';
    }
    catch (error)
    {
      console.error(`Failed to read file ${strFilePath}:`, error);
    }
  }

  strCvbContent += `## END_CVB\n`;

  let strSummary = await generateFilenameFromRequest(strUserRequest);
  if (!strSummary || strSummary.length === 0)
  {
    strSummary = 'default';
  }
  let strBaseFileName = `${strTimestamp}_${strSummary}.cvb`;
  let strFileName = strBaseFileName;
  let iCounter = 1;
  while (fs.existsSync(path.join(strTmpDir, strFileName)))
  {
    strFileName = `${strTimestamp}_${strSummary}_${iCounter}.cvb`;
    iCounter++;
  }
  const strCvbFilePath = path.join(strTmpDir, strFileName);
  fs.writeFileSync(strCvbFilePath, strCvbContent, 'utf-8');
  return strCvbFilePath;
}

/**
 * 将 CVB 文件内容应用到当前工作目录
 */
export function applyCvbToWorkspace(strCvbContent: string) : void
{
  const arrWorkspaceFolders = vscode.workspace.workspaceFolders;
  if (!arrWorkspaceFolders)
  {
    throw new Error('No workspace folder found.');
  }
  const strWorkspacePath = arrWorkspaceFolders[0].uri.fsPath;
  const cvb = new Cvb(strCvbContent);
  const recFiles = cvb.getFiles();
  for (const [strFilePath, strFileContent] of Object.entries(recFiles))
  {
    const strNormalizedPath = path.normalize(strFilePath);
    const strAbsoluteFilePath = path.resolve(strWorkspacePath, strNormalizedPath);
    if (!strAbsoluteFilePath.startsWith(strWorkspacePath))
    {
      throw new Error(`Invalid file path: ${strFilePath}. File path is outside the workspace.`);
    }
    const strDirPath = path.dirname(strAbsoluteFilePath);
    if (!fs.existsSync(strDirPath))
    {
      fs.mkdirSync(strDirPath, { recursive: true });
    }
    fs.writeFileSync(strAbsoluteFilePath, strFileContent, 'utf-8');
  }
  vscode.window.showInformationMessage('CVB applied successfully!');
}
