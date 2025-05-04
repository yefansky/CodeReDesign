import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { Cvb, TCVB, mergeCvb } from '../cvbManager'; // Adjust path to your models

suite('MergeCvb Test Suite', () => {
  test('mergeCvb produces different content from oldCvb', () => {
    const oldCvbFilePath = path.join(__dirname, '../../testdata/testfix_input_1_cvb.cvb');
    const tcvbFilePath = path.join(__dirname, '../../testdata/testfix_input_1_tcvb.txt');

    const oldCvbContent = fs.readFileSync(oldCvbFilePath, 'utf-8');
    const tcvbContent = fs.readFileSync(tcvbFilePath, 'utf-8');

    const oldCvb = new Cvb(oldCvbContent);
    const tcvb = new TCVB(tcvbContent);

    const resultCvb = mergeCvb(oldCvb, tcvb);

    console.log(resultCvb.toString());

    // Remove ## META to ## END_META section from both strings
    const removeMetaSection = (content: string): string => {
        const metaRegex = /## META[\s\S]*?## END_META\n?/g;
        return content.replace(metaRegex, '');
    };
    
    const processedResult = removeMetaSection(resultCvb.toString());
    const processedOldCvb = removeMetaSection(oldCvb.toString());

    //const processedResult = resultCvb.toString();
    //const processedOldCvb = oldCvb.toString();

    assert.notStrictEqual(processedResult, processedOldCvb);
  });
});

suite('TCVB AutoFix Test Suite', () => {
  // 测试用例1：END_TCVB标签缺失 + 代码块未闭合
  test('Case1: Missing END_TCVB + unclosed code', () => {
    const input = `
## BEGIN_TCVB
## FILE:test.txt
## OPERATION:GLOBAL-REPLACE
## OLD_CONTENT
console.log('old')
## NEW_CONTENT
console.log('new')`;

    const expected = `
## BEGIN_TCVB
## FILE:test.txt
## OPERATION:GLOBAL-REPLACE
## OLD_CONTENT
\`\`\`
console.log('old')
\`\`\`
## NEW_CONTENT
\`\`\`
console.log('new')
\`\`\`
## END_TCVB`.trim();

    assert.strictEqual(TCVB.autoFixTCVBContent(input).trim(), expected);
  });

  // 测试用例2：GLOBAL-REPLACE缺失OLD_CONTENT
  test('Case2: Incomplete GLOBAL-REPLACE', () => {
    const input = `
## FILE:test.txt
## OPERATION:GLOBAL-REPLACE
## NEW_CONTENT
console.log('new')`;

    const expected = `
## FILE:test.txt
## OPERATION:CREATE
\`\`\`
console.log('new')
\`\`\`
## END_TCVB`.trim();

    assert.strictEqual(TCVB.autoFixTCVBContent(input).trim(), expected);
  });

  // 测试用例3：混合问题（指令缩进 + 代码块未闭合）
  test('Case3: Mixed issues', () => {
    const input = `
  ## FILE:test.txt
    ## OPERATION:CREATE
    ## NEW_CONTENT
    function test() {`;

    const expected = `
## FILE:test.txt
## OPERATION:CREATE
\`\`\`
function test() {
\`\`\`
## END_TCVB`.trim();

    assert.strictEqual(TCVB.autoFixTCVBContent(input).trim(), expected);
  });

  // 测试用例4：只有开始标记的代码块
  test('Case4: Start code block only', () => {
    const input = `
## OPERATION:CREATE
## NEW_CONTENT
\`\`\`
console.log('new')`;

    const expected = `
## OPERATION:CREATE
\`\`\`
console.log('new')
\`\`\`
## END_TCVB`.trim();

    assert.strictEqual(TCVB.autoFixTCVBContent(input).trim(), expected);
  });

  // 测试用例5：无效的闭合顺序
  test('Case5: Wrong close order', () => {
    const input = `
## OPERATION:CREATE
## NEW_CONTENT
console.log('test')
\`\`\`
## FILE:test2.txt`;

    const expected = `
## OPERATION:CREATE
\`\`\`
console.log('test')
\`\`\`
## FILE:test2.txt
## END_TCVB`.trim();

    assert.strictEqual(TCVB.autoFixTCVBContent(input).trim(), expected);
  });
});