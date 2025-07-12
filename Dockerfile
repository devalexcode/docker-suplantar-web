# Dockerfile
FROM node:18-alpine

WORKDIR /usr/src/app

COPY package.json ./
RUN npm install --production

COPY server.js hosts.json ./
COPY html ./html

EXPOSE 8080

CMD ["npm", "start"]
