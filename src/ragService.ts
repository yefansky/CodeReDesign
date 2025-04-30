import { ChildProcess, execSync, exec, spawn } from 'child_process';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as net from 'net';
import * as os from 'os';
import axios from 'axios';
import * as crypto from 'crypto';

// Define a variable to store the extension path
let EXTENSION_PATH: string = '';

const isDevMode = process.env.NODE_ENV === 'development';

// Dynamically set Python script or EXE path
const getPythonScriptPath = (extensionPath: string) => {
  if (isDevMode) {
    return path.join(extensionPath, 'src', 'python', 'rag.py'); // Development mode: run Python script directly
  } else {
    return path.join(extensionPath, 'dist', 'rag.exe'); // Production mode: run EXE
  }
};

// Configuration constants (use a function to resolve paths dynamically)
export const CONFIG = {
    STORAGE_PATH: path.join(os.homedir(), 'CodeReDesignMemory', 'rag_storage'),
    PORT: 7111,
    LOCK_FILE: 'rag.lock'
};

// Type definitions
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
      vscode.window.showErrorMessage(`Failed to create storage directory: ${err}`);
    });
  }

  public async start(): Promise<void> {
    if (this.state.status !== 'stopped') { return; }

    try {
      if (!isDevMode) {
        const exePath = getPythonScriptPath(EXTENSION_PATH);
        const distPath = path.dirname(exePath);
        await fs.mkdir(distPath, { recursive: true });

        let shouldDownload = false;
        let remoteMd5 = '';

        // Check if rag.exe exists
        try {
          // Download MD5 from GitHub
          remoteMd5 = await this.downloadText('https://github.com/yefansky/CodeReDesign/releases/download/latest/md5.txt');

          await fs.access(exePath, fs.constants.F_OK);
          
          // Calculate local rag.exe MD5
          const localMd5 = await this.calculateFileMd5(exePath);
          
          // Compare MD5s
          if (remoteMd5.trim().toLowerCase() !== localMd5.toLowerCase()) {
            shouldDownload = true;
            vscode.window.showInformationMessage('rag.exe MD5 mismatch, downloading new version...');
          }
        } catch (err) {
          // rag.exe doesn't exist
          shouldDownload = true;
          vscode.window.showInformationMessage('rag.exe not found, downloading...');
        }

        if (shouldDownload) {
          // Kill any running rag.exe process
          await this.killRagExeProcess();
          
          // Download new rag.exe
          await this.downloadFile(
            'https://github.com/yefansky/CodeReDesign/releases/download/latest/rag.exe',
            exePath
          );
          
          // Verify downloaded file's MD5
          const newMd5 = await this.calculateFileMd5(exePath);
          if (newMd5.toLowerCase() !== remoteMd5.trim().toLowerCase()) {
            throw new Error('Downloaded rag.exe MD5 verification failed');
          }
        }
      }

      //await this.acquireLock();
      await this.ensurePortAvailable();
      
      this.state.status = 'starting';
      this.state.process = this.startPythonProcess();

      this.setupProcessHandlers();
      await this.waitForStartup();

    } catch (err) {
      await this.cleanup(`Startup failed: ${err}`);
    }
  }

  private async downloadText(url: string): Promise<string> {
    try {
      const response = await axios.get(url, {
        responseType: 'text',
        maxRedirects: 5 // Default, can increase if needed
      });
      console.log(`Downloaded ${url}, status: ${response.status}, redirects: ${response.request._redirectable._redirectCount}`);
      if (response.status !== 200) {
        throw new Error(`Failed to download text from ${url}: Status ${response.status}`);
      }
      return response.data.trim();
    } catch (err ) {
      throw new Error(`Failed to download text from ${url}: ${(err as Error).message}`);
    }
  }
  
  private async downloadFile(url: string, dest: string): Promise<void> {
    try {
      const response = await axios.get(url, {
        responseType: 'stream',
        maxRedirects: 5 // Default, can increase if needed
      });
      console.log(`Downloaded ${url}, status: ${response.status}, redirects: ${response.request._redirectable._redirectCount}`);
      if (response.status !== 200) {
        throw new Error(`Failed to download file from ${url}: Status ${response.status}`);
      }
      const writer = require('fs').createWriteStream(dest);
      response.data.pipe(writer);
      return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', (err: Error) => {
          require('fs').unlink(dest, () => {}); // Clean up partial download
          reject(new Error(`Failed to write file to ${dest}: ${err.message}`));
        });
      });
    } catch (err) {
      require('fs').unlink(dest, () => {}); // Clean up partial download
      throw new Error(`Failed to download file from ${url}: ${(err as Error).message}`);
    }
  }

  private async calculateFileMd5(filePath: string): Promise<string> {
    const fileBuffer = await fs.readFile(filePath);
    return crypto.createHash('md5').update(fileBuffer).digest('hex');
  }

  private async killRagExeProcess(): Promise<void> {
    if (process.platform !== 'win32') {
      return; // Only implemented for Windows as rag.exe is Windows-specific
    }

    return new Promise((resolve, reject) => {
      try {
        const command = `tasklist | findstr "rag.exe"`;
        exec(command, { shell: 'cmd.exe', encoding: 'utf8' }, (error, stdout) => {
          if (error && !stdout) {
            console.log('No rag.exe process found');
            return resolve();
          }

          const pids = stdout
            .trim()
            .split('\n')
            .map(line => {
              const parts = line.trim().split(/\s+/);
              return parts[1]; // PID is in the second column
            })
            .filter(pid => pid && /^\d+$/.test(pid));

          if (pids.length === 0) {
            console.log('No valid rag.exe PIDs found');
            return resolve();
          }

          console.log(`Terminating rag.exe PIDs: ${pids.join(', ')}`);
          const killCommand = `taskkill /F /PID ${pids.join(' ')}`;
          exec(killCommand, { shell: 'cmd.exe' }, (killError) => {
            if (killError) {
              console.error(`Failed to terminate rag.exe processes: ${killError.message}`);
              return reject(new Error(`Failed to terminate rag.exe processes: ${killError.message}`));
            }
            resolve();
          });
        });
      } catch (err) {
        console.error(`Error killing rag.exe process: ${(err as Error).message}`);
        reject(new Error(`Failed to kill rag.exe process: ${(err as Error).message}`));
      }
    });
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
        throw new Error('Another service process is already running');
      }
      throw err;
    }
  }

  private async checkPortInUse(port: number): Promise<boolean> {
    return new Promise((resolve, reject) => {
        try {
            let command: string;
            let shell: string;

            if (process.platform === 'win32') {
                // 使用 netstat 检查端口，查找 LISTENING 状态
                command = `netstat -aon | findstr /R "^.*:${port}\\s.*LISTENING.*$"`;
                shell = 'cmd.exe';
            } else {
                command = `lsof -i :${port} -t`;
                shell = '/bin/sh';
            }

            exec(command, { shell, encoding: 'utf8' }, (error, stdout) => {
                if (error && !stdout) {
                    console.log(`Port ${port} is not in use (command check)`);
                    resolve(false);
                } else if (stdout.trim()) {
                    console.log(`Port ${port} is in use (command check): ${stdout.trim()}`);
                    resolve(true);
                } else {
                    resolve(false);
                }
            });
        } catch (err) {
            console.error(`Failed to check port ${port}: ${(err as Error).message}`);
            reject(new Error(`Failed to check port ${port}: ${(err as Error).message}`));
        }
    });
  }

  private async ensurePortAvailable(): Promise<void> {
    console.log(`Checking if port ${CONFIG.PORT} is available...`);

    // 主动检查端口是否被占用
    const isPortInUse = await this.checkPortInUse(CONFIG.PORT);
    if (isPortInUse) {
        console.log(`Port ${CONFIG.PORT} is in use, attempting to free it...`);
        await this.killProcessOnPort(CONFIG.PORT);
    }

    // 使用 net.createServer 进行二次验证
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();

        server.on('error', (err: NodeJS.ErrnoException) => {
            console.log(`net.createServer error: ${err.message}`);
            if (err.code === 'EADDRINUSE') {
                console.log(`Port ${CONFIG.PORT} is still in use, attempting to free it again...`);
                this.killProcessOnPort(CONFIG.PORT)
                    .then(resolve)
                    .catch(reject);
            } else {
                reject(new Error(`Failed to check port ${CONFIG.PORT}: ${err.message}`));
            }
        });

        server.listen(CONFIG.PORT, '0.0.0.0', () => {
            console.log(`Port ${CONFIG.PORT} is available via net.createServer`);
            server.close(() => resolve());
        });
    });
  }

  private killProcessOnPort(port: number): Promise<void> {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`Invalid port number: ${port}`);
    }

    return new Promise((resolve, reject) => {
        try {
            let command: string;
            let shell: string;

            if (process.platform === 'win32') {
                command = `netstat -aon | findstr /R "TCP.*:${port}.*LISTENING"`;
                shell = 'cmd.exe';
            } else {
                command = `lsof -i :${port} -t`;
                shell = '/bin/sh';
            }

            exec(command, { shell, encoding: 'utf8' }, (error, stdout) => {
                if (error && !stdout) {
                    console.log(`No process found on port ${port}`);
                    return resolve();
                }

                const pids = stdout
                    .trim()
                    .split('\n')
                    .map(line => {
                        const parts = line.trim().split(/\s+/);
                        return parts[parts.length - 1]; // PID 在最后一列
                    })
                    .filter(pid => pid && /^\d+$/.test(pid)); // 确保是数字

                if (pids.length === 0) {
                    console.log(`No valid PIDs found on port ${port}`);
                    return resolve();
                }

                console.log(`Terminating PIDs on port ${port}: ${pids.join(', ')}`);
                const killCommand = process.platform === 'win32'
                    ? `taskkill /F /PID ${pids.join(' ')}`
                    : `kill -TERM ${pids.join(' ')}`;

                exec(killCommand, { shell }, (killError) => {
                    if (killError) {
                        console.error(`Failed to terminate processes: ${killError.message}`);
                        return reject(new Error(`Failed to terminate processes on port ${port}: ${killError.message}`));
                    }

                    // 重试检查端口是否释放
                    let retries = 3;
                    const checkPort = () => {
                        exec(command, { shell, encoding: 'utf8' }, (checkError, checkStdout) => {
                            if (checkStdout.trim()) {
                                console.log(`Port ${port} still in use, retries left: ${retries}`);
                                if (--retries > 0) {
                                    setTimeout(checkPort, 1000);
                                } else {
                                    reject(new Error(`Port ${port} still in use after termination`));
                                }
                            } else {
                                console.log(`Port ${port} successfully released`);
                                resolve();
                            }
                        });
                    };
                    setTimeout(checkPort, 1000);
                });
            });
        } catch (err) {
            console.error(`Error freeing port ${port}: ${(err as Error).message}`);
            reject(new Error(`Failed to free port ${port}: ${(err as Error).message}`));
        }
    });
  }

  private findWindowsPython(): string {
    try {
      // Get all Python paths and parse
      const output = execSync('where python', { 
        shell: 'cmd.exe',
        encoding: 'utf-8'
      });
  
      // Clean and split paths
      const paths = output
        .replace(/\r/g, '')  // Remove carriage returns
        .split('\n')
        .map(p => p.trim())
        .filter(p => p.length > 0);
  
      // Verify the first valid path
      if (paths.length === 0) {
        throw new Error('No Python path found');
      }
  
      // Prefer paths with spaces wrapped in quotes
      const validPath = paths.find(p => {
        try {
          fs.access(p, fs.constants.X_OK);
          return true;
        } catch {
          return false;
        }
      });
  
      return validPath 
        ? `"${validPath}"`  // Handle spaces in path
        : paths[0];         // Fallback
  
    } catch (error) {
      // Fallback scheme
      vscode.window.showWarningMessage('Python detection failed, using default path');
      return 'python.exe';
    }
  }
  
  private startPythonProcess(): ChildProcess {
    const scriptPath = getPythonScriptPath(EXTENSION_PATH);
    const isExe = scriptPath.endsWith('.exe');

    try {
      fs.access(scriptPath, fs.constants.X_OK);
    } catch (err) {
      throw new Error(`Script or executable not found or not executable: ${scriptPath}`);
    }
  
    if (isExe) {
      // Run EXE directly
      return spawn(scriptPath, [
        `--port=${CONFIG.PORT}`,
        `--storage_path=${CONFIG.STORAGE_PATH}`
      ], {
        env: { ...process.env, PORT: CONFIG.PORT.toString() },
        stdio: 'pipe',
        shell: true
      });
    } else {
      // Run Python script
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
      // Precisely get python3 path
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
        vscode.window.showInformationMessage('RAG service started');
      }
    });

    process.stderr?.on('data', (data: Buffer) => {
      console.error(`[Python Error] ${data}`);
    });

    process.on('exit', code => {
      if (code !== 0) {
        this.cleanup(`Service exited abnormally with code: ${code}`);
      }
    });
  }

  private async waitForStartup(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Service startup timed out'));
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

// Plugin integration
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