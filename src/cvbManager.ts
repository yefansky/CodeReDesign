import * as fs from "fs";
import * as path from "path";
import * as jschardet from "jschardet"; // 编码检测库
import * as iconv from "iconv-lite"; // 编码转换库
import * as vscode from "vscode";
import { generateFilenameFromRequest, callDeepSeekApi } from "./deepseekApi";

import { getLanguageFromPath } from "./languageMapping";
import {getOutputChannel, getCurrentOperationController} from './extension';

import * as FuzzyMatch from './fuzzyMatch';

// ================== CVB 核心类 ==================
export class Cvb {
  private m_recMetadata: Record<string, string>;
  private m_recFiles: Record<string, string>;

  constructor(cvbContent?: string) {
    this.m_recMetadata = {};
    this.m_recFiles = {};
    if (cvbContent) {
      const { metadata, files } = this.parse(cvbContent);
      this.m_recMetadata = metadata;
      this.m_recFiles = files;
    }
  }

  public getMetadata(): Record<string, string> {
    return this.m_recMetadata;
  }

  public getMetaData(key: string) : string | null {
    return this.m_recMetadata[key];
  }

  public setMetaData(strKey: string, strValue: string): void {
    this.m_recMetadata[strKey] = strValue;
  }

  public getFiles(): Record<string, string> {
    return this.m_recFiles;
  }

  public setFile(path: string, content: string) {
    this.m_recFiles[path] = content;
  }

  public getUserRequest(): string {
    return this.m_recMetadata["用户需求"] || "";
  }

  public getTimestamp(): string {
    return this.m_recMetadata["时间戳"] || "";
  }

  public toString(): string {
    // 将元数据转换成字符串
    let metaStr = "## META\n";
    for (const key in this.m_recMetadata) {
      metaStr += `@${key}: ${this.m_recMetadata[key]}\n\n`;
    }
    metaStr += "## END_META\n";

    // 将文件内容转换成字符串
    let filesStr = "";
    for (const filePath in this.m_recFiles) {
      const strLang = getLanguageFromPath(filePath);
      filesStr += `## FILE:${filePath}\n\`\`\`${strLang}\n${this.m_recFiles[filePath]}\n\`\`\`\n`;
    }

    // 重新组装整个 CVB 内容
    const cvbContent = `## BEGIN_CVB\n${metaStr}\n${filesStr}\n## END_CVB`;
    return cvbContent;
  }

  private parse(strCvbContent: string): {
    cvbContent: string;
    metadata: Record<string, string>;
    files: Record<string, string>;
  } {
    // 查找 CVB 开始与结束标记
    const regCvbStart: RegExp = /^## BEGIN_CVB$/m;
    const arrStartMatch = regCvbStart.exec(strCvbContent);
    if (!arrStartMatch) {
      throw new Error("Invalid CVB format: missing BEGIN_CVB marker.");
    }
    const iCvbStartIndex = arrStartMatch.index + arrStartMatch[0].length;

    const regCvbEnd: RegExp = /^## END_CVB$/m;
    const arrEndMatch = regCvbEnd.exec(strCvbContent);
    if (!arrEndMatch) {
      throw new Error("Invalid CVB format: missing END_CVB marker.");
    }
    const iCvbEndIndex = arrEndMatch.index;

    // 提取 CVB 部分内容
    const strCvbContentPart = strCvbContent.slice(iCvbStartIndex, iCvbEndIndex);

    // 解析 META 部分
    const regMeta: RegExp = /^## META\n([\s\S]*?)^## END_META(\s|$)/m;
    const arrMetaMatch = regMeta.exec(strCvbContentPart);
    if (!arrMetaMatch) {
      throw new Error("Invalid CVB format: missing META section.");
    }

    const recMetadata: Record<string, string> = {};
    const strMetaData = arrMetaMatch[1].trim();

    const regex = /^@([^:\n]+):([\s\S]*?)(?=^@|(?![\s\S]))/gm;
    let match;

    while ((match = regex.exec(strMetaData)) !== null) {
      const strKey = match[1].trim();
      const strValue = match[2].trim();
      recMetadata[strKey] = strValue;
    }

    // 解析文件部分
    const recFiles: Record<string, string> = {};
    const regFile: RegExp =
      /^## FILE:([^<\r\n]+)\n([\s\S]*?)(?=^## FILE:([^<\r\n]+)|(?![\s\S]))/gm;
    let arrFileMatch: RegExpExecArray | null;
    while ((arrFileMatch = regFile.exec(strCvbContentPart)) !== null) {
      const strFilePath: string = filePathNormalize(arrFileMatch[1]);
      let strFileContent: string = arrFileMatch[2].trim();
      // 去除代码块标记
      const regCodeBlock: RegExp = /^```.*\n([\s\S]*?)\n```$/m;
      const arrCodeMatch = regCodeBlock.exec(strFileContent);
      if (arrCodeMatch) {
        strFileContent = arrCodeMatch[1];
      }
      recFiles[strFilePath] = strFileContent;
    }

    return {
      cvbContent: strCvbContentPart,
      metadata: recMetadata,
      files: recFiles,
    };
  }

