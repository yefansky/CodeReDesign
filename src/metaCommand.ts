import * as fs from 'fs';
import * as path from 'path';
import {readFileAsUtf8} from './utiliti';

// Process @file:path placeholders in the message text
export async function processFilePlaceholder(messageText: string): Promise<string> {
    const filePlaceholderRegex = /^@file:([^\s\n]+)(?:\s|\n|$)/m;
    const match = messageText.match(filePlaceholderRegex);

    if (!match) {
        return messageText;
    }

    const filePath = match[1];
    try {
        // Read file content
        const content = await readFileAsUtf8(filePath);
        const fileName = path.basename(filePath);

        // Replace placeholder with formatted content
        return messageText.replace(
            filePlaceholderRegex,
            `<FILE_UPLOAD data-path="${filePath}"><content>\n${content}\n</content></FILE_UPLOAD>`
        );
    } catch (error) {
        return messageText.replace(
            filePlaceholderRegex,
            `<FILE_UPLOAD data-path="${filePath}">\n**Error reading file**: ${(error as Error).message}\n</FILE_UPLOAD>`
        );
    }
}