CREATE TRIGGER assets_membership_insert
BEFORE INSERT ON assets
WHEN (NEW.project_id IS NULL) != (NEW.sort_order IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'asset project membership fields must both be null or set');
END;

CREATE TRIGGER assets_membership_update
BEFORE UPDATE OF project_id, sort_order ON assets
WHEN (NEW.project_id IS NULL) != (NEW.sort_order IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'asset project membership fields must both be null or set');
END;
