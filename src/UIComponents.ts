import * as vscode from 'vscode';

interface InputMultiLineBoxOptions {
    prompt: string;
    placeHolder?: string;
    title?: string;
}

let currentPanel: vscode.WebviewPanel | undefined = undefined; // ��ǰ�򿪵� Webview ���

export async function showInputMultiLineBox(options: InputMultiLineBoxOptions): Promise<string | undefined> {
    return new Promise((resolve) => {
        // ���������壬�ȹر�
        if (currentPanel) {
            currentPanel.dispose();
        }

        // �����µ� Webview ���
        currentPanel = vscode.window.createWebviewPanel(
            'multiLineInput',
            options.title || 'Multi-line Input',
            vscode.ViewColumn.One,
            { enableScripts: true, localResourceRoots: [] } // ���� JavaScript
        );

        // ���� Webview ����
        currentPanel.webview.html = getWebviewContent(options.prompt, options.placeHolder || "");

        // ���� Webview ��Ϣ
        currentPanel.webview.onDidReceiveMessage(
            (message) => {
                if (message.command === 'submit') {
                    resolve(message.text); // �����û�������ı�
                    if (currentPanel) {
                        currentPanel.dispose(); // �ر� Webview
                        currentPanel = undefined; // ��յ�ǰ�������
                    }
                }
            },
            undefined
        );

        // ���� Webview �رգ��������޵ȴ�
        currentPanel.onDidDispose(() => {
            currentPanel = undefined; // ����������
            resolve(undefined);
        });
    });
}

// Webview HTML ���ݣ�ʹ�� Monaco Editor
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
                height: 50vh; /* ʹ�����߶�Ϊ�ӿڵ�һ�� */
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
