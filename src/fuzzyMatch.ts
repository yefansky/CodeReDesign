// ================ ���Ͷ��� ================
interface MatchPosition {
    start: number;
    end: number;
}

interface NormalizedContent {
    content: string;
    mapping: number[];
}

// ================ ����ʵ�� ================
const MAX_EDIT_DISTANCE = 5;
const SEGMENT_COUNT = MAX_EDIT_DISTANCE + 1;

export function applyFuzzyGlobalReplace(
    strContent: string,
    strOldContent: string,
    strNewContent: string
): string {
    // �ڶ��׶Σ�ģ��ƥ������
    const { content: normContent, mapping } = normalizeContent(strContent);
    const pattern = normalizePattern(strOldContent);

    // ��Ƭ���Һ�ѡλ��
    const candidates = findCandidatePositions(normContent, pattern);

    // ��֤����ȡ��Чƥ��
    const matches = verifyMatches(normContent, pattern, candidates, mapping);

    if (matches.length === 0) {
        throw new Error(`GLOBAL-REPLACEʧ�ܣ�δ�ҵ�����${MAX_EDIT_DISTANCE}���ַ������ƥ��`);
    }

    // Ӧ���滻
    return applyReplacements(strContent, matches, strNewContent);
}

// ================ �㷨����ģ�� ================
export function normalizeContent(original: string): { content: string; mapping: number[] } {
    // ��һ����ȥ��ע��
    const { content: noComments, mapping: mapping1 } = removeComments(original);

    // �ڶ�����ȥ������ǰ��Ŀո�
    const { content: noSymbolSpaces, mapping: mapping2 } = removeSymbolSpaces(noComments);

    // �������������з���Ϊ�ո񣬲��ϲ������Ŀո�
    const { content: finalContent, mapping: mapping3 } = normalizeWhitespace(noSymbolSpaces);

    // �ϲ� mapping
    const finalMapping = mapping3.map(idx => mapping2[idx]).map(idx => mapping1[idx]);

    return { content: finalContent, mapping: finalMapping };
}

// ��������1��ȥ��ע�ͣ���ȷ�� mapping �����ϸ��Ӧÿ������ַ����������з���
export function removeComments(original: string): { content: string; mapping: number[] } {
    const astrLines: string[] = original.split('\n');
    let strContent: string = "";
    const arrMapping: number[] = [];
    let nCurrentPos: number = 0;

    for (let i = 0; i < astrLines.length; i++) {
        const strLine = astrLines[i];
        const nCommentIndex: number = strLine.indexOf('//');
        const strCleanLine: string = nCommentIndex !== -1 ? strLine.slice(0, nCommentIndex) : strLine;
        
        // ��������������ݣ�����¼ӳ��
        strContent += strCleanLine;
        for (let nI: number = 0; nI < strCleanLine.length; nI++) {
            arrMapping.push(nCurrentPos + nI);
        }

        // ֻ���ڲ������һ��ʱ��ӻ��з�
        if (i < astrLines.length - 1) {
            strContent += "\n";
            arrMapping.push(nCurrentPos + strLine.length);
            nCurrentPos += strLine.length + 1; // +1 ��ʾ���з�
        } else {
            nCurrentPos += strLine.length; // ���һ��û�л��з�
        }
    }
    return { content: strContent, mapping: arrMapping };
}

