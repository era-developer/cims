const { CLASSIFICATIONS, LEGACY_CLASSIFICATION } = require('./classifications');

const ABBR_BY_NAME = new Map(
  [...CLASSIFICATIONS, LEGACY_CLASSIFICATION].map(c => [c.name, c.abbr])
);

function classificationAbbr(classificationName) {
  return ABBR_BY_NAME.get(classificationName) || 'MISC';
}

// Returns a function that hands out sequential asset tags for a given
// (center, classification) pair, seeded from the current max in the DB so
// tags never collide with ones already issued (legacy or otherwise).
//
// If the catalog item has a curated tagCode (e.g. "ARDU"), tags instead read
// <CENTER>/<CLASS>/<TAGCODE>-<SEQ> (seq counted per catalog item, e.g.
// JPN/ELEC/ARDU-01, -02, ...) -- readable on physical labels. Without one,
// falls back to the original <CENTER>-<CLASS>-<SEQ> scheme unchanged.
function createAssetTagGenerator(db) {
  const nextSeqByKey = new Map();

  function nextSeq(key, countQuery, ...params) {
    if (!nextSeqByKey.has(key)) {
      const row = db.prepare(countQuery).get(...params);
      nextSeqByKey.set(key, (row?.c || 0) + 1);
    }
    const seq = nextSeqByKey.get(key);
    nextSeqByKey.set(key, seq + 1);
    return seq;
  }

  return function nextAssetTag(centerCode, centerId, classificationId, classificationName, catalogId, tagCode) {
    const abbr = classificationAbbr(classificationName);
    const trimmedTagCode = String(tagCode || '').trim().toUpperCase();

    if (trimmedTagCode && catalogId) {
      const seq = nextSeq(`catalog::${catalogId}`,
        'SELECT COUNT(*) AS c FROM assets WHERE catalog_id = ?', catalogId);
      return `${centerCode}/${abbr}/${trimmedTagCode}-${String(seq).padStart(2, '0')}`;
    }

    const seq = nextSeq(`${centerId}::${classificationId}`,
      'SELECT COUNT(*) AS c FROM assets WHERE center_id = ? AND classification_id = ?', centerId, classificationId);
    return `${centerCode}-${abbr}-${String(seq).padStart(5, '0')}`;
  };
}

module.exports = { classificationAbbr, createAssetTagGenerator };
