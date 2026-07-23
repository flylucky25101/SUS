# Rift Forge Balance Report

Generated from the headless 60 Hz combat core. This report is empirical AI-policy telemetry, not a claim of solved human balance.

## Run summary

- Seeds: 101 through 39903942 (seed = 101 + gameIndex × 7919)
- Matches: 5040
- Average bout: 40.5 seconds (2428 ticks)
- Average ringouts: 4.42
- Timeout rate: 0.0%
- Draw rate: 0.0%
- Starting-side win rate: 49.7%
- Automated anomaly gate: PASS

## Matchups

| Matchup | Games | First fighter win | P1-side win | Draws |
| --- | ---: | ---: | ---: | ---: |
| kade vs kade | 240 | 46.7% | 46.7% | 0 |
| kade vs mira | 240 | 47.5% | 46.7% | 0 |
| kade vs bram | 240 | 48.8% | 52.1% | 0 |
| kade vs suri | 240 | 50.8% | 47.5% | 0 |
| kade vs juno | 240 | 44.6% | 51.2% | 0 |
| kade vs orin | 240 | 46.7% | 47.5% | 0 |
| mira vs mira | 240 | 51.7% | 51.7% | 0 |
| mira vs bram | 240 | 59.2% | 53.3% | 0 |
| mira vs suri | 240 | 42.9% | 51.2% | 0 |
| mira vs juno | 240 | 47.1% | 45.4% | 0 |
| mira vs orin | 240 | 52.1% | 49.6% | 0 |
| bram vs bram | 240 | 50.0% | 50.0% | 0 |
| bram vs suri | 240 | 44.6% | 44.6% | 0 |
| bram vs juno | 240 | 38.3% | 50.0% | 0 |
| bram vs orin | 240 | 50.4% | 50.4% | 0 |
| suri vs suri | 240 | 52.5% | 52.5% | 0 |
| suri vs juno | 240 | 61.3% | 51.2% | 0 |
| suri vs orin | 240 | 45.4% | 49.6% | 0 |
| juno vs juno | 240 | 57.5% | 57.5% | 0 |
| juno vs orin | 240 | 57.1% | 52.9% | 0 |
| orin vs orin | 240 | 42.1% | 42.1% | 0 |

## Character totals

Mirror matches are excluded from overall win rates.

| Fighter | Games | Win rate | Avg damage dealt | Recovery success |
| --- | ---: | ---: | ---: | ---: |
| kade | 1200 | 47.7% | 77.8 | 27.5% |
| mira | 1200 | 50.7% | 100.5 | 30.8% |
| bram | 1200 | 45.1% | 110.1 | 31.0% |
| suri | 1200 | 53.7% | 73.0 | 18.3% |
| juno | 1200 | 53.2% | 86.7 | 26.4% |
| orin | 1200 | 49.7% | 103.3 | 26.1% |

## Highest-use moves

| Move | Uses | Accuracy | Global share |
| --- | ---: | ---: | ---: |
| suri.neutral-special | 30572 | 23.8% | 7.9% |
| mira.air-normal | 17792 | 36.1% | 4.6% |
| juno.air-normal | 16855 | 36.1% | 4.4% |
| suri.side-special | 16552 | 23.2% | 4.3% |
| orin.side-special | 15194 | 26.4% | 3.9% |
| mira.side-special | 13986 | 28.4% | 3.6% |
| bram.air-normal | 13861 | 6.0% | 3.6% |
| kade.air-normal | 13842 | 17.9% | 3.6% |
| kade.side-special | 13277 | 22.7% | 3.4% |
| mira.side-normal | 13155 | 63.8% | 3.4% |
| kade.down-special | 13135 | 17.4% | 3.4% |
| juno.side-special | 12635 | 24.7% | 3.3% |

## Detected anomalies

- None crossed the hard anomaly thresholds.

## Directional warnings

- kade recovery success 27.5%
- mira recovery success 30.8%
- bram recovery success 31.0%
- suri recovery success 18.3%
- juno recovery success 26.4%
- orin recovery success 26.1%
- target edge mira>suri measured 42.9%
- target edge bram>mira measured 40.8%

## Adjustments and comparison

- Combat values remain centralized in character move data and the shared physics configuration.
- Suri's Prism Orbit uses a 70-frame cooldown so its long-range identity remains intact without continuous projectile cycling.
- The six-fighter anomaly gate allows designed archetype edges up to 62/38 while keeping overall fighter rates inside 56/44; the wider overall band absorbs deterministic small-sample variance while the 5,040-match report remains the tuning baseline.
- This generated run is the current baseline; future tuning should change one or two related values, rerun unit tests, and compare this table.
- No result weighting, forced winner, matchup modifier, or side-specific stat adjustment is used.

## Remaining risks

- AI-versus-AI results include policy and reaction-model bias and are not proof of human matchup balance.
- The simulator uses the competitive stage with hazards disabled and fixed hard-difficulty policy parameters.
- Human mix-ups, touch execution variance, and device frame pacing require separate playtesting.
