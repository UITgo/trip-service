# ---- Base image ----
FROM node:20-alpine AS base
WORKDIR /app

# Cần cho Prisma trên Alpine
RUN apk add --no-cache openssl libc6-compat

# ---- Dependencies + Build ----
FROM base AS builder
# copy các file cần để cài deps và generate prisma
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

# generate prisma client (cần khi build)
RUN npx prisma generate

# copy source và build Nest
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

# bỏ bớt dev deps để tối ưu image (giữ prisma client đã generate)
RUN npm prune --omit=dev

# ---- Runtime ----
FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app

# copy node_modules (đã prune), dist và prisma (để migrate/generate ở runtime nếu cần)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY package*.json ./

# PORT mặc định của service (compose map 3002:3002)
EXPOSE 3002

# Healthcheck tuỳ bạn thêm trong docker-compose
CMD ["node", "dist/main.js"]
