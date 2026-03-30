FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --production
COPY src/ src/
COPY public/ public/

EXPOSE 3666
CMD ["node", "src/index.js"]
