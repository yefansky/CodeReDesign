import OpenAI from 'openai';
import * as vscode from 'vscode';
import axios from 'axios';
import * as cheerio from 'cheerio';
import {
    DuckDuckGoSearchClient,
    DuckDuckGoSearchOptions,
    DuckDuckGoSearchResponse,
  } from '@agent-infra/duckduckgo-search';
import { processDeepSeekResponse} from './deepseekApi';
import * as fs from 'fs';
import * as path from 'path';
import * as mysql from 'mysql2/promise';
import * as childProcess from 'child_process';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ragService, CONFIG as RAG_CONFIG } from './ragService';
import { parseString } from 'xml2js';


/** 定义工具的接口 */
export interface Tool {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: Record<string, { type: string; description: string }>;
        required: string[];
    };
    function: (args: any) => Promise<string>;
}

export const toolRegistry: Map<string, Tool> = new Map();

/**
 * 注册一个工具到全局工具表
 * @param tool 要注册的工具
 */
export function registerTool(tool: Tool) {
    toolRegistry.set(tool.name, tool);
}

export async function handleNativeFunctionCalling(
    openai: OpenAI,
    modelName: string,
    messages: OpenAI.ChatCompletionMessageParam[],
    tools: Tool[],
    streamMode: boolean,
    maxToken: number,
    temperature: number,
    outputChannel?: vscode.OutputChannel,
    abortSignal?: AbortSignal
): Promise<string | null> {
    const response = await openai.chat.completions.create({
        model: modelName,
        messages,
        tools: tools.map(tool => ({
            type: "function",
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
            },
        })),
        stream: streamMode,
        max_tokens: maxToken,
        temperature: temperature,
    });

    // 工具调用收集器
    let toolCalls: Array<Partial<OpenAI.Chat.Completions.ChatCompletionMessageToolCall>> = [];

    // 统一处理响应
    const { chunkResponse, nativeToolCalls, completion } = await processDeepSeekResponse({
        streamMode,
        response: response as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk> | OpenAI.Chat.Completions.ChatCompletion,
        abortSignal,
        userStopException: 'operation stopped by user',
        infoMessage: 'Processing native tool calls...',
        outputChannel,
        processingMode: 'native-tools',
        onChunk: streamMode ? (chunk) => {
            // 流式工具调用处理
            const delta = chunk.choices[0]?.delta;
            if (delta?.tool_calls) {
                for (const toolCallDelta of delta.tool_calls) {
                    const index = toolCallDelta.index;
                    if (!toolCalls[index]) {
                        toolCalls[index] = { type: "function", function: { name: "", arguments: "" } };
                    }
                    if (toolCallDelta.id && !toolCalls[index].id) {
                        toolCalls[index].id = toolCallDelta.id;
                    }
                    const func = toolCallDelta.function;
                    if (func) {
                        if (func.name && !toolCalls[index].function!.name) {
                            toolCalls[index].function!.name = func.name;
                        }
                        if (func.arguments) {
                            toolCalls[index].function!.arguments += func.arguments;
                        }
                    }
                }
            }
        } : undefined
    });

    // 统一工具调用处理
    const resolvedToolCalls = streamMode 
        ? toolCalls.filter(tc => tc.id && tc.function?.name)
        : (completion?.choices[0].message.tool_calls || []);

    if (resolvedToolCalls.length > 0) {
        // 构造助手消息
        const assistantMessage: OpenAI.ChatCompletionMessageParam = {
            role: "assistant",
            content: chunkResponse,
            ...(streamMode ? {
                tool_calls: resolvedToolCalls.map(tc => ({
                    id: tc.id!,
                    type: tc.type!,
                    function: {
                        name: tc.function!.name,
                        arguments: tc.function!.arguments!
                    }
                }))
            } : {})
        };
        messages.push(assistantMessage);

        // 执行工具调用
        for (const toolCall of resolvedToolCalls) {
            const tool = toolRegistry.get(toolCall.function!.name);
            if (tool) {
                const args = JSON.parse(toolCall.function!.arguments!);
                const result = await tool.function(args);
                messages.push({
                    role: "tool",
                    tool_call_id: toolCall.id!,
                    content: result,
                });
            }
        }

        // 递归继续对话
        return await handleNativeFunctionCalling(
            openai, modelName, messages, tools, streamMode, maxToken, temperature, outputChannel, abortSignal
        );
    }

    return chunkResponse;
}

