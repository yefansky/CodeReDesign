import OpenAI from 'openai';
import * as vscode from 'vscode';
import { Cvb, TCVB } from './cvbManager';

/**
 * 获取 DeepSeek 模型配置
 * @returns { modelName: string, apiBaseURL: string }
 */
function getDeepSeekModelConfig(): { modelName: string, apiBaseURL: string, apiKey: string | null} {
    const config = vscode.workspace.getConfiguration('codeReDesign');
    const modelConfig = config.get<string>('modelConfig') || 'deepseek-chat';
    const apiKey = config.get<string>('deepSeekApiKey') || null;

    if (modelConfig === 'custom') {
        const customModelName = config.get<string>('customModelName') || '';
        const customApiBaseURL = config.get<string>('customApiBaseURL') || '';
        const apiKey = config.get<string>('customApiKey') || null;
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

/**
 * 调用 DeepSeek API
 * @param userContent 用户输入内容
 * @param systemContent 系统提示内容
 * @param outputChannel 输出通道，用于实时显示流式内容
 * @param streamMode 是否启用流式模式
 * @param endstring 结束字符串，用于检查输出是否包含特定字符串
 * @param abortSignal 用于中断请求的信号
 * @returns API 返回的完整内容
 */
async function callDeepSeekApi(
    userContent: string,
    systemContent: string = 'You are a helpful assistant.',
    outputChannel?: vscode.OutputChannel,
    streamMode: boolean = true,
    endstring?: string,
    abortSignal?: AbortSignal
): Promise<string | null> {
    const { modelName, apiBaseURL, apiKey } = getDeepSeekModelConfig();
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

        const messages_body: OpenAI.ChatCompletionMessageParam[] = [
            { role: 'system', content: systemContent },
            { role: 'user', content: userContent },
        ];
        let fullResponse = '';
        let maxAttempts = 5;
        let attempts = 0;

        vscode.window.showInformationMessage('开始上传DeepSeek API');

        while (attempts < maxAttempts) {
            attempts++;
            const response = await openai.chat.completions.create({
                model: modelName,
                messages: messages_body,
                stream: streamMode,
                max_tokens: 8192,
                temperature: 0
            });

            vscode.window.showInformationMessage('DeepSeek API 正在处理...');

            let chunkResponse = '';
            let finishReason: string | null = null;

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

            // 累积完整响应
            fullResponse += chunkResponse;

            // 检查终止条件
            const shouldContinue = 
                finishReason === 'length' || 
                (endstring && !fullResponse.includes(endstring));

            if (!shouldContinue) {break};

            if (abortSignal?.aborted) {
                throw new Error(userStopException);
            }

            vscode.window.showWarningMessage('超过最大Token数，正在重试...');

            // 准备下一次请求
            messages_body.push(
                { role: 'assistant', content: fullResponse },
                { role: 'user', content: '你的输出被截断了，请继续输出剩余部分, 不需要```做起始，直接继续输出纯cvb格式内容就行:' }
            );
        }

        // 最终检查
        if (endstring && !fullResponse.includes(endstring)) {
            vscode.window.showWarningMessage('响应未包含结束标记');
        }

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

这是 CVB 格式的说明:
${Cvb.getFormatDescription()}

这是 TCVB 格式的说明:
${TCVB.getFormatDescription()}

请读取以下 CVB 格式的代码，按照需求写代码，
注意：
如果我要你移动代码，其实是让你去修改原始代码，重新封装到新位置，所以不是让你简单的把代码拷贝到新为止
记住你是个代码重构助手
任何时候都要保证修改完的代码是完整的可执行的，不能有省略

最后的输出需要是 TCVB 格式， 
尤其注意，输出除了TCVB的正文内容以外，别的地方出现TCVB的开始符和结束符(比如一些关于TCVB的附加说明，或者正好字符串前缀和TCVB符号一样)要做转义，
以免接收的时候被错误的当成TCVB块（比如前面加入一些空格）
（注意,TCVB会被用来和原始的CVB合并成新CVB的，所以输出格式要准确，用于匹配的字符串要精确）

输入代码:
${cvbContent}

这是我的需求:
${userRequest}

请输出TCVB格式的代码:
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
        false
    );

    let summary = summaryResponse || '';
    console.log('Raw Summary:', summary);

    // 清理文件名
    summary = cleanFilename(summary);
    summary = summary.replace(/\s+/g, '')     // 去除所有空格
    summary = summary.replace(/^\.+|\.+$/g, ''); // 移除开头和结尾的点
    summary = summary.replace(/^ +| +$/g, '');   // 移除开头和结尾的空格
    summary = summary.substring(0, 15);           // 截取前15个字符

    if (summary.length === 0) {
        summary = 'summary';
    }

    return summary;
}