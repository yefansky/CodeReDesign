import * as vscode from 'vscode';
import { callDeepSeekApi } from './deepseekApi';

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
                </style>
            </head>
            <body>
                <div id="chat"></div>
                <textarea id="input" placeholder="Type your message here..." style="width: 100%; height: 100px;"></textarea>
                <button id="send">Send</button>
                <button id="reset">Reset</button>
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
                        const div = document.createElement('div');
                        div.className = role;
                        div.textContent = content;
                        chat.appendChild(div);
                    });
                </script>
            </body>
            </html>
        `;
    }

    private async _handleMessage(message: any) {
        switch (message.command) {
            case 'sendMessage':
                this._conversation.push({ role: 'user', content: message.text });
                this._panel.webview.postMessage({ role: 'user', content: message.text });
                const response = await callDeepSeekApi(message.text, 'You are a helpful assistant.');
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