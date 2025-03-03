import { ExtensionContext, ExtensionMode } from 'vscode';

let isDebugMode: boolean;
export function activate(context: ExtensionContext) {
    isDebugMode = context.extensionMode === ExtensionMode.Development;
}