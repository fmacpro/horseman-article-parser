# AGENTS

- Install Node.js using NVM:
  - `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash`
  - `export NVM_DIR="$HOME/.nvm"`
  - `[ -s "$NVM_DIR/nvm.sh" ] && \\. "$NVM_DIR/nvm.sh"`
  - `nvm install --lts`
  - `node --version`

- Install Chrome's required system libraries before installing dependencies:
  - `DEBIAN_FRONTEND=noninteractive apt-get update`
  - `DEBIAN_FRONTEND=noninteractive apt-get install -y apt-utils`
  - `DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends fonts-liberation libasound2t64 libatk-bridge2.0-0t64 libgtk-3-0t64 libnss3 libx11-xcb1 libxkbcommon0 libu2f-udev libgbm1`

- Install project dependencies and Chrome. Preferred approach uses an npm-provided build for speed:
  - `CI=1 npm ci`
  - `CI=1 node node_modules/puppeteer/install.mjs`
  - `export CHROME_PATH="$(node -e \"import('puppeteer').then(p => console.log(p.executablePath()));\")"`
  - Verify installation with `CI=1 "$CHROME_PATH" --version`
  - If the npm download fails, install Google Chrome from the .deb package instead:
    - `wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb`
    - `DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ./google-chrome-stable_current_amd64.deb fonts-liberation libasound2t64 libatk-bridge2.0-0t64 libgtk-3-0t64 libnss3 libx11-xcb1 libxkbcommon0 libu2f-udev libgbm1`
    - `google-chrome --version`


