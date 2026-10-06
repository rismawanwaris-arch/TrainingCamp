FROM node:22-bookworm-slim

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (better-sqlite3 memiliki prebuilt binary untuk debian/glibc)
RUN npm install --omit=dev

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
