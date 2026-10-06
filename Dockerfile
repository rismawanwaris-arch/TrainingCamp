FROM node:22-bookworm-slim

# Set working directory
WORKDIR /app

# Install build dependencies for compiling native addons (better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Clean up build tools to keep image small
RUN apt-get purge -y --auto-remove make g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy application code
COPY . .

# Ensure data and uploads directories exist
RUN mkdir -p /app/data /app/data/uploads

# Set default environment variables
ENV NODE_ENV=production
ENV PORT=5001
ENV DATA_DIR=/app/data
ENV UPLOADS_DIR=/app/data/uploads

# Expose target port
EXPOSE 5001

# Run server
CMD ["node", "src/server.js"]
