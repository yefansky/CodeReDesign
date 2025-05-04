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