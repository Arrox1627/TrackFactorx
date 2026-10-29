# Data

`sample_1min.csv`: a made-up but realistic trading day for the fictional ticker `DEMO`. `scripts/generate-sample.mjs`
generates it with a fixed seed, so it's reproducible. This is the default chart in the reel.

`MSFT_2016-04-22_1min.csv`: Microsoft (MSFT) 1-minute OHLCV bars for **Friday, April 22, 2016**, the regular session.
Times are US/Eastern.

- Source: the MSFT intraday sample dataset that ships with
  [react-stockcharts](https://github.com/rrag/react-stockcharts) (`docs/data/MSFT_INTRA_DAY.tsv`, MIT licensed).
  This file keeps only the April 22 session and converts the epoch timestamps to Eastern time.
- The last row (16:00) is the closing-auction print. `scripts/build-data.mjs` leaves it out, so the chart and VWAP
  cover 09:30–15:59.
- Why this day: MSFT gapped down after earnings, traded below VWAP until 10:55, then held above it and bounced off it
  at 12:45 and 13:30. That gives the reel a clear "below", "above" and "bounce" example.
