FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip ca-certificates curl git && \
    python3 -m pip install --break-system-packages --no-cache-dir --upgrade "yt-dlp[default]" bgutil-ytdlp-pot-provider && \
    curl -fsSL https://deno.land/install.sh | sh -s -- -y && \
    git clone --depth 1 --single-branch --branch 2.0.2 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil-ytdlp-pot-provider && \
    cd /opt/bgutil-ytdlp-pot-provider/server && npm ci && npx tsc && \
    apt-get purge -y --auto-remove git curl && rm -rf /var/lib/apt/lists/* /root/.npm
ENV PATH="/root/.deno/bin:${PATH}"
WORKDIR /app
# Render's manual Docker service uses the repository root as build context.
COPY server/package*.json ./
RUN npm install --omit=dev
COPY server/server.js ./
ENV NODE_ENV=production
EXPOSE 8080
CMD ["npm","start"]
