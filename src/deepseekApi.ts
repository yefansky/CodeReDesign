import OpenAI from 'openai';
import * as vscode from 'vscode';
import { Cvb, TCVB } from './cvbManager';

/**
 * 获取 DeepSeek 模型配置
 * @returns { modelName: string, apiBaseURL: string }
 */
function getDeepSeekModelConfig(needFast: boolean = false): { modelName: string, apiBaseURL: string, apiKey: string | null} {
    const config = vscode.workspace.getConfiguration('codeReDesign');
    let modelConfig = config.get<string>('modelConfig') || 'deepseek-chat';
    const apiKey = config.get<string>('deepSeekApiKey') || null;

    if (needFast) {
        let fastModelConfig = config.get<string>('fastModelConfig');
        if (fastModelConfig){
            modelConfig = fastModelConfig;
        }
    }

    if (modelConfig.startsWith('custom')) {
        const customModelName = config.get<string>(`${modelConfig}ModelName`) || '';
        const customApiBaseURL = config.get<string>(`${modelConfig}BaseURL`) || '';
        const apiKey = config.get<string>(`${modelConfig}APIKey`) || null;
        return {
            modelName: customModelName,
            apiBaseURL: customApiBaseURL,
            apiKey: apiKey
        };
    }

    // 默认配置
    const defaultConfigs : { [key: string]: { modelName: string, apiBaseURL: string, apiKey: string | null} }  = {
        'deepseek-chat': {
            modelName: 'deepseek-chat',
            apiBaseURL: 'https://api.deepseek.com',
            apiKey
        },
        'deepseek-reasoner': {
            modelName: 'deepseek-reasoner',
            apiBaseURL: 'https://api.deepseek.com',
            apiKey
        }
    };

    return defaultConfigs[modelConfig] || defaultConfigs['deepseek-chat'];
}

let lastMessageBody : OpenAI.ChatCompletionMessageParam[];

export function GetLastMessageBody() : OpenAI.ChatCompletionMessageParam[] {
    return lastMessageBody;
}

/**
 * 调用 DeepSeek API
 * @param userContent 用户输入内容，可以是字符串或字符串数组
 * @param systemContent 系统提示内容
 * @param outputChannel 输出通道，用于实时显示流式内容
 * @param streamMode 是否启用流式模式
 * @param endstring 结束字符串，用于检查输出是否包含特定字符串
 * @param abortSignal 用于中断请求的信号
 * @returns API 返回的完整内容
 */
