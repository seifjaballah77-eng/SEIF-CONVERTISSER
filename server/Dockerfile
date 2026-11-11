FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip ca-certificates && python3 -m pip install --break-system-packages --no-cache-dir yt-dlp && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Render's manual Docker service uses the repository root as build context.
COPY server/package*.json ./
RUN npm install --omit=dev
COPY server/server.js ./
ENV NODE_ENV=production
EXPOSE 8080
CMD ["npm","start"]
