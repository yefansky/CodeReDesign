import * as vscode from 'vscode';

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

    // 获取当前目录下的所有源文件
    const files = await vscode.workspace.findFiles('**/*.{cpp,h,c,cxx,hpp,py,lua,ls,lh,ts,js}'); // 支持的文件类型
    const filePaths = files.map(file => file.fsPath);

    // 显示文件选择面板
    const selectedItems = await vscode.window.showQuickPick(filePaths, {
        placeHolder: 'Select files to include in the refactoring',
        canPickMany: true, // 允许多选
    });

    if (selectedItems) {
        vscode.window.showInformationMessage(`Selected ${selectedItems.length} files.`);
        return selectedItems;
    }

    return [];
}