export async function handleSimulatedFunctionCalling(
    openai: OpenAI,
    modelName: string,
    messages: OpenAI.ChatCompletionMessageParam[],
    tools: Tool[],
    streamMode: boolean,
    maxToken: number,
    temperature: number,
    outputChannel?: vscode.OutputChannel,
    abortSignal?: AbortSignal
): Promise<string | null> {
    // 添加工具说明到系统提示
    if (!messages[0].content?.toString().includes("To call a tool")) {
        const toolDescriptions = tools.map(tool =>
            `- ${tool.name}: ${tool.description}. Parameters: ${JSON.stringify(tool.parameters.properties)}`
        ).join('\n');
        const functionCallingPrompt = `\n\nYou have access to these tools:\n${toolDescriptions}\n\nTo call a tool, respond with:\n<tool_call>{"id": "unique_id", "name": "tool_name", "arguments": {"arg1": "value1"}}</tool_call>`;
        messages[0].content += functionCallingPrompt;
    }

    const response = await openai.chat.completions.create({
        model: modelName,
        messages,
        stream: streamMode,
        max_tokens: maxToken,
        temperature: temperature,
    });

    // 统一处理响应
    const { chunkResponse } = await processDeepSeekResponse({
        streamMode,
        response: response as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk> | OpenAI.Chat.Completions.ChatCompletion,
        abortSignal,
        userStopException: 'operation stopped by user',
        infoMessage: 'Processing simulated tools...',
        outputChannel,
        processingMode: 'simulated-tools'
    });

    // 解析工具调用
    const toolCallMatches = chunkResponse.matchAll(/<tool_call>(.*?)<\/tool_call>/gs);
    const toolCalls = Array.from(toolCallMatches, match => JSON.parse(match[1]));

    if (toolCalls.length > 0) {
        // 记录工具调用结果
        for (const toolCall of toolCalls) {
            const tool = toolRegistry.get(toolCall.name);
            if (tool) {
                const result = await tool.function(toolCall.arguments);
                messages.push({
                    role: "assistant",
                    content: `<tool_call>${JSON.stringify(toolCall)}</tool_call>`
                });
                messages.push({
                    role: "user",
                    content: `<tool_result>{"id": "${toolCall.id}", "result": "${result}"}</tool_result>`,
                });
            }
        }

        // 递归继续对话
        return await handleSimulatedFunctionCalling(
            openai, modelName, messages, tools, streamMode, maxToken, temperature, outputChannel, abortSignal
        );
    }

    return chunkResponse;
}


export function isToolsSupported(apiBaseURL: string, modelName: string): boolean {
    // 示例：假设 DeepSeek 官方 URL 支持 tools
    return apiBaseURL === "https://api.deepseek.com" && !modelName.includes("r1") && !modelName.includes("reasoner");
}

// Define a minimal interface for search results (adjust based on actual response structure)
interface SearchResult {
    url: string;
    title?: string;
    snippet?: string;
}
  
// Fetch search result links using DuckDuckGoSearchClient
async function getLinksWithBrowser(query: string): Promise<string[]> {
    try {
      // Initialize client without config
      const client = new DuckDuckGoSearchClient();
  
      // Set search options
      const options: DuckDuckGoSearchOptions = {
        query,
        count: 10, // Retry up to 3 times
      };
  
      // Perform search
      const response: DuckDuckGoSearchResponse = await client.search(options);
  
      // Extract links (adjust based on actual response structure)
      const links: string[] = ((response as any).results as SearchResult[])
        .filter((result) => result.url && !result.url.includes('duckduckgo.com'))
        .map((result) => result.url);
  
      return links;
    } catch (error: unknown) {
      console.error('Search failed:', error instanceof Error ? error.message : error);
      return [];
    }
}

