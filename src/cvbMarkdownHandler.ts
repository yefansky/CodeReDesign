import * as vscode from 'vscode';

export function setupCvbAsMarkdown(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration('codeReDesign');
    const treatCvbAsMarkdown = config.get('treatCvbAsMarkdown', true);

    const originalLanguages: { [key: string]: string } = {};

    function setLanguageForCvbDocuments(enabled: boolean) {
        vscode.workspace.textDocuments.forEach(doc => {
            if (doc.fileName.endsWith('.cvb')) {
                if (enabled) {
                    originalLanguages[doc.uri.toString()] = doc.languageId;
                    vscode.languages.setTextDocumentLanguage(doc, 'markdown');
                } else {
                    const originalLanguage = originalLanguages[doc.uri.toString()];
                    if (originalLanguage) {
                        vscode.languages.setTextDocumentLanguage(doc, originalLanguage);
                        delete originalLanguages[doc.uri.toString()];
                    }
                }
            }
        });
    }

    if (treatCvbAsMarkdown) {
        setLanguageForCvbDocuments(true);

        const openDocumentListener = vscode.workspace.onDidOpenTextDocument(document => {
            if (document.fileName.endsWith('.cvb')) {
                originalLanguages[document.uri.toString()] = document.languageId;
                vscode.languages.setTextDocumentLanguage(document, 'markdown');
            }
        });
        context.subscriptions.push(openDocumentListener);
    }

    config.onDidChange((e: vscode.ConfigurationChangeEvent) => {
        if (e.affectsConfiguration('codeReDesign.treatCvbAsMarkdown')) {
            const newValue = config.get('treatCvbAsMarkdown', true);
            setLanguageForCvbDocuments(newValue);
        }
    }, null, context.subscriptions);
}