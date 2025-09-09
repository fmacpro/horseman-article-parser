# AGENTS

- Install Google Chrome and its required system libraries quickly:
  - `apt-get update`
  - `wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb`
  - `apt-get install -y --no-install-recommends ./google-chrome-stable_current_amd64.deb fonts-liberation libasound2t64 libatk-bridge2.0-0t64 libgtk-3-0t64 libnss3 libx11-xcb1 libxkbcommon0 libu2f-udev`
  - Verify installation with `google-chrome --version`
- Install Node.js using NVM and install dependencies:
  - `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash`
  - `export NVM_DIR="$HOME/.nvm"`
  - `[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"`
  - `nvm install --lts`
  - `node --version`
  - `npm install`
