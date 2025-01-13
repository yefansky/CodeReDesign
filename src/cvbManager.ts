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
CVB 格式介绍：
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
 * @returns 生成的 CVB 文件路径
 */
export function generateCvb(filePaths: string[], workspacePath: string): string {
    const tmpDir = path.join(workspacePath, 'CodeReDesignWorkSpace', 'tmp');
    if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
    }

    let cvbContent = '';
    filePaths.forEach(filePath => {
        try {
            const fileContent = readFileWithEncoding(filePath);
            cvbContent += `@@@FILE:${filePath}@@@\n${fileContent}\n@@@END_FILE@@@\n`;
        } catch (error) {
            console.error(`Failed to read file ${filePath}:`, error);
        }
    });

    const timestamp = new Date().getTime();
    const cvbFilePath = path.join(tmpDir, `${timestamp}.cvb`);
    fs.writeFileSync(cvbFilePath, cvbContent, 'utf-8');

    return cvbFilePath;
}

/**
 * 解析 CVB 文件
 * @param cvbFilePath CVB 文件路径
 * @returns 解析后的文件内容（文件路径和内容的键值对）
 */
export function parseCvb(cvbFilePath: string): Record<string, string> {
    const cvbContent = fs.readFileSync(cvbFilePath, 'utf-8');
    const fileSections = cvbContent.split('@@@FILE:');

    const files: Record<string, string> = {};
    fileSections.slice(1).forEach(section => {
        const [filePath, fileContent] = section.split('@@@END_FILE@@@');
        const normalizedFilePath = filePath.trim();
        files[normalizedFilePath] = fileContent.trim();
    });

    return files;
}