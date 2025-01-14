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

/**
 * 调用 DeepSeek API 发送请求（流式模式）
 * @param cvbContent CVB 文件内容
 * @param userRequest 用户输入的重构需求
 * @param outputChannel 输出通道，用于实时显示流式内容
 * @returns API 返回的完整 CVB 内容
 */
export async function callDeepSeekApi(
    cvbContent: string,
    userRequest: string,
    outputChannel: vscode.OutputChannel
): Promise<string | null> {
    const apiKey = getDeepSeekApiKey();
    if (!apiKey) {
        return null;
    }

    try {
        // 初始化 OpenAI 客户端
        const openai = new OpenAI({
            apiKey: apiKey,
            baseURL: 'https://api.deepseek.com', // 使用 DeepSeek 的 API 地址
        });

        // 拼接请求内容
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

        // 清空输出通道并显示
        outputChannel.clear();
        outputChannel.show();

        // 调用 DeepSeek API（流式模式）
        const stream = await openai.chat.completions.create({
            model: 'deepseek-chat', // 使用 DeepSeek 的模型
            messages: [
                { role: 'system', content: 'You are a helpful assistant.' },
                { role: 'user', content: requestContent },
            ],
            stream: true, // 启用流式模式
            max_tokens: 8192,
            temperature: 0
        });

        let fullResponse = '';
        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || '';
            fullResponse += content;
            outputChannel.append(content); // 实时输出到通道
        }

        // 返回完整的 API 响应内容
        return fullResponse;
    } catch (error) {
        vscode.window.showErrorMessage('Failed to call DeepSeek API: ' + (error as Error).message);
        return null;
    }
}