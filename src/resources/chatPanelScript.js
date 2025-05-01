// 初始化 Mermaid 和代码高亮
function initializeLibraries() {
    mermaid.initialize({ startOnLoad: false, theme: 'dark' });
    hljs.configure({ ignoreUnescapedHTML: true });
}

// 设置编辑按钮功能
function setupEditButtons() {
    document.querySelectorAll('.edit-btn').forEach(btn => {
        btn.onclick = (event) => {
            const userDiv = event.target.closest('.user');
            const contentDiv = userDiv.querySelector('.user-content');
            userDiv.innerHTML = `
                <textarea class="edit-textarea" style="width:100%; min-height:100px; resize:vertical; margin-bottom:8px; padding:8px; box-sizing:border-box;">${contentDiv.textContent}</textarea>
                <div class="edit-buttons" style="display:flex; gap:8px; justify-content:flex-end;">
                    <button class="edit-send" style="padding:6px 12px;">发送</button>
                    <button class="edit-cancel" style="padding:6px 12px;">取消</button>
                </div>`;

            const editSend = userDiv.querySelector('.edit-send');
            const editCancel = userDiv.querySelector('.edit-cancel');

            editSend.onclick = () => {
                const newText = userDiv.querySelector('textarea').value;
                vscode.postMessage({ command: 'editMessage', index: parseInt(userDiv.dataset.index), text: newText });
                userDiv.innerHTML = `<button class="edit-btn">✎</button><div class="user-content">${newText}</div>`;
                setupEditButtons();
            };

            editCancel.onclick = () => {
                userDiv.innerHTML = `<button class="edit-btn">✎</button><div class="user-content">${contentDiv.textContent}</div>`;
                setupEditButtons();
            };
        };
    });
}

// 设置复制按钮功能（事件委托）
function setupCopyButtonDelegation() {
    chat.addEventListener('click', (event) => {
        const copyBtn = event.target.closest('.copy-btn');
        if (!copyBtn) {return; }

        const preElement = copyBtn.closest('pre');
        if (!preElement) {return; }

        const code = preElement.querySelector('code').textContent;
        navigator.clipboard.writeText(code)
            .then(() => {
                copyBtn.textContent = 'Copied!';
                setTimeout(() => copyBtn.textContent = 'Copy', 2000);
            })
            .catch(err => console.error('Copy failed:', err));
    });
}

// 渲染数学公式
function fnRenderDisplayMath(webviewDiv) {
    const strRawHtml = webviewDiv.innerHTML;
    const rgxDisplayMath = /\$\$([\s\S]+?)\$\$/g;
    const strReplacedHtml = strRawHtml.replace(rgxDisplayMath, (strMatch, strInnerTex) => {
        try {
            const strTex = strInnerTex.replace(/^\s+|\s+$/g, '');
            return katex.renderToString(strTex, {
                displayMode: true,
                throwOnError: false
            });
        } catch (err) {
            console.error('KaTeX render error:', err);
            return strMatch;
        }
    });
    webviewDiv.innerHTML = strReplacedHtml;
}

// 全局 Mermaid 缓存
window.mermaidCache = window.mermaidCache || [];

async function renderMermaid(webviewDiv) {
    const codeBlocks = webviewDiv.querySelectorAll('pre code.language-mermaid');
    
    // 创建渲染承诺数组
    const renderPromises = Array.from(codeBlocks).map(async (codeBlock, index) => {
        const parentPre = codeBlock.closest('pre');
        const mermaidCode = codeBlock.textContent;
        try {
            const diagramId = `mermaid-diagram-${index}`;
            const { svg } = await mermaid.render(diagramId, mermaidCode);
            // 更新全局缓存
            window.mermaidCache[index] = svg;
            return { index, svg, mermaidCode, parentPre };
        } catch (err) {
            console.error('Mermaid 渲染错误，索引', index, ':', err);
            // 使用缓存中的 SVG（如果存在）
            const cachedSvg = window.mermaidCache[index] || null;
            return { index, svg: cachedSvg, mermaidCode, parentPre };
        }
    });

    // 等待所有渲染尝试完成
    const results = await Promise.all(renderPromises);

    // 批量处理结果并更新 DOM
    for (const result of results) {
        const { svg, mermaidCode, parentPre } = result;
        const container = document.createElement('div');
        container.className = 'mermaid-container';

        // 始终显示原始代码
        const rawDiv = document.createElement('div');
        rawDiv.className = 'mermaid-raw';
        rawDiv.innerHTML = `<pre><code class="language-mermaid">${mermaidCode}</code></pre>`;
        container.appendChild(rawDiv);

        // 如果有 SVG（渲染成功或缓存），则添加
        if (svg) {
            const mermaidDiv = document.createElement('div');
            mermaidDiv.className = 'mermaid';
            mermaidDiv.innerHTML = svg;
            container.insertBefore(mermaidDiv, rawDiv);
        }

        // 替换原始 pre 标签
        parentPre.replaceWith(container);
    }
}

