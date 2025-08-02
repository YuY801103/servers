const express = require('express');
const cors = require('cors');
const NodeCache = require('node-cache');
const axios = require('axios');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

// 創建快取實例 (快取 24 小時)
const cache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });

// 中間件設置
app.use(helmet());
app.use(compression());
app.use(cors({
    origin: ['chrome-extension://*', 'moz-extension://*', 'http://localhost:*'],
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// 速率限制
const limiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1分鐘
    max: 100, // 每分鐘最多100請求
    message: { error: '請求過於頻繁，請稍後再試' }
});
app.use('/api/', limiter);

// 優化的繁體中文翻譯提示詞
const getTranslationPrompt = (text, sourceLang = 'auto', targetLang = 'zh-tw') => {
    const prompts = {
        'zh-tw': `你是一個專業的翻譯專家，請將以下文本翻譯成台灣繁體中文。

翻譯要求：
1. 使用台灣地區的用詞習慣和表達方式
2. 保持原文的語氣、風格和格式
3. 技術術語使用台灣慣用翻譯
4. 確保翻譯自然流暢，符合中文語法
5. 如果是專有名詞，保持原文或使用台灣通用譯名
6. 保留原文中的HTML標籤、連結等格式

原文：
${text}

請只返回翻譯結果，不要包含任何解釋或說明：`,
        
        'zh-cn': `你是一個專業的翻譯專家，請將以下文本翻譯成簡體中文。

翻譯要求：
1. 使用大陸地區的用詞習慣和表達方式
2. 保持原文的語氣、風格和格式
3. 確保翻譯自然流暢，符合中文語法
4. 保留原文中的HTML標籤、連結等格式

原文：
${text}

請只返回翻譯結果，不要包含任何解釋或說明：`,
        
        'en': `You are a professional translator. Please translate the following text to English.

Requirements:
1. Maintain the original tone, style, and format
2. Use natural and fluent English
3. Preserve HTML tags, links and other formatting in the original text

Original text:
${text}

Please return only the translation result without any explanation:`
    };
    
    return prompts[targetLang] || prompts['zh-tw'];
};

// 與 Ollama 通信的函數
async function translateWithOllama(text, sourceLang = 'auto', targetLang = 'zh-tw', model = 'qwen2:7b-instruct') {
    try {
        const prompt = getTranslationPrompt(text, sourceLang, targetLang);
        
        console.log(`[翻譯請求] 模型: ${model}, 目標語言: ${targetLang}, 文本長度: ${text.length}`);
        
        const response = await axios.post(`${OLLAMA_BASE_URL}/api/generate`, {
            model: model,
            prompt: prompt,
            stream: false,
            options: {
                temperature: 0.1,      // 降低隨機性，提高一致性
                top_p: 0.9,
                top_k: 40,
                repeat_penalty: 1.1,
                num_predict: -1,       // 不限制輸出長度
                stop: ["原文：", "翻譯：", "說明："]
            }
        }, {
            timeout: 30000 // 30秒超時
        });
        
        let translation = response.data.response;
        
        // 清理翻譯結果
        translation = translation
            .replace(/^翻譯結果[：:]\s*/i, '')
            .replace(/^譯文[：:]\s*/i, '')
            .replace(/^翻譯[：:]\s*/i, '')
            .trim();
        
        console.log(`[翻譯完成] 用時: ${response.data.total_duration}ns, 結果長度: ${translation.length}`);
        
        return {
            success: true,
            translation: translation,
            model: model,
            stats: {
                total_duration: response.data.total_duration,
                load_duration: response.data.load_duration,
                prompt_eval_count: response.data.prompt_eval_count,
                eval_count: response.data.eval_count
            }
        };
        
    } catch (error) {
        console.error('[Ollama 錯誤]:', error.message);
        throw new Error(`翻譯失敗: ${error.message}`);
    }
}

// 批量翻譯函數
async function batchTranslate(texts, sourceLang, targetLang, model) {
    const results = [];
    const batchSize = 5; // 每批處理5個文本
    
    for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const batchPromises = batch.map(async (text, index) => {
            const cacheKey = `${model}_${sourceLang}_${targetLang}_${Buffer.from(text).toString('base64').substring(0, 50)}`;
            
            // 檢查快取
            const cached = cache.get(cacheKey);
            if (cached) {
                console.log(`[快取命中] 索引: ${i + index}`);
                return { index: i + index, ...cached };
            }
            
            try {
                const result = await translateWithOllama(text, sourceLang, targetLang, model);
                // 存入快取
                cache.set(cacheKey, result);
                return { index: i + index, ...result };
            } catch (error) {
                return { 
                    index: i + index, 
                    success: false, 
                    error: error.message,
                    translation: text // 失敗時返回原文
                };
            }
        });
        
        const batchResults = await Promise.allSettled(batchPromises);
        results.push(...batchResults.map(r => r.value || r.reason));
        
        // 批次間短暫延遲，避免過載
        if (i + batchSize < texts.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    
    return results.sort((a, b) => a.index - b.index);
}

// API 路由

// 健康檢查
app.get('/api/health', async (req, res) => {
    try {
        const response = await axios.get(`${OLLAMA_BASE_URL}/api/tags`, { timeout: 5000 });
        const models = response.data.models || [];
        const hasQwen = models.some(m => m.name.includes('qwen2'));
        
        res.json({
            status: 'healthy',
            ollama_connected: true,
            models_available: models.length,
            qwen2_available: hasQwen,
            cache_keys: cache.keys().length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(503).json({
            status: 'unhealthy',
            ollama_connected: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// 單文本翻譯
app.post('/api/translate', async (req, res) => {
    try {
        const { 
            text, 
            source_lang = 'auto', 
            target_lang = 'zh-tw', 
            model = 'qwen2:7b-instruct' 
        } = req.body;
        
        if (!text || text.trim().length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: '文本不能為空' 
            });
        }
        
        if (text.length > 10000) {
            return res.status(400).json({ 
                success: false, 
                error: '文本過長，請分段翻譯' 
            });
        }
        
        // 生成快取鍵
        const cacheKey = `${model}_${source_lang}_${target_lang}_${Buffer.from(text).toString('base64').substring(0, 50)}`;
        
        // 檢查快取
        const cached = cache.get(cacheKey);
        if (cached) {
            console.log('[快取命中]');
            return res.json({ ...cached, from_cache: true });
        }
        
        const result = await translateWithOllama(text, source_lang, target_lang, model);
        
        // 存入快取
        cache.set(cacheKey, result);
        
        res.json({ ...result, from_cache: false });
        
    } catch (error) {
        console.error('[翻譯錯誤]:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// 批量翻譯
app.post('/api/translate/batch', async (req, res) => {
    try {
        const { 
            texts, 
            source_lang = 'auto', 
            target_lang = 'zh-tw', 
            model = 'qwen2:7b-instruct' 
        } = req.body;
        
        if (!Array.isArray(texts) || texts.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: '文本數組不能為空' 
            });
        }
        
        if (texts.length > 50) {
            return res.status(400).json({ 
                success: false, 
                error: '單次最多翻譯50個文本' 
            });
        }
        
        console.log(`[批量翻譯] 開始處理 ${texts.length} 個文本`);
        const startTime = Date.now();
        
        const results = await batchTranslate(texts, source_lang, target_lang, model);
        
        const endTime = Date.now();
        console.log(`[批量翻譯完成] 用時: ${endTime - startTime}ms`);
        
        res.json({
            success: true,
            results: results,
            total_texts: texts.length,
            processing_time: endTime - startTime
        });
        
    } catch (error) {
        console.error('[批量翻譯錯誤]:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// 支援的語言列表
app.get('/api/languages', (req, res) => {
    res.json({
        supported_languages: {
            'zh-tw': '繁體中文 (台灣)',
            'zh-cn': '簡體中文',
            'en': 'English',
            'ja': '日本語',
            'ko': '한국어',
            'es': 'Español',
            'fr': 'Français',
            'de': 'Deutsch',
            'it': 'Italiano',
            'pt': 'Português',
            'ru': 'Русский',
            'ar': 'العربية'
        },
        default_target: 'zh-tw'
    });
});

// 快取統計
app.get('/api/cache/stats', (req, res) => {
    const stats = cache.getStats();
    res.json({
        ...stats,
        keys_count: cache.keys().length
    });
});

// 清除快取
app.delete('/api/cache', (req, res) => {
    cache.flushAll();
    res.json({ success: true, message: '快取已清除' });
});

// 錯誤處理中間件
app.use((error, req, res, next) => {
    console.error('[服務器錯誤]:', error);
    res.status(500).json({
        success: false,
        error: '內部服務器錯誤'
    });
});

// 404 處理
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        error: '路由不存在'
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 翻譯服務已啟動在端口 ${PORT}`);
    console.log(`📡 Ollama 連接地址: ${OLLAMA_BASE_URL}`);
    console.log(`💾 快取已啟用，TTL: 24小時`);
});

module.exports = app;