-- ChogSweeper v2 adds declineSwap (TradeDeclined). Widen the status / kind checks.
ALTER TABLE swap_events DROP CONSTRAINT swap_events_kind_check;
ALTER TABLE swap_events ADD CONSTRAINT swap_events_kind_check CHECK (kind IN ('created', 'accepted', 'cancelled', 'declined'));

ALTER TABLE swaps DROP CONSTRAINT swaps_status_check;
ALTER TABLE swaps ADD CONSTRAINT swaps_status_check CHECK (status IN ('open', 'accepted', 'cancelled', 'declined'));

-- Fee paid by the taker on acceptance (from TradeAccepted), kept for revenue reporting.
ALTER TABLE swaps ADD COLUMN fee_paid NUMERIC(78, 0);