  public static getFormatDescription(): string {
    return `
CVB 格式介绍:
- 文件以 "## BEGIN_CVB" 开头，以 "## END_CVB" 结尾。
- 元数据部分以 "## META" 开头，以 "## END_META" 结尾，包含用户需求和时间戳。
- 每个文件以 "## FILE:文件路径" 开头，紧接着是 Markdown 格式的代码块，也就是一定要用 \`\`\` 包裹文件内容。
- 多个文件按顺序拼接在一起。
- 所有 ## 开头的指令提示符前面都不能有空格，必须在行首
例子：
    ## BEGIN_CVB
    ## META
    需求: 代码重构
    时间戳: 2025-02-26 12:34:56
    ## END_META

    ## FILE: /src/main.cpp
    \`\`\`c++
    #include <iostream>
    int main() {
        std::cout << "Hello, world!" << std::endl;
        return 0;
    }
    \`\`\`
    ## FILE: /src/utils.cpp
    \`\`\`c++
    #include <cmath>
    double add(double a, double b) {
        return a + b;
    }
    \`\`\`
    ## END_CVB
`;
  }
}

// ================== TCVB 差量格式 ==================

// 抽象操作类，使用匈牙利命名法
abstract class TcvbOperation {
  constructor(
    public readonly m_strFilePath: string,
    public readonly m_strType: "exact-replace" | "global-replace" | "create"
  ) {}
}

// 1. 单个替换操作（EXACT-REPLACE）
class ExactReplaceOperation extends TcvbOperation {
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
  ) {
    super(m_strFilePath, "exact-replace");
    this.m_strBeforeAnchor = m_strBeforeAnchor;
    this.m_strAfterAnchor = m_strAfterAnchor;
    this.m_strOldContent = m_strOldContent;
    this.m_strNewContent = m_strNewContent;
  }
}


// 2. 全局替换操作（GLOBAL-REPLACE）
class GlobalReplaceOperation extends TcvbOperation {
  public m_strOldContent: string;
  public m_strNewContent: string;

  constructor(
    strFilePath: string,
    strOldContent: string,
    strNewContent: string
  ) {
    super(strFilePath, "global-replace");
    this.m_strOldContent = normalizeInput(strOldContent);
    this.m_strNewContent = normalizeInput(strNewContent);
  }
}

// 3. 创建操作（CREATE）——新写文件，后面直接跟正文内容即可
class CreateOperation extends TcvbOperation {
  public m_strContent: string;

  constructor(m_strFilePath: string, m_strContent: string) {
    super(m_strFilePath, "create");
    this.m_strContent = m_strContent;
  }
}

export class TCVB {
  private m_arrOperations: TcvbOperation[] = [];

  constructor(tcStrContent: string) {
    this.parse(tcStrContent);
  }

  private parse(tcStrContent: string): void {
    // 从文件内容中提取 "## BEGIN_TCVB" 和 "## END_TCVB" 之间的部分
    const regTCVB: RegExp = /##\s*BEGIN_TCVB\s*([\s\S]*?)\s*##\s*END_TCVB/;
    const arrTCVBMatch: RegExpExecArray | null = regTCVB.exec(tcStrContent);
    if (!arrTCVBMatch) {
      throw new Error(
        "文件内容必须包含 '## BEGIN_TCVB' 和 '## END_TCVB' 之间的内容，文件不完整"
      );
    }
    // 重新赋值 tcStrContent 为 BEGIN_TCVB 与 END_TCVB 之间的内容
    tcStrContent = arrTCVBMatch[1];

    // 匹配文件块，每个文件块以 "## FILE:" 开头
    const regFileBlock: RegExp =
      /^## FILE:(.*?)\n([\s\S]*?)(?=^## FILE:|(?![\s\S]))/gm;
    let arrFileMatch: RegExpExecArray | null;
    while ((arrFileMatch = regFileBlock.exec(tcStrContent)) !== null) {
      const strFilePath: string = filePathNormalize(arrFileMatch[1]);
      const strOperationsBlock: string = arrFileMatch[2];
      // 支持操作类型中含有 "-" 符号（如 exact-replace 等）
      const regOperation: RegExp =
        /^## OPERATION:([\w-]+)\n([\s\S]*?)(?=^## OPERATION:|(?![\s\S]))/gm;
      let arrOpMatch: RegExpExecArray | null;
      while ((arrOpMatch = regOperation.exec(strOperationsBlock)) !== null) {
        const strType: string = arrOpMatch[1].toLowerCase();
        const strOpContent: string = arrOpMatch[2].trim();
        this.parseOperation(strFilePath, strType, strOpContent);
      }
    }
  }

  private parseOperation(
    strFilePath: string,
    strType: string,
    strContent: string
  ): void {
    switch (strType) {
      case "global-replace":
        this.parseGlobalReplace(strFilePath, strContent);
        break;
      case "exact-replace":
        this.parseExactReplace(strFilePath, strContent);
        break;
      case "create":
        this.parseCreate(strFilePath, strContent);
        break;
      default:
        throw new Error(`未知的操作类型: ${strType}，文件: ${strFilePath}`);
    }
  }

  // Exact-REPLACE 操作解析：要求 BEFORE_ANCHOR、AFTER_ANCHOR、OLD_CONTENT、NEW_CONTENT 四个段落
  private parseExactReplace(strFilePath: string, strContent: string): void {
    let recSections: { [key: string]: string } = {};
    try {
      recSections = this.parseSections(strContent, [
        "BEFORE_ANCHOR",
        "AFTER_ANCHOR",
        "OLD_CONTENT",
        "NEW_CONTENT",
      ]);
    } catch (err: any) {
      throw new Error(
        `解析 exact-replace 操作时，文件 "${strFilePath}" 的内容解析失败，原因: ${err.message}`
      );
    }

    this.m_arrOperations.push(
      new ExactReplaceOperation(
        strFilePath,
        recSections["BEFORE_ANCHOR"],
        recSections["AFTER_ANCHOR"],
        recSections["OLD_CONTENT"],
        recSections["NEW_CONTENT"]
      )
    );
  }

