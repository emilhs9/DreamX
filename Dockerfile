FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build

FROM node:22-alpine AS backend
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3000
CMD ["node", "server.js"]

FROM nginx:1.27-alpine AS frontend
COPY --from=build /app/dist/client /usr/share/nginx/html
COPY docker/frontend-nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
