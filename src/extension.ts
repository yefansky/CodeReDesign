import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { selectFiles } from './fileSelector';
import { generateCvb, applyCvbToWorkspace, generateTimestamp, Cvb, TCVB, mergeCvb} from './cvbManager';
import { queryCodeReDesign, generateFilenameFromRequest, analyzeCode, callDeepSeekFixApi, GetLastMessageBody } from './deepseekApi';
import { setupCvbAsMarkdown } from './cvbMarkdownHandler';
import { registerCvbContextMenu } from './siderBar';
import { showInputMultiLineBox } from './UIComponents';
import { activateGuide } from './guide';
import {ChatPanel} from './chatPanel';

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

export async function doUploadCommand(cvbFilePath: string, userPrompt: string, outputChannel: vscode.OutputChannel){
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }

    resetCurrentOperationController();
    const CurrentOperationController = getCurrentOperationController();
    
    const workspacePath = workspaceFolders[0].uri.fsPath;
    const tmpDir = path.join(workspacePath, '.CodeReDesignWorkSpace');

    const filenameSummary = await generateFilenameFromRequest(userPrompt);
    const timestamp = generateTimestamp();
    let baseFileName = `${timestamp}_${filenameSummary}`;
    let fileName = `${baseFileName}.cvb`;
    let i = 1;
    while (fs.existsSync(path.join(tmpDir, fileName))) {
        fileName = `${baseFileName}_${i}.cvb`;
        i++;
    }

    const cvbContent = fs.readFileSync(cvbFilePath, 'utf-8');

    let apiResponse = await queryCodeReDesign(cvbContent, userPrompt, outputChannel, CurrentOperationController.signal);
    let processSuccess = true;
    let attemptCount = 0;
    do {
        try {
            if (apiResponse) {
                const tcvb = new TCVB(apiResponse);
                const oldCvb = new Cvb(cvbContent);
                const cvb = mergeCvb(oldCvb, tcvb);

                processSuccess = true;

                cvb.setMetaData("用户需求", userPrompt);
                const newCvbFilePath = path.join(tmpDir, fileName);
                fs.writeFileSync(newCvbFilePath, cvb.toString(), 'utf-8');
                vscode.window.showInformationMessage(`API response saved as CVB file: ${newCvbFilePath}`);
            }
        } catch (err : any){
            vscode.window.showInformationMessage(`API response have error ${err.message}, try fix ...`);
            apiResponse = await callDeepSeekFixApi(err.message, outputChannel, true, CurrentOperationController.signal);
            processSuccess = false;
            attemptCount++;
        }
    } while (!processSuccess && attemptCount < 3 && !CurrentOperationController.signal.aborted);

    let lastMessageBody = GetLastMessageBody();

    if (lastMessageBody && lastMessageBody.length > 2) {
        const mdFileName = `${baseFileName}.md`;
        const mdFilePath = path.join(tmpDir, mdFileName);
    
        // 创建新数组，第一条消息替换为 { "role": "user", "content": userPrompt }
        const modifiedMessages = [{ role: "user", content: userPrompt }, ...lastMessageBody.slice(2)];
    
        /*
        let mdContent = modifiedMessages.map(msg => {
            return `**${msg.role}**:\n\n${msg.content}\n\n`;
        }).join('\n');
        */
        
        // 定义修饰函数，加上表情符号
        const decorateWithEmojis = (role : string) => {
            return role === "user" ? "🙋‍♂️ **User**" : "🧠 **AI**";
        };

        // 生成Markdown内容，使用修饰函数
        let mdContent = modifiedMessages.map(msg => {
            return `${decorateWithEmojis(msg.role)}:\n\n${msg.content}\n\n`;
        }).join('\n');

        // 处理 TCVB 格式，只匹配行首的标记
        if (mdContent.includes('## BEGIN_TCVB')) {
            // 匹配行首的 ```任意语言标记\n## BEGIN_TCVB
            mdContent = mdContent.replace(/^```[^\n]*\n## BEGIN_TCVB/gm, '## BEGIN_TCVB');
            // 匹配行首的 ## END_TCVB\n```
            mdContent = mdContent.replace(/^## END_TCVB\n```$/gm, '## END_TCVB');
        }
    
        fs.writeFileSync(mdFilePath, mdContent, 'utf-8');
        vscode.window.showInformationMessage(`Conversation log saved as: ${mdFilePath}`);
    }    

    clearCurrentOperationController();
}

export async function saveAnalyzeCodeResult(request: string, respond: string){
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const workspacePath = (workspaceFolders && workspaceFolders.length > 0) ? workspaceFolders[0].uri.fsPath : "./";
    const tmpDir = path.join(workspacePath, '.CodeReDesignWorkSpace');
    const timestamp = generateTimestamp();
    const summary = await generateFilenameFromRequest(request);
    const mdFileName = `${timestamp}_${summary}.md`;
    const mdFilePath = path.join(tmpDir, mdFileName);
    const mdContent = `## 提问:\n\n${request}\n\n## 结果:\n\n${respond}`;
    fs.writeFileSync(mdFilePath, mdContent, 'utf-8');
}

function hideWorkspaceFolder() {
    const configuration = vscode.workspace.getConfiguration();
    configuration.update('files.exclude', {
        '**/.CodeReDesignWorkSpace': true
    }, vscode.ConfigurationTarget.Global);
}

// 插件激活时调用
export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "CodeReDesign" is now active!');
    
    activateGuide(context);

    hideWorkspaceFolder();

    // 创建输出通道
    const outputChannel = vscode.window.createOutputChannel('CodeReDesign API Stream', 'markdown');

    // 注册命令:开始对话
    let startChatCommand = vscode.commands.registerCommand('codeReDesign.startChat', () => {
        ChatPanel.createOrShow();
    });

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

        // 按照创建时间逆序排序
        cvbFiles.sort((a, b) => {
            const statsA = fs.statSync(path.join(tmpDir, a));
            const statsB = fs.statSync(path.join(tmpDir, b));
            return statsB.birthtime.getTime() - statsA.birthtime.getTime(); // 逆序排序
        });
    
        const selectedCvbFile = await vscode.window.showQuickPick(cvbFiles, {
            placeHolder: 'Select a CVB file to upload',
        });
    
        if (!selectedCvbFile) {
            return;
        }
    
        const userPrompt = await showInputMultiLineBox({
            prompt: 'Enter your prompt for the refactoring',
            placeHolder: 'e.g., Refactor the code to improve readability',
        });
    
        if (!userPrompt) {
            return;
        }

        const cvbFilePath = path.join(tmpDir, selectedCvbFile);
    
        doUploadCommand(cvbFilePath, userPrompt, outputChannel);
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

        // 按照创建时间逆序排序
        cvbFiles.sort((a, b) => {
            const statsA = fs.statSync(path.join(tmpDir, a));
            const statsB = fs.statSync(path.join(tmpDir, b));
            return statsB.birthtime.getTime() - statsA.birthtime.getTime(); // 逆序排序
        });

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
        const userRequest = await showInputMultiLineBox({
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

        if (analysisResult){
            saveAnalyzeCodeResult(userRequest, analysisResult);
        }
    });

    context.subscriptions.push(generateCvbCommand, uploadCvbCommand, applyCvbCommand, stopOperation, analyzeCodeCommand, outputChannel, startChatCommand);

    setupCvbAsMarkdown(context);

    // 注册右键菜单
    registerCvbContextMenu(context);
}

// 插件停用时调用
export function deactivate() {}