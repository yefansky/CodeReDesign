// src/ragService.ts
import { ChildProcess, execSync, spawn } from 'child_process';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as net from 'net';
import * as os from 'os';

// Define a variable to store the extension path
let EXTENSION_PATH: string = '';

const isDevMode = __dirname.includes('dist');
// 动态设置 Python 脚本或 EXE 路径
const getPythonScriptPath = (extensionPath: string) => {
  if (isDevMode) {
    return path.join(extensionPath, 'src', 'python', 'rag.py'); // 开发模式：直接运行 Python 脚本
  } else {
    return path.join(extensionPath, 'dist', 'rag.exe'); // 发布模式：运行 EXE
  }
};

// 配置常量 (use a function to resolve paths dynamically)
export const CONFIG = {
    STORAGE_PATH: path.join(os.homedir(), 'CodeReDesignMemory', 'rag_storage'),
    PORT: 7111,
    LOCK_FILE: 'rag.lock',
    PYTHON_SCRIPT: getPythonScriptPath(EXTENSION_PATH)
  };

// 类型定义
type ServerStatus = 'stopped' | 'starting' | 'running' | 'error';

interface ServerState {
  process?: ChildProcess;
  status: ServerStatus;
  lockFileHandle?: fs.FileHandle;
}

class RagService {
  private static instance: RagService;
  private state: ServerState = { status: 'stopped' };

  private constructor() {
    this.initializeStorage();
  }

  public static getInstance(): RagService {
    if (!RagService.instance) {
      RagService.instance = new RagService();
    }
    return RagService.instance;
  }

  private initializeStorage(): void {
    fs.mkdir(CONFIG.STORAGE_PATH, { recursive: true }).catch(err => {
      vscode.window.showErrorMessage(`创建存储目录失败: ${err}`);
    });
  }

  public async start(): Promise<void> {
    if (this.state.status !== 'stopped') { return; }

    try {
      //await this.acquireLock();
      await this.ensurePortAvailable();
      
      this.state.status = 'starting';
      this.state.process = this.startPythonProcess();

      this.setupProcessHandlers();
      await this.waitForStartup();

    } catch (err) {
      await this.cleanup(`启动失败: ${err}`);
    }
  }

  public async stop(): Promise<void> {
    if (this.state.process) {
      this.state.process.kill('SIGTERM');
    }
    await this.cleanup();
  }

  private async acquireLock(): Promise<void> {
    const lockPath = path.join(CONFIG.STORAGE_PATH, CONFIG.LOCK_FILE);
    
    try {
      const handle = await fs.open(lockPath, 'wx');
      await handle.write(process.pid.toString());
      this.state.lockFileHandle = handle;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error('已有服务进程在运行');
      }
      throw err;
    }
  }

  private async ensurePortAvailable(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.unref();

      server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          this.killProcessOnPort(CONFIG.PORT)
            .then(resolve)
            .catch(reject);
        } else {
          reject(err);
        }
      });

      server.listen(CONFIG.PORT, () => {
        server.close(() => resolve());
      });
    });
  }

  private killProcessOnPort(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const command = process.platform === 'win32' 
          ? `netstat -ano | findstr :${port} && FOR /F "tokens=5" %p IN ('netstat -ano ^| findstr :${port}') DO taskkill /F /PID %p`
          : `lsof -i :${port} -t | xargs kill -9`;
  
        // 修复类型错误
        execSync(command, { 
          shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
          encoding: 'utf-8' 
        });
        
        setTimeout(resolve, 2000);
      } catch (err) {
        reject(new Error(`无法释放端口 ${port}`));
      }
    });
  }

  private findWindowsPython(): string {
    try {
      // 获取所有Python路径并解析
      const output = execSync('where python', { 
        shell: 'cmd.exe',
        encoding: 'utf-8'
      });
  
      // 清洗并分割路径
      const paths = output
        .replace(/\r/g, '')  // 去除回车符
        .split('\n')
        .map(p => p.trim())
        .filter(p => p.length > 0);
  
      // 验证第一个有效路径
      if (paths.length === 0) {
        throw new Error('未找到Python路径');
      }
  
      // 优先选择带空格的路径用双引号包裹
      const validPath = paths.find(p => {
        try {
          fs.access(p, fs.constants.X_OK);
          return true;
        } catch {
          return false;
        }
      });
  
      return validPath 
        ? `"${validPath}"`  // 处理路径中的空格
        : paths[0];         // 最后兜底方案
  
    } catch (error) {
      // 回退方案
      vscode.window.showWarningMessage('Python自动检测失败，使用默认路径');
      return 'python.exe';
    }
  }
  
  private startPythonProcess(): ChildProcess {
    const scriptPath = CONFIG.PYTHON_SCRIPT;
    const isExe = scriptPath.endsWith('.exe');

    if (!fs.access(scriptPath)) {
      throw new Error(`未找到脚本或可执行文件: ${scriptPath}`);
    }
  
    if (isExe) {
      // 直接运行 EXE
      return spawn(scriptPath, [
        `--port=${CONFIG.PORT}`,
        `--storage_path=${CONFIG.STORAGE_PATH}`
      ], {
        env: { ...process.env, PORT: CONFIG.PORT.toString() },
        stdio: 'pipe',
        shell: true
      });
    } else {
      // 运行 Python 脚本
      const pythonPath = process.platform === 'win32' 
        ? this.findWindowsPython()
        : this.findUnixPython();
  
      return spawn(pythonPath, [
        scriptPath,
        `--port=${CONFIG.PORT}`,
        `--storage_path=${CONFIG.STORAGE_PATH}`
      ], {
        env: { ...process.env, PORT: CONFIG.PORT.toString() },
        stdio: 'pipe',
        shell: true
      });
    }
  }
  
  private findUnixPython(): string {
    try {
      // 精确获取python3路径
      return execSync('which python3', { 
        shell: '/bin/sh',
        encoding: 'utf-8'
      }).trim();
    } catch {
      return 'python3';
    }
  }

  private setupProcessHandlers(): void {
    const { process } = this.state;
    if (!process) {return;}

    process.stderr?.on('data', (data: Buffer) => {
      if (data.includes('Uvicorn running')) {
        this.state.status = 'running';
        vscode.window.showInformationMessage('RAG 服务已启动');
      }
    });

    process.stderr?.on('data', (data: Buffer) => {
      //this.state.status = 'error';
      console.error(`[Python Error] ${data}`);
    });

    process.on('exit', code => {
      if (code !== 0) {
        this.cleanup(`服务异常退出，代码: ${code}`);
      }
    });
  }

  private async waitForStartup(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('服务启动超时'));
      }, 15000);

      const checkInterval = setInterval(() => {
        if (this.state.status === 'running') {
          clearTimeout(timeout);
          clearInterval(checkInterval);
          resolve();
        }
      }, 500);
    });
  }

  private async cleanup(message?: string): Promise<void> {
    if (this.state.lockFileHandle) {
      await this.state.lockFileHandle.close();
      await fs.unlink(path.join(CONFIG.STORAGE_PATH, CONFIG.LOCK_FILE))
        .catch(() => {});
    }

    this.state = { status: 'stopped' };

    if (message) {
      vscode.window.showErrorMessage(message);
    }
  }
}

// 插件集成
export const ragService = RagService.getInstance();

export async function activate(context: vscode.ExtensionContext) {
  EXTENSION_PATH = context.extensionPath;
  await ragService.start();
  context.subscriptions.push({
    dispose: () => ragService.stop()
  });
}

export async function deactivate() {
  await ragService.stop();
}