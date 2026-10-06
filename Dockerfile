FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install python and build tools needed for better-sqlite3 native compilation on alpine
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install dependencies (production & build native modules)
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
