# Next.js frontend — dev server, consistent with how the rest of this
# compose stack runs (gradio/dagster also run in dev/served mode, not
# hardened prod builds).
FROM node:20-bullseye

WORKDIR /app

# Install dependencies first for better layer caching
COPY package.json package-lock.json ./
RUN npm install --legacy-peer-deps

# Copy the rest of the source
COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]
