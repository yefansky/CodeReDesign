import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { g_objLanguageMapping } from './languageMapping';

// 配置常量
const ALLOWED_FILENAMES = ['package.json']; // 文件名白名单
const INCLUDED_EXTENSIONS = Object.keys(g_objLanguageMapping); // 扩展名白名单
const EXCLUDED_DIRECTORIES = [
    'node_modules', 
    '.git', 
    'build', 
    'dist', 
    'out', 
    'vendor', 
    'venv', // Python 虚拟环境
    'site-packages', // Python 的 site-packages 目录
]; // 排除目录

/**
 * 解析 .gitignore 文件，返回正向模式和反向模式
 * @param filePath .gitignore 文件路径
 * @returns { ignorePatterns: string[], includePatterns: string[] }
 */
function parseGitignore(filePath: string): { ignorePatterns: string[], includePatterns: string[] } {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
        const ignorePatterns: string[] = [];
        const includePatterns: string[] = [];
        lines.forEach(line => {
            if (line.startsWith('!')) {
                includePatterns.push(line.slice(1)); // 去掉 '!'，作为强制包含模式
            } else {
                ignorePatterns.push(line);
            }
        });
        return { ignorePatterns, includePatterns };
    } catch (error) {
        return { ignorePatterns: [], includePatterns: [] };
    }
}

/**
 * 检查文件是否匹配某个模式（简单的手动匹配）
 * @param filePath 文件路径
 * @param pattern 模式
 * @returns 是否匹配
 */
function matchesPattern(filePath: string, pattern: string): boolean {
    const basename = path.basename(filePath);
    if (pattern.startsWith('*') && pattern.includes(',')) {
        const exactExtension = pattern.slice(1); // 去掉前面的 *，保留 .py,cover
        return basename.endsWith(exactExtension);
    }
    // 其他简单模式（可以扩展支持更多规则）
    return basename === pattern || filePath.includes(pattern);
}

/**
 * 显示文件选择器，并返回用户选择的文件列表
 * @returns 用户选择的文件路径数组
 */
export async function selectFiles(): Promise<string[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder found.');
        return [];
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const gitignorePath = path.join(rootPath, '.gitignore');
    const { ignorePatterns, includePatterns } = fs.existsSync(gitignorePath) ? parseGitignore(gitignorePath) : { ignorePatterns: [], includePatterns: [] };

    // 获取所有符合扩展名和文件名的文件
    const filenamePattern = `**/{${ALLOWED_FILENAMES.join(',')}}`;
    const extensionPattern = `**/*.{${INCLUDED_EXTENSIONS.join(',')}}`;
    const filenameFiles = await vscode.workspace.findFiles(filenamePattern);
    const extensionFiles = await vscode.workspace.findFiles(extensionPattern);

    // 合并并去重
    const allFiles = [...filenameFiles, ...extensionFiles];
    const uniqueFiles = Array.from(new Set(allFiles.map(file => file.fsPath)));

    // 手动过滤
    const filteredFiles = uniqueFiles.filter(filePath => {
        const relativePath = path.relative(rootPath, filePath);

        // 检查排除目录
        for (const dir of EXCLUDED_DIRECTORIES) {
            if (relativePath.startsWith(dir + path.sep)) {
                return false;
            }
        }

        // 检查 .gitignore 模式
        let shouldIgnore = false;
        for (const pattern of ignorePatterns) {
            if (matchesPattern(filePath, pattern)) {
                shouldIgnore = true;
                break;
            }
        }
        // 检查反向模式（强制包含）
        for (const pattern of includePatterns) {
            if (matchesPattern(filePath, pattern)) {
                shouldIgnore = false; // 强制包含
                break;
            }
        }

        return !shouldIgnore;
    });

    // 显示选择面板
    const selectedItems = await vscode.window.showQuickPick(filteredFiles, {
        placeHolder: 'Select files to include in the refactoring',
        canPickMany: true,
    });

    // 返回用户选择的文件
    if (selectedItems) {
        vscode.window.showInformationMessage(`Selected ${selectedItems.length} files.`);
        return selectedItems;
    }

    return [];
}