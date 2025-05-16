import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// 语言映射表
export const g_objLanguageMapping: { [key: string]: string } = {
  'cpp': 'c++',
  'hpp': 'c++',
  'cxx': 'c++',
  'c': 'c',
  'h': 'c++',
  'lua': 'lua',
  'ls': 'lua',
  'lh': 'lua',
  'py': 'python',
  'ts': 'typescript',
  'js': 'javascript',
  'cs': 'c#',            // C#
  'java': 'java',        // Java
  'go': 'go',            // Go
  'rb': 'ruby',          // Ruby
  'swift': 'swift',      // Swift
  'kt': 'kotlin',        // Kotlin
  'php': 'php',          // PHP
  'rust': 'rust',        // Rust
  'dart': 'dart',        // Dart
  'md': 'markdown',       // markdown
  'json':'json',
  'txt': 'text'
};

/**
 * 根据文件路径猜测编程语言
 * @param filePath 文件路径
 * @returns 语言名称字符串，未匹配时返回 'text'
 */
export function getLanguageFromPath(filePath: string): string {
  const strExt = filePath.split('.').pop()?.toLowerCase() || '';
  return g_objLanguageMapping[strExt] || 'text';
}

export const SOURCE_FILE_EXTENSIONS_WITH_DOT = Object.keys(g_objLanguageMapping)
  .map(ext => `.${ext}`);

  /**
 * Recursively collect all supported files from the given URIs (files or folders).
 * @param uris Array of URIs (files or folders) to process.
 * @returns Array of file paths with supported extensions.
 */
export async function collectSupportedFiles(uris: vscode.Uri[]): Promise<string[]> {
  const filePaths: string[] = [];

  async function traverseFolder(folderPath: string): Promise<void> {
    const entries = await fs.promises.readdir(folderPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(folderPath, entry.name);
      if (entry.isDirectory()) {
        // Recursively traverse subfolders
        await traverseFolder(fullPath);
      } else if (entry.isFile()) {
        // Check if the file has a supported extension
        const ext = path.extname(entry.name).toLowerCase();
        if (SOURCE_FILE_EXTENSIONS_WITH_DOT.includes(ext)) {
          filePaths.push(fullPath);
        }
      }
    }
  }

  // Process each URI
  for (const uri of uris) {
    const stat = await fs.promises.stat(uri.fsPath);
    if (stat.isDirectory()) {
      // If it's a folder, traverse it recursively
      await traverseFolder(uri.fsPath);
    } else if (stat.isFile()) {
      // If it's a file, check its extension
      const ext = path.extname(uri.fsPath).toLowerCase();
      if (SOURCE_FILE_EXTENSIONS_WITH_DOT.includes(ext)) {
        filePaths.push(uri.fsPath);
      }
    }
  }

  return filePaths;
}