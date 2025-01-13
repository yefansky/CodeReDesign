import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { selectFiles } from './fileSelector';
import { generateCvb, getCvbFormatDescription } from './cvbManager';
import { callDeepSeekApi } from './deepseekApi';

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

        const workspacePath = workspaceFolders[0].uri.fsPath;
        const selectedFiles = await selectFiles();
        if (selectedFiles.length === 0) {
            vscode.window.showErrorMessage('No files selected.');
            return;
        }

        const cvbFilePath = generateCvb(selectedFiles, workspacePath);
        vscode.window.showInformationMessage(`CVB file generated at: ${cvbFilePath}`);
    });

    // 注册命令：上传 CVB 并调用 API
    let uploadCvbCommand = vscode.commands.registerCommand('codeReDesign.uploadCvb', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder found.');
            return;
        }

        const workspacePath = workspaceFolders[0].uri.fsPath;
        const tmpDir = path.join(workspacePath, 'CodeReDesignWorkSpace', 'tmp');
        const cvbFiles = fs.readdirSync(tmpDir).filter((file: string) => file.endsWith('.cvb'));

        if (cvbFiles.length === 0) {
            vscode.window.showErrorMessage('No CVB files found in the tmp directory.');
            return;
        }

        const selectedCvbFile = await vscode.window.showQuickPick(cvbFiles, {
            placeHolder: 'Select a CVB file to upload',
        });

        if (!selectedCvbFile) {
            return;
        }

        const cvbFilePath = path.join(tmpDir, selectedCvbFile);
        const cvbContent = fs.readFileSync(cvbFilePath, 'utf-8');

        const userRequest = await vscode.window.showInputBox({
            prompt: 'Enter your refactoring request',
            placeHolder: 'e.g., Move all mouse event handling code to a single file',
        });

        if (!userRequest) {
            return;
        }

        const apiResponse = await callDeepSeekApi(cvbContent, userRequest);
        if (apiResponse) {
            const newCvbFilePath = path.join(tmpDir, `${new Date().getTime()}.cvb`);
            fs.writeFileSync(newCvbFilePath, apiResponse, 'utf-8');
            vscode.window.showInformationMessage(`API response saved as CVB file: ${newCvbFilePath}`);
        }
    });

    context.subscriptions.push(generateCvbCommand, uploadCvbCommand);
}

// 插件停用时调用
export function deactivate() {}