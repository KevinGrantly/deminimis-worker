FROM mcr.microsoft.com/playwright:v1.53.0-jammy

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src

ENV NODE_ENV=production
CMD ["npm", "start"]