export async function callDeepSeekApi(
    userContent: string | {role:string, content: string}[],  // 修改为支持 string 或 string[]
    systemContent: string = 'You are a helpful assistant.',
    outputChannel?: vscode.OutputChannel,
    streamMode: boolean = true,
    endstring?: string,
    abortSignal?: AbortSignal,
    needFast: boolean = false
): Promise<string | null> {
    const { modelName, apiBaseURL, apiKey } = getDeepSeekModelConfig(needFast);
    const userStopException = 'operation stop by user';

    if (!apiKey) {
        vscode.window.showErrorMessage('DeepSeek API Key is not configured. Please set it in the settings.');
        return null;
    }

    if (!modelName || !apiBaseURL) {
        vscode.window.showErrorMessage('DeepSeek Model Name or API Base URL is not configured.');
        return null;
    }

    try {
        const openai = new OpenAI({
            apiKey: apiKey,
            baseURL: apiBaseURL,
        });

        if (outputChannel) {
            outputChannel.clear();
            outputChannel.show();
        }

        let fullResponse = '';
        let maxAttempts = 5;
        let attempts = 0;
        let maxToken = 1024 * 8;
        let temperature = 0;

        let systemPromot : OpenAI.ChatCompletionMessageParam = {role : "system",  content: systemContent};

        if (/r1|reasoner/i.test(modelName)) {
            temperature = 0.6;
            systemPromot = {role : "user",  content: systemContent};
        }

        // 构造消息体
        let messages_body: OpenAI.ChatCompletionMessageParam[] = [];
        if (Array.isArray(userContent)) {
            if (systemPromot.role === 'user') {
                userContent[0].content = systemPromot.content + "\n\n" + userContent[0].content;
            }
            else{
                messages_body.push(systemPromot);
            }

            {
                const role = (userContent[0].role === 'user') ? 'user' : 'assistant';
                messages_body.push({ role, content: userContent[0].content });
            }

            // 如果 userContent 是数组，按交替方式生成消息
            for (let i = 1; i < userContent.length; i++) {
                const role = (userContent[i].role === 'user') ? 'user' : 'assistant';
                messages_body.push({ role, content: userContent[i].content });
            }
        } else {

            if (systemPromot.role === 'user') {
                userContent = systemPromot.content + "\n\n" + userContent;
            }
            else{
                messages_body.push(systemPromot);
            }

            // 如果是单个字符串，默认是 'user' 角色
            messages_body.push({ role: 'user', content: userContent });
        }

        vscode.window.showInformationMessage('开始上传DeepSeek API');

        while (attempts < maxAttempts) {
            attempts++;
            const response = await openai.chat.completions.create({
                model: modelName,
                messages: messages_body,
                stream: streamMode,
                max_tokens: maxToken,
                temperature: temperature
            });
            let thinking = false;

            vscode.window.showInformationMessage('DeepSeek API 正在处理...');

            let chunkResponse = '';
            let finishReason: string | null = null;

            if (streamMode) {
                for await (const chunk of response as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>) {
                    if (abortSignal?.aborted) {
                        throw new Error(userStopException);
                    }
                    const content = chunk.choices[0]?.delta?.content || '';
                    const delta = chunk.choices[0]?.delta;
                    const think = ('reasoning_content' in delta! && delta.reasoning_content) as string || "";

                    if (!thinking && chunkResponse.length === 0 && think.length > 0){
                        if (outputChannel) {
                            outputChannel.append("<think>");
                        }
                        thinking = true;
                    }

                    chunkResponse += content;
                    if (outputChannel) {
                        outputChannel.append(content + think);
                    }

                    if (thinking && content.length > 0){
                        thinking = false;
                        if (outputChannel) {
                            outputChannel.append("</think>");
                        }
                    }

                    finishReason = chunk.choices[0]?.finish_reason || null;
                }
            } else {
                const completion = response as OpenAI.Chat.Completions.ChatCompletion;
                chunkResponse = completion.choices[0].message.content || "";
                finishReason = completion.choices[0].finish_reason || null;
                if (outputChannel) {
                    outputChannel.append(chunkResponse);
                }
            }

            // 累积完整响应
            fullResponse += chunkResponse;

            // 检查终止条件
            const shouldContinue = 
                finishReason === 'length' || 
                (endstring && !fullResponse.includes(endstring));

            if (!shouldContinue) {break;};

            if (abortSignal?.aborted) {
                throw new Error(userStopException);
            }

            vscode.window.showWarningMessage('超过最大Token数，正在重试...');

            // 准备下一次请求
            messages_body.push(
                { role: 'assistant', content: fullResponse },
                { role: 'user', content: '你的输出被截断了，请继续输出剩余部分, 不需要```做起始，直接继续输出纯内容，我要把你的输出直接拼到上一次的输出后面，所以输出开始不要有多余的内容:' }
            );
        }

        // 最终检查
        if (endstring && !fullResponse.includes(endstring)) {
            vscode.window.showWarningMessage('响应未包含结束标记');
        }

        messages_body.push({ role: 'assistant', content: fullResponse });
        lastMessageBody = messages_body;
        return fullResponse;

    } catch (error) {
        if (error instanceof Error && error.message === userStopException) {
            vscode.window.showInformationMessage('operation stop by user');
            return null;
        }
        vscode.window.showErrorMessage('API调用失败: ' + (error as Error).message);
        return null;
    }
}

