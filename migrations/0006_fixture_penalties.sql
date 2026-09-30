-- Shootout scores on fixtures.
--
-- A knockout tie decided on penalties has a level scoreline, so goals alone
-- cannot say who went through. The 2022 World Cup final finished 3-3 and was
-- won 4-2 on penalties; without these columns a "who won the final" question
-- either finds no winner or, if it compares goals loosely, names the wrong team.
--
-- Nullable because the overwhelming majority of fixtures never reach a shootout,
-- and NULL is the honest value for "there wasn't one".

ALTER TABLE fixtures ADD COLUMN home_penalties INTEGER;
ALTER TABLE fixtures ADD COLUMN away_penalties INTEGER;

-- Finals and knockout rounds are looked up by (competition, season, round), and
-- the winner generators scan for a single round within one season.
CREATE INDEX IF NOT EXISTS idx_fixtures_competition_season_round
  ON fixtures (competition_id, season, round);
