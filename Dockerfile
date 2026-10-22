# Stage 1: Build the Vite app
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

ARG VITE_SUPABASE_URL=https://axprxywbbrrlypfaycpb.supabase.co
# O1748: la anon key ya no vive en el repo. Llega como build-arg
# (deploy.sh -> cloudbuild.frontend.yaml) y el build falla si no está.
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_BACKEND_URL=https://archivision-backend-d4v7u54w5a-ew.a.run.app
ARG VITE_REQUIRE_AUTH=true

ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL
ENV VITE_REQUIRE_AUTH=$VITE_REQUIRE_AUTH

# Build
RUN test -n "$VITE_SUPABASE_ANON_KEY" || (echo "ERROR: falta el build-arg VITE_SUPABASE_ANON_KEY (anon key de Supabase)" >&2; exit 1)
RUN npm run build

# Stage 2: Serve with Nginx
FROM nginx:alpine

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built files
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
