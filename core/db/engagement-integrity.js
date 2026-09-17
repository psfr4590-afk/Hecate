'use strict';

// Existing module tables cannot safely be rebuilt in every deployment because
// they may contain operational data. These triggers provide the same lifecycle
// guarantee: module rows must reference a real engagement, and deleting an
// engagement removes its module-owned rows. This is additive and secret-agnostic.

const SAFE = /^[A-Za-z_][A-Za-z0-9_]*$/;
function install(db, tables) {
  for (const table of tables) {
    if (!SAFE.test(table)) throw new Error(`Invalid table name: ${table}`);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS ${table}_engagement_insert_guard
      BEFORE INSERT ON ${table}
      WHEN NEW.engagement_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM engagements WHERE id=NEW.engagement_id)
      BEGIN SELECT RAISE(ABORT, 'invalid engagement_id'); END;

      CREATE TRIGGER IF NOT EXISTS ${table}_engagement_update_guard
      BEFORE UPDATE OF engagement_id ON ${table}
      WHEN NEW.engagement_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM engagements WHERE id=NEW.engagement_id)
      BEGIN SELECT RAISE(ABORT, 'invalid engagement_id'); END;

      CREATE TRIGGER IF NOT EXISTS engagements_delete_${table}
      AFTER DELETE ON engagements
      BEGIN DELETE FROM ${table} WHERE engagement_id=OLD.id; END;
    `);
  }
}
module.exports = { install };
