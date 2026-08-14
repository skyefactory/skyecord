Private , encrypted, peer2peer WebRTC chat, aiming to replicate common features found in web conferencing apps like Discord, Teams, and Zoom.


**Open Source Disclosure**
This project includes third-party open-source software. The sections below list direct dependencies declared in the repository and provide links to their upstream projects and license information.

**Root (electron app) dependencies**
- **@electron-forge/cli**: ^7.11.2 — https://www.npmjs.com/package/@electron-forge/cli (MIT)
- **@electron-forge/maker-deb**: ^7.11.2 — https://www.npmjs.com/package/@electron-forge/maker-deb (MIT)
- **@electron-forge/maker-rpm**: ^7.11.2 — https://www.npmjs.com/package/@electron-forge/maker-rpm (MIT)
- **@electron-forge/maker-squirrel**: ^7.11.2 — https://www.npmjs.com/package/@electron-forge/maker-squirrel (MIT)
- **@electron-forge/plugin-auto-unpack-natives**: ^7.11.2 — https://www.npmjs.com/package/@electron-forge/plugin-auto-unpack-natives (MIT)
- **@electron-forge/plugin-fuses**: ^7.11.2 — https://www.npmjs.com/package/@electron-forge/plugin-fuses (MIT)
- **@electron-forge/publisher-github**: ^7.11.2 — https://www.npmjs.com/package/@electron-forge/publisher-github (MIT)
- **@electron/fuses**: ^1.8.0 — https://www.npmjs.com/package/@electron/fuses (MIT)
- **@eslint/js**: ^10.0.1 — https://www.npmjs.com/package/@eslint/js (MIT)
- **electron**: ^43.1.1 — https://www.npmjs.com/package/electron (MIT)
- **eslint**: ^10.8.0 — https://www.npmjs.com/package/eslint (MIT)
- **globals**: ^17.9.0 — https://www.npmjs.com/package/globals (MIT)

**Root (runtime) dependencies**
- **@tailwindcss/cli**: ^4.3.3 — https://www.npmjs.com/package/@tailwindcss/cli (see upstream)
- **electron-squirrel-startup**: ^1.0.1 — https://www.npmjs.com/package/electron-squirrel-startup (Apache-2.0)
- **tailwindcss**: ^4.3.3 — https://www.npmjs.com/package/tailwindcss (see upstream)
- **update-electron-app**: ^3.3.0 — https://www.npmjs.com/package/update-electron-app (MIT)

**authserver dependencies (authserver/package.json)**
- **bcryptjs**: ^3.0.3 — https://www.npmjs.com/package/bcryptjs (MIT)
- **cors**: ^2.8.6 — https://www.npmjs.com/package/cors (MIT)
- **dotenv**: ^17.4.2 — https://www.npmjs.com/package/dotenv (see upstream)
- **express**: ^5.2.1 — https://www.npmjs.com/package/express (MIT)
- **mysql2**: ^3.23.0 — https://www.npmjs.com/package/mysql2 (see upstream)
- **ws**: ^8.21.1 — https://www.npmjs.com/package/ws (MIT)

**signalserver dependencies (signalserver/package.json)**
- **dotenv**: ^17.4.2 — https://www.npmjs.com/package/dotenv (see upstream)
- **mysql2**: ^3.23.0 — https://www.npmjs.com/package/mysql2 (see upstream)
- **validator**: ^13.15.35 — https://www.npmjs.com/package/validator (MIT)
- **ws**: ^8.21.1 — https://www.npmjs.com/package/ws (MIT)

**Included non-NPM library: rnnoise**
- rnnoise is included or used by this project (audio noise-suppression library).
- Copyright and license (from rnnoise upstream):

  Copyright (c) 2017, Mozilla
  Copyright (c) 2007-2017, Jean-Marc Valin
  Copyright (c) 2005-2017, Xiph.Org Foundation
  Copyright (c) 2003-2004, Mark Borgerding

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions
  are met: (see full license in upstream COPYING)

- Full rnnoise license and source: https://github.com/xiph/rnnoise (COPYING: https://raw.githubusercontent.com/xiph/rnnoise/master/COPYING)