# MirroTic 9×9 (experimental)

A larger MirroTic variant. Everything not listed here works as in MirroTic 3×3 (see `RULES.md`).

## Board

The board is 9×9, made of nine 3×3 quadrants:

```
Q1 | Q2 | Q3
---+----+---
Q4 | Q5 | Q6
---+----+---
Q7 | Q8 | Q9
```

Quadrants alternate border colours in a checkerboard. For scoring the board is one continuous 9×9 grid.

## Hidden configuration

At the start of each game, a configuration is drawn at random:

- **One unpaired quadrant**, at a random position. A move there places a single symbol with no copy.
- **Four quadrant pairs** formed randomly from the other eight. A move in a paired quadrant also places a copy in its partner.
- **Each pair gets its own random mirror rule:**
  - **x-axis**: flipped left ↔ right
  - **y-axis**: flipped top ↔ bottom
  - **both**: rotated 180°

  Pairs can share a rule.

That gives 9 × 105 × 81 = **76,545** possible configurations. Everything is hidden. Players deduce the configuration from where copies land, or don't land.

## Game

- A game is a single round of **30 moves**, 15 per player. X moves first.
- The board doesn't fill up: a game ends with roughly 57–60 of 81 cells occupied, depending on how many moves were played in the unpaired quadrant.
- In simulations between equal bots (looking three moves ahead), starting gave no measurable edge: the starter won 48.2% of 712 rounds (95% CI 44.5–51.8). That's why 9×9 is played as one round, while 3×3 uses two.

## Scoring and winning

- Scoring is unchanged: a maximal line of *n* ≥ 3 symbols scores **n × (n − 2)**, so lines of 3 to 9 score 3, 8, 15, 24, 35, 48 or 63.
- The higher score after 30 moves wins. Equal scores are a draw.

## AI opponent

- The bot sees only the board and the round's move history.
- It keeps the set of configurations still consistent with what it has seen (usually narrowed to one within about 8 moves).
- Each move, it samples 8 of those configurations, looks 2 moves ahead under each, and plays the move with the best average score difference.