// 切换 Mermaid 显示模式
function toggleMermaidDisplay() {
    const containers = document.querySelectorAll('.mermaid-container');
    if (mermaidToggle.checked) {
        containers.forEach(container => container.classList.add('mermaid-rendered'));
    } else {
        containers.forEach(container => container.classList.remove('mermaid-rendered'));
    }
}

// 确保复制按钮存在
function ensureCopyButtons() {
    document.querySelectorAll('.model pre').forEach(pre => {
        if (!pre.querySelector('.copy-btn')) {
            const button = document.createElement('button');
            button.className = 'copy-btn';
            button.textContent = 'Copy';
            pre.appendChild(button);
        }
    });
}

function ensureTagPreProcess(content) {
    let processedContent = content;

    // Handle unclosed <think> tags
    if (processedContent.includes('<think>') && !processedContent.includes('</think>')) {
        processedContent += '</think>';
    }

    // Handle <tool_call> tags
    const lastToolCallIndex = processedContent.lastIndexOf('<tool_call>');
    if (lastToolCallIndex !== -1) {
        // Check if there's a </tool_call> after the last <tool_call>
        const contentAfterLastToolCall = processedContent.slice(lastToolCallIndex);
        if (!contentAfterLastToolCall.includes('</tool_call>')) {
            processedContent += '</tool_call>';
        }
    }

    return processedContent;
}

function processMathBlocks(input) {
    // Regex to match %%...%% blocks
    const percentPairRegex = /%%([\s\S]*?)%%/g;
    
    // Process the input string
    return input.replace(percentPairRegex, (percentMatch, percentContent) => {
        // Regex to match $$...$$ blocks within %% content
        const mathBlockRegex = /\$\$([\s\S]*?)\$\$/g;
        
        // Process $$...$$ blocks within the %% content
        const processedContent = percentContent.replace(mathBlockRegex, (mathMatch, mathContent) => {
            // Trim and check if the math content has newlines
            const trimmedContent = mathContent.trim();
            if (!trimmedContent.includes('\n')) {
                // No newlines, return unchanged
                return `$$${trimmedContent}$$`;
            }
            
            // Replace newlines with \\ and wrap in aligned
            const singleLineContent = trimmedContent
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0)
                .join(' \\\\ ');
                
            return `$$ \\begin{aligned} ${singleLineContent} \\end{aligned} $$`;
        });
        
        // Return the processed %% block
        return `%%${processedContent}%%`;
    });
}

function separateThinkContent(input) {
    const segments = [];
    
    // 使用split捕获think块和非think内容
    const parts = input.split(/(<think>[\s\S]*?<\/think>)/g);
    
    parts.forEach(part => {
        if (!part) {return; }
        
        if (part.startsWith('<think>') && part.endsWith('</think>')) {
            segments.push({
                type: 'think',
                content: part
            });
        } else {
            segments.push({
                type: 'answer',
                content: part
            });
        }
    });

    return segments;
}

// 渲染消息
async function renderMessage(role, content, index) {
    const lastChild = chat.lastElementChild;
    let targetDiv;

    if (lastChild && lastChild.classList.contains(role)) {
        targetDiv = lastChild;
        targetDiv.dataset.markdownContent += content;
    } else {
        targetDiv = document.createElement('div');
        targetDiv.className = role;
        targetDiv.dataset.markdownContent = content;
        chat.appendChild(targetDiv);
    }

    if (role === 'model') {
        let markdownContent = targetDiv.dataset.markdownContent;
        markdownContent = ensureTagPreProcess(markdownContent);

        markdownContent = markdownContent.replace(/\$\$包裹/g, '&doller; &doller; 包裹');

        markdownContent = processMathBlocks(markdownContent);

        const segments = separateThinkContent(markdownContent);
        let htmlContent = '';
        
        segments.forEach(segment => {
            if (segment.type === 'think') {
                // Think内容直接显示原始标签
                htmlContent += `<think>${segment.content}</think>`;
            } else {
                // Answer内容用marked解析
                htmlContent += marked.parse(segment.content, {
                    breaks: false,
                    mangle: false,
                    headerIds: false,
                    highlight: (code, lang) => hljs.highlight(
                        hljs.getLanguage(lang) ? lang : 'plaintext', 
                        code
                    ).value
                });
            }
        });
        
        targetDiv.innerHTML = htmlContent;
        fnRenderDisplayMath(targetDiv);
        await renderMermaid(targetDiv);

        renderMathInElement(targetDiv, {
            delimiters: [
                { left: '$$', right: '$$', display: true },
                { left: '$', right: '$', display: false },
                { left: '\\[', right: '\\]', display: true },
                { left: '\\(', right: '\\)', display: false }
            ],
            throwOnError: false
        });
        ensureCopyButtons();
        hljs.highlightAll();
    } else {
        targetDiv.innerHTML = `<button class="edit-btn">✎</button><div class="user-content">${targetDiv.dataset.markdownContent}</div>`;
        targetDiv.dataset.index = index;
        setupEditButtons();
    }
    //chat.scrollTop = chat.scrollHeight;

    if (autoScrollEnabled) {
        smartScroll();
    }
}

