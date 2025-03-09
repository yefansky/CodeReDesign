import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { g_objLanguageMapping } from './languageMapping';

// 配置常量
const ALLOWED_FILENAMES = ['package.json']; // 文件名白名单
const INCLUDED_EXTENSIONS = Object.keys(g_objLanguageMapping); // 扩展名白名单
const EXCLUDED_DIRECTORIES = ['node_modules', '.git', 'build', 'dist', 'out', 'vendor']; // 排除目录

/**
 * 解析 ignore 文件内容并返回匹配模式数组
 * @param filePath ignore 文件路径
 * @returns 过滤模式数组
 */
function parseIgnoreFile(filePath: string): string[] {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        return content
            .split('\n')
            .map(line => line.trim())
            .filter(line => 
                line && // 非空行
                !line.startsWith('#') && // 不是注释
                !line.startsWith('!') // 不是反向模式
            )
            .map(pattern => {
                // 转换 gitignore 风格的模式为 glob 模式
                if (pattern.endsWith('/')) {
                    return `**/${pattern}**`;
                }
                return `**/${pattern}`;
            });
    } catch (error) {
        return [];
    }
}

/**
 * 显示文件选择器，并返回用户选择的文件列表
 * @returns 用户选择的文件路径数组
 */
export async function selectFiles(): Promise<string[]> {
    // 检查是否打开了工作区
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder found.');
        return [];
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    
    // 构建默认排除模式数组
    const defaultExcludePatterns = EXCLUDED_DIRECTORIES.map(dir => `**/${dir}/**`);
    
    // 获取 ignore 文件的模式
    let ignorePatterns: string[] = [];
    const gitignorePath = path.join(rootPath, '.gitignore');
    
    if (fs.existsSync(gitignorePath)) {
        ignorePatterns = ignorePatterns.concat(parseIgnoreFile(gitignorePath));
    }

    // 合并所有排除模式并确保是扁平结构
    const allExcludePatterns = [...defaultExcludePatterns, ...ignorePatterns];
    const excludePattern = allExcludePatterns.length > 0 
        ? `{${allExcludePatterns.join(',')}}`
        : undefined;

    // 1. 匹配白名单文件名
    const filenamePattern = `**/{${ALLOWED_FILENAMES.join(',')}}`;
    const filenameFiles = await vscode.workspace.findFiles(filenamePattern, excludePattern);

    // 2. 匹配扩展名文件
    const extensionPattern = `**/*.{${INCLUDED_EXTENSIONS.join(',')}}`;
    const extensionFiles = await vscode.workspace.findFiles(extensionPattern, excludePattern);

    // 3. 合并结果并去重
    const allFiles = [...filenameFiles, ...extensionFiles];
    const uniqueFiles = Array.from(new Set(allFiles.map(file => file.fsPath)));

    // 4. 显示文件选择面板
    const selectedItems = await vscode.window.showQuickPick(uniqueFiles, {
        placeHolder: 'Select files to include in the refactoring',
        canPickMany: true, // 允许多选
    });

    // 返回用户选择的文件
    if (selectedItems) {
        vscode.window.showInformationMessage(`Selected ${selectedItems.length} files.`);
        return selectedItems;
    }

    return [];
}