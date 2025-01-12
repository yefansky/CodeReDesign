import * as vscode from 'vscode';
import * as path from 'path'; // 导入 path 模块
import * as fs from 'fs'; // 导入 fs 模块
import { selectFiles } from './fileSelector';
import { generateCvb, parseCvb } from './cvbManager';

// 插件激活时调用
export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "CodeReDesign" is now active!');

    // 注册命令：选择文件并生成 CVB
    let generateCvbCommand = vscode.commands.registerCommand('codeReDesign.generateCvb', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder found.');
            return;
        }

        // 获取当前工作目录
        const workspacePath = workspaceFolders[0].uri.fsPath;

        // 选择文件
        const selectedFiles = await selectFiles();
        if (selectedFiles.length === 0) {
            vscode.window.showErrorMessage('No files selected.');
            return;
        }

        // 生成 CVB 文件
        const cvbFilePath = generateCvb(selectedFiles, workspacePath);
        vscode.window.showInformationMessage(`CVB file generated at: ${cvbFilePath}`);
    });

    // 注册命令：解析 CVB 文件
    let parseCvbCommand = vscode.commands.registerCommand('codeReDesign.parseCvb', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder found.');
            return;
        }

        // 获取当前工作目录
        const workspacePath = workspaceFolders[0].uri.fsPath;

        // 获取临时目录下的 CVB 文件
        const tmpDir = path.join(workspacePath, 'CodeReDesignWorkSpace', 'tmp');
        const cvbFiles = fs.readdirSync(tmpDir).filter((file: string) => file.endsWith('.cvb')); // 显式定义 file 类型

        if (cvbFiles.length === 0) {
            vscode.window.showErrorMessage('No CVB files found in the tmp directory.');
            return;
        }

        // 选择 CVB 文件
        const selectedCvbFile = await vscode.window.showQuickPick(cvbFiles, {
            placeHolder: 'Select a CVB file to parse',
        });

        if (!selectedCvbFile) {
            return;
        }

        // 解析 CVB 文件
        const cvbFilePath = path.join(tmpDir, selectedCvbFile);
        const parsedFiles = parseCvb(cvbFilePath);

        // 显示解析结果
        vscode.window.showInformationMessage(`Parsed ${Object.keys(parsedFiles).length} files from CVB.`);
        console.log('Parsed files:', parsedFiles);
    });

    // 将命令注册到插件上下文中
    context.subscriptions.push(generateCvbCommand, parseCvbCommand);
}

// 插件停用时调用
export function deactivate() {}