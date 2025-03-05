import * as assert from 'assert';
import * as vscode from 'vscode';
import { applyGlobalReplace, normalizeInput, normalizeData } from '../cvbManager';
import * as fuzzyMatch from '../fuzzyMatch';

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
return aaa + bbb;
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
  
suite('Normalization Full Coverage Test Suite', () => 
{
    // 1. 测试 removeComments：多行混合注释的情况
    test('removeComments - 多行代码包含注释', () => 
    {
        const strInput: string = `function test() { // 这是一个函数
    let nValue = 10; // 这里初始化变量
    // 这是一整行注释
    return nValue; // 返回变量
} // 结束函数
`;

        const stResult = fuzzyMatch.removeComments(strInput);
        const strContent: string = stResult.content;
        const arrMapping: number[] = stResult.mapping;

        const strExpectedContent: string =
            "function test() { \n" +
            "    let nValue = 10; \n" +
            "    \n" +
            "    return nValue; \n" +
            "} \n";

        assert.strictEqual(strContent, strExpectedContent, "removeComments 多行内容不正确");
        assert.strictEqual(arrMapping.length, strExpectedContent.length, "removeComments 多行 mapping 长度不正确");
    });

    // 2. 测试 removeSymbolSpaces：符号前后空格
    test('removeSymbolSpaces - 符号前后带空格', () => 
    {
        const strInput: string = `a +  b
( x - y )
{ c *  d }`;
        const stResult = fuzzyMatch.removeSymbolSpaces(strInput);
        const strContent: string = stResult.content;
        const arrMapping: number[] = stResult.mapping;

        const strExpectedContent: string =
            "a+b\n" +
            "(x-y)\n" +
            "{c*d}";

        assert.strictEqual(strContent, strExpectedContent, "removeSymbolSpaces 符号空格去除不正确");
        assert.strictEqual(arrMapping.length, strExpectedContent.length, "removeSymbolSpaces mapping 长度不正确");
    });

    // 3. 测试 normalizeWhitespace：空白字符处理
    test('normalizeWhitespace - 处理换行符、tab 和连续空格', () => 
    {
        const strInput: string = `abc   def
ghi\t\tjkl
mno    pqr`;
        const stResult = fuzzyMatch.normalizeWhitespace(strInput);
        const strContent: string = stResult.content;
        const arrMapping: number[] = stResult.mapping;

        const strExpectedContent: string = "abc def\nghi jkl\nmno pqr";

        assert.strictEqual(strContent, strExpectedContent, "normalizeWhitespace 处理空白字符错误");
        assert.strictEqual(arrMapping.length, strExpectedContent.length, "normalizeWhitespace mapping 长度错误");
    });

    // 4. 测试 removeComments 对全是注释的代码
    test('removeComments - 代码全是注释', () => 
    {
        const strInput: string = `// 这是注释
// 这也是注释
// 还有注释
`;

        const stResult = fuzzyMatch.removeComments(strInput);
        const strContent: string = stResult.content;
        const arrMapping: number[] = stResult.mapping;

        const strExpectedContent: string = "\n\n\n";

        assert.strictEqual(strContent, strExpectedContent, "removeComments 全注释去除不正确");
        assert.strictEqual(arrMapping.length, strExpectedContent.length, "removeComments 全注释 mapping 错误");
    });

    // 5. 测试 normalizeWhitespace 处理连续换行
    test('normalizeWhitespace - 处理连续换行', () => 
    {
        const strInput: string = `abc


def`;
        const stResult = fuzzyMatch.normalizeWhitespace(strInput);
        const strContent: string = stResult.content;
        const arrMapping: number[] = stResult.mapping;

        const strExpectedContent: string = "abc\ndef";

        assert.strictEqual(strContent, strExpectedContent, "normalizeWhitespace 处理连续换行错误");
        assert.strictEqual(arrMapping.length, strExpectedContent.length, "normalizeWhitespace mapping 长度错误");
    });

    // 6. 测试 removeSymbolSpaces 处理特殊符号混合情况
    test('removeSymbolSpaces - 复杂符号空格情况', () => 
    {
        const strInput: string = `a  + ( b *  c ) / [ d -  e ]`;
        const stResult = fuzzyMatch.removeSymbolSpaces(strInput);
        const strContent: string = stResult.content;
        const arrMapping: number[] = stResult.mapping;

        const strExpectedContent: string = "a+(b*c)/[d-e]";

        assert.strictEqual(strContent, strExpectedContent, "removeSymbolSpaces 复杂符号空格处理错误");
        assert.strictEqual(arrMapping.length, strExpectedContent.length, "removeSymbolSpaces mapping 长度错误");
    });

    // 7. 测试 normalizeWhitespace 处理只有空格和换行符的输入
    test('normalizeWhitespace - 只有空格和换行符', () => 
    {
        const strInput: string = "   \n   \n   ";
        const stResult = fuzzyMatch.normalizeWhitespace(strInput);
        const strContent: string = stResult.content;
        const arrMapping: number[] = stResult.mapping;

        const strExpectedContent: string = "\n";

        assert.strictEqual(strContent, strExpectedContent, "normalizeWhitespace 纯空格处理错误");
        assert.strictEqual(arrMapping.length, strExpectedContent.length, "normalizeWhitespace mapping 长度错误");
    });

    // 8. 综合测试 normalizeContent
    test('normalizeContent - 复杂综合测试', () => 
    {
        const strInput: string = `function test() { // 这是注释
    let a  =  5 + 6 ;  // 多个空格
    let b = a *  2;  // 还有注释
    return  b;
}`; 
        const stResult = fuzzyMatch.normalizeContent(strInput);
        const strContent: string = stResult.content;
        const arrMapping: number[] = stResult.mapping;

        const strExpectedContent: string = 
            "function test(){\n" +
            "let a=5+6;\n" +
            "let b=a*2;\n" +
            "return b;\n" +
            "}";

        assert.strictEqual(strContent, strExpectedContent, "normalizeContent 复杂测试错误");
        assert.strictEqual(arrMapping.length, strExpectedContent.length, "normalizeContent mapping 长度错误");
    });
});

