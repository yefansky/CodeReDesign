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