export async function callDeepSeekFixApi(
    errorInfo: string,
    outputChannel?: vscode.OutputChannel,
    streamMode: boolean = true,
    abortSignal?: AbortSignal
): Promise<string | null> {
    const { modelName, apiBaseURL, apiKey } = getDeepSeekModelConfig(false);
    const userStopException = 'operation stop by user';

    if (!apiKey) {
        vscode.window.showErrorMessage('DeepSeek API Key is not configured. Please set it in the settings.');
        return null;
    }

    if (!modelName || !apiBaseURL) {
        vscode.window.showErrorMessage('DeepSeek Model Name or API Base URL is not configured.');
        return null;
    }

    const openai = new OpenAI({
        apiKey: apiKey,
        baseURL: apiBaseURL,
    });

    if (outputChannel) {
        outputChannel.clear();
        outputChannel.show();
    }

    let messages_body = lastMessageBody;

    messages_body.push(
        { role: 'user', content:`你以上提供的数据格式存在错误: ${errorInfo}。
请你仔细检查数据，分析并找出所有错误原因，并核实错误类型。请按照下面的格式输出，要求如下：

【第一步：错误原因分析】
请逐项列出所有错误原因，每项必须包括：
  1. 错误类型及原因描述（详细说明为何出错）
  2. 对应的文件路径（精确到文件）
  3. 错误的写法（直接引用错误代码，指明具体位置）
  4. 正确的写法（建议的修正代码，必须准确对应错误部分）
  
【第二步：最小改动修正】
在保证原有正确部分完整保留的前提下，仅对错误部分做最小改动。要求：
  - 详细说明每处改动的理由
  - 列出每个文件修改的具体位置和修改内容，确保不遗漏任何正确部分

【第三步：完整输出】
请输出最终修正后的完整数据，按照上一次要求的格式，严格输出。并注意：
  - 包含修正后的代码
  - 不要遗漏原有正确部分（完整输出，绝对不省略任何内容）
  
【第四步：总结说明】
在输出完完整数据后，请总结以上步骤，归纳错误原因和修改方案，并确认所有文件路径及代码位置均正确无误。

请严格按照以上步骤输出，确保先详细列出错误原因，再输出完整修正后的数据，不要只输出错误部分。
请不要输出 "其他部分保持原内容" 这样的描述性语句。请保证这一次代码一定能直接拿来编译成功，展现你的实力！不要再犯同样的错误，那样很丢人! 

`}
    );

    let fullResponse = '';
    let chunkResponse = '';
    let finishReason: string | null = null;

    vscode.window.showInformationMessage('开始上传DeepSeek API, 进行修复');

    const response = await openai.chat.completions.create({
        model: modelName,
        messages: messages_body,
        stream: streamMode,
        max_tokens: 8192,
        temperature: 0
    });

    if (streamMode) {
        for await (const chunk of response as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>) {
            if (abortSignal?.aborted) {
                throw new Error(userStopException);
            }
            const content = chunk.choices[0]?.delta?.content || '';
            chunkResponse += content;
            if (outputChannel) {
                outputChannel.append(content);
            }
            finishReason = chunk.choices[0]?.finish_reason || null;
        }
    } else {
        const completion = response as OpenAI.Chat.Completions.ChatCompletion;
        chunkResponse = completion.choices[0].message.content || "";
        finishReason = completion.choices[0].finish_reason || null;
        if (outputChannel) {
            outputChannel.append(chunkResponse);
        }
    }

    fullResponse = chunkResponse;

    messages_body.push({ role: 'assistant', content: fullResponse });
    lastMessageBody = messages_body;

    return fullResponse;
}

/**
 * 应用代码重构功能
 * @param cvbContent CVB 文件内容
 * @param userRequest 用户输入的重构需求
 * @param outputChannel 输出通道，用于实时显示流式内容
 * @param abortSignal 用于中断请求的信号
 * @returns API 返回的完整 CVB 内容
 */
