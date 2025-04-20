import * as vscode from 'vscode';
import { callDeepSeekApi } from './deepseekApi';
import { getCurrentOperationController, resetCurrentOperationController } from './extension';
import path from 'path';
import * as fs from "fs";
import * as apiTools from './apiTools';
import {getOutputChannel} from './extension';

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
        //getOutputChannel().append(value);
    }

    appendLine(value: string): void {
        this.append(value + '\n');
        //getOutputChannel().appendLine(value);
    }

    clear(): void {
        this.webview.postMessage({ role: 'model', content: '' });
    }

    show(columnOrPreserve?: vscode.ViewColumn | boolean, preserveFocus?: boolean): void {
        // 根据参数类型处理显示逻辑（这里简化为无操作，实际可扩展）
    }

    hide(): void {
        // 可选实现
    }

    dispose(): void {
        // 可选清理逻辑
    }

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

    private constructor(panel: vscode.WebviewPanel) {
        this.panel = panel;
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.html = this.getHtmlForWebview();
        this.panel.webview.onDidReceiveMessage((message) => this.handleMessage(message), this, this.disposables);
    }

    public static createOrShow(): void {
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
        ChatPanel.currentPanel = new ChatPanel(panel);
    }

    private getHtmlForWebview(): string {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src vscode-resource: https:; script-src vscode-resource: 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; style-src vscode-resource: 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; font-src https://cdn.jsdelivr.net;">
                <title>Chat with Model</title>
                <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.7.0/styles/atom-one-dark.min.css">
                <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
                <style>
                    #chat {
                        height: calc(100vh - 170px);
                        overflow-y: auto;
                        padding: 8px;
                    }
                    .user {
                        position: relative;
                        background-color: #a3a3a3;
                        color: black;
                        padding: 8px 12px 8px 40px;
                        margin: 4px 0;
                        border-radius: 4px;
                        white-space: pre-wrap;
                    }
                    .edit-btn {
                        position: absolute;
                        left: 8px;
                        top: 50%;
                        transform: translateY(-50%);
                        display: none;
                        background: none;
                        border: none;
                        color: #fff;
                        cursor: pointer;
                        padding: 4px;
                    }
                    .user:hover .edit-btn {
                        display: block;
                    }
                    .model {
                        background-color: #333;
                        color: white;
                        padding: 12px;
                        margin: 4px 0;
                        border-radius: 4px;
                    }
                    .model pre code {
                        background-color: #040404 !important;
                        padding: 1em;
                        border-radius: 4px;
                        display: block;
                        overflow-x: auto;
                    }
                    .model code {
                        background-color: #040404;
                        padding: 2px 4px;
                        border-radius: 3px;
                    }
                    .copy-btn {
                        position: absolute;
                        right: 8px;
                        top: 8px;
                        padding: 4px 8px;
                        background: #616161;
                        border: none;
                        color: white;
                        cursor: pointer;
                        border-radius: 4px;
                        font-size: 0.8em;
                        transition: opacity 0.3s;
                    }
                    .copy-btn:hover {
                        background: #757575;
                    }
                    .model pre {
                        position: relative;
                        padding-top: 30px !important;
                    }
                    .katex {
                        color: white !important;
                        background-color: transparent !important;
                    }
                    .katex-display > .katex {
                        padding: 1em 0;
                    }
                    #input-container {
                        position: fixed;
                        bottom: 0;
                        width: 100%;
                        background-color: var(--vscode-editor-background);
                        padding: 10px;
                        box-sizing: border-box;
                    }
                    #input {
                        width: 100%;
                        height: 100px;
                        padding: 8px;
                        margin-bottom: 8px;
                        color: var(--vscode-input-foreground);
                        background-color: var(--vscode-input-background);
                        border: 1px solid var(--vscode-input-border);
                    }
                    button {
                        padding: 8px 16px;
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        cursor: pointer;
                    }
                </style>
            </head>
            <body>
                <div id="chat"></div>
                <div id="input-container">
                    <textarea id="input" placeholder="Type your message here... (Ctrl+Enter to send)"></textarea>
                    <button id="send">Send</button>
                    <button id="stop" style="display: none;">Stop</button>
                    <button id="new-session" style="position: absolute; top: 10px; right: 10px;">New Session</button>

                    <input type="checkbox" id="web-search">
                    <label for="web-search">联网搜索</label>
                </div>
                <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
                <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.7.0/highlight.min.js"></script>
                <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
                <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"></script>
                <script>
                    const vscode = acquireVsCodeApi();
                    const chat = document.getElementById('chat');
                    const input = document.getElementById('input');
                    const sendButton = document.getElementById('send');
                    const stopButton = document.getElementById('stop');
                    const newSessionButton = document.getElementById('new-session');
                    const webSearchCheckbox = document.getElementById('web-search');

                    // 配置代码高亮
                    hljs.configure({ ignoreUnescapedHTML: true });

                    // 添加编辑按钮功能
                    function setupEditButtons() {
                        document.querySelectorAll('.edit-btn').forEach(btn => {
                            btn.onclick = (event) => {
                                const userDiv = event.target.closest('.user');
                                const contentDiv = userDiv.querySelector('.user-content');
                                userDiv.innerHTML = \`
                                    <textarea class="edit-textarea" style="width:100%; min-height:100px; resize:vertical; margin-bottom:8px; padding:8px; box-sizing:border-box;">\${contentDiv.textContent}</textarea>
                                    <div class="edit-buttons" style="display:flex; gap:8px; justify-content:flex-end;">
                                        <button class="edit-send" style="padding:6px 12px;">发送</button>
                                        <button class="edit-cancel" style="padding:6px 12px;">取消</button>
                                    </div>\`;

                                const editSend = userDiv.querySelector('.edit-send');
                                const editCancel = userDiv.querySelector('.edit-cancel');

                                editSend.onclick = () => {
                                    const newText = userDiv.querySelector('textarea').value;
                                    vscode.postMessage({ command: 'editMessage', index: parseInt(userDiv.dataset.index), text: newText });
                                    userDiv.innerHTML = \`<button class="edit-btn">✎</button><div class="user-content">\${newText}</div>\`;
                                    setupEditButtons();
                                };

                                editCancel.onclick = () => {
                                    userDiv.innerHTML = \`<button class="edit-btn">✎</button><div class="user-content">\${contentDiv.textContent}</div>\`;
                                    setupEditButtons();
                                };
                            };
                        });
                    }

                    // 为代码块添加复制按钮
                    function ensureCopyButtons() {
                        document.querySelectorAll('.model pre').forEach(pre => {
                            if (!pre.querySelector('.copy-btn')) {
                                const button = document.createElement('button');
                                button.className = 'copy-btn';
                                button.textContent = 'Copy';
                                pre.appendChild(button);
                            }
                        });
                    }

                    // 处理复制按钮点击（事件委托）
                    function setupCopyButtonDelegation() {
                        chat.addEventListener('click', (event) => {
                            const copyBtn = event.target.closest('.copy-btn');
                            if (!copyBtn) return;

                            const preElement = copyBtn.closest('pre');
                            if (!preElement) return;

                            const code = preElement.querySelector('code').textContent;
                            navigator.clipboard.writeText(code)
                                .then(() => {
                                    copyBtn.textContent = 'Copied!';
                                    setTimeout(() => copyBtn.textContent = 'Copy', 2000);
                                })
                                .catch(err => console.error('Copy failed:', err));
                        });
                    }

                    /**
                     * fnRenderDisplayMath
                     * 把 container.innerHTML 里所有的 $$…$$ 块，
                     * 用 katex.renderToString 直接渲染成 HTML
                     */
                    function fnRenderDisplayMath(webviewDiv)
                    {
                        // 1) 获取原始 HTML
                        const strRawHtml = webviewDiv.innerHTML;

                        // 2) 匹配所有 $$…$$（非贪婪）
                        const rgxDisplayMath = /\$\$([\s\S]+?)\$\$/g;

                        // 3) 替换成 katex 渲染结果
                        const strReplacedHtml = strRawHtml.replace(rgxDisplayMath
                        ,
                        (strMatch, strInnerTex) =>
                        {
                            try
                            {
                                // trim 首尾空白，保持 display 模式
                                const strTex = strInnerTex.replace(/^\s+|\s+$/g, '');
                                return katex.renderToString(strTex
                                ,
                                {
                                    displayMode: true,
                                    throwOnError: false
                                });
                            }
                            catch (err)
                            {
                                console.error('KaTeX render error:', err);
                                // 渲染失败就返回原始 $$…$$
                                return strMatch;
                            }
                        });

                        // 4) 更新回 DOM
                        webviewDiv.innerHTML = strReplacedHtml;
                    }

                    // 渲染消息内容
                    function renderMessage(role, content, index) {
                        const lastChild = chat.lastElementChild;
                        let targetDiv;

                        if (lastChild && lastChild.classList.contains(role)) {
                            targetDiv = lastChild;
                            targetDiv.dataset.markdownContent += content;
                        } else {
                            targetDiv = document.createElement('div');
                            targetDiv.className = role;
                            targetDiv.dataset.markdownContent = content;
                            chat.appendChild(targetDiv);
                        }

                        if (role === 'model') {
                            targetDiv.innerHTML = marked.parse(targetDiv.dataset.markdownContent, {
                                breaks: false,
                                mangle: false,
                                headerIds: false,
                                highlight: (code, lang) => hljs.highlight(hljs.getLanguage(lang) ? lang : 'plaintext', code).value
                            });

                            fnRenderDisplayMath(targetDiv);

                            renderMathInElement(targetDiv, {
                                delimiters: [
                                    { left: '$$', right: '$$', display: true },
                                    { left: '$', right: '$', display: false },
                                    { left: '\\[', right: '\\]', display: true },
                                    { left: '\\(', right: '\\)', display: false }
                                ],
                                throwOnError: false
                            });
                            ensureCopyButtons();
                            hljs.highlightAll();
                        } else {
                            targetDiv.innerHTML = \`<button class="edit-btn">✎</button><div class="user-content">\${targetDiv.dataset.markdownContent}</div>\`;
                            targetDiv.dataset.index = index;
                            setupEditButtons();
                        }
                        chat.scrollTop = chat.scrollHeight;
                    }

                    // 处理 Webview 消息
                    window.addEventListener('message', (event) => {
                        const data = event.data;

                        if (data.role && data.content) {
                            renderMessage(data.role, data.content, data.index);
                            return;
                        }

                        if (!data.command) return;

                        switch (data.command) {
                            case 'disableSendButton':
                                sendButton.disabled = true;
                                break;
                            case 'enableSendButton':
                                sendButton.disabled = false;
                                break;
                            case 'showStopButton':
                                stopButton.style.display = 'inline-block';
                                break;
                            case 'hideStopButton':
                                stopButton.style.display = 'none';
                                break;
                            case 'clearAfterIndex':
                                const clearIndex = data.index;
                                document.querySelectorAll('.user').forEach(userDiv => {
                                    if (parseInt(userDiv.dataset.index) >= clearIndex) {
                                        const modelDiv = userDiv.nextElementSibling;
                                        if (modelDiv?.classList.contains('model')) modelDiv.remove();
                                        userDiv.remove();
                                    }
                                });
                                break;
                        }
                    });

                    // 初始化事件监听
                    setupCopyButtonDelegation();

                    // 发送消息
                    sendButton.addEventListener('click', () => {
                        const text = input.value.trim();
                        if (text) {
                            vscode.postMessage({ command: 'sendMessage', text, webSearch: webSearchCheckbox.checked });
                            input.value = '';
                        }
                    });

                    // 新会话
                    newSessionButton.addEventListener('click', () => {
                        vscode.postMessage({ command: 'newSession' });
                        chat.innerHTML = '';
                        sendButton.disabled = false;
                        stopButton.style.display = 'none';
                    });

                    // 停止操作
                    stopButton.addEventListener('click', () => {
                        vscode.postMessage({ command: 'stop' });
                    });

                    // Ctrl+Enter 发送
                    input.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                            const text = input.value.trim();
                            if (text) {
                                vscode.postMessage({ command: 'sendMessage', text , webSearch: webSearchCheckbox.checked });
                                input.value = '';
                            }
                        }
                    });
                </script>
            </body>
            </html>
        `;
    }

    private async handleMessage(message: any): Promise<void> {
        const webviewOutputChannel = new WebviewOutputChannel(this.panel.webview, 'DeepSeek API Output');

        if (message.command === 'sendMessage' || message.command === 'editMessage') {
            await this.handleSendOrEdit(message, webviewOutputChannel);
            this.saveChatToFile();
            return;
        }

        if (message.command === 'newSession') {
            this.chatFilePath = null;
        }

        if (message.command === 'newSession') {
            this.conversation = [];
            this.userMessageIndex = 0;
            resetCurrentOperationController();
            this.panel.webview.postMessage({ command: 'clearAfterIndex', index: -1 });
            return;
        }

        if (message.command === 'stop') {
            resetCurrentOperationController();
            this.panel.webview.postMessage({ role: 'model', content: '\n\n**Operation stopped by user**' });
        }
    }

    private async handleSendOrEdit(message: any, webviewOutputChannel: WebviewOutputChannel): Promise<void> {
        if (message.command === 'editMessage' && message.index < this.conversation.length) {
            this.conversation.splice(message.index + 1);
            this.panel.webview.postMessage({ command: 'clearAfterIndex', index: message.index });
            this.userMessageIndex = message.index;
        }

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

        this.conversation.push({ role: 'user', content: message.text });
        this.panel.webview.postMessage({ role: 'user', content: message.text, index: this.userMessageIndex++ });

        this.panel.webview.postMessage({ command: 'disableSendButton' });
        this.panel.webview.postMessage({ command: 'showStopButton' });

        try {
            const tools = message.webSearch ? [apiTools.searchTool] : null;
            const nomalSystemPromot = "用markdown输出。";
            const systemPrompt = message.webSearch ? "每次回答问题前，一定要先上网搜索一下再回答。" + nomalSystemPromot : nomalSystemPromot;
            const response = await callDeepSeekApi(
                this.conversation.map(msg => ({ role: msg.role, content: msg.content })),
                systemPrompt,
                webviewOutputChannel,
                true,
                undefined,
                getCurrentOperationController().signal,
                false, tools
            );

            this.conversation.push({ role: 'model', content: response || '' });
        } catch (error) {
            this.panel.webview.postMessage({
                role: 'model',
                content: `**Error**: ${error instanceof Error ? error.message : 'Unknown error'}`
            });
        }

        this.panel.webview.postMessage({ command: 'enableSendButton' });
        this.panel.webview.postMessage({ command: 'hideStopButton' });
    }

    public dispose(): void {
        ChatPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            this.disposables.pop()?.dispose();
        }
    }

    private saveChatToFile(): void {
        if (!this.chatFilePath) {
            return;
        }

        const now = Date.now();
        if (now - this.lastSaveTime < 10000) {
            return;
        }

        const mdContent = this.conversation.map(msg => {
            return `@${msg.role === 'user' ? 'user' : 'AI'}:\n\n${msg.content}\n\n`;
        }).join('\n');

        fs.writeFileSync(this.chatFilePath, mdContent, 'utf-8');
        this.lastSaveTime = now;
    }
}