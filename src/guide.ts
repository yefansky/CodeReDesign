import * as vscode from 'vscode';

export function activateGuide(context: vscode.ExtensionContext) {
  const guideViewProvider = new GuideViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('guideView', guideViewProvider)
  );

  guideViewProvider.webview?.onDidReceiveMessage((message) => {
    switch (message.command) {
      case 'saveApiKey':
        // 保存 API 密钥
        context.globalState.update('deepSeekApiKey', message.apiKey);
        break;
      case 'openCommand':
        // 打开指令
        vscode.commands.executeCommand(message.command);
        break;
    }
  });
}

class GuideViewProvider implements vscode.WebviewViewProvider {
  constructor(private context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };
    webviewView.webview.html = this.getWebviewContent();
  }

  private getWebviewContent(): string {
    // 获取 DeepSeek API 密钥
    const apiKey = this.context.globalState.get('deepSeekApiKey') || '';
  
    return `
      <!DOCTYPE html>
      <html lang="zh-CN">
      <head>
        <meta charset="UTF-8">
        <title>引导页</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            margin: 20px;
          }
          h1 {
            color: #333;
          }
          .section {
            margin-bottom: 20px;
          }
          .section label {
            display: block;
            margin-bottom: 5px;
          }
          .section input {
            width: 100%;
            padding: 8px;
            margin-bottom: 10px;
            border: 1px solid #ccc;
            border-radius: 4px;
          }
          .section button {
            padding: 8px 16px;
            border: none;
            background-color: #4CAF50;
            color: white;
            border-radius: 4px;
            cursor: pointer;
          }
          .section button:hover {
            background-color: #45a049;
          }
          .section a {
            color: #007BFF;
            text-decoration: none;
          }
          .section a:hover {
            text-decoration: underline;
          }
        </style>
      </head>
      <body>
        <h1>欢迎使用 CodeReDesign 插件！</h1>
        <div class="section">
          <label for="apiKey">DeepSeek API 密钥：</label>
          <input type="text" id="apiKey" value="${apiKey}" placeholder="请输入您的 DeepSeek API 密钥" />
          <button id="saveApiKey">保存</button>
        </div>
        <div class="section">
          <h2>常用指令：</h2>
          <ul>
            <li><a href="#" id="generateCvb">生成 CVB 文件</a></li>
            <li><a href="#" id="uploadCvb">上传 CVB 文件</a></li>
            <li><a href="#" id="applyCvb">应用 CVB 文件</a></li>
            <li><a href="#" id="analyzeCode">分析代码</a></li>
          </ul>
        </div>
        <script>
          const vscode = acquireVsCodeApi();
  
          // 保存 API 密钥
          document.getElementById('saveApiKey').addEventListener('click', () => {
            const apiKey = document.getElementById('apiKey').value;
            vscode.postMessage({ command: 'saveApiKey', apiKey });
          });
  
          // 跳转到指令
          document.getElementById('generateCvb').addEventListener('click', () => {
            vscode.postMessage({ command: 'openCommand', command: 'codeReDesign.generateCvb' });
          });
          document.getElementById('uploadCvb').addEventListener('click', () => {
            vscode.postMessage({ command: 'openCommand', command: 'codeReDesign.uploadCvb' });
          });
          document.getElementById('applyCvb').addEventListener('click', () => {
            vscode.postMessage({ command: 'openCommand', command: 'codeReDesign.applyCvb' });
          });
          document.getElementById('analyzeCode').addEventListener('click', () => {
            vscode.postMessage({ command: 'openCommand', command: 'codeReDesign.analyzeCode' });
          });
        </script>
      </body>
      </html>
    `;
  }
  
}