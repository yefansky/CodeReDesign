import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// 定义 tokenizer_config.json 的结构（简化版）
interface TokenizerConfig {
    add_bos_token: boolean;
    add_eos_token: boolean;
    bos_token: { content: string };
    eos_token: { content: string };
    model_max_length: number;
    [key: string]: any;
}

// 定义 tokenizer.json 的结构（简化版）
interface TokenizerData {
    model: {
        vocab: { [token: string]: number };
        merges: string[];
    };
    added_tokens?: Array<{ id: number; content: string }>;
}

// 合并后的完整配置
interface FullTokenizerConfig {
    vocab: { [token: string]: number };
    merges: string[];
    bosToken: string;
    eosToken: string;
    addBosToken: boolean;
    addEosToken: boolean;
    modelMaxLength: number;
}

// 简化的 BPE Tokenizer 类
class SimpleBPETokenizer {
    private vocab: { [token: string]: number };
    private merges: string[];
    private cache: { [word: string]: string[] };
    private bosToken: string;
    private eosToken: string;
    private addBosToken: boolean;
    private addEosToken: boolean;
    private modelMaxLength: number;

    constructor(config: FullTokenizerConfig) {
        this.vocab = config.vocab;
        this.merges = config.merges;
        this.bosToken = config.bosToken;
        this.eosToken = config.eosToken;
        this.addBosToken = config.addBosToken;
        this.addEosToken = config.addEosToken;
        this.modelMaxLength = config.modelMaxLength;
        this.cache = {};
    }

    private getPairs(word: string[]): Set<string> {
        const pairs = new Set<string>();
        for (let i = 0; i < word.length - 1; i++) {
            pairs.add(word[i] + ' ' + word[i + 1]);
        }
        return pairs;
    }

    private bpe(word: string): string[] {
        if (this.cache[word]) {
             return this.cache[word];
        }
        let wordArr = word.split('');
        while (true) {
            const pairs = this.getPairs(wordArr);
            if (pairs.size === 0) {
                break;
            }
            let minPair = '';
            let minRank = Infinity;
            for (const pair of pairs) {
                const rank = this.merges.indexOf(pair);
                if (rank !== -1 && rank < minRank) {
                    minRank = rank;
                    minPair = pair;
                }
            }
            if (minRank === Infinity) {
                break;
            }
            const [first, second] = minPair.split(' ');
            const newWord: string[] = [];
            let i = 0;
            while (i < wordArr.length) {
                const j = wordArr.indexOf(first, i);
                if (j === -1) {
                    newWord.push(...wordArr.slice(i));
                    break;
                }
                newWord.push(...wordArr.slice(i, j));
                if (j < wordArr.length - 1 && wordArr[j + 1] === second) {
                    newWord.push(first + second);
                    i = j + 2;
                } else {
                    newWord.push(wordArr[j]);
                    i = j + 1;
                }
            }
            wordArr = newWord;
        }
        this.cache[word] = wordArr;
        return wordArr;
    }

    private tokenize(text: string): string[] {
        const tokens: string[] = [];
        if (this.addBosToken) {
            tokens.push(this.bosToken);
        }
        const words = text.split(' ');
        for (const word of words) {
            if (!word) {
                continue;
            }
            const bpeTokens = this.bpe(word);
            tokens.push(...bpeTokens);
        }
        if (this.addEosToken) {
            tokens.push(this.eosToken);
        }
        return tokens;
    }

    public encode(text: string): number[] {
        const tokens = this.tokenize(text);
        return tokens.map(token => {
            const id = this.vocab[token];
            if (id === undefined) {
                console.warn(`Token "${token}" not found in vocab, returning -1`);
                return -1;
            }
            return id;
        });
    }

    public countTokens(text: string): number {
        const tokens = this.tokenize(text);
        return tokens.length > this.modelMaxLength ? this.modelMaxLength : tokens.length;
    }

    // 新增：检查 token 数量是否小于限制，尽早退出
    public isUnderTokenLimit(text: string, limit: number): boolean {
        let tokenCount = 0;
        if (this.addBosToken) {
            tokenCount++; // BOS token
        }
        const words = text.split(' ');
        for (const word of words) {
            if (!word) continue;
            const bpeTokens = this.bpe(word);
            tokenCount += bpeTokens.length;
            if (tokenCount >= limit) return false; // 超过限制，立即返回
        }
        if (this.addEosToken) tokenCount++; // EOS token
        return tokenCount < limit;
    }
}

// 单例模式实现全局 tokenizer
class TokenizerSingleton {
    private static instance: SimpleBPETokenizer | null = null;

    public static initialize(context: vscode.ExtensionContext): void {
        if (!TokenizerSingleton.instance) {
            const configPath = path.join(context.extensionPath, 'data', 'tokenizer_config.json');
            const dataPath = path.join(context.extensionPath, 'data', 'tokenizer.json');
            try {
                const config: TokenizerConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
                const data: TokenizerData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
                const fullConfig: FullTokenizerConfig = {
                    vocab: data.model.vocab,
                    merges: data.model.merges,
                    bosToken: config.bos_token.content,
                    eosToken: config.eos_token.content,
                    addBosToken: config.add_bos_token,
                    addEosToken: config.add_eos_token,
                    modelMaxLength: config.model_max_length
                };
                TokenizerSingleton.instance = new SimpleBPETokenizer(fullConfig);
            } catch (error : any) {
                vscode.window.showErrorMessage(`Failed to load tokenizer files: ${error.message}`);
                throw error;
            }
        }
    }

    public static getTokenizer(): SimpleBPETokenizer {
        if (!TokenizerSingleton.instance) {
            throw new Error('Tokenizer not initialized. Call initialize() in activate() first.');
        }
        return TokenizerSingleton.instance;
    }
}

export function initTokenizer(context: vscode.ExtensionContext) {
    TokenizerSingleton.initialize(context);
}

// 对外导出的 countTokens 函数
export function countTokens(text: string): number {
    const tokenizer = TokenizerSingleton.getTokenizer();
    return tokenizer.countTokens(text);
}

// 新增：对外导出的 isUnderTokenLimit 函数
export function isUnderTokenLimit(text: string, limit: number): boolean {
    const tokenizer = TokenizerSingleton.getTokenizer();
    return tokenizer.isUnderTokenLimit(text, limit);
}