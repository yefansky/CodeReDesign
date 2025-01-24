import * as vscode from 'vscode';

export function setupCvbAsMarkdown(context: vscode.ExtensionContext) {
    // ��ȡ����
    const config = vscode.workspace.getConfiguration('codeReDesign');
    const treatCvbAsMarkdown = config.get('treatCvbAsMarkdown', true);

    // ���ڴ洢ԭʼ����ģʽ
    const originalLanguages: { [key: string]: string } = {};

    /**
     * ���� .cvb �ļ�������ģʽ
     * @param enabled �Ƿ� .cvb �ļ���Ϊ Markdown
     */
    function setLanguageForCvbDocuments(enabled: boolean) {
        vscode.workspace.textDocuments.forEach(doc => {
            if (doc.fileName.endsWith('.cvb')) {
                if (enabled) {
                    // ����ԭʼ����ģʽ
                    originalLanguages[doc.uri.toString()] = doc.languageId;
                    // ����Ϊ Markdown
                    vscode.languages.setTextDocumentLanguage(doc, 'markdown');
                } else {
                    // �ָ�ԭʼ����ģʽ
                    const originalLanguage = originalLanguages[doc.uri.toString()];
                    if (originalLanguage) {
                        vscode.languages.setTextDocumentLanguage(doc, originalLanguage);
                        delete originalLanguages[doc.uri.toString()];
                    }
                }
            }
        });
    }

    // ��ʼ��ʱ��������ģʽ
    if (treatCvbAsMarkdown) {
        setLanguageForCvbDocuments(true);
    }

    // �����ļ����¼�
    const openDocumentListener = vscode.workspace.onDidOpenTextDocument(document => {
        if (document.fileName.endsWith('.cvb') && treatCvbAsMarkdown) {
            originalLanguages[document.uri.toString()] = document.languageId;
            vscode.languages.setTextDocumentLanguage(document, 'markdown');
        }
    });
    context.subscriptions.push(openDocumentListener);

    // �������ñ仯
    const configChangeListener = vscode.workspace.onDidChangeConfiguration((e: vscode.ConfigurationChangeEvent) => {
        if (e.affectsConfiguration('codeReDesign.treatCvbAsMarkdown')) {
            const newValue = config.get('treatCvbAsMarkdown', true);
            setLanguageForCvbDocuments(newValue);
        }
    });
    context.subscriptions.push(configChangeListener);
}