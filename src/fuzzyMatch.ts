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

// ================ ���ߺ��� ================
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
