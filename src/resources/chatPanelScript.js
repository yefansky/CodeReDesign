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

        //if (markdownContent.includes('<think>') && !markdownContent.includes('</think>')){
          //  markdownContent += "</think>";
        //}

        targetDiv.innerHTML = marked.parse(markdownContent, {
            breaks: false,
            mangle: false,
            headerIds: false,
            highlight: (code, lang) => hljs.highlight(hljs.getLanguage(lang) ? lang : 'plaintext', code).value
        });

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
    chat.scrollTop = chat.scrollHeight;
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
        vscode.postMessage({ command: 'sendMessage', text, webSearch: webSearchCheckbox.checked });
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

// 主初始化函数
function initializeWebview() {
    // 初始化库和事件监听
    initializeLibraries();
    setupMessageHandlers();
    setupInputHandlers();
    setupEditButtons();
    setupCopyButtonDelegation();
}

initializeWebview();

