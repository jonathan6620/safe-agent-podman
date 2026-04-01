FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

ARG NODE_VERSION=22

# System tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    bat \
    bubblewrap \
    curl \
    dnsutils \
    fuse-overlayfs \
    git \
    iptables \
    iproute2 \
    neovim \
    podman \
    python3 \
    ripgrep \
    tmux \
    uidmap \
    zsh \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/batcat /usr/local/bin/bat

# Configure subordinate UID/GID ranges for rootless podman inside the container
RUN usermod --add-subuids 100000-165535 vscode \
    && usermod --add-subgids 100000-165535 vscode

# Python package management via uv
RUN curl -LsSf https://astral.sh/uv/install.sh | sh \
    && mv /root/.local/bin/uv /usr/local/bin/ \
    && mv /root/.local/bin/uvx /usr/local/bin/

# Node.js via fnm (install to shared location so vscode user can access)
ENV FNM_DIR="/usr/local/share/fnm"
RUN curl -fsSL https://fnm.vercel.app/install | bash -s -- --install-dir /usr/local/bin \
    && mkdir -p ${FNM_DIR} \
    && /usr/local/bin/fnm install ${NODE_VERSION} \
    && /usr/local/bin/fnm default ${NODE_VERSION}

ENV PATH="${FNM_DIR}/aliases/default/bin:${PATH}"

# Install Claude Code via native installer
RUN curl -fsSL https://claude.ai/install.sh | bash \
    && mv /root/.local/share/claude /usr/local/share/claude \
    && CLAUDE_VER=$(ls /usr/local/share/claude/versions/) \
    && ln -sf /usr/local/share/claude/versions/${CLAUDE_VER} /usr/local/bin/claude

# Setup scripts
COPY post-create.sh /setup/post-create.sh
COPY firewall.sh /setup/firewall.sh
COPY entrypoint.sh /setup/entrypoint.sh
RUN chmod +x /setup/*.sh

# Allow vscode user to run apt/apt-get without sudo
RUN printf '#!/bin/bash\nexec sudo /usr/bin/apt "$@"\n' > /usr/local/bin/apt \
    && chmod +x /usr/local/bin/apt \
    && printf '#!/bin/bash\nexec sudo /usr/bin/apt-get "$@"\n' > /usr/local/bin/apt-get \
    && chmod +x /usr/local/bin/apt-get

USER vscode
RUN mkdir -p /home/vscode/.claude /home/vscode/.local/bin
COPY --chown=vscode:vscode zshrc /home/vscode/.zshrc
WORKDIR /workspace
ENTRYPOINT ["/setup/entrypoint.sh"]