  // GLOBAL-REPLACE 操作解析：仅要求 OLD_CONTENT 与 NEW_CONTENT
  private parseGlobalReplace(strFilePath: string, strContent: string): void {
    let recSections: { [key: string]: string } = {};
    try {
      recSections = this.parseSections(strContent, [
        "OLD_CONTENT",
        "NEW_CONTENT",
      ]);
    } catch (err: any) {
      throw new Error(
        `解析 global-replace 操作时，文件 "${strFilePath}" 的内容解析失败，原因: ${err.message}`
      );
    }

    this.m_arrOperations.push(
      new GlobalReplaceOperation(
        strFilePath,
        recSections["OLD_CONTENT"],
        recSections["NEW_CONTENT"]
      )
    );
  }

  // CREATE 操作解析：直接将正文内容作为新文件内容，可选地去除 Markdown 代码块
  private parseCreate(strFilePath: string, strContent: string): void {
    let strNewContent: string = strContent;
    const regCodeBlock: RegExp = /^```.*\n([\s\S]*?)\n```$/m;
    const arrMatch: RegExpExecArray | null = regCodeBlock.exec(strNewContent);
    if (arrMatch) {
      strNewContent = arrMatch[1];
    }

    this.m_arrOperations.push(new CreateOperation(strFilePath, strNewContent));
  }

  // 辅助方法：剥离 Markdown 代码块外部包裹的 ``` 标记
  private RemoveMarkdownCodeBlock(strContent: string): string {
    let strTrimmedContent: string = strContent.trim();
    const arrLines: string[] = strTrimmedContent.split("\n");

    if (arrLines.length >= 2) {
      const strFirstLine: string = arrLines[0].trim();
      const strLastLine: string = arrLines[arrLines.length - 1].trim();

      // 检查第一行和最后一行是否为代码块标记
      if (strFirstLine.startsWith("```") && strLastLine.startsWith("```")) {
        // 去除第一行和最后一行后，重新拼接内容
        arrLines.shift();
        arrLines.pop();
        strTrimmedContent = arrLines.join("\n").trim();
      }
    }

    return strTrimmedContent;
  }

