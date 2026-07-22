-- Switch the default accent from red to the app's green, and move any
-- restaurant still sitting on the old red default over to green. Restaurants
-- that picked their own color are left untouched.

ALTER TABLE "Restaurant" ALTER COLUMN "accentColor" SET DEFAULT '#3ddc84';

UPDATE "Restaurant"
SET "accentColor" = '#3ddc84'
WHERE "accentColor" = '#E63946';
