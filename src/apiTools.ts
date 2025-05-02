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
import * as fs from 'fs/promises';
import * as path from 'path';
import * as mysql from 'mysql2/promise';
import * as childProcess from 'child_process';
import { exec } from 'child_process';
import { promisify } from 'util';
import { CONFIG as RAG_CONFIG } from './ragService';
import { parseString } from 'xml2js';
import ExcelJS from 'exceljs';
import pdfParse from 'pdf-parse';

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
export const webSearchRegistry : Map<string, Tool> = new Map();

/**
 * 注册一个工具到全局工具表
 * @param tool 要注册的工具
 */
export function registerTool(tool: Tool) {
    toolRegistry.set(tool.name, tool);
}

export function registerWebSearchTool(tool: Tool) {
    webSearchRegistry.set(tool.name, tool);
}

/**
 * Retrieves an array of all registered tools from the tool registry.
 * @returns An array of Tool objects.
 */
export function getAllTools(): Tool[] {
    return Array.from(toolRegistry.values());
}

export function getWebSearchTools(): Tool[] {
    return Array.from(webSearchRegistry.values());
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
export const webSearchTool: Tool = {
    name: 'web_search',
    description: `执行网络搜索并返回前5个结果的摘要。适用于需要获取外部信息、验证数据或了解最新动态的情况。
用户提供这个工具通常是对你的知识储备或判断持怀疑态度，希望通过网络搜索获取更权威或更新的信息。
你可以用它来补充自己的回答，确保回答准确且有据可依。
当问到你依稀技术名词的时候，你没有把握就不要乱说，先联网搜索。因为大模型很容易产生幻觉，以为自己什么都懂。
使用完这些搜索到的信息以后，你还应该输出所有被你采纳信息的来源，也就是url，方便用户核实

使用场景:
- 获取最新信息: 例如，用户询问“2023年最好的编程语言是什么？”
- 验证事实: 例如，确认“Python的最新版本是什么？”
- 收集多种观点: 例如，了解“AI在医疗领域的应用有哪些？”

具体示例:
用户问：“最新的AI编程工具是什么？”
你可以使用 web_search，输入参数 query: "latest AI programming tools 2023"，然后回答：
“根据网络搜索结果，当前流行的AI编程工具包括：1. GitHub Copilot（代码自动补全），2. Tabnine（多语言支持），...”。

如何使用:
- 参数 query: 输入搜索关键词，支持英文双引号精确匹配。例如 "AI tools site:github.com" 会限定搜索范围到 GitHub。`,
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
        vscode.window.showInformationMessage(`CodeReDesign 正在搜索网络 ${args.query}`);
        try {
            const links = await getLinksWithBrowser(args.query);
            if (!links.length) {
                return '未找到相关结果';
            }
            
            // 修改结果处理部分
            const results = await Promise.all(
                links.map(link => 
                    fetchPageContent(link as string)
                        .then(content => ({
                            url: link,
                            content: content
                        }))
                        .catch(e => ({
                            url: link,
                            content: `抓取失败: ${e.message}`
                        }))
                )
            );
            
            // 添加URL信息到返回结果
            return results
                .map((res, i) => 
                    `【结果${i+1}】\n` + 
                    `来源：${res.url}\n` + 
                    `内容摘要：${res.content.slice(0, 500)}...` // 限制内容长度
                )
                .join('\n\n');
        } catch (error: any) {
            return `搜索失败: ${error.message}`;
        }
    },
};
registerTool(webSearchTool);
registerWebSearchTool(webSearchTool);

