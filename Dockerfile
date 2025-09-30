# Dockerfile - for Render (Remotion + ffmpeg)
# Based on Node 18 (change tag if you want Node 20)
FROM node:18-bullseye-slim

# لازم تثبّت أدوات النظام والمكتبات اللي يحتاجها headless chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    wget \
    curl \
    gnupg \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    libatspi2.0-0 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libasound2 \
    lsb-release \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/*

# FFmpeg: إذا تحتاج ffmpeg bin في الحاوية، ثبته هنا أيضاً
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

# Create app dir
WORKDIR /app

# Copy package.json first (cache npm install)
COPY package.json package-lock.json* ./ 

# Install dependencies
RUN npm install --production=false --no-audit --prefer-offline

# Copy rest
COPY . .

# Build step (if you have any build script, optional)
# RUN npm run build

# Expose port expected by Render (your server uses process.env.PORT)
ENV PORT 10000
EXPOSE 10000

# Start command
CMD ["npm", "start"]
