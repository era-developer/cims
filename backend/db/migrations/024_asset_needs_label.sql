-- Per-unit "print a QR label for this" flag.
--
-- Every physical unit is still an assets row (stock is the count of available
-- units, and orders, transfers and internal use all pin specific units), but
-- bulk consumables -- a reel of resistors, a bag of jumper wires -- are never
-- labelled one by one. The invoice form now asks per line item; units created
-- with the box unticked are left out of the "Print N QR labels now" prompt and
-- of the Labels page's default view. Existing units default to 1 so nothing
-- already labelled disappears from those screens.

ALTER TABLE assets ADD COLUMN needs_label INTEGER NOT NULL DEFAULT 1;
