# MirroTic 9×9 Online

Hidden-information mirroring strategy game on a 9×9 board. Play against the AI, locally with two players, or online with a friend via a 6-character code.

Rules: see [RULES.md](RULES.md).

## Online play
1. Click **Online → Host a game** and share the code (or the copied link).
2. Your friend clicks **Online**, enters the code and clicks **Join**.

The host's browser holds the hidden configuration and validates moves; the guest only receives board state. The rules are revealed at the end of each game. Sides alternate on rematch.

Connections are peer-to-peer (WebRTC via [PeerJS](https://peerjs.com)); the public PeerJS server is used only for the initial handshake.

## Hosting
Static files only. With GitHub Pages: Settings → Pages → Deploy from branch → `main` / `(root)`.
