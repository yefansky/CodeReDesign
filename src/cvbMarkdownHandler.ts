import * as vscode from 'vscode';

export function setupCvbAsMarkdown(context: vscode.ExtensionContext) {
    // 获取配置
    const config = vscode.workspace.getConfiguration('codeReDesign');
    const treatCvbAsMarkdown = config.get('treatCvbAsMarkdown', true);

    // 用于存储原始语言模式
    const originalLanguages: { [key: string]: string } = {};

    /**
     * 设置 .cvb 文件的语言模式
     * @param enabled 是否将 .cvb 文件视为 Markdown
     */
    function setLanguageForCvbDocuments(enabled: boolean) {
        vscode.workspace.textDocuments.forEach(doc => {
            if (doc.fileName.endsWith('.cvb')) {
                if (enabled) {
                    // 保存原始语言模式
                    originalLanguages[doc.uri.toString()] = doc.languageId;
                    // 设置为 Markdown
                    vscode.languages.setTextDocumentLanguage(doc, 'markdown');
                } else {
                    // 恢复原始语言模式
                    const originalLanguage = originalLanguages[doc.uri.toString()];
                    if (originalLanguage) {
                        vscode.languages.setTextDocumentLanguage(doc, originalLanguage);
                        delete originalLanguages[doc.uri.toString()];
                    }
                }
            }
        });
    }

    // 初始化时设置语言模式
    if (treatCvbAsMarkdown) {
        setLanguageForCvbDocuments(true);
    }

    // 监听文件打开事件
    const openDocumentListener = vscode.workspace.onDidOpenTextDocument(document => {
        if (document.fileName.endsWith('.cvb') && treatCvbAsMarkdown) {
            originalLanguages[document.uri.toString()] = document.languageId;
            vscode.languages.setTextDocumentLanguage(document, 'markdown');
        }
    });
    context.subscriptions.push(openDocumentListener);

    // 监听配置变化
    const configChangeListener = vscode.workspace.onDidChangeConfiguration((e: vscode.ConfigurationChangeEvent) => {
        if (e.affectsConfiguration('codeReDesign.treatCvbAsMarkdown')) {
            const newValue = config.get('treatCvbAsMarkdown', true);
            setLanguageForCvbDocuments(newValue);
        }
    });
    context.subscriptions.push(configChangeListener);
}