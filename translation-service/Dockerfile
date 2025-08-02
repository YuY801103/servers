FROM node:18-alpine

# 設置工作目錄
WORKDIR /app

# 複製 package.json 和 package-lock.json
COPY package*.json ./

# 安裝依賴
RUN npm ci --only=production && npm cache clean --force

# 複製應用代碼
COPY . .

# 創建非 root 用戶
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# 更改文件所有者
RUN chown -R nodejs:nodejs /app
USER nodejs

# 健康檢查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# 暴露端口
EXPOSE 3000

# 啟動應用
CMD ["node", "server.js"]