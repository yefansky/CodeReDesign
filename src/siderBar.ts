import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { applyCvbToWorkspace } from './cvbManager';
import { queryCodeReDesign, analyzeCode } from './deepseekApi';
import { getCurrentOperationController,  resetCurrentOperationController, clearCurrentOperationController} from './extension';

export function registerCvbContextMenu(context: vscode.ExtensionContext) {

  // 注册右键菜单命令
  const applyCvbCommand = vscode.commands.registerCommand('codeReDesign.applyThisCvb', (uri: vscode.Uri) => {
    // 获取文件路径
    const filePath = uri.fsPath;

    // 调用处理函数
    applyThisCvb(filePath);
  });

  // 注册上传 CVB 命令
  const uploadCvbCommand = vscode.commands.registerCommand('codeReDesign.uploadThisCvb', async (uri: vscode.Uri) => {
    const filePath = uri.fsPath;
    await uploadThisCvb(filePath);
  });

  // 注册分析 CVB 命令
  const analyzeCvbCommand = vscode.commands.registerCommand('codeReDesign.analyzeThisCvb', async (uri: vscode.Uri) => {
    const filePath = uri.fsPath;
    await analyzeThisCvb(filePath);
  });

  // 将命令添加到订阅中
  context.subscriptions.push(applyCvbCommand, uploadCvbCommand, analyzeCvbCommand);

  // 注册 TreeDataProvider
  const cvbViewProvider = new CvbViewProvider();
  vscode.window.registerTreeDataProvider('codeReDesign.cvbView', cvbViewProvider);

  // 刷新视图的命令
  vscode.commands.registerCommand('codeReDesign.refreshCvbView', () => {
    cvbViewProvider.refresh();
  });

  // 监听文件变化
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders) {
    const targetFolder = path.join(workspaceFolders[0].uri.fsPath, '.CodeReDesignWorkSpace'); // 替换为你的子文件夹名称

    // 创建文件系统监听器
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(targetFolder, '**/*.cvb') // 监听子文件夹中的所有 .cvb 文件
    );

    // 当文件变化时刷新视图
    watcher.onDidCreate(() => cvbViewProvider.refresh());
    watcher.onDidDelete(() => cvbViewProvider.refresh());
    watcher.onDidChange(() => cvbViewProvider.refresh());

    // 将监听器添加到订阅中，确保扩展销毁时清理资源
    context.subscriptions.push(watcher);
  }

  // 注册右键菜单命令
  vscode.commands.registerCommand('codeReDesign.openCvbFile', (uri: vscode.Uri) => {
    vscode.window.showTextDocument(uri);
  });
}

class CvbViewProvider implements vscode.TreeDataProvider<CvbFile> {
  private _onDidChangeTreeData: vscode.EventEmitter<CvbFile | undefined> = new vscode.EventEmitter<CvbFile | undefined>();
  readonly onDidChangeTreeData: vscode.Event<CvbFile | undefined> = this._onDidChangeTreeData.event;

  // 刷新视图
  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  // 获取树节点
  getTreeItem(element: CvbFile): vscode.TreeItem {
    return element;
  }

  // 获取子节点
  async getChildren(element?: CvbFile): Promise<CvbFile[]> {
    if (element) {
      // 如果有子节点，可以在这里处理
      return [];
    } else {
      // 从指定子文件夹中读取 .cvb 文件
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        return [];
      }

      const cvbFiles: CvbFile[] = [];
      const targetFolder = path.join(workspaceFolders[0].uri.fsPath, '.CodeReDesignWorkSpace'); // 替换为你的子文件夹名称

      // 读取文件夹中的文件
      if (fs.existsSync(targetFolder)) {
        const files = fs.readdirSync(targetFolder);
        files.forEach(file => {
          if (file.endsWith('.cvb')) {
            const filePath = path.join(targetFolder, file);
            cvbFiles.push(new CvbFile(file, vscode.Uri.file(filePath)));
          }
        });
      }

      return cvbFiles;
    }
  }
}

class CvbFile extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly uri: vscode.Uri
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);

    // 设置命令，单击时打开文件
    this.command = {
      command: 'codeReDesign.openCvbFile',
      title: 'Open CVB File',
      arguments: [uri]
    };

    // 设置图标（可选）
    this.iconPath = vscode.ThemeIcon.File;

    // 添加上下文菜单
    this.contextValue = 'cvbFile';
  }
}

/**
 * 处理 .cvb 文件的函数
 * @param filePath .cvb 文件的路径
 */
function applyThisCvb(filePath: string) {
  // 在这里实现你的逻辑
  vscode.window.showInformationMessage(`Applying CVB from: ${filePath}`);
  // 例如：读取文件内容并处理
  const cvbContent = fs.readFileSync(filePath, 'utf-8');
  // 调用你的处理逻辑

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders) {
    applyCvbToWorkspace(cvbContent);
  }
}

/**
 * 上传 CVB 文件并调用 API
 * @param filePath .cvb 文件的路径
 */
async function uploadThisCvb(filePath: string) {
  const userPrompt = await vscode.window.showInputBox({
    prompt: 'Enter your prompt for the refactoring',
    placeHolder: 'e.g., Refactor the code to improve readability',
  });

  if (!userPrompt) {
    return;
  }

  const cvbContent = fs.readFileSync(filePath, 'utf-8');
  const outputChannel = vscode.window.createOutputChannel('CodeReDesign API Stream');

  resetCurrentOperationController();

  const apiResponse = await queryCodeReDesign(cvbContent, userPrompt, outputChannel, getCurrentOperationController().signal);
  if (apiResponse) {
    vscode.window.showInformationMessage('API response received. Check the output channel for details.');
  }
  clearCurrentOperationController();
}

/**
 * 分析 CVB 文件
 * @param filePath .cvb 文件的路径
 */
async function analyzeThisCvb(filePath: string) {
  const userRequest = await vscode.window.showInputBox({
    prompt: 'Enter your analysis request',
    placeHolder: 'e.g., Analyze the code for potential bugs',
  });

  if (!userRequest) {
    return;
  }

  const cvbContent = fs.readFileSync(filePath, 'utf-8');
  const outputChannel = vscode.window.createOutputChannel('CodeReDesign API Stream');

  resetCurrentOperationController();

  const analysisResult = await analyzeCode(cvbContent, userRequest, outputChannel, getCurrentOperationController().signal);
  if (analysisResult) {
    vscode.window.showInformationMessage('Analysis completed. Check the output channel for details.');
  }
  clearCurrentOperationController();
}

export function deactivate() {}