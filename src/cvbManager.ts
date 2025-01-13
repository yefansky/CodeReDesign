import * as fs from 'fs';
import * as path from 'path';
import * as jschardet from 'jschardet'; // 编码检测库
import * as iconv from 'iconv-lite'; // 编码转换库

/**
 * 检测文件编码并转换为 UTF-8
 * @param filePath 文件路径
 * @returns 转换后的 UTF-8 内容
 */
function readFileWithEncoding(filePath: string): string {
    // 读取文件的二进制数据
    const buffer = fs.readFileSync(filePath);

    // 检测文件编码
    const detected = jschardet.detect(buffer);
    const encoding = detected.encoding.toLowerCase();

    // 如果编码是 UTF-8，直接返回内容
    if (encoding === 'utf-8') {
        return buffer.toString('utf-8');
    }

    // 如果是 GBK 或其他编码，尝试转换为 UTF-8
    if (encoding === 'gbk' || encoding === 'gb2312' || encoding === 'windows-1252') {
        return iconv.decode(buffer, 'gbk');
    }

    // 如果无法识别编码，抛出错误
    throw new Error(`Unsupported encoding: ${encoding}`);
}

/**
 * 生成 CVB 格式的文件
 * @param filePaths 文件路径数组
 * @param workspacePath 工作目录路径
 * @returns 生成的 CVB 文件路径
 */
export function generateCvb(filePaths: string[], workspacePath: string): string {
    // 创建临时目录（如果不存在）
    const tmpDir = path.join(workspacePath, 'CodeReDesignWorkSpace', 'tmp');
    if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
    }

    // 生成 CVB 文件内容
    let cvbContent = '';
    filePaths.forEach(filePath => {
        try {
            const fileContent = readFileWithEncoding(filePath); // 读取并转换编码
            cvbContent += `@@@FILE:${filePath}@@@\n${fileContent}\n@@@END_FILE@@@\n`;
        } catch (error) {
            console.error(`Failed to read file ${filePath}:`, error);
        }
    });

    // 生成 CVB 文件名（使用时间戳）
    const timestamp = new Date().getTime();
    const cvbFilePath = path.join(tmpDir, `${timestamp}.cvb`);

    // 将 CVB 内容写入文件
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