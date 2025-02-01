import * as vscode from 'vscode';

// 配置常量
const ALLOWED_FILENAMES = ['package.json']; // 文件名白名单
const INCLUDED_EXTENSIONS = ['cpp', 'h', 'c', 'cxx', 'hpp', 'py', 'lua', 'ls', 'lh', 'ts', 'js']; // 扩展名白名单
const EXCLUDED_DIRECTORIES = ['node_modules', '.git', 'build', 'dist', 'out', 'vendor']; // 排除目录

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

    const excludePattern = `{${EXCLUDED_DIRECTORIES.map(dir => `**/${dir}/**`).join(',')}}`;

    // 1. 匹配白名单文件名
    const filenamePattern = `**/{${ALLOWED_FILENAMES.join(',')}}`;
    const filenameFiles = await vscode.workspace.findFiles(filenamePattern, excludePattern);

    // 2. 匹配扩展名文件，并排除指定目录
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