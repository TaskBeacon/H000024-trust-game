import {
  StimBank,
  SubInfo,
  TaskSettings,
  TrialBuilder,
  count_down,
  mountTaskApp,
  next_trial_id,
  parsePsyflowConfig,
  reset_trial_counter,
  type CompiledTrial,
  type Resolvable,
  type RuntimeView,
  type StimRef,
  type StimSpec,
  type TrialSnapshot
} from "psyflow-web";

import configText from "./config/config.yaml?raw";
import { Controller } from "./src/controller";
import { run_trial } from "./src/run_trial";
import { summarizeBlock, summarizeOverall } from "./src/utils";

function buildWaitTrial(
  meta: { trial_id: string; condition: string; trial_index: number },
  blockId: string | null,
  unitLabel: string,
  stimInputs: Array<Resolvable<StimRef | StimSpec | null>>
): CompiledTrial {
  const trial = new TrialBuilder({
    trial_id: meta.trial_id,
    block_id: blockId,
    trial_index: meta.trial_index,
    condition: meta.condition
  });
  trial.unit(unitLabel).addStim(...stimInputs).waitAndContinue();
  return trial.build();
}

export async function run(root: HTMLElement): Promise<void> {
  const parsed = parsePsyflowConfig(configText, import.meta.url);
  const settings = TaskSettings.from_dict(parsed.task_config);
  const subInfo = new SubInfo(parsed.subform_config);
  const stimBank = new StimBank(parsed.stim_config);
  const controller = Controller.from_dict(parsed.controller_config);

  settings.triggers = parsed.trigger_config;
  settings.controller = parsed.controller_config;

  await mountTaskApp({
    root,
    task_id: "H000024-trust-game",
    task_name: "Trust Game",
    task_description: "HTML preview aligned to local psyflow Trust Game procedure and parameters.",
    settings,
    subInfo,
    stimBank,
    buildTrials: (): CompiledTrial[] => {
      reset_trial_counter();
      const compiledTrials: CompiledTrial[] = [];
      const trialPerBlock = Math.max(1, Number(settings.trial_per_block ?? settings.trials_per_block ?? 1));
      const totalBlocks = Math.max(1, Number(settings.total_blocks ?? 1));
      const conditions = (Array.isArray(settings.conditions)
        ? settings.conditions
        : ["high_trust", "medium_trust", "low_trust"]
      ).map(String);

      compiledTrials.push(
        buildWaitTrial(
          { trial_id: "instruction", condition: "instruction", trial_index: -1 },
          null,
          "instruction_text",
          [stimBank.get("instruction_text")]
        )
      );

      for (let blockIndex = 0; blockIndex < totalBlocks; blockIndex += 1) {
        const blockId = `block_${blockIndex}`;
        compiledTrials.push(
          ...count_down({
            seconds: 3,
            block_id: blockId,
            trial_id_prefix: `countdown_${blockId}`,
            stim: { color: "black", height: 3.5 }
          })
        );

        const plannedConditions = controller.prepare_block({
          block_idx: blockIndex,
          n_trials: trialPerBlock,
          conditions
        });

        plannedConditions.forEach((condition, trialIndex) => {
          const trial = new TrialBuilder({
            trial_id: next_trial_id(),
            block_id: blockId,
            trial_index: trialIndex,
            condition: "trust"
          });
          run_trial(trial, condition, {
            settings,
            stimBank,
            controller,
            block_id: blockId,
            block_idx: blockIndex
          });
          compiledTrials.push(trial.build());
        });

        compiledTrials.push(
          buildWaitTrial(
            {
              trial_id: `block_break_${blockIndex}`,
              condition: "block_break",
              trial_index: plannedConditions.length + blockIndex
            },
            blockId,
            "block_break",
            [
              (_snapshot: TrialSnapshot, runtime: RuntimeView) => {
                const summary = summarizeBlock(runtime.getReducedRows(), blockId);
                return stimBank.get_and_format("block_break", {
                  block_num: blockIndex + 1,
                  total_blocks: settings.total_blocks,
                  trust_rate: summary.trust_rate,
                  block_earned: summary.block_earned,
                  total_earned: summary.total_earned
                });
              }
            ]
          )
        );
      }

      compiledTrials.push(
        buildWaitTrial(
          {
            trial_id: "goodbye",
            condition: "goodbye",
            trial_index: Number(settings.total_trials ?? 0)
          },
          null,
          "goodbye",
          [
            (_snapshot: TrialSnapshot, runtime: RuntimeView) => {
              const summary = summarizeOverall(runtime.getReducedRows());
              return stimBank.get_and_format("good_bye", {
                total_earned: summary.total_earned
              });
            }
          ]
        )
      );

      return compiledTrials;
    }
  });
}

export async function main(root: HTMLElement): Promise<void> {
  await run(root);
}

export default main;
