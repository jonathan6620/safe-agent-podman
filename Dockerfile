FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

ARG NODE_VERSION=22

# System tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    bubblewrap \
    ripgrep \
    tmux \
    zsh \
    git \
    curl \
    iptables \
    iproute2 \
    dnsutils \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Node.js via fnm
RUN curl -fsSL https://fnm.vercel.app/install | bash -s -- --install-dir /usr/local/bin \
    && /usr/local/bin/fnm install ${NODE_VERSION} \
    && /usr/local/bin/fnm default ${NODE_VERSION}

ENV PATH="/root/.local/share/fnm/aliases/default/bin:${PATH}"

# Install Claude Code globally
RUN npm install -g @anthropic-ai/claude-code

# Setup script
COPY post-create.sh /setup/post-create.sh
COPY firewall.sh /setup/firewall.sh
RUN chmod +x /setup/*.sh

USER vscode
WORKDIR /workspace
