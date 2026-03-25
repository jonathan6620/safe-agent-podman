# safe-agent-podman shell configuration

# Oh My Zsh
export ZSH="$HOME/.oh-my-zsh"
ZSH_THEME="robbyrussell"
plugins=(git)
source $ZSH/oh-my-zsh.sh

# fnm (Node.js version manager)
export FNM_DIR="/usr/local/share/fnm"
eval "$(fnm env --shell zsh)"

# Local bin (claude wrapper, user-installed tools)
export PATH="$HOME/.local/bin:$PATH"

# uv (Python package manager)
eval "$(uv generate-shell-completion zsh 2>/dev/null)" || true
alias python3='uv run python3'
alias ipython='uv run --with ipython ipython3'

# BAT_THEME is set dynamically by post-create.sh at first boot