  // 辅助方法：解析操作正文中的各个段落（段落标记格式为 "## 段落名称"）
  private parseSections(
    strContent: string,
    arrExpectedSections: string[]
  ): Record<string, string> {
    const recResult: Record<string, string> = {};
    let strCurrentSection: string | null = null;
    const arrBuffer: string[] = [];
    const arrLines: string[] = strContent.split("\n");

    for (const strLine of arrLines) {
      const arrSectionMatch = strLine.match(/^## ([A-Z_]+)/);

      if (arrSectionMatch) {
        if (strCurrentSection) {
          // 拼接当前段落内容，并剥离 Markdown 代码块包裹的 ``` 标记
          recResult[strCurrentSection] = this.RemoveMarkdownCodeBlock(
            arrBuffer.join("\n").trim()
          );
          arrBuffer.length = 0;
        }

        strCurrentSection = arrSectionMatch[1];

        if (arrExpectedSections.indexOf(strCurrentSection) === -1) {
          const cMaxLen: number = 50;
          const strSnippet: string =
            strContent.length <= cMaxLen
              ? strContent
              : strContent.substring(0, cMaxLen) + "...";
          throw new Error(
            `意外的段落: ${strCurrentSection}，操作原始内容部分为: ${strSnippet}`
          );
        }
      } else if (strCurrentSection) {
        arrBuffer.push(strLine);
      }
    }

    // 处理最后一个段落
    if (strCurrentSection) {
      recResult[strCurrentSection] = this.RemoveMarkdownCodeBlock(
        arrBuffer.join("\n").trim()
      );
    }

    // 检查是否缺少必需的段落
    for (const strSection of arrExpectedSections) {
      if (!(strSection in recResult)) {
        const cMaxLen: number = 50;
        const strSnippet: string =
          strContent.length <= cMaxLen
            ? strContent
            : strContent.substring(0, cMaxLen) + "...";
        throw new Error(
          `缺失必需的段落: ${strSection}，操作原始内容部分为: ${strSnippet}`
        );
      }
    }

    return recResult;
  }

  public getOperations(): TcvbOperation[] {
    return [...this.m_arrOperations];
  }

  public static getFormatDescription(): string {
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

1. **全局替换操作(GLOBAL-REPLACE)**:
    - 适用于需要在文件中替换某一段内容的情况。
    - 提供被替换的旧内容（OLD_CONTENT）和新的替换内容（NEW_CONTENT）。
    - 内容应尽量保持简洁，避免过长的上下文。上下文一般保留前后3行，可以根据需要增加，但总长度不要超过10行，避免出错。
    - 替换操作中的内容需要完整包含在三个反引号（\`\`\`）包裹的代码块中。
    
    示例：
    ## OPERATION:GLOBAL-REPLACE
    ## OLD_CONTENT
    \`\`\`
    #include <iostream>
    int main() {
        std::cout << "Hello, world!" << std::endl;
        return 0;
    }
    \`\`\`
    ## NEW_CONTENT
    \`\`\`
    #include <iostream>
    int main() {
        std::cout << "Welcome to TCVB format!" << std::endl;
        return 0;
    }
    \`\`\`
    
    - 操作说明:
        - OLD_CONTENT：包含旧代码，通常保留必要的上下文。
        - NEW_CONTENT：包含新代码，将替换掉旧内容。
        - 重要提示：尽量避免长段内容的替换，细化为多个小块进行替换。不要丢失注释、空行等结构信息。

2. 创建操作(CREATE):
    - 创建一个新文件，后面直接给全文代码。
    - 新文件的全部内容应完整写入代码块中。
    - 如果文件已经存在，应该有GLOBAL-REPLACE来插入，而不是用CREATE。如果是已有的文件，会直接把内容插入末尾。
    
    示例：
    ## OPERATION:CREATE
    \`\`\`
    #include <cmath>
    double add(double a, double b) {
        return a + b;
    }
    \`\`\`

    - 操作说明：
        - 该操作用于新文件的创建或新增代码块。
        - 新的代码必须以 Markdown 格式代码块包裹。
        - 如果在已有文件中插入大块代码，应该使用替换操作，而不是 CREATE 操作。

### 省略标识符规则：

3. 省略标识符（//...CCVB:
    - \`//...CCVB\` 是一个省略标识符，表示代码的某一部分过长或不需要显示，已被省略或删除。
    - 注意：省略标识符不能出现在被替换的内容中。
    - 如果某段代码包含省略标识符 \`//...CCVB\`，则不能将该标识符的行当作替换操作的锚点的一部分。
    - 被替换的内容必须位于 \`//...CCVB\` 标识符的上下方，不能跨越该标识符。
    
    示例：
    假设以下代码中有一段被省略：
    \`\`\`cpp
    // Some initial setup code...
    //...CCVB
    // Remaining logic code...
    \`\`\`

    在进行全局替换操作时，不能选择跨越 \`//...CCVB\` 标识符的范围。例如：
    错误的替换示例（跨越省略标识符）：
    "
    ## OPERATION:GLOBAL-REPLACE
    ## OLD_CONTENT
    \`\`\`
    // Some initial setup code...
    //...CCVB
    // Remaining logic code...
    \`\`\`
    "

    正确的替换示例（避免跨越省略标识符）：
    "
    ## OPERATION:GLOBAL-REPLACE
    ## OLD_CONTENT
    \`\`\`
    // Some initial setup code...
    \`\`\`
    ## NEW_CONTENT
    \`\`\`
    // New code after the initial setup
    \`\`\`
    "

注意：
1. 所有 OPERATION 操作以行为单位。
2. 一个 '## FILE' 下可以有多个 '## OPERATION'。
3. 锚点为连续的多行内容：使用至少3行唯一文本作为锚点，用来标定范围，防止混淆（如果需要可以超过3行）。
4. [markdown代码块] 一定要用 \`\`\` ... \`\`\` 包裹，仔细检查不要漏掉。
5. 注意 TCVB 和 CVB 的区别。CVB 是完整的内容，而 TCVB 是用来生成差量同步的，通过多个 OPERATION 去操作已有 CVB 合成新 CVB。
6. 插入和删除操作都可以转化为替换操作。
7. 用来匹配的锚点必须和原文的格式完全一致，不能有缺失，不能丢弃注释。
8. 注意不要丢失 OPERATION 而直接输出代码块。
9. 不要私自加入不必要的空行。
10. 如果是在一个已有文件里插入大块代码，不应该用 CREATE，而是用替换的方式插入。
11. 所有## 开头的提示符前面都不能有空格，要在行首
12.严格禁止在代码块中添加任何占位符、示例说明、过程性描述（如 // 类似添加其他新函数的实现... 或 // 这里需要添加更多代码 等）。这些内容会导致解析失败。
13.绝对!绝对!不许输出 "//由于篇幅限制，此处仅展示关键修改示例，完整实现需按相同模式添加所有函数" 或 "这里的代码使用原内容" 这种偷懒的,不完整内容！ 
14.注意格式一定要严格按照标准示例，必须用 ## END_TCVB 结尾，不然就是严重的错误!
15.你是一个有经验且很有耐心的程序员，请挑战一次输出就能通过编译通过！展现你真正的水平！

示例：
    ## BEGIN_TCVB

    ## FILE:/src/main.cpp
    ## OPERATION:GLOBAL-REPLACE
    ## OLD_CONTENT
    \`\`\`
    #include <iostream>
    int main() {
        std::cout << "Hello, world!" << std::endl;
        return 0;
    }
    \`\`\`
    ## NEW_CONTENT
    \`\`\`
    #include <iostream>
    int main() {
        std::cout << "Welcome to TCVB format!" << std::endl;
        return 0;
    }
    \`\`\`

    ## FILE:/src/utils.cpp
    ## OPERATION:CREATE
    \`\`\`
    #include <cmath>
    double add(double a, double b) {
        return a + b;
    }
    \`\`\`

    ## END_TCVB
    `;
}

}

// ================== 合并函数 ==================

export function mergeCvb(baseCvb: Cvb, tcvb: TCVB): Cvb {

  if (baseCvb.getMetaData("compressFrom")) {
    const orignalPath = baseCvb.getMetaData("compressFrom") || "";
    const cvbContent = fs.readFileSync(orignalPath, 'utf-8');
    baseCvb = new Cvb(cvbContent);
  }

  // 先将 baseCvb 中的所有文件内容存入 Map
  const mapMergedFiles: Map<string, string> = new Map<string, string>(
    Object.entries(baseCvb.getFiles())
  );

  // 按文件分组 TCVB 操作
  const mapOperationsByFile: Map<string, TcvbOperation[]> = new Map<
    string,
    TcvbOperation[]
  >();
  for (const op of tcvb.getOperations()) {
    if (!mapOperationsByFile.has(op.m_strFilePath)) {
      mapOperationsByFile.set(op.m_strFilePath, []);
    }
    mapOperationsByFile.get(op.m_strFilePath)!.push(op);
  }

  try {
    // 对每个文件执行所有操作（按顺序执行）
    for (const [strFilePath, arrOperations] of mapOperationsByFile) {
      let strContent: string = mapMergedFiles.get(strFilePath) || "";
      for (const op of arrOperations) {
        if (op instanceof ExactReplaceOperation) {
          strContent = applyExactReplace(strContent, op);
        } else if (op instanceof GlobalReplaceOperation) {
          strContent = applyGlobalReplace(strContent, op);
        } else if (op instanceof CreateOperation) {
          if (mapMergedFiles.has(strFilePath)) {
            strContent = applyInsertTail(strContent, op);
          }
          else {
            strContent = op.m_strContent;
          }
        }
      }
      mapMergedFiles.set(strFilePath, strContent);
    }
  } catch (err: any) {
    throw new Error(
      `TCVB格式可能有问题，尝试增量修改CVB时出错: ${err.message}`
    );
  }

  return rebuildCvb(baseCvb, mapMergedFiles);
}

function diagnoseMatchFailure(
  strContent: string,
  op: ExactReplaceOperation
): string {
  function findLineNumberRange(
    content: string,
    pattern: RegExp
  ): [number, number] {
    let match;
    let minLine = -1,
      maxLine = -1;
    while ((match = pattern.exec(content)) !== null) {
      const matchStartLine = content
        .substring(0, match.index)
        .split("\n").length;
      if (minLine === -1 || matchStartLine < minLine) {
        minLine = matchStartLine;
      }
      if (matchStartLine > maxLine) {
        maxLine = matchStartLine;
      }
    }
    return [minLine, maxLine];
  }

  let errorMessages: string[] = [];
  const beforeAnchorPattern = new RegExp(
    normalizeLineWhitespace(escapeRegExp(op.m_strBeforeAnchor)),
    "gs"
  );
  const afterAnchorPattern = new RegExp(
    normalizeLineWhitespace(escapeRegExp(op.m_strAfterAnchor)),
    "gs"
  );
  const oldContentPattern = new RegExp(
    normalizeLineWhitespace(escapeRegExp(op.m_strOldContent)),
    "gs"
  );

  const beforeAnchorRange = findLineNumberRange(
    strContent,
    beforeAnchorPattern
  );
  const afterAnchorRange = findLineNumberRange(strContent, afterAnchorPattern);
  const oldContentRange = findLineNumberRange(strContent, oldContentPattern);

  if (beforeAnchorRange[0] === -1) {
    errorMessages.push(
      `FILE: ${op.m_strFilePath} 无法精确匹配(有和原文不一致的地方) BEFORE_ANCHOR:\n\`\`\`\n${op.m_strBeforeAnchor}\n\`\`\``
    );
    console.log(
      `FILE: ${op.m_strFilePath} 未找到 BEFORE_ANCHOR:\n\`\`\`\n${op.m_strBeforeAnchor}\n\`\`\`\n表达式\n${beforeAnchorPattern}`
    );
  }

  if (afterAnchorRange[0] === -1) {
    errorMessages.push(
      `FILE: ${op.m_strFilePath} 无法精确匹配(有和原文不一致的地方) AFTER_ANCHOR:\n\`\`\`\n${op.m_strAfterAnchor}\n\`\`\``
    );
    console.log(
      `FILE: ${op.m_strFilePath} 未找到 AFTER_ANCHOR:\n\`\`\`\n${op.m_strAfterAnchor}\n\`\`\`\n表达式\n${afterAnchorPattern}`
    );
  }

  if (oldContentRange[0] === -1) {
    errorMessages.push(
      `FILE: ${op.m_strFilePath} 无法精确匹配(有和原文不一致的地方) OLD_CONTENT:\n\`\`\`\n${op.m_strOldContent}\n\`\`\``
    );
    console.log(
      `FILE: ${op.m_strFilePath} 未找到 OLD_CONTENT:\n\`\`\`\n${op.m_strOldContent}\n\`\`\`\n表达式\n${oldContentPattern}`
    );
  }

  if (errorMessages.length === 0) {
    const lastBeforeAnchorLine = beforeAnchorRange[1]; // beforeAnchorPattern 最后匹配的行号
    const firstAfterAnchorLine = afterAnchorRange[0]; // afterAnchorPattern 第一次匹配的行号
    const firstOldContentLine = oldContentRange[0]; // oldContentPattern 第一次匹配的行号
    const lastOldContentLine = oldContentRange[1]; // oldContentPattern 最后匹配的行号

    if (
      firstOldContentLine < lastBeforeAnchorLine ||
      lastOldContentLine > firstAfterAnchorLine
    ) {
      errorMessages.push(
        `FILE: ${op.m_strFilePath} OLD_CONTENT 应该在 BEFORE_ANCHOR 和 AFTER_ANCHOR 之间, 且不能有重叠 :\nBEFORE_ANCHOR:\n\`\`\`\n${op.m_strBeforeAnchor}\n\`\`\`\nOLD_CONTENT:\n\`\`\`\n${op.m_strOldContent}\n\`\`\`\nAFTER_ANCHOR:\n\`\`\`\n${op.m_strAfterAnchor}\n\`\`\``
      );
    }
  }

  if (errorMessages.length === 0) {
    errorMessages.push(
      `原因未知, FILE: ${op.m_strFilePath} BEFORE_ANCHOR:\n\`\`\`\n${op.m_strBeforeAnchor}\n\`\`\`\nOLD_CONTENT:\n\`\`\`\n${op.m_strOldContent}\n\`\`\`\nAFTER_ANCHOR:\n\`\`\`\n${op.m_strAfterAnchor}\n\`\`\``
    );
  }

  return errorMessages.join("\n");
}

function applyExactReplace(
  strContent: string,
  op: ExactReplaceOperation
): string {
  const regPattern = buildPattern(
    op.m_strBeforeAnchor,
    op.m_strOldContent,
    op.m_strAfterAnchor
  );
  const strReplacement =
    op.m_strBeforeAnchor +
    "$1" +
    op.m_strNewContent +
    "$2" +
    op.m_strAfterAnchor;

  regPattern.lastIndex = 0;
  if (!regPattern.test(strContent)) {
    const diagnosticMessage = diagnoseMatchFailure(strContent, op);
    const errorMsg = `EXACT-REPLACE 失败\n` + `错误:\n${diagnosticMessage}`;

    console.log(errorMsg + `\n表达式: ${regPattern}`);
    throw new Error(errorMsg);
  }

  regPattern.lastIndex = 0;
  return strContent.replace(regPattern, strReplacement);
}

// 调整缩进的函数
function adjustIndentation(originalContent: string, matchStart: number, newContent: string): string {
  // 找到匹配部分的起始行
  const linesBeforeMatch = originalContent.substring(0, matchStart).split("\n");
  const lastLineBeforeMatch = linesBeforeMatch[linesBeforeMatch.length - 1];
  
  // 获取匹配部分的缩进（前导空白字符）
  const indentMatch = lastLineBeforeMatch.match(/^(\s*)/)?.[1] || "";
  
  // 处理新内容的每一行，添加匹配的缩进
  const newLines = newContent.split("\n");
  const adjustedLines = newLines.map((line, index) => {
    // 第一行保持与匹配内容相同的缩进，后续行根据需要可保持相对缩进
    if (index === 0) {
      return line.trimStart(); // 只移除行首多余空格，保留内容本身可能的缩进
    }
    // 如果是最后一行且为空，不添加缩进
    if (index === newLines.length - 1 && line.trim().length === 0) {
      return "";
    }
    return indentMatch + line; // 后续行直接加上缩进
  });
  
  return adjustedLines.join("\n");
}

export function applyGlobalReplace(
  strContent: string,
  op: GlobalReplaceOperation
): string {
  if (op.m_strOldContent === "") {
    const errorMsg = `GLOBAL-REPLACE 失败：FILE:"${op.m_strFilePath}" OLD_CONTENT 是空的"`;
    console.log(errorMsg);
    throw new Error(errorMsg);
  }

  const regPattern: RegExp = new RegExp(
    normalizeLineWhitespace(escapeRegExp(op.m_strOldContent)),
    "gs"
  );

  if (regPattern.test(strContent)) {
    regPattern.lastIndex = 0;
    return strContent.replace(regPattern, (match, offset) => {
      return adjustIndentation(strContent, offset, op.m_strNewContent);
    });
  }

  try {
    return FuzzyMatch.applyFuzzyGlobalReplace(strContent, op.m_strOldContent, op.m_strNewContent);
  }catch (error : any) {
    const errorMsg = `GLOBAL-REPLACE 失败：FILE:"${op.m_strFilePath}" 中未找到OLD_CONTENT: "${op.m_strOldContent}" 可能是和原文有细微差异，或者文件路径和别的文件搞错了`;
    console.log(errorMsg + `\n表达式: ${regPattern}`);
    throw new Error(errorMsg);
  }
}

export function applyInsertTail(
  strContent: string,
  op: CreateOperation){
    strContent += "\n" + op.m_strContent;
    return strContent;
  }

// 根据前锚点、内容、后锚点构建正则表达式（dotall 模式）
function buildPattern(
  strBefore: string,
  strContent: string,
  strAfter: string
): RegExp {
  return new RegExp(
    normalizeLineWhitespace(escapeRegExp(strBefore)) +
      "([\\s\\S]*?)" + // 捕获前锚点与旧内容之间的任意字符（非贪婪）
      normalizeLineWhitespace(escapeRegExp(strContent)) +
      "([\\s\\S]*?)" + // 捕获旧内容与后锚点之间的任意字符（非贪婪）
      normalizeLineWhitespace(escapeRegExp(strAfter)),
    "gs" // 全局匹配且允许跨行
  );
}

function rebuildCvb(baseCvb: Cvb, mapFiles: Map<string, string>): Cvb {
  let strNewContent: string = `## BEGIN_CVB\n## META\n`;

  const recMetadata = baseCvb.getMetadata();
  for (const [strKey, strValue] of Object.entries(recMetadata)) {
    strNewContent += `@${strKey}: ${strValue}\n`;
  }
  strNewContent += `## END_META\n\n`;

  for (const [strFilePath, strContent] of mapFiles) {
    const strLang: string = getLanguageFromPath(strFilePath);
    strNewContent += `## FILE:${strFilePath}\n\`\`\`${strLang}\n${strContent}\n\`\`\`\n\n`;
  }

  strNewContent += `## END_CVB`;
  const cvb = new Cvb(strNewContent);

  cvb.setMetaData("时间戳", generateTimestamp());
  return cvb;
}

export async function compressCvb(cvb: Cvb, userRequest: string): Promise<Cvb> {
  // 获取元数据和文件内容
  const metadata = cvb.getMetadata();
  const files = cvb.getFiles();
  const compressedFiles: Record<string, string> = {};
  const MAX_CONCURRENT = 5; // 设置最大并行数量为5

  const outputChannel = getOutputChannel();
  const signal = getCurrentOperationController().signal;

  outputChannel.appendLine("compress task start");

  // 将文件处理任务放入队列
  const fileEntries = Object.entries(files);
  const processFile = async ([filePath, fileContent]: [string, string]) => {
    const requestContent = `
文件路径: ${filePath}

文件内容:
\`\`\`
${fileContent}
\`\`\`

用户请求:
\`\`\`
${userRequest}
\`\`\`

请从文件内容中识别并提取出有价值的代码片段，这些片段对理解代码在用户请求中的上下文非常重要。你需要关注以下几点：
1. 提取出关键信息的代码块，这些代码块帮助理解用户请求中的核心上下文。比如在重构任务中，需要关注相关的函数、变量及其上下级调用等。
2. 需要被处理的内容（如重构代码），应该被提取出来。
3. 确定有必要作为“锚点”的代码段，以便后续处理时可以方便地替换。
4. 如果不确定是否相关的代码，就先当不相关处理，也就是丢弃这部分代码

例如：
假设给定代码如下：
\`\`\`
function func1() {
    // 代码块1
}

function func2() {
    // 代码块2
}

function func3() {
    // 代码块3
}
\`\`\`

用户请求关注 \`func1\` 和 \`func2\`，并希望忽略 \`func3\`。你应该返回如下结果：

\`\`\`
function func1() {
    // 代码块1
}
===SEGMENT===
function func2() {
    // 代码块2
}
\`\`\`

注意：
1. 只保留 \`func1\` 和 \`func2\`，并通过 \`===SEGMENT===\` 分隔。
2. \`func3\` 被丢弃，**但其位置仍然被正确地分隔开**，以确保后续的处理不会出现问题。
3. 例子里的 \`\`\` 只是为了便于说明格式清楚，你输出的时候不要有 \`\`\` 包裹代码

返回时，请确保**每个代码片段**都保持原始结构，不要有任何多余的文字，并且使用 \`===SEGMENT===\` 来分隔它们，而不是使用 \`\`\`code\`\`\` 或其他分隔符。

确保返回的格式是干净且可解析的，只包括代码片段和分隔符，不要包含任何额外的解释或注释信息！
    `;

    const systemContent = "你是一个代码分析助手。给定一个文件的内容和用户的请求，识别并提取出对理解代码在请求上下文中的有价值的代码片段。注意输出的时候不要有 \`\`\`";

    outputChannel.appendLine(`compress processing .. ${filePath}`);
    try {
      const response = await callDeepSeekApi(requestContent, systemContent, undefined, true, undefined, signal, true);
      if (response) {
        const segments = response.split("===SEGMENT===").map(segment => segment.trim());
        const compressedContent = segments.join("\n//...CCVB\n");
        compressedFiles[filePath] = compressedContent;
        outputChannel.appendLine(`compress processing .. ${filePath} [success]`);
      } else {
        outputChannel.appendLine(`compress processing .. ${filePath} [failed]`);
      }
    } catch (error) {
      outputChannel.appendLine(`compress processing .. ${filePath} [failed: ${error}]`);
    }
  };

  // 创建并行处理队列
  const processQueue = async () => {
    const activePromises: Promise<void>[] = [];
    
    for (const entry of fileEntries) {
      // 当达到最大并行数时，等待任意一个任务完成
      if (activePromises.length >= MAX_CONCURRENT) {
        await Promise.race(activePromises);
      }
      
      // 创建新任务
      const promise = processFile(entry).then(() => {
        // 任务完成后从活动promise数组中移除
        const index = activePromises.indexOf(promise);
        if (index !== -1) {
          activePromises.splice(index, 1);
        }
      });
      
      activePromises.push(promise);
    }
    
    // 等待所有剩余任务完成
    await Promise.all(activePromises);
  };

  await processQueue();

  outputChannel.appendLine("compress task finish");

  const newCvb = new Cvb();
  for (const [key, value] of Object.entries(metadata)) {
    newCvb.setMetaData(key, value);
  }
  for (const [filePath, content] of Object.entries(compressedFiles)) {
    newCvb.setFile(filePath, content);
  }

  newCvb.setMetaData("用户需求", userRequest);
  return newCvb;
}
// ================== 工具函数 ==================

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\&]/g, (match) => "\\" + match);
}

