# EMPIRE ✳ — party game for friends

A mobile-friendly multiplayer web app for the game Empire. Everyone answers the same question privately; the host sees the answers in a random order and reveals the people behind them after everyone guesses.

## How to play

1. The host opens the website, enters their name, and chooses the first question.
2. Tap **Share** or **Copy link** to send an invitation. There is also a six-character code.
3. Every player opens the link on their own phone, enters a name, and submits a private answer. The host can submit an answer too.
4. The host sees who has answered and taps **Shuffle & reveal** when ready.
5. Read the anonymous answers aloud. After guesses, tap **Who said it?** on an answer to reveal its author.
6. Choose another question and start a new round without rejoining.

Players need no accounts. Only the host sees the answer board, and even the host cannot see the authors until they press the reveal control. Players can edit answers until the host starts the reveal. Rooms and host sessions survive browser refreshes while the server remains running.

## Get a public, shareable link (Render)

This download contains the **working application code, not a live website URL**. To give everyone a link that works on separate phones:

1. Create a GitHub repository and upload the **unzipped contents** of this project, including `server.js`, `public/`, and `render.yaml`.
2. Sign in at https://dashboard.render.com and choose **New → Web Service**. Connect your repository.
3. Choose runtime **Node** and plan **Free**. Set build command to `echo "No dependencies required"` and start command to `npm start`. (The provided `render.yaml` has these settings for a Blueprint deployment.)
4. After deployment, open the `https://YOUR-NAME.onrender.com` address, create a game, and tap **Share**. That generated invite link is the one to send your friends.

Render offers Free web services, but they can spin down after 15 minutes of inactivity. A service spin-down, restart, or redeployment can erase the rooms and answers because this app keeps them in memory. Keep the webpage open and actively use it during your game. For important games, use a persistent database and always-on hosting.

Documentation: https://render.com/docs/your-first-deploy and https://render.com/docs/free

## Run locally (no dependencies)

Install Node.js 20 or newer, then:

```sh
npm start
```

Open http://localhost:3000. To test on other phones using the same Wi-Fi network, open `http://YOUR_COMPUTER_LAN_IP:3000` on the host phone instead of `localhost`, and ensure your computer's firewall permits port 3000. Create the room from the LAN address so the invite link points there too. Cross-network friends need public hosting.

Run the automated tests using:

```sh
npm test
```

## How it works

- Zero external Node.js packages, and no build step
- Simple HTTP API plus live server-sent events (SSE)
- Cryptographically generated room codes and private player/host tokens
- Securely randomized, per-round answer ordering
- Host-only answers board and individual reveals
- Duplicate player-name checks, optional player removal, reusable rooms
- HTML-escaped user content to protect the user interface

**Privacy:** This is an informal party game, not an app for sensitive information. Player sessions are saved in their browser and rooms are only protected by invite codes. Host privileges are protected separately by a random private token that is not included in normal invite links. The server's in-memory room data is temporary.