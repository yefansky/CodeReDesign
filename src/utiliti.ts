import { ExtensionContext, ExtensionMode } from 'vscode';
import * as fs from 'fs/promises';
import * as iconv from 'iconv-lite';

let isDebugMode: boolean;
export function activate(context: ExtensionContext) {
    isDebugMode = context.extensionMode === ExtensionMode.Development;
}

/**
 * 读取文件并根据其编码（GBK、UTF-8 或带 BOM 的 UTF-8）转换为 UTF-8 字符串
 * @param filePath 文件路径
 * @returns 转换后的 UTF-8 字符串
 * @throws 如果无法读取文件或解码失败，抛出错误
 */
export async function readFileAsUtf8(filePath: string): Promise<string> {
    try {
        // 读取文件的原始 Buffer
        const buffer = await fs.readFile(filePath);

        // 检测是否为带 BOM 的 UTF-8
        const isUtf8WithBom =
            buffer.length >= 3 &&
            buffer[0] === 0xEF &&
            buffer[1] === 0xBB &&
            buffer[2] === 0xBF;

        if (isUtf8WithBom) {
            // 移除 BOM 并作为 UTF-8 解码
            return buffer.slice(3).toString('utf8');
        }

        // 尝试作为 UTF-8 解码
        try {
            // 先验证是否是有效的 UTF-8
            const utf8Text = buffer.toString('utf8');
            // 简单的 UTF-8 有效性检查：重新编码后比较
            if (Buffer.from(utf8Text, 'utf8').equals(buffer)) {
                return utf8Text;
            }
        } catch (utf8Error) {
            // 如果 UTF-8 解码失败，继续尝试 GBK
        }

        // 尝试作为 GBK 解码
        try {
            const gbkText = iconv.decode(buffer, 'gbk');
            return gbkText;
        } catch (gbkError) {
            throw new Error(`Failed to decode file as GBK: ${(gbkError as Error).message}`);
        }

    } catch (error) {
        throw new Error(`Failed to read file: ${(error as Error).message}`);
    }
}