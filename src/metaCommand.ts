import * as path from 'path';
import { readFileAsUtf8 } from './utiliti';

export async function processFilePlaceholder(messageText: string): Promise<string> {
    // 修改1：添加全局匹配标志/g，移除行首限制^
    const filePlaceholderRegex = /@file:([^\s\n]+)(?:\s|\n|$)/g;
    
    // 修改2：存储所有匹配项
    const matches = [];
    let match;
    while ((match = filePlaceholderRegex.exec(messageText)) !== null) {
        matches.push(match);
    }

    if (matches.length === 0) {
        return messageText;
    }

    let processedText = messageText;
    // 修改3：倒序处理（避免替换后索引变化）
    for (let i = matches.length - 1; i >= 0; i--) {
        const match = matches[i];
        const filePath = match[1];
        const fullMatch = match[0];

        try {
            const content = await readFileAsUtf8(filePath);
            const replacement = `<FILE_UPLOAD data-path="${filePath}"><content>\n${content}\n</content></FILE_UPLOAD>`;
            processedText = processedText.substring(0, match.index) +
                replacement +
                processedText.substring(match.index + fullMatch.length);
        } catch (error) {
            const replacement = `<FILE_UPLOAD data-path="${filePath}">\n**Error reading file**: ${(error as Error).message}\n</FILE_UPLOAD>`;
            processedText = processedText.substring(0, match.index) +
                replacement +
                processedText.substring(match.index + fullMatch.length);
        }
    }

    return processedText;
}