/**
 * 本地AI翻譯模組
 * 與本地翻譯服務進行通信
 */

class LocalAITranslator {
    constructor() {
        this.baseURL = 'http://localhost:3000/api';
        this.model = 'qwen2:7b-instruct';
        this.timeout = 30000; // 30秒超時
        this.retryCount = 3;
        this.queue = []; // 翻譯隊列
        this.processing = false;
    }

    /**
     * 檢查服務健康狀態
     */
    async checkHealth() {
        try {
            const response = await fetch(`${this.baseURL}/health`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                },
                signal: AbortSignal.timeout(5000)
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            return data.status === 'healthy' && data.qwen2_available;
        } catch (error) {
            console.error('[健康檢查失敗]:', error.message);
            return false;
        }
    }

    /**
     * 單個文本翻譯
     */
    async translateText(text, sourceLang = 'auto', targetLang = 'zh-tw') {
        if (!text || text.trim().length === 0) {
            return { success: false, error: '文本為空' };
        }

        // 文本長度檢查
        if (text.length > 10000) {
            return await this.splitAndTranslate(text, sourceLang, targetLang);
        }

        for (let attempt = 1; attempt <= this.retryCount; attempt++) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), this.timeout);

                const response = await fetch(`${this.baseURL}/translate`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        text: text,
                        source_lang: sourceLang,
                        target_lang: targetLang,
                        model: this.model
                    }),
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || `HTTP ${response.status}`);
                }

                const result = await response.json();
                
                if (result.success) {
                    console.log(`[翻譯成功] 嘗試: ${attempt}, 快取: ${result.from_cache}`);
                    return {
                        success: true,
                        translation: result.translation,
                        sourceLang: sourceLang,
                        targetLang: targetLang,
                        fromCache: result.from_cache,
                        stats: result.stats
                    };
                } else {
                    throw new Error(result.error || '翻譯失敗');
                }

            } catch (error) {
                console.error(`[翻譯失敗] 嘗試 ${attempt}:`, error.message);
                
                if (attempt === this.retryCount) {
                    return {
                        success: false,
                        error: `翻譯失敗 (${this.retryCount}次重試): ${error.message}`,
                        originalText: text
                    };
                }

                // 重試前等待
                await this.delay(1000 * attempt);
            }
        }
    }

    /**
     * 長文本分段翻譯
     */
    async splitAndTranslate(text, sourceLang, targetLang) {
        const segments = this.splitText(text, 5000); // 5000字符為一段
        const translations = [];

        console.log(`[長文本翻譯] 分為 ${segments.length} 段處理`);

        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i];
            console.log(`[處理段落] ${i + 1}/${segments.length}`);
            
            const result = await this.translateText(segment, sourceLang, targetLang);
            
            if (result.success) {
                translations.push(result.translation);
            } else {
                console.error(`[段落翻譯失敗] ${i + 1}:`, result.error);
                translations.push(segment); // 失敗時保留原文
            }

            // 段落間延遲，避免過載
            if (i < segments.length - 1) {
                await this.delay(500);
            }
        }

        return {
            success: true,
            translation: translations.join(''),
            sourceLang: sourceLang,
            targetLang: targetLang,
            segments: segments.length
        };
    }

    /**
     * 批量翻譯
     */
    async batchTranslate(texts, sourceLang = 'auto', targetLang = 'zh-tw') {
        if (!Array.isArray(texts) || texts.length === 0) {
            return { success: false, error: '文本數組為空' };
        }

        if (texts.length > 50) {
            return { success: false, error: '單次最多翻譯50個文本' };
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.timeout * 2);

            const response = await fetch(`${this.baseURL}/translate/batch`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    texts: texts,
                    source_lang: sourceLang,
                    target_lang: targetLang,
                    model: this.model
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }

            const result = await response.json();
            
            if (result.success) {
                console.log(`[批量翻譯成功] 處理了 ${result.total_texts} 個文本，用時 ${result.processing_time}ms`);
                return {
                    success: true,
                    results: result.results,
                    totalTexts: result.total_texts,
                    processingTime: result.processing_time
                };
            } else {
                throw new Error(result.error || '批量翻譯失敗');
            }

        } catch (error) {
            console.error('[批量翻譯錯誤]:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 智能網頁翻譯
     * 識別並翻譯網頁中的文本節點
     */
    async translateWebPage(document, targetLang = 'zh-tw') {
        const textNodes = this.extractTextNodes(document);
        const textsToTranslate = textNodes
            .map(node => node.textContent.trim())
            .filter(text => text.length > 0 && this.shouldTranslate(text));

        if (textsToTranslate.length === 0) {
            return { success: true, message: '沒有需要翻譯的文本' };
        }

        console.log(`[網頁翻譯] 發現 ${textsToTranslate.length} 個文本節點`);

        // 批量翻譯
        const batchResult = await this.batchTranslate(textsToTranslate, 'auto', targetLang);
        
        if (!batchResult.success) {
            return batchResult;
        }

        // 應用翻譯結果
        let appliedCount = 0;
        textNodes.forEach((node, index) => {
            const original = node.textContent.trim();
            if (original.length > 0 && this.shouldTranslate(original)) {
                const result = batchResult.results[appliedCount];
                if (result && result.success) {
                    // 創建雙語顯示
                    this.createBilingualDisplay(node, original, result.translation);
                    appliedCount++;
                }
            }
        });

        return {
            success: true,
            translatedNodes: appliedCount,
            totalTexts: textsToTranslate.length,
            processingTime: batchResult.processingTime
        };
    }

    /**
     * 提取文本節點
     */
    extractTextNodes(document) {
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: (node) => {
                    const parent = node.parentElement;
                    if (!parent) return NodeFilter.FILTER_REJECT;
                    
                    // 排除腳本、樣式、SVG等元素
                    const excludeTags = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'CANVAS'];
                    if (excludeTags.includes(parent.tagName)) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    
                    // 排除隱藏元素
                    const style = window.getComputedStyle(parent);
                    if (style.display === 'none' || style.visibility === 'hidden') {
                        return NodeFilter.FILTER_REJECT;
                    }
                    
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );

        const textNodes = [];
        let node;
        while (node = walker.nextNode()) {
            textNodes.push(node);
        }

        return textNodes;
    }

    /**
     * 判斷文本是否需要翻譯
     */
    shouldTranslate(text) {
        // 過濾掉純數字、純符號、太短的文本
        if (text.length < 3) return false;
        if (/^[\d\s\W]+$/.test(text)) return false;
        
        // 已經是中文的大部分跳過（但允許混合文本）
        const chineseChars = text.match(/[\u4e00-\u9fff]/g);
        const chineseRatio = chineseChars ? chineseChars.length / text.length : 0;
        if (chineseRatio > 0.8) return false;
        
        return true;
    }

    /**
     * 創建雙語顯示
     */
    createBilingualDisplay(textNode, original, translation) {
        const parent = textNode.parentElement;
        if (!parent) return;

        // 創建容器
        const container = document.createElement('div');
        container.className = 'ai-translation-container';
        container.style.cssText = `
            margin: 2px 0;
            padding: 4px;
            border-left: 3px solid #4CAF50;
            background-color: rgba(76, 175, 80, 0.05);
            border-radius: 4px;
        `;

        // 原文
        const originalSpan = document.createElement('span');
        originalSpan.className = 'ai-original-text';
        originalSpan.textContent = original;
        originalSpan.style.cssText = `
            display: block;
            color: #666;
            font-size: 0.9em;
            margin-bottom: 2px;
            line-height: 1.4;
        `;

        // 譯文
        const translationSpan = document.createElement('span');
        translationSpan.className = 'ai-translation-text';
        translationSpan.textContent = translation;
        translationSpan.style.cssText = `
            display: block;
            color: #333;
            font-weight: 500;
            line-height: 1.4;
        `;

        container.appendChild(originalSpan);
        container.appendChild(translationSpan);

        // 替換原節點
        parent.replaceChild(container, textNode);
    }

    /**
     * 文本分割函數
     */
    splitText(text, maxLength) {
        if (text.length <= maxLength) {
            return [text];
        }

        const segments = [];
        let currentSegment = '';
        const sentences = text.split(/([.!?。！？]+\s*)/);

        for (const sentence of sentences) {
            if (currentSegment.length + sentence.length <= maxLength) {
                currentSegment += sentence;
            } else {
                if (currentSegment) {
                    segments.push(currentSegment);
                    currentSegment = sentence;
                } else {
                    // 單個句子太長，強制分割
                    segments.push(sentence.substring(0, maxLength));
                    currentSegment = sentence.substring(maxLength);
                }
            }
        }

        if (currentSegment) {
            segments.push(currentSegment);
        }

        return segments;
    }

    /**
     * 延遲函數
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 獲取支援的語言
     */
    async getSupportedLanguages() {
        try {
            const response = await fetch(`${this.baseURL}/languages`);
            if (response.ok) {
                return await response.json();
            }
        } catch (error) {
            console.error('[獲取語言列表失敗]:', error);
        }
        
        // 備用語言列表
        return {
            supported_languages: {
                'zh-tw': '繁體中文 (台灣)',
                'zh-cn': '簡體中文',
                'en': 'English',
                'ja': '日本語',
                'ko': '한국어'
            },
            default_target: 'zh-tw'
        };
    }

    /**
     * 清除翻譯快取
     */
    async clearCache() {
        try {
            const response = await fetch(`${this.baseURL}/cache`, {
                method: 'DELETE'
            });
            return response.ok;
        } catch (error) {
            console.error('[清除快取失敗]:', error);
            return false;
        }
    }
}

// 創建全域實例
const localAITranslator = new LocalAITranslator();

// 導出給其他模組使用
if (typeof module !== 'undefined' && module.exports) {
    module.exports = LocalAITranslator;
} else if (typeof window !== 'undefined') {
    window.LocalAITranslator = LocalAITranslator;
    window.localAITranslator = localAITranslator;
}