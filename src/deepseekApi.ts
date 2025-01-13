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
 * 调用 DeepSeek API 发送请求
 * @param cvbContent CVB 文件内容
 * @param userRequest 用户输入的重构需求
 * @returns API 返回的 CVB 内容
 */
export async function callDeepSeekApi(cvbContent: string, userRequest: string): Promise<string | null> {
    const apiKey = getDeepSeekApiKey();
    if (!apiKey) {
        return null;
    }

    try {
        // 初始化 OpenAI 客户端
        const openai = new OpenAI({
            apiKey: apiKey,
            baseURL: 'https://api.deepseek.com',
        });

        // 拼接请求内容
        const requestContent = `
用户输入请求：
${userRequest}

${getCvbFormatDescription()}

请读取以下 CVB 格式内容，按照请求重新输出一个 CVB：
${cvbContent}
`;

        // 调用 DeepSeek API
        const response = await openai.chat.completions.create({
            model: 'deepseek-chat',
            messages: [
                { role: 'system', content: 'You are a helpful assistant.' },
                { role: 'user', content: requestContent },
            ],
        });

        // 返回 API 响应的 CVB 内容
        return response.choices[0].message.content;
    } catch (error) {
        vscode.window.showErrorMessage('Failed to call DeepSeek API: ' + (error as Error).message);
        return null;
    }
}