export function normalizeInput(anchor: string): string {
  let lines: string[] = anchor.split("\n");
  
  // 移除首行空行
  while (lines.length > 0 && lines[0].trim().length === 0) {
    lines.shift();
  }
  
  // 移除末尾空行
  while (lines.length > 0 && lines[lines.length - 1].trim().length === 0) {
    lines.pop();
  }
  
  // 如果全是空行，返回空字符串
  if (lines.length === 0) {
    return "";
  }
  
  return lines.join("\n");
}

// 处理空白字符的规范化函数
function normalizeLineWhitespace(anchor: string): string {
  if (anchor === "") {
    return "\\s*";
  }
  
  let lines: string[] = anchor.split("\n");
  
  // 处理每一行的空白字符
  let normalizedLines: string[] = lines.map((line: string, index: number, arr: string[]) => {
    const isFirstLine = index === 0;
    const isLastLine = index === arr.length - 1;
    line = line.trim();
    
    if (line.length > 0) {
      // 将行内连续空白替换为 \s*
      line = line.replace(/\s+/g, "\\s*");
      
      // 根据行位置添加前后 \s*
      if (isFirstLine) {
        return `${line}\\s*`;
      } else if (isLastLine) {
        return `\\s*${line}`;
      } else {
        return `\\s*${line}\\s*`;
      }
    }
    return "\\s*"; // 空行处理
  });
  
  return normalizedLines.join("\n");
}

