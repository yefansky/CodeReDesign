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
function normalizeContent(original: string): NormalizedContent {
    const mapping: number[] = [];
    let normalized = "";
    let lastCharIsWhitespace = true;
    let currentPos = 0;

    for (const char of original) {
        if (/\s/.test(char)) {
        if (!lastCharIsWhitespace) {
            normalized += ' ';
            mapping.push(currentPos);
            lastCharIsWhitespace = true;
        }
        currentPos++;
        } else {
        normalized += char;
        mapping.push(currentPos);
        currentPos++;
        lastCharIsWhitespace = false;
        }
    }

    return { content: normalized, mapping };
}

function normalizePattern(pattern: string): string {
    return pattern.replace(/\s+/g, ' ').trim();
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
    const validMatches: MatchPosition[] = [];
    const patternLen = pattern.length;

    candidates.forEach(start => {
        const end = start + patternLen;
        if (end > content.length) {
            return;
        }

        const substring = content.substring(start, end);
        const distance = calculateEditDistance(substring, pattern, MAX_EDIT_DISTANCE);
        
        if (distance <= MAX_EDIT_DISTANCE) {
            validMatches.push({
                start: mapping[start],
                end: mapping[end] || mapping[mapping.length - 1]
            });
        }
    });

    return processOverlaps(validMatches);
}

// ================ 工具函数 ================
function splitPattern(pattern: string, count: number): string[] {
    const segments: string[] = [];
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
