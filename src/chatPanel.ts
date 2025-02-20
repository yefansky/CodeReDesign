import * as vscode from 'vscode';
import { callDeepSeekApi } from './deepseekApi';
import { getCurrentOperationController, resetCurrentOperationController } from './extension';

class WebviewOutputChannel implements vscode.OutputChannel {
    private _webview: vscode.Webview;
    private _name: string;

    constructor(webview: vscode.Webview, name: string) {
        this._webview = webview;
        this._name = name;
    }

    get name(): string {
        return this._name;
    }

    append(value: string): void {
        // 将数据通过 Webview 发送出去
        this._webview.postMessage({ role: 'model', content: value });
    }

    appendLine(value: string): void {
        this.append(value + '\n');
    }

    clear(): void {
        // 清除输出，通常可以通过清空 Webview 来实现
        this._webview.postMessage({ role: 'model', content: '' });
    }

    show(preserveFocus?: boolean): void;
    show(column?: vscode.ViewColumn, preserveFocus?: boolean): void;
    show(arg1?: boolean | vscode.ViewColumn, arg2?: boolean): void {
        if (typeof arg1 === 'boolean') {
            // 第一种重载：show(preserveFocus?: boolean)
            //this._webview.postMessage({ role: 'model', content: 'Webview is now shown' });
        } else {
            // 第二种重载：show(column?: ViewColumn, preserveFocus?: boolean)
            if (arg1 !== undefined) {
                // 根据 column 进行处理（可以自定义逻辑）
                //console.log(`Showing in column: ${arg1}`);
            }
            //this._webview.postMessage({ role: 'model', content: 'Webview is now shown' });
        }
    }
    hide(): void {

    }

    dispose(): void{
        
    }

    replace(value: string): void {
        // 替换输出内容
        this._webview.postMessage({ role: 'model', content: value });
    }
}


export class ChatPanel {
    private static readonly viewType = 'chatPanel';
    private static currentPanel: ChatPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _conversation: { role: string, content: string }[] = [];
    private _userMessageIndex: number = 0;

    private constructor(panel: vscode.WebviewPanel) {
        this._panel = panel;
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.html = this._getHtmlForWebview();
        this._panel.webview.onDidReceiveMessage(this._handleMessage, this, this._disposables);
    }

    public static createOrShow() {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (ChatPanel.currentPanel) {
            ChatPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            ChatPanel.viewType,
            'Chat with Model',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        );

        ChatPanel.currentPanel = new ChatPanel(panel);
    }

