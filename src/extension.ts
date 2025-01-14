import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { selectFiles } from './fileSelector';
import { generateCvb, parseCvb, applyCvbToWorkspace, generateTimestamp } from './cvbManager';
import { callDeepSeekApi, generateFilenameFromRequest} from './deepseekApi';
import { setupCvbAsMarkdown } from './cvbMarkdownHandler';

// 插件激活时调用
export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "CodeReDesign" is now active!');

    // 创建输出通道
    const outputChannel = vscode.window.createOutputChannel('CodeReDesign API Stream');

    // 注册命令:选择文件并生成 CVB
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

        const userRequest = await vscode.window.showInputBox({
            prompt: 'Enter your refactoring request',
            placeHolder: 'e.g., Move all mouse event handling code to a single file',
        });

        if (!userRequest) {
            return;
        }

        const cvbFilePath = generateCvb(selectedFiles, workspacePath, userRequest);
        vscode.window.showInformationMessage(`CVB file generated at: ${cvbFilePath}`);
    });

    // 注册命令:上传 CVB 并调用 API
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
    
        const userPrompt = await vscode.window.showInputBox({
            prompt: 'Enter your prompt for the refactoring',
            placeHolder: 'e.g., Refactor the code to improve readability',
        });
    
        if (!userPrompt) {
            return;
        }
    
        const filenameSummary = await generateFilenameFromRequest(userPrompt);
        const timestamp = generateTimestamp();
        let baseFileName = `${timestamp}_${filenameSummary}.cvb`;
        let fileName = baseFileName;
        let i = 1;
        while (fs.existsSync(path.join(tmpDir, fileName))) {
            fileName = `${timestamp}_${filenameSummary}_${i}.cvb`;
            i++;
        }
    
        const cvbFilePath = path.join(tmpDir, selectedCvbFile);
        const cvbContent = fs.readFileSync(cvbFilePath, 'utf-8');
    
        const apiResponse = await callDeepSeekApi(cvbContent, userPrompt, outputChannel);
        if (apiResponse) {
            const { cvbContent: newCvbContent, metadata, files } = parseCvb(apiResponse);
            const newCvbFilePath = path.join(tmpDir, fileName);
            fs.writeFileSync(newCvbFilePath, newCvbContent, 'utf-8');
            vscode.window.showInformationMessage(`API response saved as CVB file: ${newCvbFilePath}`);
        }
    });

    // 注册命令：应用 CVB 到工作目录
    let applyCvbCommand = vscode.commands.registerCommand('codeReDesign.applyCvb', async () => {
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

        // 让用户选择要应用的 CVB 文件
        const selectedCvbFile = await vscode.window.showQuickPick(cvbFiles, {
            placeHolder: 'Select a CVB file to apply',
        });

        if (!selectedCvbFile) {
            return;
        }

        // 读取 CVB 文件内容
        const cvbFilePath = path.join(tmpDir, selectedCvbFile);
        const cvbContent = fs.readFileSync(cvbFilePath, 'utf-8');

        try {
            // 应用 CVB 到工作目录
            applyCvbToWorkspace(cvbContent, workspacePath);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to apply CVB: ${(error as Error).message}`);
        }
    });

    context.subscriptions.push(generateCvbCommand, uploadCvbCommand, applyCvbCommand, outputChannel);

    setupCvbAsMarkdown(context);
}

// 插件停用时调用
export function deactivate() {}