// ��������2��ȥ������ǰ��Ŀո�
export function removeSymbolSpaces(strContentIn: string): { content: string; mapping: number[] } {
    // ����������ʽ��ƥ�䳣������
    const regSymbols: RegExp = /[+\-/*()\[\]{};=,'"`!&|]/;
    let strNewContent: string = "";
    const arrMapping: number[] = [];
    const nLen: number = strContentIn.length;
    
    for (let nI: number = 0; nI < nLen; nI++) {
        const strCurrentChar: string = strContentIn[nI];
        
        // ʹ��������ʽƥ�����пհ��ַ����ո��Ʊ�������з��ȣ�
        if (/\s/.test(strCurrentChar) && strCurrentChar !== '\n') {
            // ���������һ���ǿհ��ַ�
            let nPrev: number = nI - 1;
            while (nPrev >= 0 && /\s/.test(strContentIn[nPrev])) {
                nPrev--;
            }
            // �������ҵ�һ���ǿհ��ַ�
            let nNext: number = nI + 1;
            while (nNext < nLen && /\s/.test(strContentIn[nNext])) {
                nNext++;
            }
            
            let bSkipSpace: boolean = false;
            // ���ǰһ���ַ��Ƿ��ţ�������ǰ�հ��ַ�
            if (nPrev >= 0 && regSymbols.test(strContentIn[nPrev])) {
                bSkipSpace = true;
            }
            // �����һ���ַ��Ƿ��ţ�������ǰ�հ��ַ�
            if (nNext < nLen && regSymbols.test(strContentIn[nNext])) {
                bSkipSpace = true;
            }
            
            if (bSkipSpace) {
                continue; // �������Ÿ����Ŀհ��ַ�
            }
        }
        
        // �����ǿհ��ַ���δ�����Ŀհ��ַ�
        strNewContent += strCurrentChar;
        arrMapping.push(nI);
    }
    
    return { content: strNewContent, mapping: arrMapping };
}

// ��������3�������з���Ϊ�ո񣬲��ϲ������Ŀո�
export function normalizeWhitespace(content: string): { content: string; mapping: number[] }
{
    let strNewContent: string = "";
    let arrMapping: number[] = [];
    let bAtLineStart: boolean = true;          // ��ǵ�ǰ�Ƿ�������
    let nPendingSpaceIndex: number | null = null; // ����ӿո��ԭʼ����

    for (let nIdx = 0; nIdx < content.length; nIdx++)
    {
        const chChar: string = content[nIdx];

        if (chChar === '\n')
        {
            // �������з�ʱ����������ӵĿո񣨱�����β�ո�
            nPendingSpaceIndex = null;
            // ������Ϊ�ջ���һ���ַ����ǻ��з�������ӻ��з�
            if (strNewContent.length === 0 || strNewContent[strNewContent.length - 1] !== '\n')
            {
                strNewContent += '\n';
                arrMapping.push(nIdx);
            }
            bAtLineStart = true;
        }
        else if (/\s/.test(chChar))
        {
            // �����ǻ��пհ��ַ�����������ף�����ԣ����򣬼�¼��һ���հ��ַ�����
            if (!bAtLineStart)
            {
                if (nPendingSpaceIndex === null)
                {
                    nPendingSpaceIndex = nIdx;
                }
            }
        }
        else
        {
            // �����ǿհ��ַ�ʱ������д���ӵĿո��������һ���ո�
            if (nPendingSpaceIndex !== null)
            {
                strNewContent += ' ';
                arrMapping.push(nPendingSpaceIndex);
                nPendingSpaceIndex = null;
            }
            strNewContent += chChar;
            arrMapping.push(nIdx);
            bAtLineStart = false;
        }
    }

    return { content: strNewContent, mapping: arrMapping };
}


export function normalizePattern(pattern: string): string {
    const { content } = normalizeContent(pattern);
    return content;
}

function findCandidatePositions(content: string, pattern: string): number[] {
    const candidates = new Set<number>();
    const segments = splitPattern(pattern, SEGMENT_COUNT);

    // ����ÿ����Ƭ��ƥ��λ��
    segments.forEach(segment => {
            let pos = -1;
            while ((pos = content.indexOf(segment, pos + 1)) !== -1) {
            if (pos === -1) {
                break;
            }
            // ��ǰ����չ���ܵ�ƥ�䷶Χ
            const start = Math.max(0, pos - pattern.length);
            const end = Math.min(content.length, pos + pattern.length * 2);
            for (let i = start; i < end; i++) {
                candidates.add(i);
            }
        }
    });

    return Array.from(candidates).sort((a, b) => a - b);
}

function verifyMatches(
    content: string,
    pattern: string,
    candidates: number[],
    mapping: number[]
): MatchPosition[] {
    let bestMatch: MatchPosition | null = null;
    let minDistance = MAX_EDIT_DISTANCE + 1; // ��Ϊ��������������1

    const patternLen = pattern.length;

    candidates.forEach(start => {
        const end = start + patternLen;
        if (end > content.length) {
            return;
        }

        const substring = content.substring(start, end);
        const distance = calculateEditDistance(substring, pattern, MAX_EDIT_DISTANCE);

        if (distance < minDistance) {
            minDistance = distance;
            bestMatch = {
                start: mapping[start],
                end: mapping[end] || mapping[mapping.length - 1]
            };
        }
    });

    return bestMatch ? [bestMatch] : [];
}
// ================ ���ߺ��� ================
function splitPattern(pattern: string, count: number): string[] {
    const segments: string[] = [];

    if (pattern.length / count < 3) {
        count = pattern.length / 3;
    }

    const baseLength = Math.floor(pattern.length / count);
    let remaining = pattern.length % count;
    let pos = 0;

    for (let i = 0; i < count; i++) {
        const length = baseLength + (remaining-- > 0 ? 1 : 0);
        segments.push(pattern.substr(pos, length));
        pos += length;
    }

    return segments.filter(s => s.length > 0);
}

function calculateEditDistance(a: string, b: string, maxDistance: number): number {
if (Math.abs(a.length - b.length) > maxDistance) {
    return Infinity;
}

// ʹ�ù��������Ż�
let prevRow = Array(b.length + 1).fill(0).map((_, i) => i);
let currentRow = new Array(b.length + 1);

for (let i = 1; i <= a.length; i++) {
        currentRow[0] = i;
        let minInRow = i;

        for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        currentRow[j] = Math.min(
            prevRow[j] + 1,
            currentRow[j - 1] + 1,
            prevRow[j - 1] + cost
        );
        minInRow = Math.min(minInRow, currentRow[j]);
        }

        if (minInRow > maxDistance) {
        return Infinity;
        }
        [prevRow, currentRow] = [currentRow, prevRow];
    }

    return prevRow[b.length];
}

function processOverlaps(matches: MatchPosition[]): MatchPosition[] {
    return matches
        .sort((a, b) => a.start - b.start)
        .filter((match, index, arr) => {
        return index === 0 || match.start >= arr[index - 1].end;
        });
}

function applyReplacements(
    original: string,
    matches: MatchPosition[],
    replacement: string
): string {
    let result = original;
    // �Ӻ���ǰ�滻����Ӱ������
    for (let i = matches.length - 1; i >= 0; i--) {
        const { start, end } = matches[i];
        result = result.slice(0, start) + replacement + result.slice(end);
    }
    return result;
}
