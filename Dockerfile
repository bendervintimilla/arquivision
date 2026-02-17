# Stage 1: Build the Vite app
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build args for env vars needed at build time
# Build args for env vars needed at build time
# Hardcoded for reliable Cloud Run source deploy
ENV GEMINI_API_KEY=***REMOVED_GEMINI_KEY***
ENV VITE_SUPABASE_URL=https://axprxywbbrrlypfaycpb.supabase.co
ENV VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF4cHJ4eXdiYnJybHlwZmF5Y3BiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkxNjEzODksImV4cCI6MjA4NDczNzM4OX0.0iIydaM-iFcabn-q63dqK_1CTLX8LRW_mGOr8qT0pZ0
ENV VITE_BACKEND_URL=https://archivision-backend-555543910452.us-central1.run.app

# Build
RUN npm run build

# Stage 2: Serve with Nginx
FROM nginx:alpine

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built files
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
