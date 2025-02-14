import * as vscode from 'vscode';
import * as path from 'path';

export function activateGuide(context: vscode.ExtensionContext) {
  const guideViewProvider = new GuideViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('guideView', guideViewProvider)
  );
}

class GuideViewProvider implements vscode.WebviewViewProvider {
  constructor(private context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };
    webviewView.webview.html = this.getWebviewContent();

    webviewView.webview?.onDidReceiveMessage((message) => {
      switch (message.command) {
        case 'saveApiKey':
          this.saveApiKey(message.apiKey);
          break;
        case 'updateModelConfig':
          const config = vscode.workspace.getConfiguration('codeReDesign');
          config.update('modelConfig', message.selectedModel, vscode.ConfigurationTarget.Global).then(() => {
            webviewView.webview.html = this.getWebviewContent(); // 更新内容
          });
          break;
        default:
          vscode.commands.executeCommand(message.command);
          break;
      }
    });
  }

  private saveApiKey(apiKey: string) {
    const config = vscode.workspace.getConfiguration('codeReDesign');
    config.update('deepSeekApiKey', apiKey, vscode.ConfigurationTarget.Global)
      .then(() => {
        vscode.window.showInformationMessage('配置已更新');
      }, (err) => {
        vscode.window.showErrorMessage(`配置更新失败: ${err}`);
      });
  }
  private getWebviewContent(): string {
    const config = vscode.workspace.getConfiguration('codeReDesign');
    const apiKey = config.get('deepSeekApiKey') || '';
    const currentModelConfig = config.get('modelConfig') || 'deepseek-chat';
  
    // 获取所有以 'custom' 开头的模型配置
    const customConfigs = [];
    for (let i = 1; i <= 5; i++) {
      const baseURL = config.get(`custom${i}BaseURL`);
      const modelName = config.get(`custom${i}ModelName`);
      const modelNickname = config.get(`custom${i}ModelNickname`);
      const modelAPIKey = config.get(`custom${i}APIKey`);
      
      customConfigs.push({
        value: `custom${i}`,
        label: modelNickname || `自定义模型 ${i}`,
        baseURL: baseURL || '',
        modelName: modelName || '',
        modelNickname: modelNickname || `自定义模型 ${i}`,
        modelAPIKey : modelAPIKey || ''
      });
    }
  
    // 生成模型配置枚举
    const modelConfigEnum = [
      { value: 'deepseek-chat', label: 'deepseek-chat' },
      { value: 'deepseek-reasoner', label: 'deepseek-r1' },
      ...customConfigs.map(config => ({
        value: config.value,
        label: config.label
      }))
    ];
  
    // 如果没有找到自定义配置，给定默认值
    const selectedCustomConfig = customConfigs.find(config => config.value === currentModelConfig);
    const customBaseURL = selectedCustomConfig?.baseURL || '';
    const customModelName = selectedCustomConfig?.modelName || '';
    const customModelNickname = selectedCustomConfig?.modelNickname || '';
    const customAPIKey = selectedCustomConfig?.modelAPIKey || '';

    // 获取图片路径
    const imagePath = vscode.Uri.file(
      path.join(this.context.extensionPath, 'images/guide/rightClick.png')
    );
    const imageUri = imagePath.with({ scheme: 'vscode-resource' }).toString(); // 转换为 vscode-resource 协议 URL
  
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
        .section input, .section select {
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
        details {
          margin-top: 10px;
        }
        summary {
          font-weight: bold;
          cursor: pointer;
        }
      </style>
    </head>
    <body>
      <h1>欢迎使用 CodeReDesign 插件！</h1>
      <!--折叠的自定义模型设置部分-->
      <div class="section">
      <h2>开始使用前你需要先选择使用的模型和APIKey</h2>
        <details close>
          <summary>点击此处展开选择模型和设置APIKey</summary>
          <label for="apiKey">DeepSeek 官方 API Key：</label>
          <input type="text" id="apiKey" value="${apiKey}" placeholder="请输入您的 DeepSeek API 密钥" />
          <button id="saveApiKey">保存</button>
          <summary>自定义模型配置</summary>
          <label for="modelConfig">选择模型</label>
          <select id="modelConfig">
            ${modelConfigEnum.map(option => `
              <option value="${option.value}" ${option.value === currentModelConfig ? 'selected' : ''}>
                ${option.label}
              </option>
            `).join('')}
          </select>
          <div class="section" id="customConfigSection">
            <label for="customBaseURL">自定义模型 Base URL：</label>
            <input type="text" id="customBaseURL" value="${customBaseURL}" placeholder="请输入自定义模型的 Base URL" />
            <label for="customModelName">自定义模型名称：</label>
            <input type="text" id="customModelName" value="${customModelName}" placeholder="请输入自定义模型的名称" />
            <label for="customModelNickname">自定义模型昵称：</label>
            <input type="text" id="customModelNickname" value="${customModelNickname}" placeholder="请输入自定义模型的昵称" />
            <label for="customModelAPIKey">API Key：</label>
            <input type="text" id="customModelAPIKey" value="${customAPIKey}" placeholder="请输入自定义模型的 API Key" />
          </div>
        </details>
      </div>
  
      <!-- 常用指令部分 -->
      <div class="section">
        <h2>常用指令：</h2>
        <ul style="list-style-type: none; padding-left: 0;">
          <li>
            <p><strong>1. 需要先选择需要修改的文件列表，建立一个文件集合镜像（CVB），选完后回车，然后输入这个文件镜像集合的名字。</strong></p>
            <a href="#" id="generateCvb">CodeReDesign: Generate CVB File</a>
          </li>
          <li>
            <p><strong>2. 选择一个文件镜像集合到大模型，并提出修改需求。模型会在本地输出框输出处理过程，成功后也会在本地生成一个新的 CVB 文件。</strong></p>
            <a href="#" id="uploadCvb">CodeReDesign: Upload CVB and Call API</a>
          </li>
          <li>
            <p><strong>3. 选择一个本地的 CVB 文件，把里面的内容覆盖到当前目录中，也就是应用修改。</strong></p>
            <a href="#" id="applyCvb">CodeReDesign: Apply CVB to Workspace</a>
          </li>
          <li>
            <p><strong>4. 使用"分析代码功能"，例如让它解释代码，或描述一个 bug，让他分析可能原因，并提出修改方案。</strong></p>
            <a href="#" id="analyzeCode">CodeReDesign: Analyze Code</a>
          </li>
          <li>
            <p><strong>5. 中断正在进行的任务</strong></p>
            <a href="#" id="stopOperation">CodeReDesign: Stop Operation</a>
          </li>
        </ul>
      </div>

      <div class="section">
          <img src="${imageUri}" style="max-width: 100%; height: auto;">
      </div>
  
      <script>
        const vscode = acquireVsCodeApi();
  
        document.getElementById('saveApiKey').addEventListener('click', () => {
          const apiKey = document.getElementById('apiKey').value;
          vscode.postMessage({ command: 'saveApiKey', apiKey });
        });
  
        document.getElementById('modelConfig').addEventListener('change', (event) => {
          const selectedModel = event.target.value;
          const customConfigSection = document.getElementById('customConfigSection');
          customConfigSection.style.display = selectedModel.startsWith('custom') ? 'block' : 'none';
          vscode.postMessage({ command: 'updateModelConfig', selectedModel });
        });
  
        (function() {
          const selectedModel = document.getElementById('modelConfig').value;
          const customConfigSection = document.getElementById('customConfigSection');
          customConfigSection.style.display = selectedModel.startsWith('custom') ? 'block' : 'none';
        })();
  
        document.querySelectorAll('.section a').forEach(item => {
          item.addEventListener('click', (event) => {
            const command = event.target.id;
            vscode.postMessage({ command: \`codeReDesign.\${command}\` });
          });
        });
      </script>
    </body>
    </html>
    `;
  }  
}