function filePathNormalize(strRawPath: string): string {
  return path.normalize(strRawPath.replace(/^[\\/]+/, "").trim());
}

/**
 * 检测文件编码并转换为 UTF-8
 */
function readFileWithEncoding(strFilePath: string): string {
  const bufFile = fs.readFileSync(strFilePath);
  const objDetected = jschardet.detect(bufFile);
  let strEncoding: string = objDetected.encoding.toLowerCase();

  if (strEncoding === "ascii") {
    if (isLikelyGBK(bufFile)) {
      strEncoding = "gbk";
    } else {
      strEncoding = "utf-8";
    }
  }

  if (strEncoding === "utf-8") {
    return bufFile.toString("utf-8");
  }
  if (
    strEncoding === "gbk" ||
    strEncoding === "gb2312" ||
    strEncoding === "windows-1252"
  ) {
    return iconv.decode(bufFile, "gbk");
  }

  throw new Error(`Unsupported encoding: ${strEncoding}`);
}

function isLikelyGBK(buf: Buffer): boolean {
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] >= 0x81 && buf[i] <= 0xfe) {
      if (i + 1 < buf.length && buf[i + 1] >= 0x40 && buf[i + 1] <= 0xfe) {
        return true;
      }
    }
  }
  return false;
}

export function generateTimestamp(): string {
  const dtNow = new Date();
  const strYear = dtNow.getFullYear().toString().slice(-2);
  const strMonth = (dtNow.getMonth() + 1).toString().padStart(2, "0");
  const strDay = dtNow.getDate().toString().padStart(2, "0");
  const strHour = dtNow.getHours().toString().padStart(2, "0");
  const strMinute = dtNow.getMinutes().toString().padStart(2, "0");
  const strSecond = dtNow.getSeconds().toString().padStart(2, "0");
  return `${strYear}${strMonth}${strDay}${strHour}${strMinute}${strSecond}`;
}

