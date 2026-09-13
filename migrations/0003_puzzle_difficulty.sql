ALTER TABLE puzzles ADD COLUMN difficulty TEXT NOT NULL DEFAULT 'current'
  CHECK (difficulty IN ('current', 'difficult'));