async function fetchPageContent(url: string): Promise<string> {
    try {
        const response = await axios.get(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml',
            },
            timeout: 10000,
        });
        
        console.debug('Cheerio Object:', cheerio);  // 调试点1：确认 cheerio 存在
        console.debug('Response Data:', response.data.slice(0, 100)); // 调试点2：确认数据存在
        const $ = cheerio.load(response.data);
        
        // 优化内容提取
        const title = $('title').text().trim() || '无标题';
        const mainContent = $('body').find('p, article, .content').text().trim();
        const content = (mainContent || $('body').text())
            .replace(/\s+/g, ' ')
            .substring(0, 1000);

        return `${title}: ${content}`;
    } catch (error: any) {
        return `访问失败: ${error.message}`;
    }
}

// 1. 搜索网络
export const searchTool: Tool = {
    name: 'web_search',
    description: '执行网络搜索并返回前5个结果的摘要，用户提供这个工具一般是不信任你自己的判断，先上网搜索总结后再下结论。',
    parameters: {
        type: 'object',
        properties: {
            query: { 
                type: 'string', 
                description: '搜索关键词，使用英文双引号支持精确匹配，示例：最佳AI编程工具 site:github.com' 
            },
        },
        required: ['query'],
    },
    function: async (args: { query: string }) => {
        try {
            const links = await getLinksWithBrowser(args.query);
            if (!links.length) {
                return '未找到相关结果';
            }
            
            const results = await Promise.all(
                links.map(link => 
                    fetchPageContent(link as string)
                        .catch(e => `抓取失败: ${link} (${e.message})`)
                )
            );
            
            return results
                .map((res, i) => `【结果${i+1}】\n${res}`)
                .join('\n\n');
        } catch (error: any) {
            return `搜索失败: ${error.message}`;
        }
    },
};
registerTool(searchTool);

// 2. 获取当前日期时间
export const getCurrentDateTime: Tool = {
    name: 'get_current_datetime',
    description: '获取当前的日期和时间。',
    parameters: {
        type: 'object',
        properties: {},
        required: [],
    },
    function: async () => {
        const now = new Date();
        return now.toLocaleString();
    },
};
registerTool(getCurrentDateTime);

// 3. 读取指定路径文本
export const readTextFile: Tool = {
    name: 'read_text_file',
    description: '读取指定路径的文本文件内容。',
    parameters: {
        type: 'object',
        properties: {
            filePath: { 
                type: 'string', 
                description: '要读取的文本文件路径。' 
            },
        },
        required: ['filePath'],
    },
    function: async (args: { filePath: string }) => {
        try {
            const content = await fs.promises.readFile(args.filePath, 'utf-8');
            return content;
        } catch (error: any) {
            return `读取文件失败: ${error.message}`;
        }
    },
};
registerTool(readTextFile);

// 4. 连接 MySQL 查表
export const queryMySQL: Tool = {
    name: 'query_mysql',
    description: '连接 MySQL 数据库并执行查询。',
    parameters: {
        type: 'object',
        properties: {
            host: { type: 'string', description: 'MySQL 主机地址。' },
            user: { type: 'string', description: 'MySQL 用户名。' },
            password: { type: 'string', description: 'MySQL 密码。' },
            database: { type: 'string', description: '要查询的数据库名称。' },
            query: { type: 'string', description: '要执行的 SQL 查询。' },
        },
        required: ['host', 'user', 'password', 'database', 'query'],
    },
    function: async (args: { host: string; user: string; password: string; database: string; query: string }) => {
        try {
            const connection = await mysql.createConnection({
                host: args.host,
                user: args.user,
                password: args.password,
                database: args.database,
            });
            const [rows] = await connection.execute(args.query);
            await connection.end();
            return JSON.stringify(rows);
        } catch (error: any) {
            return `查询失败: ${error.message}`;
        }
    },
};
registerTool(queryMySQL);