// 消息处理
function setupMessageHandlers() {
    window.addEventListener('message', async (event) => {
        const data = event.data;

        if (data.role && data.content) {
            await renderMessage(data.role, data.content, data.index);
            return;
        }

        if (!data.command) { return; }

        switch (data.command) {
            case 'disableSendButton':
                sendButton.disabled = true;
                break;
            case 'enableSendButton':
                sendButton.disabled = false;
                break;
            case 'showStopButton':
                stopButton.style.display = 'inline-block';
                break;
            case 'hideStopButton':
                stopButton.style.display = 'none';
                break;
            case 'clearAfterIndex':
                const clearIndex = data.index;
                document.querySelectorAll('.user').forEach(userDiv => {
                    if (parseInt(userDiv.dataset.index) >= clearIndex) {
                        const modelDiv = userDiv.nextElementSibling;
                        if (modelDiv?.classList.contains('model')) { modelDiv.remove(); }
                        userDiv.remove();
                    }
                });
                break;
        }
    });

    mermaidToggle.addEventListener('change', toggleMermaidDisplay);
}

// 输入处理
function setupInputHandlers() {
    sendButton.addEventListener('click', sendMessage);
    newSessionButton.addEventListener('click', startNewSession);
    stopButton.addEventListener('click', stopOperation);
    input.addEventListener('keydown', handleKeyDown);
}

function sendMessage() {
    const text = input.value.trim();
    if (text) {
        vscode.postMessage({ command: 'sendMessage', text, webSearch: webSearchCheckbox.checked, agentMode: agentModeCheckbox.checked });
        input.value = '';
    }
}

function startNewSession() {
    vscode.postMessage({ command: 'newSession' });
    chat.innerHTML = '';
    sendButton.disabled = false;
    stopButton.style.display = 'none';
}

function stopOperation() {
    vscode.postMessage({ command: 'stop' });
}

function handleKeyDown(e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        sendMessage();
    }
}


// 优化版智能滚动控制
// 配置常量
const SCROLL_THRESHOLD = 200; // 距离底部?px视为触底
let autoScrollEnabled = true;
let lastScrollTop = 0;

// 精准的滚轮方向检测
function handleWheel(e) {
    const isScrollingDown = e.deltaY > 0;
    checkScrollIntent(isScrollingDown);
}

// 滚动意图检测
function checkScrollIntent(isScrollingDown) {
    const currentPos = chat.scrollTop + chat.clientHeight;
    const maxPos = chat.scrollHeight;
    const distanceToBottom = maxPos - currentPos;

    // 判断条件
    if (isScrollingDown) {
        // 向下滚动时：距离底部小于阈值则开启自动滚动
        autoScrollEnabled = distanceToBottom <= SCROLL_THRESHOLD;
    } else {
        // 任何向上滚动动作立即关闭自动滚动
        autoScrollEnabled = false;
    }

    // 调试输出
    console.log(`方向: ${isScrollingDown ? '↓' : '↑'} | 距底部: ${distanceToBottom}px | 自动: ${autoScrollEnabled}`);
}

// 智能滚动执行
function smartScroll() {
    if (autoScrollEnabled) {
        chat.scrollTop = chat.scrollHeight;
    }
}

// 初始化
function setupScroll() {
    // 监听滚轮事件
    chat.addEventListener('wheel', handleWheel, { passive: true });
    
    // 实时滚动检测（使用requestAnimationFrame优化性能）
    let lastRender = 0;
    const checkScroll = (timestamp) => {
        if (timestamp - lastRender > 100) { // 每100ms检查一次
            if (autoScrollEnabled) {
                smartScroll();
            }
            lastRender = timestamp;
        }
        requestAnimationFrame(checkScroll);
    };
    requestAnimationFrame(checkScroll);
}


// 主初始化函数
function initializeWebview() {
    // 初始化库和事件监听
    initializeLibraries();
    setupMessageHandlers();
    setupInputHandlers();
    setupEditButtons();
    setupCopyButtonDelegation();

    setupScroll();
}

initializeWebview();
