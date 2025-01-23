import OpenAI from 'openai';
import * as vscode from 'vscode';
import { getCvbFormatDescription } from './cvbManager';

/**
 * 获取 DeepSeek API Key
 * @returns DeepSeek API Key
 */
function getDeepSeekApiKey(): string | null {
    const apiKey = vscode.workspace.getConfiguration('codeReDesign').get<string>('deepSeekApiKey');
    if (!apiKey) {
        vscode.window.showErrorMessage('DeepSeek API Key is not configured. Please set it in the settings.');
        return null;
    }
    return apiKey;
}

async function callDeepSeekApi(
    userContent: string,
    systemContent: string = 'You are a helpful assistant.',
    outputChannel?: vscode.OutputChannel,
    streamMode: boolean = true
): Promise<string | null> {
    const apiKey = getDeepSeekApiKey();
    if (!apiKey) {
        return null;
    }

    try {
        const openai = new OpenAI({
            apiKey: apiKey,
            baseURL: 'https://api.deepseek.com',
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
        let continueResponse = true;

        while (continueResponse) {
            const response = await openai.chat.completions.create({
                model: 'deepseek-chat',
                messages: messages_body,
                stream: streamMode,
                max_tokens: 8192,
                temperature: 0
            });

            if (streamMode) {
                let lastChunk: any = null;
                for await (const chunk of response as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>) {
                    const content = chunk.choices[0]?.delta?.content || '';
                    fullResponse += content;
                    if (outputChannel) {
                        outputChannel.append(content);
                    }
                    lastChunk = chunk;
                }
                // 检查最后的 finish_reason
                if (lastChunk && lastChunk.choices[0].finish_reason === 'length') {
                    // 需要继续
                    messages_body.push({ role: 'user', content: 'Please continue.' });
                } else {
                    continueResponse = false;
                }
            } else {
                fullResponse = (response as OpenAI.Chat.Completions.ChatCompletion).choices[0].message.content || "";
                if (outputChannel) {
                    outputChannel.append(fullResponse);
                }
                if ((response as OpenAI.Chat.Completions.ChatCompletion).choices[0].finish_reason === 'length') {
                    // 需要继续
                    messages_body.push({ role: 'user', content: 'Please continue.' });
                } else {
                    continueResponse = false;
                }
            }
        }

        return fullResponse;

    } catch (error) {
        vscode.window.showErrorMessage('Failed to call DeepSeek API: ' + (error as Error).message);
        return null;
    }
}

/**
 * 应用代码重构功能
 * @param cvbContent CVB 文件内容
 * @param userRequest 用户输入的重构需求
 * @param outputChannel 输出通道，用于实时显示流式内容
 * @returns API 返回的完整 CVB 内容
 */
export async function queryCodeReDesign(
    cvbContent: string,
    userRequest: string,
    outputChannel: vscode.OutputChannel
): Promise<string | null> {
    const requestContent = `
这是我的需求:
${userRequest}

这是 CVB 格式的说明:
${getCvbFormatDescription()}

请读取以下 CVB 格式的代码，按照需求写代码，
注意：
如果我要你移动代码，其实是让你去修改原始代码，重新封装到新位置，所以不是让你简单的把代码拷贝到新为止
记住你是个代码重构助手
任何时候都要保证修改完的代码是完整的可执行的，不能有省略

最后的输出需要时 CVB 格式， （注意要完整输出所有文件，不管是否有修改，CVB是一个当前所有文件的快照，所以你不能偷懒）:
${cvbContent}
`;

    return callDeepSeekApi(requestContent, undefined, outputChannel, true);
}

function cleanFilename(str: string) {
    // Replace invalid filename characters for Windows with underscores
    return str.replace(/[\\/:*?"<>|]/g, '_');
}

export async function generateFilenameFromRequest(userRequest: string): Promise<string> {
    const summaryResponse = await callDeepSeekApi(
        `请简单概括一下需求，输出字符串作为文件名。如果描述里有版本名称，这个名称一定要保留并放在开头。 需求："${userRequest}"`,
        '你是一个工具函数，接收请求，只返回纯结果，不要有附加说明.',
        undefined,
        false
    );

    let summary = summaryResponse || '';
    console.log('Raw Summary:', summary);

    // Clean the summary
    summary = cleanFilename(summary);
    summary = summary.replace(/^\.+|\.+$/g, ''); // Remove leading/trailing dots
    summary = summary.replace(/^ +| +$/g, '');   // Remove leading/trailing spaces
    summary = summary.substring(0, 15);           // Truncate to 15 characters

    if (summary.length === 0) {
        summary = 'summary';
    }

    return summary;
}