// SVN 日志条目类型
type LogEntry = {
    revision: string;
    author?: string;
    date?: string;
    message?: string;
    paths?: Array<{ action: string; path: string }>;
};
  
// 增强错误类型
type SVNError = Error & { stderr?: string };
const execAsync = promisify(exec);
export const getSVNLog: Tool = {
    name: 'get_svn_log',
    description: '获取SVN日志，支持多种查询条件',
    parameters: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: `仓库路径，支持以下格式：
- 本地工作副本路径：'/projects/myapp'
- 仓库URL：'http://svn.example.com/repo'
- 仓库子目录：'http://svn.example.com/repo/trunk/src'`
            },
            author: {
                type: 'string',
                description: '提交者名称筛选（支持模糊匹配）'
            },
            keyword: {
                type: 'string',
                description: '提交信息关键词筛选（支持模糊匹配）'
            },
            startDate: {
                type: 'string',
                description: `开始时间，支持格式：
- 绝对时间：'2024-03-01'
- 相对时间：'1h'(最近1小时)/'24h'(最近1天)/'7d'(最近7天)/'30d'(最近30天)`
            },
            endDate: {
                type: 'string',
                description: `结束时间，支持格式：
- 绝对时间：'2024-03-15'
- 相对时间：'1h'(1小时前)`
            },
            revisionStart: {
                type: 'number',
                description: '起始版本号（包含）'
            },
            revisionEnd: {
                type: 'number',
                description: '结束版本号（包含）'
            },
            limit: {
                type: 'number',
                description: '返回结果最大数量'
            }
        },
        required: ['path'],
    },
    function: async (args): Promise<string> => {
      try {
        const params: string[] = [];
        let repoPath = args.path;
  
        // 时间处理函数
        const parseTime = (timeStr?: string, isEndTime = false): string => {
          if (!timeStr) { return isEndTime ? 'HEAD' : '1'; }
          
          const relativeMatch = timeStr.match(/^(\d+)([hd])$/);
          if (relativeMatch) {
            const now = new Date();
            const [, value, unit] = relativeMatch;
            const ms = parseInt(value) * (unit === 'h' ? 3600 : 86400) * 1000;
            return `{${new Date(now.getTime() - ms).toISOString().slice(0, 19)}}`;
          }
  
          if (/^\d{4}-\d{2}-\d{2}$/.test(timeStr)) {
            return isEndTime 
              ? `{${timeStr} 23:59:59}` 
              : `{${timeStr} 00:00:00}`;
          }
  
          throw new Error(`Invalid time format: ${timeStr}`);
        };
  
        // 构建查询参数
        if (args.author) { params.push(`--search "author:${args.author}"`); }
        if (args.keyword) { params.push(`--search "message:${args.keyword}"`); }
        
        const startRev = parseTime(args.startDate);
        const endRev = parseTime(args.endDate, true);
        if (startRev !== '1' || endRev !== 'HEAD') {
          params.push(`--revision ${startRev}:${endRev}`);
        }
  
        if (args.revisionStart || args.revisionEnd) {
          const start = args.revisionStart ?? 1;
          const end = args.revisionEnd ?? 'HEAD';
          params.push(`--revision ${start}:${end}`);
        }
  
        if (args.limit) { params.push(`-l ${args.limit}`); }
  
        // 获取仓库根地址
        if (!/^(http|https|svn):\/\//.test(repoPath)) {
          const { stdout } = await execAsync(
            `svn info "${repoPath}" --show-item repos-root-url`,
            { encoding: 'utf8' }
          );
          repoPath = stdout.trim();
        }
  
        // 执行命令
        const { stdout } = await execAsync(
          `svn log "${repoPath}" --xml ${params.join(' ')}`,
          { encoding: 'gbk' as BufferEncoding, maxBuffer: 1024 * 1024 * 10 }
        );
  
        // 解析XML
        const parsed = await new Promise<any>((resolve, reject) => {
          parseString(stdout, (err, result) => {
            err ? reject(err) : resolve(result);
          });
        });
  
        // 转换为LogEntry数组
        const entries: LogEntry[] = (parsed.log.logentry || []).map(
          (entry: any) => ({
            revision: entry.$.revision,
            author: entry.author?.[0],
            date: entry.date?.[0],
            message: entry.msg?.[0]?.trim(),
            paths: (entry.paths?.[0]?.path || []).map((p: any) => ({
              action: p.$.action,
              path: p._
            }))
          })
        );
  
        return JSON.stringify(entries, null, 2);
  
      } catch (error) {
        const err = error as SVNError;
        const errorMapping: Record<string, string> = {
          '175002': '认证失败',
          '160013': '路径不存在',
          '200009': '无效时间格式',
          '205000': '无效版本号'
        };
  
        const errorCode = err.stderr?.match(/svn: E(\d+):/)?.[1] || '';
        const message = errorCode in errorMapping
          ? `SVN错误 [E${errorCode}]: ${errorMapping[errorCode]}`
          : `操作失败: ${err.message?.replace(/^svn: E\d+: /, '') || '未知错误'}`;
  
        return message;
      }
    }
};
  