// 获取网页正文内容的工具
export const getWebpageContent: Tool = {
    name: 'get_webpage_content',
    description: `通过输入的URL获取网页的正文内容，自动过滤广告、脚本等无关信息，提取纯文本有用信息。
适用于需要快速提取网页核心内容的场景，例如信息检索、内容分析或总结网页信息。

使用场景:
- 信息提取: 用户提供URL，想获取网页的主要文本内容（如文章、新闻）。
- 内容分析: 需要分析网页核心信息，排除广告、导航等干扰。
- 自动化总结: 提取网页正文后进一步处理或总结。

具体示例:
用户输入: “https://deepwiki.com/RVC-Boss/GPT-SoVITS”
工具返回: 该网页的正文内容（纯文本，例如GPT-SoVITS的介绍、功能描述等）。

如何使用:
- 参数: 一个包含URL的字符串（必须有效）。
- 返回: 网页正文内容的纯文本字符串。`,
    parameters: {
        type: 'object',
        properties: {
            url: {
                type: 'string',
                description: '需要提取正文内容的网页URL',
            },
        },
        required: ['url'],
    },
    function: async ({ url }: { url: string }) => {
        try {
            // 显示正在处理的提示
            vscode.window.showInformationMessage(`正在提取 ${url} 的正文内容`);

            // 获取网页内容
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                },
            });

            // 使用 cheerio 解析 HTML
            const $ = cheerio.load(response.data);

            // 移除无关元素
            $('script, style, iframe, noscript, header, footer, nav, aside, .ad, [class*="ad"], [id*="ad"]').remove();

            // 针对 deepwiki.com 优化提取逻辑
            let content = $('main, .content, .article, [role="main"]').text().trim();

            // 如果没有找到特定容器，尝试提取所有段落
            if (!content) {
                content = $('p, h1, h2, h3, h4, h5, h6')
                    .map((_, el) => $(el).text().trim())
                    .get()
                    .filter(text => text.length > 0)
                    .join('\n');
            }

            // 清理多余的空白和换行
            content = content.replace(/\s+/g, ' ').trim();

            // 如果没有提取到有效内容，返回提示
            if (!content) {
                return '无法提取有效的正文内容，可能是网页结构不标准或内容为空。';
            }

            return content;
        } catch (error) {
            vscode.window.showErrorMessage(`提取网页内容失败: ${(error as Error).message}`);
            return `错误: 无法获取 ${url} 的内容，请检查URL或网络连接。`;
        }
    },
};

registerTool(getWebpageContent);
registerWebSearchTool(getWebpageContent);

// 列举指定路径下文件和目录的工具
export const listDirectory: Tool = {
    name: 'list_directory',
    description: `列举指定路径下的文件和目录。适用于需要查看文件夹内容或文件列表的场景。
它会返回路径下的文件和目录名称列表，区分文件和目录类型。路径可以是相对路径或绝对路径。

使用场景:
- 文件管理: 用户想查看某个文件夹里有哪些文件或子文件夹。
- 自动化脚本: 需要获取目录内容以进行进一步处理（如批量操作文件）。
- 调试: 检查项目目录结构或确认文件是否存在。

具体示例:
用户输入: “./docs”
工具返回: “文件: readme.md, config.json；目录: images, templates”

如何使用:
- 参数: 一个包含路径的字符串（可以是相对或绝对路径）。
- 返回: 包含文件和目录列表的字符串，格式清晰易读。`,
    parameters: {
        type: 'object',
        properties: {
            dirPath: {
                type: 'string',
                description: '要列举的目录路径（相对或绝对路径）',
            },
        },
        required: ['dirPath'],
    },
    function: async ({ dirPath }: { dirPath: string }) => {
        try {
            // 显示正在处理的提示
            vscode.window.showInformationMessage(`正在列举 ${dirPath} 下的内容`);

            // 解析路径，处理相对路径
            const resolvedPath = path.resolve(dirPath);

            // 读取目录内容
            const dirItems = await fs.readdir(resolvedPath, { withFileTypes: true });

            // 分离文件和目录
            const files: string[] = [];
            const directories: string[] = [];

            for (const item of dirItems) {
                if (item.isFile()) {
                    files.push(item.name);
                } else if (item.isDirectory()) {
                    directories.push(item.name);
                }
            }

            // 格式化输出
            let result = '';
            if (files.length > 0) {
                result += `文件: ${files.join(', ')}`;
            }
            if (directories.length > 0) {
                result += `${files.length > 0 ? '; ' : ''}目录: ${directories.join(', ')}`;
            }

            // 处理空目录
            if (!result) {
                return `目录 ${dirPath} 为空`;
            }

            return result;
        } catch (error) {
            vscode.window.showErrorMessage(`列举目录失败: ${(error as Error).message}`);
            return `错误: 无法列举 ${dirPath} 的内容，请检查路径是否正确或是否有权限。`;
        }
    },
};

registerTool(listDirectory);


