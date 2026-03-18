# H000024 Trust Game

HTML/browser preview of the investor-side Trust Game built with `psyflow-web`.
Partner-condition scheduling (`high/medium/low trust`), invest/keep/timeout decision logic, and cumulative earnings are aligned to local `T000024-trust-game`, with shorter block count for preview.

## Layout

- `main.ts`: task orchestration
- `config/config.yaml`: declarative config
- `src/controller.ts`: partner scheduler and payoff tracker
- `src/run_trial.ts`: trial logic
- `src/utils.ts`: condition parsing and summary helpers

## Run

From `e:\xhmhc\TaskBeacon\psyflow-web`:

```powershell
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:4173/?task=H000024-trust-game
```
