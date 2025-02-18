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
                <title>Chat with Model</title>
                <style>
                    .user { color: blue; }
                    .model { color: green; }
                    #chat {
                        height: calc(100vh - 150px);
                        overflow-y: auto;
                    }
                    #input-container {
                        position: fixed;
                        bottom: 0;
                        width: 100%;
                        background-color: white;
                        padding: 10px;
                    }
                    #chat div {
                        white-space: pre-wrap; /* 关键代码：保留换行符 */
                        margin-bottom: 8px;    /* 段落间距（可选） */
                    }
                </style>
            </head>
            <body>
                <div id="chat"></div>
                <div id="input-container">
                    <textarea id="input" placeholder="Type your message here..." style="width: 100%; height: 100px;"></textarea>
                    <button id="send">Send</button>
                    <button id="reset">Reset</button>
                </div>
                <script>
                    const vscode = acquireVsCodeApi();
                    const chat = document.getElementById('chat');
                    const input = document.getElementById('input');
                    const send = document.getElementById('send');
                    const reset = document.getElementById('reset');

                    input.addEventListener('keydown', (event) => {
                        if (event.key === 'Enter' && event.ctrlKey) {
                            vscode.postMessage({
                                command: 'sendMessage',
                                text: input.value
                            });
                            input.value = '';
                        }
                    });

                    send.addEventListener('click', () => {
                        vscode.postMessage({
                            command: 'sendMessage',
                            text: input.value
                        });
                        input.value = '';
                    });

                    reset.addEventListener('click', () => {
                        vscode.postMessage({
                            command: 'reset'
                        });
                    });

                    window.addEventListener('message', (event) => {
                        const { role, content } = event.data;
                        const chat = document.getElementById('chat');
                        const lastChild = chat.lastElementChild;

                        // 合并到同一角色元素
                        if (lastChild && lastChild.className === role) {
                            lastChild.textContent += content;
                        } else {
                            const div = document.createElement('div');
                            div.className = role;
                            div.textContent = content;
                            chat.appendChild(div);
                        }

                        // 自动滚动到底部
                        chat.scrollTop = chat.scrollHeight;
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
                const response = await callDeepSeekApi(message.text, 'You are a helpful assistant.', webviewOutputChannel, true);
                this._conversation.push({ role: 'model', content: response || '' });
                this._panel.webview.postMessage({ role: 'model', content: response || '' });
                break;
            case 'reset':
                this._conversation = [];
                this._panel.webview.html = this._getHtmlForWebview();
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