registerTool(getSVNLog);

// 6. 比对 SVN 本地差异的 diff
export const getSVNDiff: Tool = {
    name: 'get_svn_diff',
    description: '获取 SVN 仓库的本地差异。',
    parameters: {
        type: 'object',
        properties: {
            repoPath: { type: 'string', description: 'SVN 仓库的本地路径。' },
        },
        required: ['repoPath'],
    },
    function: async (args: { repoPath: string }) => {
        try {
            const exec = promisify(childProcess.exec);
            const { stdout } = await exec(`svn diff "${args.repoPath}"`);
            return stdout;
        } catch (error: any) {
            return `获取 SVN diff 失败: ${error.message}`;
        }
    },
};
registerTool(getSVNDiff);

// 7. 比对 GitHub 本地差异的 diff
export const getGitDiff: Tool = {
    name: 'get_git_diff',
    description: '获取 Git 仓库的本地差异。',
    parameters: {
        type: 'object',
        properties: {
            repoPath: { type: 'string', description: 'Git 仓库的本地路径。' },
        },
        required: ['repoPath'],
    },
    function: async (args: { repoPath: string }) => {
        try {
            const exec = promisify(childProcess.exec);
            const { stdout } = await exec(`git -C "${args.repoPath}" diff`);
            return stdout;
        } catch (error: any) {
            return `获取 Git diff 失败: ${error.message}`;
        }
    },
};
registerTool(getGitDiff);

// 8. Grep 搜索指定目录文本
export const grepSearch: Tool = {
    name: 'grep_search',
    description: '在指定目录中搜索文本。',
    parameters: {
        type: 'object',
        properties: {
            directory: { type: 'string', description: '要搜索的目录路径。' },
            pattern: { type: 'string', description: '要搜索的文本模式。' },
        },
        required: ['directory', 'pattern'],
    },
    function: async (args: { directory: string; pattern: string }) => {
        try {
            const exec = promisify(childProcess.exec);
            const { stdout } = await exec(`findstr /s /i /m /c:"${args.pattern}" "${args.directory}\\*"`);
            return stdout;
        } catch (error: any) {
            return `搜索失败: ${error.message}`;
        }
    },
};
registerTool(grepSearch);

