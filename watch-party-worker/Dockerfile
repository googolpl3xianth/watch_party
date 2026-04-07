FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y ffmpeg bash

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .

RUN chmod +x /app/convert_videos.sh

CMD ["node", "worker.js"]