export async function queryCodeReDesign(
    cvbContent: string,
    userRequest: string,
    outputChannel: vscode.OutputChannel,
    abortSignal?: AbortSignal
): Promise<string | null> {
    const requestContent = `
【格式说明】
- CVB 格式说明：${Cvb.getFormatDescription()}
- TCVB 格式说明：${TCVB.getFormatDescription()}

【任务说明】
请读取以下 CVB 格式代码，并根据需求修改代码。注意：
1. 如果需求涉及“移动代码”，请务必修改原始代码，将代码重新封装到新位置，而非简单复制；
2. 修改后的代码必须完整、可执行，不能有任何省略；
3. 输出内容必须严格遵守 TCVB 格式（仅正文部分含 TCVB 标记，其他地方如有 TCVB 开始或结束符需转义），以确保后续合并正确；
4. 注意不要将某文件的修改内容误认为是其他文件，请一条一条列出具体修改项及对应文件路径。

【输出要求】
1. 先输出你对需求及相关代码的理解，请按层级缩进列出笔记，便于整理思路；
2. 再输出详细的方案大纲，格式如下：
    需求理解:
        …
    查询资料:
        列出每个关键修改点所在的文件路径
    修改方案:
        文件路径1:
            描述修改点，避免用大块代码,注意只输出关键修改,不要太长, 不要加载无用的上下文。不要输出没有改动部分的代码
        文件路径2:
            描述修改点，同上
        …
    最后检查:
        对以上输出的方案大纲进行反思，重新阅读输入代码，结合以上方案大纲，逐条检查有没有和原文对不上的地方。检查方案是否完备、文件路径是否正确，设计思路是否无误，如有问题请提出修正意见
3. 请确保输出中既包含错误部分的修正说明，又完整保留原有正确部分，不得遗漏任何内容；
4. 用最小改动实现需求目的。

【输入部分】
- 输入代码：${cvbContent}
- 需求描述：${userRequest}

【最终输出】
请先输出思路与方案大纲，最后汇总输出符合 TCVB 格式的精确代码。
`;

    return callDeepSeekApi(requestContent, undefined, outputChannel, true, '## END_TCVB', abortSignal); // 添加结束字符串
}

/**
 * 分析代码
 * @param cvbContent CVB 文件内容
 * @param userRequest 用户输入的分析需求
 * @param outputChannel 输出通道，用于实时显示流式内容
 * @returns API 返回的分析结果
 */
export async function analyzeCode(
    cvbContent: string,
    userRequest: string,
    outputChannel: vscode.OutputChannel,
    abortSignal?: AbortSignal
): Promise<string | null> {
    const requestContent = `

这是 CVB 格式的说明:
${Cvb.getFormatDescription()}

请读取以下 CVB 格式的代码，按照需求进行分析，

输入代码:
${cvbContent}

这是我的需求:
${userRequest}

请输出分析结果:
`;

    return callDeepSeekApi(requestContent, "你是一个代码分析助手", outputChannel, true, undefined, abortSignal);
}

/**
 * 清理文件名
 * @param str 原始字符串
 * @returns 清理后的文件名
 */
function cleanFilename(str: string) {
    // 替换 Windows 文件名中的非法字符
    return str.replace(/[\\/:*?"<>|]/g, '_');
}

/**
 * 根据用户需求生成文件名
 * @param userRequest 用户需求
 * @returns 生成的文件名
 */
export async function generateFilenameFromRequest(userRequest: string): Promise<string> {
    if (userRequest.length < 16) {
        return cleanFilename(userRequest)
            .replace(/\s+/g, '')           // 去除所有空格
            .replace(/^\.+|\.+$/g, '');    // 移除开头和结尾的点
    }

    // 否则，调用 API 获取概括的文件名
    const summaryResponse = await callDeepSeekApi(
        `请简单概括一下需求，输出字符串作为文件名。如果描述里有版本名称，这个名称一定要保留并放在开头。 需求："${userRequest}"`,
        '你是一个工具函数，接收请求，只返回纯结果，不要有附加说明.',
        undefined,
        false,
        undefined, undefined,
        true
    );

    let summary = summaryResponse || '';
    console.log('Raw Summary:', summary);

    // 清理文件名
    summary = cleanFilename(summary);
    summary = summary.replace(/\s+/g, '');     // 去除所有空格
    summary = summary.replace(/^\.+|\.+$/g, ''); // 移除开头和结尾的点
    summary = summary.replace(/^ +| +$/g, '');   // 移除开头和结尾的空格
    summary = summary.substring(0, 15);           // 截取前15个字符

    if (summary.length === 0) {
        summary = 'summary';
    }

    return summary;
}