# MirroTic 9×9 Online

Hidden-information mirroring strategy game on a 9×9 board. Play against the AI at seven difficulty levels, with two players on one screen (hot seat), or online with a friend via a 6-character code.

Rules: see [RULES.md](RULES.md).

## Starting a game
Press **New game** above the board and choose:
- **vs AI:** pick a level from 0 (Training) to 6 (Master), then play ×, ○ or a random side.
- **Hot seat:** two players take turns on the same screen.
- **Online:** host a game or join one with a code.

## AI levels
| Level | Name | Elo |
|---|---|---|
| 0 | Training | 331 |
| 1 | Beginner | 538 |
| 2 | Easy | 797 |
| 3 | Normal | 954 |
| 4 | Hard | 1,138 |
| 5 | Expert | 1,279 |
| 6 | Master | 1,452 |

The bots live in `sim/skill/skill9.js` and only use public information: the board and where each move's copy landed. They never see the hidden configuration. If that file can't be loaded (for example when `index.html` is opened directly from disk), every level falls back to a simpler built-in AI. Serve the folder over HTTP to get all levels.

## Online play
1. Press **New game → Online → Host a game** and share the code (or the copied link).
2. Your friend presses **New game → Online**, enters the code and presses **Join**.

The host's browser holds the hidden configuration and validates moves; the guest only receives board state. The rules are revealed at the end of each game. Sides alternate on rematch.

Connections are peer-to-peer (WebRTC via [PeerJS](https://peerjs.com)); the public PeerJS server is used only for the initial handshake.

## Hosting
Static files only. With GitHub Pages: Settings → Pages → Deploy from branch → `main` / `(root)`.
