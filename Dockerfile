# EZ Shots is a static site. This Dockerfile exists so Railway builds with Docker
# instead of Railpack. Railpack mounts every Railway service variable into the
# build as a BuildKit secret, and one malformed variable name there took down
# every deploy. Docker builds do not do that. See PROJECT-STATE.md, 2026-09-01.
FROM node:22-alpine

WORKDIR /app

# Install first so the dependency layer is cached across content-only changes.
# npm ci needs the lockfile and installs exactly what it pins.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Railway injects PORT at runtime. package.json falls back to 3000 locally.
EXPOSE 3000
CMD ["npm", "start"]