    private _getHtmlForWebview() {
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
                        padding: 12px 12px 12px 40px;
                        margin: 8px 0;
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
                        margin: 8px 0;
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

                    function addEditButtons() {
                        document.querySelectorAll('.edit-btn').forEach(btn => {
                            btn.onclick = function(event) {
                                const userDiv = event.target.closest('.user');
                                const contentDiv = userDiv.querySelector('.user-content');
                                userDiv.innerHTML = \`
                                    <textarea class="edit-textarea">\${contentDiv.textContent}</textarea>
                                    <div class="edit-buttons">
                                        <button class="edit-send">发送</button>
                                        <button class="edit-cancel">取消</button>
                                    </div>
                                \`;
                                
                                userDiv.querySelector('.edit-send').onclick = () => {
                                    const newText = userDiv.querySelector('textarea').value;
                                    vscode.postMessage({
                                        command: 'editMessage',
                                        index: parseInt(userDiv.dataset.index),
                                        text: newText
                                    });
                                    // 立即更新当前消息显示
                                    userDiv.innerHTML = \`
                                        <button class="edit-btn">✎</button>
                                        <div class="user-content">\${newText}</div>
                                    \`;
                                    addEditButtons();
                                    userDiv.querySelectorAll('.model').forEach(m => m.remove());
                                };
                                
                                userDiv.querySelector('.edit-cancel').onclick = () => {
                                    userDiv.innerHTML = \`
                                        <button class="edit-btn">✎</button>
                                        <div class="user-content">\${contentDiv.textContent}</div>
                                    \`;
                                    addEditButtons();
                                };
                            };
                        });
                    }
                    
                    function addCopyButtons() {
                        document.querySelectorAll('pre').forEach(pre => {
                            if (pre.querySelector('.copy-btn')) return;

                            const button = document.createElement('button');
                            button.className = 'copy-btn';
                            button.textContent = 'Copy';
                            
                            button.addEventListener('click', (event) => {
                                // 通过事件目标找到最近的 pre 元素
                                const preElement = event.target.closest('pre');
                                // 获取 pre 元素下的第一个 code 元素内容
                                const code = preElement.querySelector('code').textContent;
                                
                                navigator.clipboard.writeText(code).then(() => {
                                    event.target.textContent = 'Copied!';
                                    setTimeout(() => {
                                        event.target.textContent = 'Copy';
                                    }, 2000);
                                });
                            });

                            pre.appendChild(button);
                        });
                    }
                    
                    // 初始化代码高亮
                    hljs.configure({ ignoreUnescapedHTML: true });

                    // 消息处理
                    window.addEventListener('message', (event) => {
                        const data = event.data;

                        // 处理 role 和 content 的消息
                        if (data.role && data.content) {
                            const { role, content } = data;
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
                                // 解析 Markdown
                                targetDiv.innerHTML = marked.parse(targetDiv.dataset.markdownContent, {
                                    breaks: true,
                                    mangle: false,
                                    headerIds: false,
                                    highlight: (code, lang) => {
                                        const validLang = hljs.getLanguage(lang) ? lang : 'plaintext';
                                        return hljs.highlight(code, { language: validLang }).value;
                                    }
                                });

                                // 渲染数学公式
                                renderMathInElement(targetDiv, {
                                    delimiters: [
                                        { left: '$$', right: '$$', display: true },
                                        { left: '$', right: '$', display: false },
                                        { left: '\\[', right: '\\]', display: true },
                                        { left: '\\(', right: '\\)', display: false }
                                    ],
                                    throwOnError: false
                                });

                                addCopyButtons();
                                // 重新高亮代码块
                                hljs.highlightAll();
                            } else {
                                // 用户消息保持纯文本并添加编辑功能
                                targetDiv.innerHTML = \`
                                            <button class="edit-btn">✎</button>
                                            <div class="user-content">\${targetDiv.dataset.markdownContent}</div>
                                        \`;
                                targetDiv.dataset.index = data.index;
                            }
                            addEditButtons();

                            chat.scrollTop = chat.scrollHeight;
                        }
                        
                        // 处理 command 类型的消息
                        if (data.command) {
                            const { command } = data;

                            switch (command) {
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
                                        const userIndex = parseInt(userDiv.dataset.index);
                                        if (userIndex >= clearIndex) {
                                            const modelDiv = userDiv.nextElementSibling;
                                            if (modelDiv && modelDiv.classList.contains('model')) {
                                                modelDiv.remove();
                                            }
                                            userDiv.remove();
                                        }
                                    });
                                    break;
                                default:
                                    // 处理其他 command 消息
                                    break;
                            }
                        }
                    });

                    // 发送消息逻辑
                    document.getElementById('send').addEventListener('click', () => {
                        vscode.postMessage({
                                command: 'sendMessage',
                                text: input.value
                            });
                        input.value = '';
                    });

                    document.getElementById('new-session').addEventListener('click', () => {
                        vscode.postMessage({ command: 'newSession' });
                        chat.innerHTML = '';
                        sendButton.disabled = false;
                        stopButton.style.display = 'none';
                    });

                    stopButton.addEventListener('click', () => {
                        vscode.postMessage({ command: 'stop' });
                    });

                    input.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                            vscode.postMessage({
                                command: 'sendMessage',
                                text: input.value
                            });
                            input.value = '';
                        }
                    });
                </script>
            </body>
            </html>
        `;
    }

    private async _handleMessage(message: any) {
        const webviewOutputChannel = new WebviewOutputChannel(this._panel.webview, 'DeepSeek API Output');
    
        switch (message.command) {
            case 'editMessage':
                if (message.index < this._conversation.length) {
                    this._conversation.splice(message.index + 1);
                    this._panel.webview.postMessage({ command: 'clearAfterIndex', index: message.index });
                    this._userMessageIndex = message.index;   
                }
                // break; 复用下面的send
            case 'sendMessage':
                this._conversation.push({ role: 'user', content: message.text });
                this._panel.webview.postMessage({ role: 'user', content: message.text, index: this._userMessageIndex });
                this._userMessageIndex++;
                
                try {
                    // 发送消息到 Webview，禁用发送按钮并显示停止按钮
                    this._panel.webview.postMessage({ command: 'disableSendButton' });
                    this._panel.webview.postMessage({ command: 'showStopButton' });

                    // 转换 _conversation 为 DeepSeek API 所需的消息格式
                    const conversationMessages: {role : string, content : string}[] = [];
                    for (let i = 0; i < this._conversation.length; i++) {
                        const message = this._conversation[i];
                        conversationMessages.push({role: message.role, 'content' : message.content}); // 仅取出内容
                    }
    
                    const response = await callDeepSeekApi(
                        conversationMessages,
                        'You are a helpful assistant. Always format answers with Markdown.',
                        webviewOutputChannel,
                        true,
                        undefined,
                        getCurrentOperationController().signal
                    );
    
                    // 发送消息到 Webview，启用发送按钮并隐藏停止按钮
                    this._panel.webview.postMessage({ command: 'enableSendButton' });
                    this._panel.webview.postMessage({ command: 'hideStopButton' });
    
                    this._conversation.push({ role: 'model', content: response || '' });
                } catch (error) {
                    // 发送消息到 Webview，启用发送按钮并隐藏停止按钮
                    this._panel.webview.postMessage({ command: 'enableSendButton' });
                    this._panel.webview.postMessage({ command: 'hideStopButton' });
    
                    this._panel.webview.postMessage({ 
                        role: 'model', 
                        content: `**Error**: ${error instanceof Error ? error.message : 'Unknown error'}`
                    });
                }
                break;
                
            case 'newSession':
                this._conversation = [];
                this._userMessageIndex = 0;
                resetCurrentOperationController();
                this._panel.webview.postMessage({ command: 'clearAfterIndex', index: -1 });
                break;
            case 'stop':
                resetCurrentOperationController();
                this._panel.webview.postMessage({ role: 'model', content: '\n\n**Operation stopped by user**' });
                break;
        }
    }

    public dispose() {
        ChatPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}