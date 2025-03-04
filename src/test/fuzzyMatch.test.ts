import * as assert from 'assert';
import * as vscode from 'vscode';
import { applyGlobalReplace, normalizeInput } from '../cvbManager';

// 定义 GlobalReplaceOperation 接口

// 抽象操作类，使用匈牙利命名法
abstract class TcvbOperation {
    constructor(
      public readonly m_strFilePath: string,
      public readonly m_strType: "exact-replace" | "global-replace" | "create"
    ) {}
  }
  
  // 2. 全局替换操作（GLOBAL-REPLACE）
class GlobalReplaceOperation extends TcvbOperation {
    public m_strOldContent: string;
    public m_strNewContent: string;

    constructor(
        m_strFilePath: string,
        m_strOldContent: string,
        m_strNewContent: string
    ) {
        super(m_strFilePath, "global-replace");
        this.m_strOldContent = normalizeInput(m_strOldContent);
        this.m_strNewContent = normalizeInput(m_strNewContent);
    }
}

// 函数：规范化 GlobalReplaceOperation 实例的成员
function normalizeData(operation: GlobalReplaceOperation): GlobalReplaceOperation {
    operation.m_strOldContent = normalizeInput(operation.m_strOldContent);
    operation.m_strNewContent = normalizeInput(operation.m_strNewContent);
    return operation;
}
  
suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    // 测试用例 1：多行上下文替换（带有相似代码块）
    test('Multi-line replacement with similar code block', () => {
        const content = `
function calculateSum(a, b) {
    let sum = 0;
    sum += a;
    sum += b;
    return sum;
}

function calculateProduct(a, b) {
    let product = 1;
    product *= a;
    product *= b;
    return product;
}
        `;
        const op: GlobalReplaceOperation = {
            m_strType: "global-replace",
            m_strFilePath: 'test.js',
            m_strOldContent: `
let sum = 0;
sum += a;
sum += b;
            `,
            m_strNewContent: `
const sum = a + b;
`
        };
        const expected = `
function calculateSum(a, b) {
    const sum = a + b;
    return sum;
}

function calculateProduct(a, b) {
    let product = 1;
    product *= a;
    product *= b;
    return product;
}
        `;
        const result = applyGlobalReplace(content, normalizeData(op));
        assert.strictEqual(result.trim(), expected.trim());
    });

    // 测试用例 2：多行上下文替换（带有轻微差异的诱饵）
    test('Multi-line replacement with slightly different decoy', () => {
        const content = `
class MathOperations {
    add(a, b) {
        return a + b;
    }

    subtract(a, b) {
        return a - b;
    }

    multiply(a, b) {
        return a * b;
    }
}
        `;
        const op: GlobalReplaceOperation = {
            m_strType: "global-replace",
            m_strFilePath: 'test.js',
            m_strOldContent: `
add(a, b) {
    return a + b;
}
            `,
            m_strNewContent: `
add(a, b) {
    console.log('Adding', a, b);
    return a + b;
}
            `
        };
        const expected = `
class MathOperations {
    add(a, b) {
        console.log('Adding', a, b);
        return a + b;
    }

    subtract(a, b) {
        return a - b;
    }

    multiply(a, b) {
        return a * b;
    }
}
        `;
        const result = applyGlobalReplace(content, normalizeData(op));
        assert.strictEqual(result.trim(), expected.trim());
    });

    // 测试用例 3：模糊匹配多行代码（格式差异的诱饵）
    test('Fuzzy multi-line replacement with format differences', () => {
        const content = `
function processData(data) {
    if (data.length > 0) {
        console.log("Processing...");
        data.forEach(item => {
            console.log(item);
        });
    }
}
        `;
        const op: GlobalReplaceOperation = {
            m_strType: "global-replace",
            m_strFilePath: 'test.js',
            m_strOldContent: `
if (data.length > 0) {
console.log("Processing...");
data.forEach(item => {
console.log(item);
});
}
            `,
            m_strNewContent: `
if (data && data.length > 0) {
    console.log("Starting processing...");
    data.forEach(item => console.log(item));
}
            `
        };
        const expected = `
function processData(data) {
    if (data && data.length > 0) {
        console.log("Starting processing...");
        data.forEach(item => console.log(item));
    }
}
        `;
        const result = applyGlobalReplace(content, normalizeData(op));
        assert.strictEqual(result.trim(), expected.trim());
    });

    // 测试用例 4：多处相似代码块（全局替换的诱饵）应该采用最短编辑距离选择最相似的
    test('Multiple similar code blocks with global replacement', () => {
        const content = `
function logMessage(message) {
    console.log(message);
}

function logError(error) {
    console.log(error);
}

function logWarning(warning) {
    console.log(warning);
}
        `;
        const op: GlobalReplaceOperation = {
            m_strType: "global-replace",
            m_strFilePath: 'test.js',
            m_strOldContent: `
console.log(warn);
            `,
            m_strNewContent: `
console.warn(warning);
            `
        };
        const expected = `
function logMessage(message) {
    console.log(message);
}

function logError(error) {
    console.log(error);
}

function logWarning(warning) {
    console.warn(warning);
}
        `;
        const result = applyGlobalReplace(content, normalizeData(op));
        assert.strictEqual(result.trim(), expected.trim());
    });

    // 测试用例 5：无法匹配（诱饵干扰）
    test('No match with decoy interference throws error', () => {
        const content = `
function compute(a, b) {
    return a * b;
}

function anotherCompute(a, b) {
    return a / b;
}
        `;
        const op: GlobalReplaceOperation = {
            m_strType: "global-replace",
            m_strFilePath: 'test.js',
            m_strOldContent: `
return a + b;
            `,
            m_strNewContent: `
return a - b;
            `
        };
        assert.throws(() => {
            applyGlobalReplace(content, normalizeData(op));
        }, /GLOBAL-REPLACE 失败：FILE:"test.js" 中未找到OLD_CONTENT/);
    });

    // 额外测试：空旧内容抛出错误
    test('Empty old content throws error', () => {
        const content = `
function empty() {}
        `;
        const op: GlobalReplaceOperation = {
            m_strType: "global-replace",
            m_strFilePath: 'test.js',
            m_strOldContent: '',
            m_strNewContent: 'some content'
        };
        assert.throws(() => {
            applyGlobalReplace(content, normalizeData(op));
        }, /GLOBAL-REPLACE 失败：FILE:"test.js" OLD_CONTENT 是空的/);
    });
});