/**
 * 生成 CVB 格式的文件
 */
export async function generateCvb(
  arrFilePaths: string[],
  strUserRequest: string
): Promise<string> {
  const arrWorkspaceFolders = vscode.workspace.workspaceFolders;
  if (!arrWorkspaceFolders) {
    throw new Error("No workspace folder found.");
  }

  const strWorkspacePath = arrWorkspaceFolders[0].uri.fsPath;
  const strTmpDir = path.join(strWorkspacePath, ".CodeReDesignWorkSpace");
  if (!fs.existsSync(strTmpDir)) {
    fs.mkdirSync(strTmpDir, { recursive: true });
  }

  const strTimestamp = generateTimestamp();
  const cvb = new Cvb();
  cvb.setMetaData("用户需求", strUserRequest);
  cvb.setMetaData("时间戳", strTimestamp);

  for (const strFilePath of arrFilePaths) {
    try {
      const strFileContent = readFileWithEncoding(strFilePath);
      cvb.setFile(strFilePath, strFileContent);
    } catch (error) {
      console.error(`Failed to read file ${strFilePath}:`, error);
    }
  }

  const strCvbContent = cvb.toString();

  let strSummary = await generateFilenameFromRequest(strUserRequest);
  if (!strSummary || strSummary.length === 0) {
    strSummary = "default";
  }
  let strBaseFileName = `${strTimestamp}_${strSummary}.cvb`;
  let strFileName = strBaseFileName;
  let iCounter = 1;
  while (fs.existsSync(path.join(strTmpDir, strFileName))) {
    strFileName = `${strTimestamp}_${strSummary}_${iCounter}.cvb`;
    iCounter++;
  }
  const strCvbFilePath = path.join(strTmpDir, strFileName);
  fs.writeFileSync(strCvbFilePath, strCvbContent, "utf-8");
  return strCvbFilePath;
}

