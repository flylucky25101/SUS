# Rift Forge Balance Report

Generated from the headless 60 Hz combat core. This report is empirical AI-policy telemetry, not a claim of solved human balance.

## Run summary

- Seeds: 101 through 18997782 (seed = 101 + gameIndex × 7919)
- Matches: 2400
- Average bout: 39.5 seconds (2370 ticks)
- Average ringouts: 4.41
- Timeout rate: 0.0%
- Draw rate: 0.0%
- Starting-side win rate: 49.3%
- Automated anomaly gate: PASS

## Matchups

| Matchup | Games | First fighter win | P1-side win | Draws |
| --- | ---: | ---: | ---: | ---: |
| kade vs kade | 240 | 51.2% | 51.2% | 0 |
| kade vs mira | 240 | 47.5% | 45.8% | 0 |
| kade vs bram | 240 | 49.6% | 48.8% | 0 |
| kade vs suri | 240 | 49.6% | 48.8% | 0 |
| mira vs mira | 240 | 54.2% | 54.2% | 0 |
| mira vs bram | 240 | 51.2% | 51.2% | 0 |
| mira vs suri | 240 | 52.5% | 51.7% | 0 |
| bram vs bram | 240 | 48.8% | 48.8% | 0 |
| bram vs suri | 240 | 47.5% | 43.3% | 0 |
| suri vs suri | 240 | 48.8% | 48.8% | 0 |

## Character totals

Mirror matches are excluded from overall win rates.

| Fighter | Games | Win rate | Avg damage dealt | Recovery success |
| --- | ---: | ---: | ---: | ---: |
| kade | 720 | 48.9% | 79.7 | 26.3% |
| mira | 720 | 52.1% | 97.2 | 31.4% |
| bram | 720 | 48.9% | 106.8 | 29.6% |
| suri | 720 | 50.1% | 67.7 | 16.8% |

## Highest-use moves

| Move | Uses | Accuracy | Global share |
| --- | ---: | ---: | ---: |
| suri.neutral-special | 20961 | 23.6% | 11.8% |
| mira.air-normal | 12872 | 35.5% | 7.3% |
| suri.side-special | 12051 | 21.0% | 6.8% |
| kade.side-special | 10372 | 22.5% | 5.9% |
| mira.side-special | 9977 | 26.5% | 5.6% |
| kade.air-normal | 9608 | 17.3% | 5.4% |
| mira.side-normal | 9420 | 62.1% | 5.3% |
| bram.air-normal | 8950 | 5.8% | 5.1% |
| kade.down-special | 8430 | 16.5% | 4.8% |
| kade.side-normal | 8272 | 42.5% | 4.7% |
| bram.side-normal | 7377 | 43.0% | 4.2% |
| bram.side-special | 6340 | 48.0% | 3.6% |

## Detected anomalies

- None crossed the hard anomaly thresholds.

## Directional warnings

- kade recovery success 26.3%
- mira recovery success 31.4%
- bram recovery success 29.6%
- suri recovery success 16.8%
- target edge bram>mira measured 48.8%

## Adjustments and comparison

- Combat values remain centralized in character move data and the shared physics configuration.
- Suri's Prism Orbit uses a 70-frame cooldown so its long-range identity remains intact without continuous projectile cycling.
- This generated run is the current baseline; future tuning should change one or two related values, rerun unit tests, and compare this table.
- No result weighting, forced winner, matchup modifier, or side-specific stat adjustment is used.

## Remaining risks

- AI-versus-AI results include policy and reaction-model bias and are not proof of human matchup balance.
- The simulator uses the competitive stage with hazards disabled and fixed hard-difficulty policy parameters.
- Human mix-ups, touch execution variance, and device frame pacing require separate playtesting.
