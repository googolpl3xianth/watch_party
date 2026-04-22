FROM node:18-slim

WORKDIR /home/node/app

COPY --chown=node:node package*.json ./
RUN npm install

COPY --chown=node:node . .

EXPOSE 3000

USER node

CMD ["node", "server.js"]