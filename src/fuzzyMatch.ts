// ================ 类型定义 ================
interface MatchPosition {
    start: number;
    end: number;
}

interface NormalizedContent {
    content: string;
    mapping: number[];
}

// ================ 核心实现 ================
const MAX_EDIT_DISTANCE = 5;
const SEGMENT_COUNT = MAX_EDIT_DISTANCE + 1;

export function applyFuzzyGlobalReplace(
    strContent: string,
    strOldContent: string,
    strNewContent: string
): string {
    // 第二阶段：模糊匹配流程
    const { content: normContent, mapping } = normalizeContent(strContent);
    const pattern = normalizePattern(strOldContent);

    // 分片查找候选位置
    const candidates = findCandidatePositions(normContent, pattern);

    // 验证并获取有效匹配
    const matches = verifyMatches(normContent, pattern, candidates, mapping);

    if (matches.length === 0) {
        throw new Error(`GLOBAL-REPLACE失败：未找到允许${MAX_EDIT_DISTANCE}个字符差异的匹配`);
    }

    // 应用替换
    return applyReplacements(strContent, matches, strNewContent);
}

// ================ 算法核心模块 ================
export function normalizeContent(original: string): { content: string; mapping: number[] } {
    // 第一步：去除注释
    const { content: noComments, mapping: mapping1 } = removeComments(original);

    // 第二步：去除符号前后的空格
    const { content: noSymbolSpaces, mapping: mapping2 } = removeSymbolSpaces(noComments);

    // 第三步：将换行符改为空格，并合并连续的空格
    const { content: finalContent, mapping: mapping3 } = normalizeWhitespace(noSymbolSpaces);

    // 合并 mapping
    const finalMapping = mapping3.map(idx => mapping2[idx]).map(idx => mapping1[idx]);

    return { content: finalContent, mapping: finalMapping };
}

// 辅助函数1：去除注释，并确保 mapping 数组严格对应每个输出字符（包括换行符）
export function removeComments(original: string): { content: string; mapping: number[] } {
    const astrLines: string[] = original.split('\n');
    let strContent: string = "";
    const arrMapping: number[] = [];
    let nCurrentPos: number = 0;

    for (let i = 0; i < astrLines.length; i++) {
        const strLine = astrLines[i];
        const nCommentIndex: number = strLine.indexOf('//');
        const strCleanLine: string = nCommentIndex !== -1 ? strLine.slice(0, nCommentIndex) : strLine;
        
        // 添加清理后的行内容，并记录映射
        strContent += strCleanLine;
        for (let nI: number = 0; nI < strCleanLine.length; nI++) {
            arrMapping.push(nCurrentPos + nI);
        }

        // 只有在不是最后一行时添加换行符
        if (i < astrLines.length - 1) {
            strContent += "\n";
            arrMapping.push(nCurrentPos + strLine.length);
            nCurrentPos += strLine.length + 1; // +1 表示换行符
        } else {
            nCurrentPos += strLine.length; // 最后一行没有换行符
        }
    }
    return { content: strContent, mapping: arrMapping };
}

// 辅助函数2：去除符号前后的空格
export function removeSymbolSpaces(strContentIn: string): { content: string; mapping: number[] } {
    // 更新正则表达式，匹配常见符号
    const regSymbols: RegExp = /[+\-/*()\[\]{};=,'"`!&|]/;
    let strNewContent: string = "";
    const arrMapping: number[] = [];
    const nLen: number = strContentIn.length;
    
    for (let nI: number = 0; nI < nLen; nI++) {
        const strCurrentChar: string = strContentIn[nI];
        
        // 使用正则表达式匹配所有空白字符（空格、制表符、换行符等）
        if (/\s/.test(strCurrentChar) && strCurrentChar !== '\n') {
            // 查找向左第一个非空白字符
            let nPrev: number = nI - 1;
            while (nPrev >= 0 && /\s/.test(strContentIn[nPrev])) {
                nPrev--;
            }
            // 查找向右第一个非空白字符
            let nNext: number = nI + 1;
            while (nNext < nLen && /\s/.test(strContentIn[nNext])) {
                nNext++;
            }
            
            let bSkipSpace: boolean = false;
            // 如果前一个字符是符号，跳过当前空白字符
            if (nPrev >= 0 && regSymbols.test(strContentIn[nPrev])) {
                bSkipSpace = true;
            }
            // 如果后一个字符是符号，跳过当前空白字符
            if (nNext < nLen && regSymbols.test(strContentIn[nNext])) {
                bSkipSpace = true;
            }
            
            if (bSkipSpace) {
                continue; // 跳过符号附近的空白字符
            }
        }
        
        // 保留非空白字符或未跳过的空白字符
        strNewContent += strCurrentChar;
        arrMapping.push(nI);
    }
    
    return { content: strNewContent, mapping: arrMapping };
}

// 辅助函数3：将换行符改为空格，并合并连续的空格
export function normalizeWhitespace(content: string): { content: string; mapping: number[] }
{
    let strNewContent: string = "";
    let arrMapping: number[] = [];
    let bAtLineStart: boolean = true;          // 标记当前是否处于行首
    let nPendingSpaceIndex: number | null = null; // 待添加空格的原始索引

    for (let nIdx = 0; nIdx < content.length; nIdx++)
    {
        const chChar: string = content[nIdx];

        if (chChar === '\n')
        {
            // 遇到换行符时，丢弃待添加的空格（避免行尾空格）
            nPendingSpaceIndex = null;
            // 如果输出为空或上一个字符不是换行符，则添加换行符
            if (strNewContent.length === 0 || strNewContent[strNewContent.length - 1] !== '\n')
            {
                strNewContent += '\n';
                arrMapping.push(nIdx);
            }
            bAtLineStart = true;
        }
        else if (/\s/.test(chChar))
        {
            // 遇到非换行空白字符：如果在行首，则忽略；否则，记录第一个空白字符索引
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
            // 遇到非空白字符时，如果有待添加的空格则先输出一个空格
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

    // 查找每个分片的匹配位置
    segments.forEach(segment => {
            let pos = -1;
            while ((pos = content.indexOf(segment, pos + 1)) !== -1) {
            if (pos === -1) {
                break;
            }
            // 向前后扩展可能的匹配范围
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
    let minDistance = MAX_EDIT_DISTANCE + 1; // 设为比允许的最大距离大1

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
// ================ 工具函数 ================
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

// 使用滚动数组优化
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
    // 从后往前替换避免影响索引
    for (let i = matches.length - 1; i >= 0; i--) {
        const { start, end } = matches[i];
        result = result.slice(0, start) + replacement + result.slice(end);
    }
    return result;
}
