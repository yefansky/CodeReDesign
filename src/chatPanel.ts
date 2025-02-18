import * as vscode from 'vscode';
import { callDeepSeekApi } from './deepseekApi';

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
                        background-color: #a3a3a3;
                        color: black;
                        padding: 12px;
                        margin: 8px 0;
                        border-radius: 4px;
                        white-space: pre-wrap;
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
                    <button id="reset">Reset</button>
                </div>
                <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
                <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.7.0/highlight.min.js"></script>
                <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
                <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"></script>
                <script>
                    const vscode = acquireVsCodeApi();
                    const chat = document.getElementById('chat');
                    const input = document.getElementById('input');
                    
                    // 初始化代码高亮
                    hljs.configure({ ignoreUnescapedHTML: true });

                    // 消息处理
                    window.addEventListener('message', (event) => {
                        const { role, content } = event.data;
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
                            // 解析Markdown
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

                            // 重新高亮代码块
                            hljs.highlightAll();
                        } else {
                            // 用户消息保持纯文本
                            targetDiv.textContent = targetDiv.dataset.markdownContent;
                        }

                        chat.scrollTop = chat.scrollHeight;
                    });

                    // 发送消息逻辑
                    document.getElementById('send').addEventListener('click', () => {
                        vscode.postMessage({ command: 'sendMessage', text: input.value });
                        input.value = '';
                    });

                    document.getElementById('reset').addEventListener('click', () => {
                        vscode.postMessage({ command: 'reset' });
                    });

                    input.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                            vscode.postMessage({ command: 'sendMessage', text: input.value });
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
            case 'sendMessage':
                this._conversation.push({ role: 'user', content: message.text });
                this._panel.webview.postMessage({ role: 'user', content: message.text });
                
                try {
                    const response = await callDeepSeekApi(
                        message.text,
                        'You are a helpful assistant. Always format answers with Markdown.',
                        webviewOutputChannel,
                        true
                    );
                    
                    this._conversation.push({ role: 'model', content: response || '' });
                } catch (error) {
                    this._panel.webview.postMessage({ 
                        role: 'model', 
                        content: `**Error**: ${error instanceof Error ? error.message : 'Unknown error'}`
                    });
                }
                break;
                
            case 'reset':
                this._conversation = [];
                this._panel.webview.postMessage({ command: 'clearHistory' });
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