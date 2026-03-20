FROM node:18-bullseye-slim

RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY worker.js .
COPY convert_videos.sh .
RUN chmod +x convert_videos.sh

CMD ["node", "worker.js"]