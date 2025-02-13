import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { applyCvbToWorkspace} from './cvbManager';
import { analyzeCode } from './deepseekApi';
import { getCurrentOperationController,  resetCurrentOperationController, clearCurrentOperationController, doUploadCommand} from './extension';
import { showInputMultiLineBox } from './UIComponents';

export function registerCvbContextMenu(context: vscode.ExtensionContext) {

  // 注册右键菜单命令
  const applyCvbCommand = vscode.commands.registerCommand('codeReDesign.applyThisCvb', (cvb: CvbFile) => {
    // 获取文件路径
    const filePath = cvb.resourceUri?.fsPath || "";
    // 调用处理函数
    applyThisCvb(filePath);
  });

  // 注册上传 CVB 命令
  const uploadCvbCommand = vscode.commands.registerCommand('codeReDesign.uploadThisCvb', async (cvb: CvbFile) => {
    const filePath = cvb.resourceUri?.fsPath || "";
    await uploadThisCvb(filePath);
  });

  // 注册分析 CVB 命令
  const analyzeCvbCommand = vscode.commands.registerCommand('codeReDesign.analyzeThisCvb', async (cvb: CvbFile) => {
    const filePath = cvb.resourceUri?.fsPath || "";
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
  vscode.commands.registerCommand('codeReDesign.showFile', (uri: vscode.Uri) => {
    vscode.window.showTextDocument(uri);
  });
}


class CvbViewProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  // 修改返回类型为更通用的TreeItem
  private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined> = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined> = this._onDidChangeTreeData.event;

  // 刷新视图
  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  // 获取树节点
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  // 获取子节点
  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (element) {
      return [];
    } else {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) { return [];}

      const files: vscode.TreeItem[] = [];
      const targetFolder = path.join(workspaceFolders[0].uri.fsPath, '.CodeReDesignWorkSpace');

      if (fs.existsSync(targetFolder)) {
        fs.readdirSync(targetFolder).forEach(file => {
          const filePath = path.join(targetFolder, file);
          const uri = vscode.Uri.file(filePath);
          
          if (file.endsWith('.cvb')) {
            files.push(new CvbFile(file, uri));
          } else if (file.endsWith('.md')) {
            files.push(new MDFile(file, uri));
          }
        });
      }

      // 修改后的排序逻辑
      files.sort((a, b) => {
        const labelA = a.label ? a.label.toString() : '';
        const labelB = b.label ? b.label.toString() : '';
        return labelA.localeCompare(labelB, undefined, { sensitivity: 'base' });
      });

      return files;
    }
  }
}

class CvbFile extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly uri: vscode.Uri
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.command = {
      command: 'codeReDesign.showFile',
      title: 'Open CVB File',
      arguments: [uri]
    };
    this.iconPath = new vscode.ThemeIcon('files'); // 使用代码图标
    this.resourceUri = uri;
    this.contextValue = 'cvbFile'; // 上下文值保持不变
  }
}

class MDFile extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly uri: vscode.Uri
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.command = {
      command: 'codeReDesign.showFile', // 复用同一个打开命令
      title: 'Open Markdown File',
      arguments: [uri]
    };
    this.iconPath = new vscode.ThemeIcon('comment-discussion'); // 使用文档图标
    this.resourceUri = uri;
    this.contextValue = 'mdFile'; // 新的上下文值
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
/*
  // 测试 begin
  {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      vscode.window.showErrorMessage('No workspace folder found.');
      return;
    }
    const workspacePath = workspaceFolders[0].uri.fsPath;
    const filepath = path.join(workspacePath, "/prompt/testdata2.txt");
    let tcvbContent = fs.readFileSync(filepath, 'utf-8');
    tcvbContent = tcvbContent.replace(/\r\n?/g, "\n");
    const tcvb = new TCVB(tcvbContent);
    let cvbContent = fs.readFileSync(filePath, 'utf-8');
    cvbContent = cvbContent.replace(/\r\n?/g, "\n");
    const oldCvb = new Cvb(cvbContent);
    const cvb = mergeCvb(oldCvb, tcvb);
    console.log(cvb.toString());
  }
  // 测试 end
*/
  const userPrompt = await showInputMultiLineBox({
    prompt: 'Enter your prompt for the refactoring',
    placeHolder: 'e.g., Refactor the code to improve readability',
  });

  if (!userPrompt) {
    return;
  }
  const outputChannel = vscode.window.createOutputChannel('CodeReDesign API Stream');
  doUploadCommand(filePath, userPrompt, outputChannel);
}

/**
 * 分析 CVB 文件
 * @param filePath .cvb 文件的路径
 */
async function analyzeThisCvb(filePath: string) {
  const userRequest = await showInputMultiLineBox({
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