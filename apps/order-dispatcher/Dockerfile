FROM node:20-alpine
WORKDIR /app

COPY package.json ./
COPY tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages

RUN npm install
RUN npm run build

CMD ["npm", "run", "-w", "@smp/order-dispatcher", "start"]