/**
 * 将 CVB 文件内容应用到当前工作目录
 */
export function applyCvbToWorkspace(strCvbContent: string): void {
  const arrWorkspaceFolders = vscode.workspace.workspaceFolders;
  if (!arrWorkspaceFolders) {
    throw new Error("No workspace folder found.");
  }
  const strWorkspacePath = arrWorkspaceFolders[0].uri.fsPath;
  const cvb = new Cvb(strCvbContent);
  const recFiles = cvb.getFiles();
  for (const [strFilePath, strFileContent] of Object.entries(recFiles)) {
    const strNormalizedPath = path.normalize(strFilePath);
    const strAbsoluteFilePath = path.resolve(
      strWorkspacePath,
      strNormalizedPath
    );
    if (!strAbsoluteFilePath.startsWith(strWorkspacePath)) {
      throw new Error(
        `Invalid file path: ${strFilePath}. File path is outside the workspace.`
      );
    }
    const strDirPath = path.dirname(strAbsoluteFilePath);
    if (!fs.existsSync(strDirPath)) {
      fs.mkdirSync(strDirPath, { recursive: true });
    }
    fs.writeFileSync(strAbsoluteFilePath, strFileContent, "utf-8");
  }
  vscode.window.showInformationMessage("CVB applied successfully!");
}
