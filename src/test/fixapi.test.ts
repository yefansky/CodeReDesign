import * as assert from 'assert';
import * as vscode from 'vscode';
import * as cvbMgr from '../cvbManager';
import * as fs from "fs";

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    test('testmerge', () => {
        const cvbFilePath = "test/";
        let cvbContent = fs.readFileSync(cvbFilePath, 'utf-8');
    });
});