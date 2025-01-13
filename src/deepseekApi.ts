import OpenAI from 'openai';
import * as vscode from 'vscode';
import { getCvbFormatDescription } from './cvbManager';

/**
 * ��ȡ DeepSeek API Key
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
 * ���� DeepSeek API ��������
 * @param cvbContent CVB �ļ�����
 * @param userRequest �û�������ع�����
 * @returns API ���ص� CVB ����
 */
export async function callDeepSeekApi(cvbContent: string, userRequest: string): Promise<string | null> {
    const apiKey = getDeepSeekApiKey();
    if (!apiKey) {
        return null;
    }

    try {
        // ��ʼ�� OpenAI �ͻ���
        const openai = new OpenAI({
            apiKey: apiKey,
            baseURL: 'https://api.deepseek.com',
        });

        // ƴ����������
        const requestContent = `
�û���������
${userRequest}

${getCvbFormatDescription()}

���ȡ���� CVB ��ʽ���ݣ����������������һ�� CVB��
${cvbContent}
`;

        // ���� DeepSeek API
        const response = await openai.chat.completions.create({
            model: 'deepseek-chat',
            messages: [
                { role: 'system', content: 'You are a helpful assistant.' },
                { role: 'user', content: requestContent },
            ],
        });

        // ���� API ��Ӧ�� CVB ����
        return response.choices[0].message.content;
    } catch (error) {
        vscode.window.showErrorMessage('Failed to call DeepSeek API: ' + (error as Error).message);
        return null;
    }
}