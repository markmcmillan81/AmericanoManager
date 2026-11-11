# Padel Spot

Runs weekly padel Americanos and Mexicanos for 4–8 players, keeps every result, and gives everyone a link to view live scores, past results and the all-time leaderboard.

- **Formats:** Americano (fixed rotation) or Mexicano (each round drawn from the standings)
- **Play as:** individual (partners rotate) or fixed pairs
- **Scoring:** points or games, any target (e.g. 24 points), with optional "scores add up to the target" auto-fill
- **Matching:** each player count has a fixed slot rotation (slots 1–8). Randomise shuffles who sits in which slot, or tap two players to swap them.
- **Viewing vs scoring:** anyone with the link can view. Only someone with the organiser key can create tournaments or enter scores.
- **History:** every tournament is stored online. The leaderboard adds your totals from the old app (`public/legacy.json`).
- **Phone app:** installs to the iPhone or Android home screen from the browser. No App Store needed.

## How fair is the matching?

Checked by `npm test`, which plays thousands of simulated matches.

| Players | Courts | Default rounds | What you get |
|---|---|---|---|
| 8 | 2 | 7 | **Perfect:** partner everyone exactly once, face everyone exactly twice |
| 7 | 1 | 7 | Partner each player at most once; face everyone 1–2 times; everyone sits 3 |
| 6 | 1 | 6 | Partner each player at most once; face everyone 1–3 times; everyone sits 2. A 15-round full rotation is perfect (partner ×2, face ×4) |
| 5 | 1 | 5 | **Perfect:** partner everyone once, face everyone twice, everyone sits once |
| 4 | 1 | 6 | **Perfect** (two full rotations) |

You can change the number of rounds. The setup screen shows the round counts at which sit-outs come out exactly even. If you play beyond the full rotation, it starts again from the top.

Mexicano by design pairs people by current ranking (1st & 4th v 2nd & 3rd on each court), so repeat partnerships happen. The app swaps to a different pairing on a court when that avoids a repeat.

The tournament page has a "Who played with / against whom" table you can open, so you can see the matching for yourself.

---

## 1. Run it on your laptop (about 10 minutes, one-off setup)

1. Install **Node.js**: go to https://nodejs.org and download the "LTS" version. Install it with the default options.
2. Unzip this folder somewhere easy, e.g. `Documents/padel-spot`.
3. Open a terminal in that folder:
   - **Mac:** open Terminal, type `cd ` (with a space after it), drag the folder into the window, press Enter.
   - **Windows:** open the folder in File Explorer, click the address bar, type `cmd`, press Enter.
4. Type `npm install` and press Enter. This downloads the one library the app needs and takes about a minute.
5. Make a copy of `.env.example` named `.env` and change `change-me` to any password you like. That password is your organiser key for laptop testing. (On a Mac, files starting with a dot are hidden; press Cmd+Shift+. in Finder to show them.)
6. Type `npm run local` and press Enter. It prints something like:
   ```
   On this laptop:  http://localhost:8888
   On your phone:   http://192.168.1.23:8888   (same Wi-Fi)
   ```
7. Open the laptop address in Chrome. To see it at phone size, press F12 (Windows) or Cmd+Option+I (Mac), then click the phone icon.
8. On your phone, connected to the same Wi-Fi, open the "On your phone" address in Safari. If a Mac firewall prompt appears, click Allow.
9. Tap **Organiser** and enter the key from step 5. Then try a tournament.

Test results on your laptop are saved in the `.local-data` folder. Delete that folder to start fresh. Press Ctrl+C in the terminal to stop the app.

## 2. Put it online (GitHub + Netlify, about 15 minutes)

**GitHub**

1. On github.com, click **+ → New repository**. Name it `padel-spot`, choose **Private** or Public (either works), and click **Create repository**.
2. On the new repo's page, click **uploading an existing file**. Drag in everything inside the project folder **except** `node_modules`, `.local-data` and `.env`. Then click **Commit changes**.
   (Alternatively, use GitHub Desktop, which respects `.gitignore` automatically.)

**Netlify**

3. On app.netlify.com, go to **Add new site → Import an existing project → GitHub**, then choose `padel-spot`. Netlify reads the settings from `netlify.toml`, so leave everything as it is and click **Deploy**.
4. Go to **Site configuration → Environment variables → Add a variable**. Set the key to `ADMIN_KEY` and the value to your real organiser password. Make it a proper one, because this is what stops anyone else editing results.
5. Go to **Deploys → Trigger deploy → Deploy site**, so the new key takes effect.
6. Optional: **Site configuration → Change site name** to something like `padel-spot-gresham`. Your link becomes `https://padel-spot-gresham.netlify.app`.

Storage (Netlify Blobs) switches on automatically, so there's no database to set up. Netlify's free plan is plenty for this.

## 3. Install it on your phone

- **iPhone:** open your Netlify link in **Safari**, tap **Share → Add to Home Screen**. It opens full-screen like a normal app.
- **Android:** open the link in Chrome, then tap **⋮ → Add to Home screen** (or **Install app**).
- Then tap **Organiser** once and enter your key. Your phone remembers it.

Other players can do the same without the key. They'll see live scores, results and the leaderboard, but can't change anything.

## 4. Weekly routine

1. **Before play:** tap **+ New tournament**. Your settings from last time are pre-filled. Tap the eight players, tap **Randomise** (or swap anyone by tapping two names), check Round 1, then tap **Start**.
2. **Share the link** in the group chat. People can follow the scores live, and the page refreshes itself.
3. **After each match:** tap a score box and tap the score. With "add up to 24" switched on, entering one side fills in the other.
4. **Mexicano:** the next round is drawn automatically when the last score of a round goes in.
5. **Running late or early:** use **+ Add a round**, or finish early. Unscored matches are dropped.
6. **At the end:** tap **Finish & save result**. The winner goes into the history and the leaderboard updates.

Made a mistake? Open the tournament, tap **Reopen to edit scores**, fix it, and finish again.

**Signal at the courts:** scores are saved on the phone first and uploaded when there's a connection. Under the title you'll see either "Saved ✓" or "Not saved online yet — will retry".

## 5. Looking after it

- **Backups:** once a month, go to Leaderboard → **Download everything (JSON)** and keep the file somewhere safe. The **CSV** download opens in Excel.
- **Old-app totals:** these are in `public/legacy.json`, typed from your 11 Nov 2026 screenshot. Edit them on GitHub (open the file, click the pencil, Commit). Make sure names match exactly how you add players in the app (e.g. "Mark M"), so their stats combine.
- **Changes and updates:** any change committed on GitHub goes live on Netlify in about a minute.
- **Second organiser:** give them the organiser key. To revoke access, change `ADMIN_KEY` in Netlify and redeploy. Everyone then needs to log in again with the new key.
- **App name:** change "Padel Spot" in `public/index.html` and `public/manifest.webmanifest`.

## Files

```
public/              the app (what people's phones load)
  index.html, styles.css, app.js   screens
  scheduler.js       tournament rules: rotations, Mexicano draw, standings, career stats
  schedules.js       the fixed slot rotations for 4–8 players (generated)
  legacy.json        totals carried over from the old app
netlify/functions/api.mjs   saves and loads tournaments (Netlify Blobs)
tools/               local server, and the scripts that generated the rotations
tests/               npm test: checks rotations and simulates every format
```
