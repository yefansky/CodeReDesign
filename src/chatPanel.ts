import * as vscode from 'vscode';
import { callDeepSeekApi } from './deepseekApi';
import { getCurrentOperationController, resetCurrentOperationController } from './extension';
import path from 'path';
import * as fs from "fs";
import * as apiTools from './apiTools';
import { getOutputChannel } from './extension';

// Webview 输出通道实现
class WebviewOutputChannel implements vscode.OutputChannel {
    private readonly webview: vscode.Webview;
    private readonly channelName: string;

    constructor(webview: vscode.Webview, name: string) {
        this.webview = webview;
        this.channelName = name;
    }

    get name(): string {
        return this.channelName;
    }

    append(value: string): void {
        this.webview.postMessage({ role: 'model', content: value });
        getOutputChannel().append(value);
    }

    appendLine(value: string): void {
        this.append(value + '\n');
        getOutputChannel().append(value + '\n');
    }

    clear(): void {
        this.webview.postMessage({ role: 'model', content: '' });
    }

    show(): void { /* 可选实现 */ }
    hide(): void { /* 可选实现 */ }
    dispose(): void { /* 可选清理逻辑 */ }
    replace(value: string): void {
        this.webview.postMessage({ role: 'model', content: value });
    }
}

// 聊天面板类
export class ChatPanel {
    private static readonly viewType = 'chatPanel';
    private static currentPanel: ChatPanel | undefined;
    
    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];
    private conversation: { role: string; content: string }[] = [];
    private userMessageIndex: number = 0;
    private chatFilePath: string | null = null;
    private lastSaveTime: number = Date.now();
    private readonly context: vscode.ExtensionContext;

    private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
        this.panel = panel;
        this.context = context;
        this.setupPanelEventListeners();
        this.panel.webview.html = this.getHtmlForWebview();
    }

    public static createOrShow(context: vscode.ExtensionContext): void {
        const column = vscode.window.activeTextEditor?.viewColumn;
        
        if (ChatPanel.currentPanel) {
            ChatPanel.currentPanel.panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            ChatPanel.viewType,
            'Chat with Model',
            column || vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        
        ChatPanel.currentPanel = new ChatPanel(panel, context);
    }

    private setupPanelEventListeners(): void {
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.onDidReceiveMessage(
            (message) => this.handleMessage(message), 
            this, 
            this.disposables
        );
    }

    private getHtmlForWebview(): string {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                ${this.getHeadContent()}
            </head>
            <body>
                <div id="chat"></div>
                ${this.getInputContainerHtml()}
                ${this.getScriptTags()}
                <script>
                    ${this.getWebviewScript()}
                </script>
            </body>
            </html>
        `;
    }

    private getHeadContent(): string {
        const cssUri = this.getCssUri();
        return `
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src vscode-resource: https:; script-src vscode-resource: 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; style-src vscode-resource: 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; font-src https://cdn.jsdelivr.net;">
            <title>Chat with Model</title>
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.7.0/styles/atom-one-dark.min.css">
            <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
            <link rel="stylesheet" href="${cssUri}">
        `;
    }

    private getCssUri(): vscode.Uri {
        // 获取 css 文件的 URI
        const scriptUri = this.panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'src', 'resources', 'chatPanel.css')
        );
        return scriptUri;
    }

    private getInputContainerHtml(): string {
        return `
            <div id="input-container">
                <div class="top-right-flex-container">
                    <button id="new-session" class="fixed-width-btn">New Session</button>
                    <div class="mermaid-wrapper">
                        <input type="checkbox" id="mermaid-toggle">
                        <label for="mermaid-toggle">Show Mermaid Raw Code</label>
                    </div>
                </div>
                <textarea id="input" placeholder="Type your message here..."></textarea>
                <div class="bottom-controls">
                    <div class="left-controls">
                        <button id="send">Send</button>
                        <button id="stop" style="display:none;">Stop</button>
                        <div class="web-search">
                            <input type="checkbox" id="web-search">
                            <label for="web-search">联网搜索</label>
                        </div>
                        <div class="agent-mode">
                            <input type="checkbox" id="agent-mode">
                            <label for="agent-mode">Agent模式</label>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    private getScriptTags(): string {
        return `
            <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.7.0/highlight.min.js"></script>
            <script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"></script>
            <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
            <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"></script>
        `;
    }

    private getWebviewScript(): string {
        // 获取 JavaScript 文件的 URI
        const scriptUri = this.panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'src', 'resources', 'chatPanelScript.js')
        );
    
        return `
            // 全局变量声明
            const vscode = acquireVsCodeApi();
            const chat = document.getElementById('chat');
            const input = document.getElementById('input');
            const sendButton = document.getElementById('send');
            const stopButton = document.getElementById('stop');
            const newSessionButton = document.getElementById('new-session');
            const webSearchCheckbox = document.getElementById('web-search');
            const agentModeCheckbox = document.getElementById('agent-mode');
            const mermaidToggle = document.getElementById('mermaid-toggle');
    
            // 加载外部脚本
            const script = document.createElement('script');
            script.src = '${scriptUri}';
            document.body.appendChild(script);
        `;
    }

    private async handleMessage(message: any): Promise<void> {
        const webviewOutputChannel = new WebviewOutputChannel(this.panel.webview, 'DeepSeek API Output');

        switch (message.command) {
            case 'sendMessage':
            case 'editMessage':
                await this.handleSendOrEditMessage(message, webviewOutputChannel);
                this.saveChatToFile();
                break;
                
            case 'newSession':
                this.handleNewSession();
                break;
                
            case 'stop':
                this.handleStopCommand();
                break;
        }
    }

    private async handleSendOrEditMessage(message: any, webviewOutputChannel: WebviewOutputChannel): Promise<void> {
        if (message.command === 'editMessage' && message.index < this.conversation.length) {
            this.conversation.splice(message.index + 1);
            this.panel.webview.postMessage({ command: 'clearAfterIndex', index: message.index });
            this.userMessageIndex = message.index;
        }

        this.prepareChatFilePath();
        
        this.conversation.push({ role: 'user', content: message.text });
        this.panel.webview.postMessage({ 
            role: 'user', 
            content: message.text, 
            index: this.userMessageIndex++ 
        });

        this.updateUIForSending();

        try {
            const response = await this.callModelApi(message, webviewOutputChannel);
            this.conversation.push({ role: 'model', content: response || '' });
        } catch (error) {
            this.handleApiError(error);
        }

        this.updateUIAfterResponse();
    }

    private prepareChatFilePath(): void {
        if (!this.chatFilePath) {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders) {
                const workspacePath = workspaceFolders[0].uri.fsPath;
                const tmpDir = path.join(workspacePath, '.CodeReDesignWorkSpace');
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const filename = `${timestamp}_chat.chat`;
                this.chatFilePath = path.join(tmpDir, filename);
            }
        }
    }

    private updateUIForSending(): void {
        this.panel.webview.postMessage({ command: 'disableSendButton' });
        this.panel.webview.postMessage({ command: 'showStopButton' });
    }

    private updateUIAfterResponse(): void {
        this.panel.webview.postMessage({ command: 'enableSendButton' });
        this.panel.webview.postMessage({ command: 'hideStopButton' });
    }

    // Function to load prompt from file
    private loadAgentPrompt(): string {
        // Resolve path to resources/agentPrompt.txt
        const filePath = this.context.asAbsolutePath(path.join('src', 'resources', 'agentPrompt.txt'));
        try {
            const prmompt = fs.readFileSync(filePath, 'utf-8');
            return prmompt.trim();
        } catch (error) {
            throw new Error(`Failed to load agentPrompt.txt: ${(error as Error).message}`);
        }
    }

    private async callModelApi(message: any, webviewOutputChannel: WebviewOutputChannel): Promise<string | null> {
        let tools = null;
        const normalSystemPrompt = "用markdown输出。如果有数学公式要用$$包裹，每条一行不要换行。如果有流程图(Mermaid)里的每个字符串都要用引号包裹。";
        let systemPrompt = normalSystemPrompt;

        if (message.webSearch) {
            tools = apiTools.getWebSearchTools();
            systemPrompt += "每次回答问题前,先观察信息是否足够, 如果不够，先用tool_call进行网络搜索。不要盲目自信， 不要臆测不确定的信息。";
        }
        if (message.agentMode) {
            tools = apiTools.getAllTools();
            systemPrompt += this.loadAgentPrompt();
        }

        return await callDeepSeekApi(
            this.conversation.map(msg => ({ role: msg.role, content: msg.content })),
            systemPrompt,
            webviewOutputChannel,
            true,
            undefined,
            getCurrentOperationController().signal,
            false, 
            tools
        );
    }

    private handleApiError(error: any): void {
        this.panel.webview.postMessage({
            role: 'model',
            content: `**Error**: ${error instanceof Error ? error.message : 'Unknown error'}`
        });
    }

    private handleNewSession(): void {
        this.chatFilePath = null;
        this.conversation = [];
        this.userMessageIndex = 0;
        resetCurrentOperationController();
        this.panel.webview.postMessage({ command: 'clearAfterIndex', index: -1 });
    }

    private handleStopCommand(): void {
        resetCurrentOperationController();
        this.panel.webview.postMessage({ 
            role: 'model', 
            content: '\n\n**Operation stopped by user**' 
        });
    }

    private saveChatToFile(): void {
        if (!this.chatFilePath || Date.now() - this.lastSaveTime < 10000) {
            return;
        }

        try {
            const mdContent = this.conversation.map(msg => {
                return `@${msg.role === 'user' ? 'user' : 'AI'}:\n\n${msg.content}\n\n`;
            }).join('\n');

            // 确保路径存在
            const dirPath = path.dirname(this.chatFilePath);
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
            }

            fs.writeFileSync(this.chatFilePath, mdContent, 'utf-8');
            this.lastSaveTime = Date.now();
        } catch (error) {
            console.error('Failed to save chat file:', error);
        }
    }

    public static async loadFromFile(context: vscode.ExtensionContext, filePath: string) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const conversation = this.parseChatContent(content);
        
        this.createOrShow(context);

        ChatPanel.currentPanel!.chatFilePath = filePath;
        ChatPanel.currentPanel!.conversation = conversation;
        ChatPanel.currentPanel!.userMessageIndex = conversation.filter(m => m.role === 'user').length;

        // 将历史记录发送到webview
        conversation.forEach((msg, index) => {
            ChatPanel.currentPanel!.panel.webview.postMessage({
                role: msg.role,
                content: msg.content,
                index: msg.role === 'user' ? index : undefined
            });
        });
    }

    private static parseChatContent(content: string): Array<{role: string, content: string}> {
        const conversation = [];
        const lines = content.split('\n');
        let currentRole = '';
        let currentContent = [];
        
        for (const line of lines) {
            if (line.startsWith('@user:')) {
                if (currentRole) {
                    conversation.push({
                        role: currentRole,
                        content: currentContent.join('\n').trim()
                    });
                }
                currentRole = 'user';
                currentContent = [];
            } else if (line.startsWith('@AI:')) {
                if (currentRole) {
                    conversation.push({
                        role: currentRole,
                        content: currentContent.join('\n').trim()
                    });
                }
                currentRole = 'model';
                currentContent = [];
            } else {
                currentContent.push(line);
            }
        }

        if (currentRole) {
            conversation.push({
                role: currentRole,
                content: currentContent.join('\n').trim()
            });
        }

        return conversation;
    }

    public dispose(): void {
        ChatPanel.currentPanel = undefined;
        this.panel.dispose();
        
        while (this.disposables.length) {
            this.disposables.pop()?.dispose();
        }
    }
}