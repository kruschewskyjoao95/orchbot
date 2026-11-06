FROM mcr.microsoft.com/playwright:v1.64.1-noble@sha256:ee15712262f017b8157421b212b12099146645f44b1bc5c0514cbbe6a229b1d0
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 NODE_PATH=/usr/lib/node_modules
RUN npm install --global --omit=dev @openai/codex@0.166.0 @anthropic-ai/claude-code@2.1.318 @playwright/mcp@0.0.84 playwright@1.64.1 \
    && ln -s "$(find /ms-playwright -path '*/chrome-linux64/chrome' -type f | head -1)" /usr/local/bin/orchbot-chromium \
    && test -x /usr/local/bin/orchbot-chromium
LABEL org.orchbot.runtime="1"
