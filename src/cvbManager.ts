import * as fs from 'fs';
import * as path from 'path';
import * as jschardet from 'jschardet'; // 编码检测库
import * as iconv from 'iconv-lite'; // 编码转换库

/**
 * 返回 CVB 格式介绍的静态字符串
 * @returns CVB 格式介绍
 */
export function getCvbFormatDescription(): string {
    return `
CVB 格式介绍:
- 文件以 "@@@BEGIN_CVB@@@" 开头，以 "@@@END_CVB@@@" 结尾。
- 元数据部分以 "@@@META@@@" 开头，以 "@@@END_META@@@" 结尾，包含用户需求和时间戳。
- 每个文件以 "@@@FILE:文件路径@@@" 开头，以 "@@@END_FILE@@@" 结尾。
- 文件路径和文件内容之间用换行符分隔。
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
    const encoding = detected.encoding.toLowerCase();

    if (encoding === 'utf-8') {
        return buffer.toString('utf-8');
    }

    if (encoding === 'gbk' || encoding === 'gb2312' || encoding === 'windows-1252') {
        return iconv.decode(buffer, 'gbk');
    }

    throw new Error(`Unsupported encoding: ${encoding}`);
}

/**
 * 生成 CVB 格式的文件
 * @param filePaths 文件路径数组
 * @param workspacePath 工作目录路径
 * @param userRequest 用户输入的重构需求
 * @returns 生成的 CVB 文件路径
 */
export function generateCvb(filePaths: string[], workspacePath: string, userRequest: string): string {
    // 创建临时目录（如果不存在）
    const tmpDir = path.join(workspacePath, 'CodeReDesignWorkSpace', 'tmp');
    if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
    }

    // 生成 CVB 头部
    const timestamp = new Date().toISOString();
    let cvbContent = `@@@BEGIN_CVB@@@\n`;
    cvbContent += `@@@META@@@\n`;
    cvbContent += `@用户需求: ${userRequest}\n`;
    cvbContent += `@时间戳: ${timestamp}\n`;
    cvbContent += `@@@END_META@@@\n\n`;

    // 生成 CVB 正文（文件内容）
    filePaths.forEach(filePath => {
        try {
            const fileContent = readFileWithEncoding(filePath);
            cvbContent += `@@@FILE:${filePath}@@@\n${fileContent}\n@@@END_FILE@@@\n`;
        } catch (error) {
            console.error(`Failed to read file ${filePath}:`, error);
        }
    });

    // 添加 CVB 结束标记
    cvbContent += `@@@END_CVB@@@\n`;

    // 生成 CVB 文件名（使用时间戳）
    const cvbFilePath = path.join(tmpDir, `${new Date().getTime()}.cvb`);

    // 将 CVB 内容写入文件
    fs.writeFileSync(cvbFilePath, cvbContent, 'utf-8');

    return cvbFilePath;
}

/**
 * 解析 API 返回的字符串，提取 CVB 格式内容
 * @param apiResponse API 返回的字符串
 * @returns 包含 CVB 字符串、元数据和文件内容的对象
 */
export function parseCvb(apiResponse: string): {
    cvbContent: string; // 纯字符串形式的 CVB 内容
    metadata: Record<string, string>; // 元数据
    files: Record<string, string>; // 文件内容
} {
    // 检查是否包含 CVB 格式的起始和结束标记
    const cvbStartIndex = apiResponse.indexOf('@@@BEGIN_CVB@@@');
    const cvbEndIndex = apiResponse.indexOf('@@@END_CVB@@@');

    if (cvbStartIndex === -1 || cvbEndIndex === -1) {
        throw new Error('Invalid API response: missing CVB format markers.');
    }

    // 提取 CVB 内容部分
    const cvbContent = apiResponse.slice(cvbStartIndex, cvbEndIndex + '@@@END_CVB@@@'.length);

    // 提取元数据部分
    const metaMatch = cvbContent.match(/@@@META@@@([\s\S]*?)@@@END_META@@@/);
    if (!metaMatch) {
        throw new Error('Invalid CVB format: missing META section.');
    }

    const metadata: Record<string, string> = {};
    metaMatch[1].trim().split('\n').forEach(line => {
        const [key, value] = line.split(':');
        if (key && value) {
            metadata[key.trim()] = value.trim();
        }
    });

    // 提取文件内容部分
    const files: Record<string, string> = {};
    const fileSections = cvbContent.split('@@@FILE:');
    fileSections.slice(1).forEach(section => {
        const [filePath, fileContent] = section.split('@@@END_FILE@@@');
        const normalizedFilePath = filePath.trim();
        files[normalizedFilePath] = fileContent.trim();
    });

    return {
        cvbContent, // 返回纯字符串形式的 CVB 内容
        metadata,   // 返回元数据
        files,      // 返回文件内容
    };
}