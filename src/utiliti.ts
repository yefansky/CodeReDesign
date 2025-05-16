import { ExtensionContext, ExtensionMode } from 'vscode';
import * as fs from 'fs/promises';
import * as iconv from 'iconv-lite';

let isDebugMode: boolean;
export function activate(context: ExtensionContext) {
    isDebugMode = context.extensionMode === ExtensionMode.Development;
}

/**
 * ��ȡ�ļ�����������루GBK��UTF-8 ��� BOM �� UTF-8��ת��Ϊ UTF-8 �ַ���
 * @param filePath �ļ�·��
 * @returns ת����� UTF-8 �ַ���
 * @throws ����޷���ȡ�ļ������ʧ�ܣ��׳�����
 */
export async function readFileAsUtf8(filePath: string): Promise<string> {
    try {
        // ��ȡ�ļ���ԭʼ Buffer
        const buffer = await fs.readFile(filePath);

        // ����Ƿ�Ϊ�� BOM �� UTF-8
        const isUtf8WithBom =
            buffer.length >= 3 &&
            buffer[0] === 0xEF &&
            buffer[1] === 0xBB &&
            buffer[2] === 0xBF;

        if (isUtf8WithBom) {
            // �Ƴ� BOM ����Ϊ UTF-8 ����
            return buffer.slice(3).toString('utf8');
        }

        // ������Ϊ UTF-8 ����
        try {
            // ����֤�Ƿ�����Ч�� UTF-8
            const utf8Text = buffer.toString('utf8');
            // �򵥵� UTF-8 ��Ч�Լ�飺���±����Ƚ�
            if (Buffer.from(utf8Text, 'utf8').equals(buffer)) {
                return utf8Text;
            }
        } catch (utf8Error) {
            // ��� UTF-8 ����ʧ�ܣ��������� GBK
        }

        // ������Ϊ GBK ����
        try {
            const gbkText = iconv.decode(buffer, 'gbk');
            return gbkText;
        } catch (gbkError) {
            throw new Error(`Failed to decode file as GBK: ${(gbkError as Error).message}`);
        }

    } catch (error) {
        throw new Error(`Failed to read file: ${(error as Error).message}`);
    }
}