// 测试套件
suite('Fuzzy Global Replace Test Suite', () => {
    vscode.window.showInformationMessage('Start all fuzzy global replace tests.');

    const originalContent = `
function logMessage(message) {
    console.log(message);
}

function logError(error) {
    console.log(error);
}

function logWarning(warning) {
    console.log(warning);
}
    `.trim();
    const oldContent = `
console.log(warn);
    `.trim();
    const newContent = `
console.warn(warning);
    `.trim();
    const expectedContent = `
function logMessage(message) {
    console.log(message);
}

function logError(error) {
    console.log(error);
}

function logWarning(warning) {
    console.warn(warning);
}
    `.trim();

    test('normalizeContent should correctly normalize content and provide accurate mapping', () => {
        const { content: normContent, mapping } = fuzzyMatch.normalizeContent(originalContent);
        const logWarningStart = originalContent.indexOf('console.log(warning);');
        const logWarningEnd = logWarningStart + 'console.log(warning);'.length;
        const normLogWarningStart = normContent.indexOf('console.log(warning);');

        assert.ok(normContent.includes('console.log(warning);'), 'Normalized content should contain the target string');
        assert.strictEqual(
            mapping[normLogWarningStart],
            logWarningStart,
            'Mapping should point to original start position'
        );
        assert.strictEqual(
            mapping[normLogWarningStart + 'console.log(warning);'.length] || mapping[mapping.length - 1],
            logWarningEnd,
            'Mapping should point to original end position'
        );
    });

    test('normalizePattern should correctly normalize the old content', () => {
        const normPattern = fuzzyMatch.normalizePattern(oldContent);
        assert.strictEqual(
            normPattern.trim(),
            'console.log(warn);',
            'Pattern should be normalized correctly'
        );
    });

    test('findCandidatePositions should find potential match positions', () => {
        const { content: normContent } = fuzzyMatch.normalizeContent(originalContent);
        const normPattern = fuzzyMatch.normalizePattern(oldContent);
        const candidates = fuzzyMatch.findCandidatePositions(normContent, normPattern);

        assert.ok(candidates.length > 0, 'Should find at least one candidate position');
        const logWarningPos = normContent.indexOf('console.log(warning);');
        assert.ok(
            candidates.some(pos => Math.abs(pos - logWarningPos) < normPattern.length * 2),
            'Should include a position near the target string'
        );
    });

    test('verifyMatches should select the best match with correct positions', () => {
        const { content: normContent, mapping } = fuzzyMatch.normalizeContent(originalContent);
        const normPattern = fuzzyMatch.normalizePattern(oldContent);
        const candidates = fuzzyMatch.findCandidatePositions(normContent, normPattern);
        const matches = fuzzyMatch.verifyMatches(normContent, normPattern, candidates, mapping);

        assert.strictEqual(matches.length, 1, 'Should find exactly one best match');
        assert.strictEqual(
            originalContent.slice(matches[0].start, matches[0].end).trim(),
            'console.log(warning);',
            'Best match should correspond to the closest substring'
        );
    });

    test('applyReplacements should replace content correctly without extra characters', () => {
        const matches = [{
            start: originalContent.indexOf('console.log(warning);'),
            end: originalContent.indexOf('console.log(warning);') + 'console.log(warning);'.length
        }];
        const result = fuzzyMatch.applyReplacements(originalContent, matches, newContent);

        assert.strictEqual(result.trim(), expectedContent, 'Replacement should match expected output');
        assert.ok(!result.includes('warn);'), 'Result should not contain incorrectly replaced warn);');
    });

    test('applyFuzzyGlobalReplace should perform the full replacement correctly', () => {
        const result = fuzzyMatch.applyFuzzyGlobalReplace(originalContent, oldContent, newContent);
        assert.strictEqual(result.trim(), expectedContent, 'Full fuzzy replace should produce the expected output');
        assert.ok(!result.includes('warn);'), 'Result should not contain incorrectly replaced warn);');
    });
});