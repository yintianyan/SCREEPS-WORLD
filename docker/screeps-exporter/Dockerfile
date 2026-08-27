FROM node:24

WORKDIR /app
COPY package.json ./
RUN npm install --production --omit=dev
COPY index.js ./

EXPOSE 9115
CMD ["node", "index.js"]
