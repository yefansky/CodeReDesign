import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { selectFiles } from './fileSelector';
import { generateCvb, parseCvb, applyCvbToWorkspace, generateTimestamp } from './cvbManager';
import { queryCodeReDesign, generateFilenameFromRequest, analyzeCode } from './deepseekApi';
import { setupCvbAsMarkdown } from './cvbMarkdownHandler';
import { registerCvbContextMenu } from './siderBar';

let currentOperationController: AbortController | null = null;

export function getCurrentOperationController() {
    if (!currentOperationController) {
        currentOperationController = new AbortController;
    }
    return currentOperationController;
}

export function resetCurrentOperationController() {
    if (currentOperationController) {
        currentOperationController.abort();
        currentOperationController = null;
    }
    currentOperationController = new AbortController;
}

export function clearCurrentOperationController() {
    if (currentOperationController) {
        currentOperationController.abort(); // 中止操作
        currentOperationController = null; // 清除引用
    }
}

// 插件激活时调用
export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "CodeReDesign" is now active!');

    // 创建输出通道
    const outputChannel = vscode.window.createOutputChannel('CodeReDesign API Stream', 'markdown');

    // 注册命令:选择文件并生成 CVB
    let generateCvbCommand = vscode.commands.registerCommand('codeReDesign.generateCvb', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder found.');
            return;
        }

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

        const cvbFilePath = generateCvb(selectedFiles, userRequest);
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
        const tmpDir = path.join(workspacePath, '.CodeReDesignWorkSpace');
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

        resetCurrentOperationController();

        const apiResponse = await queryCodeReDesign(cvbContent, userPrompt, outputChannel, getCurrentOperationController().signal);
        if (apiResponse) {
            const { cvbContent: newCvbContent, metadata, files } = parseCvb(apiResponse);
            const newCvbFilePath = path.join(tmpDir, fileName);
            fs.writeFileSync(newCvbFilePath, newCvbContent, 'utf-8');
            vscode.window.showInformationMessage(`API response saved as CVB file: ${newCvbFilePath}`);
        }
        clearCurrentOperationController();
    });

    // 注册命令：中断当前的上传操作
    let stopOperation = vscode.commands.registerCommand('codeReDesign.stopOperation', () => {
        if (currentOperationController) {
            currentOperationController.abort();
            currentOperationController = null;
            vscode.window.showInformationMessage('Stop operation.');
        } else {
            vscode.window.showInformationMessage('No operation in progress.');
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
        const tmpDir = path.join(workspacePath, '.CodeReDesignWorkSpace');
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
            applyCvbToWorkspace(cvbContent);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to apply CVB: ${(error as Error).message}`);
        }
    });

    // 注册命令：分析代码
    let analyzeCodeCommand = vscode.commands.registerCommand('codeReDesign.analyzeCode', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder found.');
            return;
        }

        const workspacePath = workspaceFolders[0].uri.fsPath;
        const tmpDir = path.join(workspacePath, '.CodeReDesignWorkSpace');
        const cvbFiles = fs.readdirSync(tmpDir).filter((file: string) => file.endsWith('.cvb'));

        if (cvbFiles.length === 0) {
            vscode.window.showErrorMessage('No CVB files found in the tmp directory.');
            return;
        }

        // 让用户选择要分析的 CVB 文件
        const selectedCvbFile = await vscode.window.showQuickPick(cvbFiles, {
            placeHolder: 'Select a CVB file to analyze',
        });

        if (!selectedCvbFile) {
            return;
        }

        // 读取 CVB 文件内容
        const cvbFilePath = path.join(tmpDir, selectedCvbFile);
        const cvbContent = fs.readFileSync(cvbFilePath, 'utf-8');

        // 获取用户的分析需求
        const userRequest = await vscode.window.showInputBox({
            prompt: 'Enter your analysis request',
            placeHolder: 'e.g., Analyze the code for potential bugs',
        });

        if (!userRequest) {
            return;
        }

        resetCurrentOperationController();
        // 调用分析代码功能
        const analysisResult = await analyzeCode(cvbContent, userRequest, outputChannel, getCurrentOperationController().signal);
        if (analysisResult) {
            vscode.window.showInformationMessage('Analysis completed. Check the output channel for details.');
        }

        vscode.window.showInformationMessage('解析完毕');
    });

    context.subscriptions.push(generateCvbCommand, uploadCvbCommand, applyCvbCommand, stopOperation, analyzeCodeCommand, outputChannel);

    setupCvbAsMarkdown(context);

    // 注册右键菜单
    registerCvbContextMenu(context);
}

// 插件停用时调用
export function deactivate() {}