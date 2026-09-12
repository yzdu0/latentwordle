CREATE TABLE IF NOT EXISTS game_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id TEXT NOT NULL UNIQUE,
  game_kind TEXT NOT NULL CHECK (game_kind IN ('daily', 'random')),
  game_key TEXT NOT NULL,
  score INTEGER NOT NULL,
  rounds INTEGER NOT NULL,
  solved_rounds INTEGER NOT NULL,
  total_turns INTEGER NOT NULL,
  completed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS game_scores_game_key_idx ON game_scores (game_key);
