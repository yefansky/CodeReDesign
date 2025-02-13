import * as vscode from 'vscode';

interface InputMultiLineBoxOptions {
    prompt: string;
    placeHolder?: string;
    title?: string;
}

let currentPanel: vscode.WebviewPanel | undefined = undefined; // 当前打开的 Webview 面板

export async function showInputMultiLineBox(options: InputMultiLineBoxOptions): Promise<string | undefined> {
    return new Promise((resolve) => {
        // 如果已有面板，先关闭
        if (currentPanel) {
            currentPanel.dispose();
        }

        // 创建新的 Webview 面板
        currentPanel = vscode.window.createWebviewPanel(
            'multiLineInput',
            options.title || 'Multi-line Input',
            vscode.ViewColumn.One,
            { enableScripts: true, localResourceRoots: [] } // 允许 JavaScript
        );

        // 设置 Webview 内容
        currentPanel.webview.html = getWebviewContent(options.prompt, options.placeHolder || "");

        // 监听 Webview 消息
        currentPanel.webview.onDidReceiveMessage(
            (message) => {
                if (message.command === 'submit') {
                    resolve(message.text); // 返回用户输入的文本
                    if (currentPanel) {
                        currentPanel.dispose(); // 关闭 Webview
                        currentPanel = undefined; // 清空当前面板引用
                    }
                }
            },
            undefined
        );

        // 监听 Webview 关闭，避免无限等待
        currentPanel.onDidDispose(() => {
            currentPanel = undefined; // 清空面板引用
            resolve(undefined);
        });
    });
}

// Webview HTML 内容，使用 Monaco Editor
function getWebviewContent(prompt: string, placeHolder: string): string {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body {
                font-family: "Consolas", "Courier New", monospace;
                padding: 10px;
                background-color: #1e1e1e;
                color: white;
                height: 100%;
            }
            textarea {
                width: 100%;
                height: 50vh; /* 使输入框高度为视口的一半 */
                background-color: #252526;
                color: white;
                border: 1px solid #444;
                padding: 10px;
                font-size: 14px;
                border-radius: 4px;
            }
            button {
                margin-top: 10px;
                background-color: #007acc;
                color: white;
                border: none;
                padding: 10px;
                font-size: 14px;
                cursor: pointer;
                border-radius: 4px;
            }
            button:hover {
                background-color: #005a8c;
            }
        </style>
    </head>
    <body>
        <h3>${prompt}</h3>
        <textarea placeholder="${placeHolder}" id="inputField"></textarea>
        <button id="submitButton">Submit</button>
        <script>
            const vscode = acquireVsCodeApi();
            document.getElementById('submitButton').addEventListener('click', () => {
                const inputText = document.getElementById('inputField').value;
                vscode.postMessage({
                    command: 'submit',
                    text: inputText
                });
            });
        </script>
    </body>
    </html>
    `;
}
