# HOWL

A desktop companion for League of Legends **ARAM: Mayhem**. HOWL connects to your League client on its own and helps in three places:

- **Champ select:** rates your champion, your bench and your teammates' picks (for trades) with a tier and the reasons behind it. It writes its build into the client as an item set and can set your summoner spells.
- **In game:** an overlay with the skill to level next, the next items to buy (adjusted to the enemy team, for example anti-heal against healers or penetration against tanks), your build progress and the team item gold difference.
- **Augments:** when the augment cards appear, HOWL reads their names off the screen and puts a tier badge over each card, highlights the best pick and says why it fits your champion.

It also has a builds browser for every champion, a browser for the full Mayhem augment pool, your own Mayhem record from match history, and a short review after each game.

## For friends: just run it

1. Download `HOWL-<version>-portable.exe` from the [Releases page](https://github.com/AH228589/howl/releases).
2. Double-click it. Windows may show "Windows protected your PC" because the app is not code-signed: click **More info**, then **Run anyway**.
3. Set League to **borderless** or **windowed** (Settings > Video > Window mode) so the overlay can sit on top.

No Riot API key needed: HOWL downloads the shared ARAM build stats from this repository on its own. It only reads your League client and your screen; it never changes game files.

## Run from source

```powershell
npm.cmd install
npm.cmd start
```

League must run in **borderless** or **windowed** mode for the overlay to show on top of the game.

Hotkeys: `Ctrl+Shift+H` shows or hides the overlay, `Ctrl+Shift+J` reads the augment cards now and saves what HOWL saw (image plus the text it read) to `%APPDATA%howlscans`, handy when a card is misread.

Overlay position, size and opacity are in Settings. HOWL keeps an activity log in `%APPDATA%howlhowl.log`.

## Where the data comes from

| Data | Source |
| --- | --- |
| Champions, items, summoner spells | Riot Data Dragon, refreshed each patch |
| Mayhem augment pool, names, text | Riot game data via CommunityDragon (mode `KIWI`) |
| Community tiers for augments and champions | `data/community/mayhem-reference.json`, compiled from public tier lists (sources inside the file) |
| Your games and the other nine players' builds | Your client's match history, saved locally so it grows past the client's limit of about 20 games |
| Your skill order and buy order | Recorded live from Riot's Live Client Data API while you play |
| Global ARAM builds, first items, skill orders | Riot match-v5 API (queue 450, current and previous patch) with your own key, see below |

Riot keeps Mayhem match data private on its public API, so HOWL cannot download global Mayhem stats. Builds start as an estimate from each champion's kit, then lean on regular ARAM games from the Riot API (same map, public data) and on your recorded Mayhem games as they add up.

### Riot API key (optional, recommended)

Only the person publishing the shared stats needs a key; everyone else uses the shared file.

1. Log in at [developer.riotgames.com](https://developer.riotgames.com) with your Riot account.
2. Copy the **Development API Key** from your dashboard (it starts with `RGAPI-`).
3. In HOWL open **Settings**, paste it into the key box and press **Save key**. Collection starts right away and then runs in the background at most every 6 hours.

Development keys expire after 24 hours; HOWL shows an error when the key is rejected, and you paste a fresh one. For a key that does not expire, register a Personal API Key product on the same site. The key is stored only in HOWL's settings file on this PC and is never shown back in the window.

## Rules HOWL follows

- It only uses Riot's local client API, the official Live Client Data API and a screenshot of the screen for augment names. It never touches game files or memory and never automates input.
- It never shows augment win rates: Riot's developer policy forbids apps from displaying them. Augment tiers and reasons are shown instead.
- Several options are always shown next to each other; nothing is picked for you.

HOWL isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties.

## Development

```powershell
npm.cmd test          # engine, OCR matcher and full session flow against a fake client
npm.cmd run e2e       # launches the real app invisibly against the fake client and saves screenshots
npm.cmd run snapshot  # refreshes the bundled game data (data/gamedata.json)
npm.cmd run fake      # fake League client + live game for manual testing
npm.cmd run dist      # portable HOWL-<version>-portable.exe in dist/
npm.cmd run publish-stats -- --push  # share your collected ARAM stats (counts only, no key or ids)
```
