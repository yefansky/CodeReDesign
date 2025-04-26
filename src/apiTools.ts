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
import { promisify } from 'util';
import { ragService, CONFIG as RAG_CONFIG } from './ragService';


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

// 5. 读取 SVN 日志
export const getSVNLog: Tool = {
    name: 'get_svn_log',
    description: '获取 SVN 仓库的日志。',
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
            const { stdout } = await exec(`svn log "${args.repoPath}"`);
            return stdout;
        } catch (error: any) {
            return `获取 SVN 日志失败: ${error.message}`;
        }
    },
};

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
            const results: string[] = [];

            // 递归搜索函数
            const searchDir = async (currentDir: string) => {
                const files = await fs.promises.readdir(currentDir);
                for (const file of files) {
                    const filePath = path.join(currentDir, file);
                    const stat = await fs.promises.stat(filePath);
                    if (stat.isDirectory()) {
                        await searchDir(filePath); // 递归搜索子目录
                    } else {
                        const fileName = path.basename(filePath);
                        if (useRegex) {
                            const regex = new RegExp(pattern);
                            if (regex.test(fileName)) {
                                results.push(filePath);
                            }
                        } else {
                            if (fileName === pattern) {
                                results.push(filePath);
                            }
                        }
                    }
                }
            };

            await searchDir(directory);
            return results.join('\n');
        } catch (error: any) {
            return `搜索文件失败: ${error.message}`;
        }
    },
};

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