// 9. 在路径下递归搜索文件
export const findFiles: Tool = {
    name: 'find_files',
    description: '在指定路径下递归搜索文件，支持文件名或正则表达式匹配。',
    parameters: {
        type: 'object',
        properties: {
            directory: { 
                type: 'string', 
                description: '要搜索的根目录路径。' 
            },
            pattern: { 
                type: 'string', 
                description: '搜索模式，可以是文件名或正则表达式。' 
            },
            useRegex: { 
                type: 'boolean', 
                description: '是否使用正则表达式进行搜索。true 表示 pattern 是正则表达式，false 表示 pattern 是精确文件名。' 
            },
        },
        required: ['directory', 'pattern', 'useRegex'],
    },
    function: async (args: { directory: string; pattern: string; useRegex: boolean }) => {
        try {
            const { directory, pattern, useRegex } = args;
            const queue: string[] = [directory];
            const results: string[] = []; // 声明结果数组 <--- 修复点
    
            while (queue.length > 0) {
                const currentDir = queue.shift()!;
                const files = await fs.promises.readdir(currentDir, { withFileTypes: true });
    
                for (const file of files) {
                    try {
                        const filePath = path.join(currentDir, file.name);
                        
                        if (file.isDirectory()) {
                            queue.push(filePath);
                        } else {
                            // 严格匹配模式
                            if (!useRegex) {
                                if (file.name === pattern) {
                                    return filePath; // 直接返回首个匹配项
                                }
                            } 
                            // 正则表达式模式
                            else {
                                const regex = new RegExp(pattern);
                                if (regex.test(file.name)) {
                                    results.push(filePath); // 收集所有匹配项
                                }
                            }
                        }
                    } catch (error) {
                        continue;
                    }
                }
            }
    
            // 根据模式返回不同结果
            return useRegex 
                ? results.join('\n')  // 正则模式返回所有结果
                : '';               // 严格模式未找到返回空
        } catch (error: any) {
            return `搜索失败: ${error.message}`;
        }
    },
};
registerTool(findFiles);

// 修改后的writeMemory工具（移除本地嵌入生成和存储）
export const writeMemory: Tool = {
    name: 'write_memory',
    description: 'Save knowledge or insights to memory.',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The knowledge or insight content to save.' },
      },
      required: ['content'],
    },
    function: async (args: { content: string }) => {
      try {
        // 调用FastAPI的/add_knowledge端点
        const response = await fetch(`http://localhost:${RAG_CONFIG.PORT}/add_knowledge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([args.content]),
        });
  
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API request failed: ${response.status} - ${errorText}`);
        }
  
        const result = await response.json() as { status: string };
        return result.status === 'added' 
          ? `Memory saved: ${args.content.slice(0, 50)}...`
          : "Failed to save memory";
      } catch (error: any) {
        return `保存记忆失败: ${error.message}`;
      }
    },
};
  
  // 修改后的readMemory工具（移除本地相似度计算）
export const readMemory: Tool = {
    name: 'read_memory',
    description: 'Retrieve relevant knowledge from memory.',
    parameters: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'The query text to search memory.' },
        },
        required: ['query'],
    },
    function: async (args: { query: string }) => {
        try {
        // 调用FastAPI的/query端点
        const response = await fetch(`http://localhost:${RAG_CONFIG.PORT}/query?query_text=${encodeURIComponent(args.query)}`, {
            method: 'GET'
        });

        if (!response.ok) {
            throw new Error(`API请求失败: ${response.status}`);
        }

        const data = await response.json() as { results: string[] };
        const results = data.results;

        return results.length > 0 
            ? results.map((text: string, index: number) => 
                `结果 ${index + 1}:\n${text.slice(0, 200)}...`
            ).join('\n\n')
            : '未找到相关记忆';
        } catch (error: any) {
            return `检索记忆失败: ${error.message}`;
        }
    },
};

// Register tools
registerTool(writeMemory);
registerTool(readMemory);
/**
 * Retrieves an array of all registered tools from the tool registry.
 * @returns An array of Tool objects.
 */
export function getAllTools(): Tool[] {
  return Array.from(toolRegistry.values());
}

