FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY server.js ./
ENV PORT=8765
ENV HOST=0.0.0.0
EXPOSE 8765
CMD ["node", "server.js"]
