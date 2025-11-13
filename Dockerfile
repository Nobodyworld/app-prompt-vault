# Use Node.js 24 (matching .nvmrc)
FROM node:24-alpine AS base

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++ git

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci --only=production=false

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:24-alpine AS production

# Install runtime dependencies for SQLite
RUN apk add --no-cache sqlite

# Create app user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy built application from build stage
COPY --from=base --chown=nodejs:nodejs /app/dist ./dist
COPY --from=base --chown=nodejs:nodejs /app/src/db/migrations ./dist/db/migrations
COPY --from=base --chown=nodejs:nodejs /app/src-tauri ./dist/src-tauri

# Create data directory for SQLite database
RUN mkdir -p /app/data && chown -R nodejs:nodejs /app/data

# Switch to non-root user
USER nodejs

# Expose port (default from server.ts)
EXPOSE 3001

# Set environment variables
ENV NODE_ENV=production
ENV PROMPT_VAULT_DB_PATH=/app/data/prompt-vault.db

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/observability/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

# Start the application
CMD ["node", "dist/server.js"]