// 2. 获取当前日期时间
export const getCurrentDateTime: Tool = {
    name: 'get_current_datetime',
    description: `获取当前的日期和时间。适用于任何需要实时时间信息的情况。
它简单高效，没有参数，直接返回本地时间。可以用它来回答时间相关的问题，或在任务中提供时间上下文。

使用场景:
- 回答时间问题: 例如，用户直接问“现在几点了？”或“今天是星期几？”
- 任务安排: 例如，用户说“请在明天上午10点提醒我开会”，你可以用它确认当前时间并计算提醒时间。
- 记录时间戳: 例如，在日志或事件记录中添加当前时间。

具体示例:
用户问：“现在是几点？”
你调用 get_current_datetime，返回：
“当前时间是 2023年10月15日 14:30（本地时间）。”

如何使用:
- 无参数，直接调用即可，返回格式为本地时间的字符串。`,
    parameters: {
        type: 'object',
        properties: {},
        required: [],
    },
    function: async () => {
        vscode.window.showInformationMessage('CodeReDesign 正在获取当前日期');
        const now = new Date();
        return now.toLocaleString();
    },
};
registerTool(getCurrentDateTime);

// 3. 读取指定路径文本
export const readTextFile: Tool = {
    name: 'read_text_file',
    description: `读取指定路径的文本文件内容。适用于需要访问本地文件信息的情况。
它可以帮助你提取文件中的数据、配置或日志，适合处理静态文本内容。
比如我让你解析一个代码里的内容，找出里面的某个引用函数，你就可以用这个工具加载文件文本内容然后再进行分析。
有些时候我会让你解释代码。或者问你代码里的某一段内容的意思，或者查找相关代码，你就应该重新加载最可能的那个代码文件，然后重新回答我的问题。
我让你解释代码的时候你一定要用这个工具去读取，而不是凭文件名猜测他的内容，切记！

使用场景:
- 读取文件内容: 例如，用户说“请告诉我 C:\\notes.txt 里写了什么”。
- 处理配置: 例如，在调试时读取配置文件“读取 config.txt 的设置”。
- 分析日志: 例如，查看日志文件中的错误信息“读取 error.log 的最后一行”。

具体示例:
用户说：“请读取 C:\\data.py 的内容。”
你调用 read_text_file，参数 filePath: "C:\\data.tpy"，返回：
“文件内容是：'这是一个测试文件，包含重要信息。'”

如何使用:
- 参数 filePath: 输入完整的文件路径（如 "C:\\data.py"），支持 UTF-8 编码的文本文件。`,
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
            const content = await fs.readFile(args.filePath, 'utf-8');
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
    description: `连接 MySQL 数据库并执行 SQL 查询，返回 JSON 格式结果。适合数据查询或管理。

使用场景:

数据查询：用户问“用户表里有多少人？”
生成报告：统计“所有订单的总金额”。
数据管理：更新“用户 ID 为 1 的状态”。
具体示例:
用户说：“查询用户表中的所有用户。”
调用 query_mysql，参数：host: "localhost", user: "root", password: "123456", database: "mydb", query: "SELECT * FROM users"，返回：
“结果：[{"id": 1, "name": "Alice"}, {"id": 2, "name": "Bob"}]`,
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
        vscode.window.showInformationMessage('CodeReDesign 正在连接MySQL');
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
    description: `获取 SVN 仓库的提交日志，支持筛选路径、作者或时间范围，适合版本管理。

使用场景:

查看历史：用户问“SVN 仓库最近5次提交是什么？”
代码审查：查找“Alice 的所有提交”。
项目跟踪：查看“过去一周的提交”。
具体示例:
用户说：“获取 SVN 仓库最近10条提交记录。”
调用 get_svn_log，参数 path: "http://svn.example.com/repo", limit: 10，返回：
“结果：[{'revision': '100', 'author': 'Alice', 'date': '2023-10-01', 'message': '修复bug'}]`,
    parameters: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: `仓库路径，支持以下格式：
- 本地工作副本路径：'k:\\projects\\myapp'
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
        vscode.window.showInformationMessage('CodeReDesign 正在查询svn提交日志');
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
    description: `显示 SVN 本地工作副本与远程仓库的差异，适合提交前检查。

使用场景:

检查改动：用户问“我对 SVN 做了什么改动？”
提交审查：确认“本地差异”。
调试：对比本地和远程代码。
具体示例:
用户说：“显示 SVN 仓库的本地差异。”
调用 get_svn_diff，参数 repoPath: "C:\\svn_repo"，返回：
“差异：'+ 新增一行\n- 删除一行'”
参数说明:
repoPath: 本地仓库路径`,
    parameters: {
        type: 'object',
        properties: {
            repoPath: { type: 'string', description: 'SVN 仓库的本地路径。' },
        },
        required: ['repoPath'],
    },
    function: async (args: { repoPath: string }) => {
        vscode.window.showInformationMessage('CodeReDesign 正在获取svn本地差异');
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
    description: `显示 Git 本地工作目录与已提交内容的差异，适合代码审查或调试。

使用场景:

检查更改：用户问“Git 仓库的本地改动是什么？”
提交确认：查看“Git diff”。
错误排查：对比改动。
具体示例:
用户说：“显示 Git 仓库的本地差异。”
调用 get_git_diff，参数 repoPath: "C:\\git_repo"，返回：
“差异：'+ 添加新功能\n- 删除旧代码'`,
    parameters: {
        type: 'object',
        properties: {
            repoPath: { type: 'string', description: 'Git 仓库的本地路径。' },
        },
        required: ['repoPath'],
    },
    function: async (args: { repoPath: string }) => {
        vscode.window.showInformationMessage('CodeReDesign 正在查询git本地差异');
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
    description: `在指定目录中搜索包含特定文本的文件，适合日志分析或代码搜索。

使用场景:

搜索关键词：用户说“在 C:\\logs 里找 'error'”。
代码审查：查找“userId”的使用。
日志分析：定位“timeout”。
具体示例:
用户说：“在 C:\\projects 里搜索 'error'。”
调用 grep_search，参数 directory: "C:\\projects", pattern: "error"，返回：
“结果：C:\\projects\\log.txt, C:\\projects\\test.py`,
    parameters: {
        type: 'object',
        properties: {
            directory: { type: 'string', description: '要搜索的目录路径。' },
            pattern: { type: 'string', description: '要搜索的文本模式。' },
        },
        required: ['directory', 'pattern'],
    },
    function: async (args: { directory: string; pattern: string }) => {
        vscode.window.showInformationMessage('CodeReDesign 正在使用grep搜索');
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
    description: `递归搜索指定路径下的文件，支持文件名或正则表达式，适合文件管理。

使用场景:

查找文件：用户说“找 C:\projects 里的 config.json”。
批量搜索：列出“.py 文件”。
项目管理：搜索“test 开头的文件”。
具体示例:
用户说：“找 C:\projects 里所有的 .py 文件。”
调用 find_files，参数 directory: "C:\projects", pattern: ".+\.py", useRegex: true，返回：
“结果：C:\projects\main.py, C:\projects\test.py”`,
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
        vscode.window.showInformationMessage('CodeReDesign 正在查找文件');
        try {
            const { directory, pattern, useRegex } = args;
            const queue: string[] = [directory];
            const results: string[] = []; // 声明结果数组 <--- 修复点
    
            while (queue.length > 0) {
                const currentDir = queue.shift()!;
                const files = await fs.readdir(currentDir, { withFileTypes: true });
    
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
    description: `将重要信息或见解保存到记忆中，供将来检索。
它适合记录对话中的关键点或学习成果，类似于一个知识库。
一些我要求你记住的东西，或者是联网搜索到的知识，你自己总结出来的感悟。你都可以总结起来存入本地记忆。
一些我们一起讨论得出的结论你也可以存起来。你要做个虚心好学的学生，学到的东西都要做好笔记。
如果一个任务你做了好几个步骤才完成，可以总结一下，写明任务目标，注意事项，一些积累经验，快速执行的方法，存入记忆，下次类似任务可以根据这个经验快速处理。
当我告诉你的话里出现"记住","存入记忆","下次"等关键词，就是明确告诉你要调用write_memory把信息记录下来
你存入的每一条记忆，必须有前倾提要，或者有说明语境。单独拿出来看必须能知道是在什么情况下总结出来的信息，有什么价值
比如"在???情况下应该用什么???策略应对", "因为我提到了某某，所以你需要记录下来XX，以便下次能想起来"， "用户让我搜索互联网，主题是XXX，结果我搜到了信息XXX"
必须包含这些丰富的上下文语境，有了语境的记忆才是正确的，必须要注意！不能只存需要写入的信息的片段，必须有上下文！
存入记忆前你最好评估这条信息的可信度，如果是从网络上搜索到的可信度比较高，如果是你自己猜测的可信度就比较低，最好不要存入可信度不高的信息
并且存入的语句要通顺

使用场景:
- 记录新信息: 例如，用户说“我发现了一个新工具叫 X”，你可以保存它。
- 学习过程: 例如，保存一个技巧“Python 的 lambda 函数用法”。
- 任务跟踪: 例如，记录项目更新“项目 A 的截止日期是明天”。

具体示例:
用户说：“我发现了一个新工具叫 CodeAI。”
你调用 write_memory，参数 content: "新工具：CodeAI"，
返回：
“记忆已保存：新工具：CodeAI。”

如何使用:
- 参数 content: 输入要保存的内容。`,
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The knowledge or insight content to save.' },
      },
      required: ['content'],
    },
    function: async (args: { content: string }) => {
        vscode.window.showInformationMessage('CodeReDesign 正在写入记忆');
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
    description: `从记忆中检索信息，适合回顾保存的内容。
    有时候我要你回忆一下，就是要你从这里调取记忆。我们以前进行的对话，我纠正过你的记忆，或者你自己总结的感悟都会在本地记忆里。
    你要勤于调取本地记忆，看看是否有和当前任务相关的记忆，帮助你更好的执行任务。
    有一些复杂任务你可以预先调取记忆，看以前有没有遇到过类似任务，有没有总结过的经验可以参考，从而高效的完成。
    当我告诉你的话里出现"回忆","再想想","我告诉过你"等关键词，就是明确告诉你要调用read_memory调取以前存入的信息

使用场景:

回忆信息：用户问“之前提到的工具是什么？”
引用知识：使用保存的内容。
任务回顾：查看“截止日期”。
具体示例:
用户说：“之前提到的工具是什么？”
调用 read_memory，参数 query: "工具"，返回：
“结果：新工具：CodeAI”
参数说明:
query: 搜索关键词。`,
    parameters: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'The query text to search memory.' },
        },
        required: ['query'],
    },
    function: async (args: { query: string }) => {
        vscode.window.showInformationMessage('CodeReDesign 正在读取记忆');
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

// 读取 Excel 文件并转换为 tab 分隔 CSV 文本的工具
export const excelToCsv: Tool = {
    name: 'excel_to_csv',
    description: `读取指定路径的 Excel 文件（.xlsx）并将其转换为 tab 分隔的 CSV 文本输出。
输出格式使用 \\t 分隔列，\\n 分隔行。适用于需要将 Excel 数据转换为纯文本格式的场景。

使用场景:
- 数据转换: 将 Excel 文件转换为 tab 分隔的文本，用于其他工具或系统处理。
- 数据提取: 快速提取 Excel 表格内容为纯文本，便于分析或共享。
- 自动化处理: 在脚本中将 Excel 数据转换为标准格式以进行进一步操作。

具体示例:
用户输入: “./data/sample.xlsx”
工具返回: “Name\tAge\tCity\nJohn\t30\tNew York\nAlice\t25\tLondon”

如何使用:
- 参数: 一个包含 Excel 文件路径的字符串（相对或绝对路径）。
- 返回: tab 分隔的 CSV 文本字符串，包含 Excel 表格内容。`,
    parameters: {
        type: 'object',
        properties: {
            filePath: {
                type: 'string',
                description: 'Excel 文件的路径（.xlsx，相对或绝对路径）',
            },
        },
        required: ['filePath'],
    },
    function: async ({ filePath }: { filePath: string }) => {
        try {
            // 显示正在处理的提示
            vscode.window.showInformationMessage(`正在读取 Excel 文件 ${filePath}`);

            // 解析路径，处理相对路径
            const resolvedPath = path.resolve(filePath);

            // 使用 exceljs 读取 Excel 文件
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.readFile(resolvedPath);

            // 默认使用第一个工作表，并检查是否存在
            const worksheet = workbook.worksheets[0];
            if (!worksheet) {
                return `Excel 文件 ${filePath} 没有工作表或内容为空。`;
            }

            // 转换为 tab 分隔的 CSV 文本
            const jsonData: string[][] = [];
            worksheet.eachRow({ includeEmpty: true }, (row) => {
                // 检查 row.values 是否存在且是数组
                const values = row.values;
                if (!values || !Array.isArray(values)) {
                    jsonData.push([]); // 空行添加空数组
                    return;
                }

                const rowData = values.slice(1).map((cell: ExcelJS.CellValue) => {
                    if (cell === null || cell === undefined) {
                        return '';
                    }
                    const cellStr = String(cell).replace(/\t/g, ' ').replace(/\n/g, ' ');
                    return cellStr;
                });
                jsonData.push(rowData);
            });

            // 转换为 tab 分隔的 CSV 文本
            const csvText = jsonData
                .map(row => row.join('\t'))
                .join('\n');

            // 检查是否生成了有效内容
            if (!csvText) {
                return `Excel 文件 ${filePath} 为空或无有效数据。`;
            }

            return csvText;
        } catch (error) {
            // 显式声明 error 类型
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`读取 Excel 文件失败: ${errorMessage}`);
            return `错误: 无法读取 ${filePath}，请检查文件路径、格式或权限。`;
        }
    },
};

registerTool(excelToCsv);

/*
// 读取 PDF 文件并提取文本内容的工具
export const readPdf: Tool = {
    name: 'read_pdf',
    description: `读取指定路径的 PDF 文件并提取其文本内容，输出为纯文本字符串。
适用于需要从 PDF 文档中提取信息的场景，例如文档分析、内容搜索或文本处理。

使用场景:
- 文档提取: 用户提供 PDF 文件路径，想获取其中的文本内容（如文章、报告）。
- 内容分析: 提取 PDF 文本以进行关键词搜索或总结。
- 自动化处理: 将 PDF 内容转换为纯文本以供其他工具或系统使用。

具体示例:
用户输入: “./docs/report.pdf”
工具返回: “报告标题\n第一段内容...\n第二段内容...”

如何使用:
- 参数: 一个包含 PDF 文件路径的字符串（相对或绝对路径）。
- 返回: PDF 文件的文本内容，格式为纯文本字符串。`,
    parameters: {
        type: 'object',
        properties: {
            filePath: {
                type: 'string',
                description: 'PDF 文件的路径（.pdf，相对或绝对路径）',
            },
        },
        required: ['filePath'],
    },
    function: ({ filePath }: { filePath: string }) => {
        // 显示正在处理的提示
        vscode.window.showInformationMessage(`正在读取 PDF 文件 ${filePath}`);
    
        // 解析路径，处理相对路径
        const resolvedPath = path.resolve(filePath);
    
        // 使用 Promise 链式调用
        return fs.readFile(resolvedPath)
            .then(fileBuffer => pdfParse(fileBuffer))
            .then(pdfData => {
                // 获取文本内容
                let textContent = pdfData.text.trim();
    
                // 清理多余的空白和换行
                textContent = textContent.replace(/\s+/g, ' ').replace(/\n+/g, '\n').trim();
    
                // 检查是否提取到有效内容
                if (!textContent) {
                    return `PDF 文件 ${filePath} 为空或无有效文本内容。`;
                }
    
                return textContent;
            })
            .catch(error => {
                vscode.window.showErrorMessage(`读取 PDF 文件失败: ${error.message}`);
                return `错误: 无法读取 ${filePath}，请检查文件路径、格式或权限。`;
            });
    },
};

registerTool(readPdf);
*/

// 9. 提取前5个Error信息
export const diagnosticTop5Errors: Tool = {
    name: 'diagnostic_top5_errors',
    description: `从 VSCode Problems 面板中提取当前工程前5条错误信息，并组织成 JSON 返回。

使用场景:

代码检查：快速收集当前最重要的编译/类型错误。
问题分析：在提交代码前，了解主要报错内容。

具体示例:
用户说：“列出我项目里最严重的前几个错误。”
调用 diagnostic_top5_errors，无需额外参数，返回：
[
    { "file": "xxx.ts", "line": 10, "character": 5, "message": "xxx" },
    ...
]`,
    parameters: {
        type: 'object',
        properties: {},
        required: [],
    },
    function: async (_args: {}) => {
        vscode.window.showInformationMessage('CodeReDesign 正在提取Problems中的错误信息');

        try
        {
            const arrResult: IErrorInfo[] = [];
            const arrDiagnostics: [vscode.Uri, vscode.Diagnostic[]][] = vscode.languages.getDiagnostics();

            for (const [objUri, arrDiagList] of arrDiagnostics)
            {
                for (const objDiagnostic of arrDiagList)
                {
                    if (objDiagnostic.severity === vscode.DiagnosticSeverity.Error)
                    {
                        const objErrorInfo: IErrorInfo =
                        {
                            strFilePath: objUri.fsPath,
                            nLine: objDiagnostic.range.start.line + 1,
                            nCharacter: objDiagnostic.range.start.character + 1,
                            strMessage: objDiagnostic.message
                        };

                        arrResult.push(objErrorInfo);

                        if (arrResult.length >= 5)
                        {
                            return JSON.stringify(arrResult, null, 4);
                        }
                    }
                }
            }

            return JSON.stringify(arrResult, null, 4);
        }
        catch (error: any)
        {
            return `提取失败: ${error.message}`;
        }
    },
};

// 定义接口，供上面使用
interface IErrorInfo
{
    strFilePath: string
    nLine: number
    nCharacter: number
    strMessage: string
}

// 注册工具
registerTool(diagnosticTop5Errors);

// 12. 沙盒执行 Lua/Python 代码
export const sandboxRun: Tool = {
    name: 'sandbox_run',
    description: `在沙盒环境中执行 Lua、Python、Node.js、TypeScript 或 WSL Bash 代码，并返回标准输出、标准错误。禁止访问文件系统。
    让你在沙盒里执行主要是要验证语法错误和执行结果。如果出错或者有输出，你应该先把这些信息提供给我，然后再做分析。方便我观察你做的怎么样`,
    parameters: {
        type: 'object',
        properties: {
            language: { type: 'string', description: '执行语言（lua、python、nodejs、typescript、bash）' },
            code: { type: 'string', description: '要执行的代码内容。' },
            input: { type: 'string', description: '可选的标准输入内容（stdin）。' }
        },
        required: ['language', 'code'],
    },
    function: async (args: { language: 'lua' | 'python' | 'nodejs' | 'typescript' | 'bash'; code: string; input?: string }) =>
    {
        const strLanguage: string = args.language;
        const strCode: string = args.code;
        const strInput: string = args.input ?? '';

        try
        {
            // 简单敏感词检测
            const arrForbidden: string[] = [
                'os.', 'io.', 'open(', 'require(', 'import os', 'import shutil',
                'fs.', 'child_process', 'process.', 'import fs', 'import child_process', 'import process'
            ];
            for (const strBad of arrForbidden)
            {
                if (strCode.includes(strBad))
                {
                    return `安全警告：代码中包含禁止的调用 (${strBad})`;
                }
            }

            let strCommand: string = '';
            let arrArgs: string[] = [];

            if (strLanguage === 'lua')
            {
                strCommand = 'lua';
                arrArgs = ['-e', strCode];
            }
            else if (strLanguage === 'python')
            {
                strCommand = 'python';
                arrArgs = ['-c', strCode];
            }
            else if (strLanguage === 'nodejs')
            {
                strCommand = 'node';
                arrArgs = ['-e', strCode];
            }
            else if (strLanguage === 'typescript')
            {
                strCommand = 'ts-node';
                arrArgs = ['-e', strCode];
            }
            else if (strLanguage === 'bash')
            {
                strCommand = 'wsl';
                arrArgs = ['bash', '-c', strCode];
            }
            else
            {
                return `不支持的语言类型: ${strLanguage}`;
            }

            return await new Promise<string>((resolve, reject) =>
            {
                const objChild = childProcess.spawn(strCommand, arrArgs, { stdio: ['pipe', 'pipe', 'pipe'] });

                let strStdout: string = '';
                let strStderr: string = '';

                objChild.stdout.on('data', (data) => {
                    strStdout += data.toString();
                });

                objChild.stderr.on('data', (data) => {
                    strStderr += data.toString();
                });

                objChild.on('error', (error) => {
                    reject(`执行出错: ${error.message}`);
                });

                objChild.on('close', (code) => {
                    resolve(JSON.stringify({
                        exitCode: code,
                        stdout: strStdout.trim(),
                        stderr: strStderr.trim(),
                    }, null, 4));
                });

                // 写入标准输入
                if (strInput.length > 0)
                {
                    objChild.stdin.write(strInput);
                }
                objChild.stdin.end();

                // 超时保护（3秒）
                setTimeout(() => {
                    objChild.kill('SIGKILL');
                }, 3000);
            });
        }
        catch (error: any)
        {
            return `沙盒执行失败: ${error.message}`;
        }
    },
};

registerTool(sandboxRun);


/** Ping 工具 */
export const ping: Tool = {
    name: 'ping',
    description: `在 Windows 系统中使用 ping 命令测试网络连通性。适用于需要确认目标主机是否可达的场景。

使用场景:
- 网络诊断: 测试网络连通性，确保目标主机在线。
- 自动化脚本: 在脚本中进行网络健康检查。

如何使用:
- 参数: 一个字符串，表示目标主机名或 IP 地址。
- 返回: ping 的结果，包含每个响应的 RTT 时间。`,
    parameters: {
        type: 'object',
        properties: {
            target: {
                type: 'string',
                description: '目标主机名或 IP 地址。',
            },
        },
        required: ['target'],
    },
    function: async ({ target }: { target: string }) => {
        try {
            // 执行 ping 命令
            const { stdout, stderr } = await execPromise(`ping -n 4 ${target}`);

            // 处理并返回结果
            if (stderr) {
                return `错误: ${stderr}`;
            }
            return `Ping 结果: \n${stdout}`;
        } catch (error) {
            return `Ping 执行失败: ${(error as Error).message}`;
        }
    },
};

/** Telnet 工具 (通过 PowerShell Test-NetConnection) */
export const telnet: Tool = {
    name: 'telnet',
    description: `在 Windows 中测试 TCP 端口连通性（使用 PowerShell）。适用于确认目标端口是否可用。

使用场景:
- 网络诊断: 确认目标主机上的服务是否在指定端口上运行。
- 自动化脚本: 在脚本中进行端口健康检查。

如何使用:
- 参数: 主机名或 IP 地址，以及端口号。
- 返回: 端口连接的测试结果。`,
    parameters: {
        type: 'object',
        properties: {
            host: {
                type: 'string',
                description: '目标主机名或 IP 地址。',
            },
            port: {
                type: 'string',
                description: '目标端口号。',
            },
        },
        required: ['host', 'port'],
    },
    function: async ({ host, port }: { host: string; port: string }) => {
        try {
            // 执行 Telnet 命令（通过 PowerShell）
            const script = `Test-NetConnection -ComputerName "${host}" -Port ${port} | Format-List`;
            const { stdout, stderr } = await execPromise(`powershell -Command "${script}"`);

            // 处理并返回结果
            if (stderr) {
                return `错误: ${stderr}`;
            }
            return `Telnet 结果: \n${stdout}`;
        } catch (error) {
            return `Telnet 执行失败: ${(error as Error).message}`;
        }
    },
};

/** Nslookup 工具 */
export const nslookup: Tool = {
    name: 'nslookup',
    description: `在 Windows 中查询域名解析记录。适用于获取 DNS 解析信息。

使用场景:
- 网络诊断: 查询某个域名的 DNS 记录。
- 自动化脚本: 在脚本中获取域名的解析记录，判断域名是否有效。

如何使用:
- 参数: 需要查询的域名。
- 返回: 查询的 DNS 记录信息。`,
    parameters: {
        type: 'object',
        properties: {
            domain: {
                type: 'string',
                description: '要查询的域名。',
            },
        },
        required: ['domain'],
    },
    function: async ({ domain }: { domain: string }) => {
        try {
            // 执行 Nslookup 命令
            const { stdout, stderr } = await execPromise(`nslookup ${domain}`);

            // 处理并返回结果
            if (stderr) {
                return `错误: ${stderr}`;
            }
            return `Nslookup 结果: \n${stdout}`;
        } catch (error) {
            return `Nslookup 执行失败: ${(error as Error).message}`;
        }
    },
};

/** 执行命令并返回 Promise */
function execPromise(command: string): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                reject(error);
            } else {
                resolve({ stdout, stderr });
            }
        });
    });
}

// 获取VSCode工作区路径工具
export const getVsCodeWorkspacePath: Tool = {
    name: 'get_vscode_workspace_path',
    description: `获取当前VSCode工作区根目录的绝对路径。支持单工作区和多工作区模式。
当工作区包含多个根目录时，返回所有路径的列表。适用于需要定位项目根目录或验证工作区配置的场景。

使用场景:
- 需要确定当前项目的绝对路径
- 处理多工作区项目时需要所有根路径
- 自动化脚本需要基于工作区路径进行文件操作
- 调试时验证环境路径是否正确

示例:
1. 单工作区 -> "/User/projects/web-app"
2. 多工作区 -> "/User/projects/frontend; /User/projects/backend"
3. 未打开工作区 -> "当前未打开任何工作区目录"`,

    // 不需要输入参数
    parameters: {
        type: 'object',
        properties: {},
        required: []
    },

    function: async () => {
        try {
            // 获取工作区文件夹配置
            const workspaceFolders = vscode.workspace.workspaceFolders;

            // 处理未打开工作区的情况
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return "当前未打开任何工作区目录";
            }

            // 处理多工作区路径格式化
            const pathList = workspaceFolders.map(folder => {
                // 确保返回绝对路径
                const rawPath = folder.uri.fsPath;
                
                // 处理Windows路径的反斜杠问题
                return process.platform === 'win32' 
                    ? rawPath.replace(/\\/g, '/')  // 统一转换为正斜杠
                    : path.resolve(rawPath);       // Linux/macOS直接解析
            });

            // 去重处理（防止异常配置）
            const uniquePaths = Array.from(new Set(pathList));

            return uniquePaths.join('; ');
        } catch (error) {
            // 错误处理流程
            const errorMessage = (error as Error).message;
            vscode.window.showErrorMessage(`路径获取失败: ${errorMessage}`);
            
            // 返回结构化的错误信息
            return `ERROR: 无法获取工作区路径 (${errorMessage})`;
        }
    }
};

registerTool(getVsCodeWorkspacePath);


