FROM node:24.21.0-bookworm-slim

RUN mkdir -p /workspace/node_modules /workspace/apps/web/node_modules \
      /workspace/packages/bindings/node_modules \
    && chmod 1777 /workspace/node_modules /workspace/apps/web/node_modules \
      /workspace/packages/bindings/node_modules
WORKDIR /workspace
