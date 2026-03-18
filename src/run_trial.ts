import {
  set_trial_context,
  type StimBank,
  type TaskSettings,
  type TrialBuilder,
  type TrialSnapshot
} from "psyflow-web";

import type { Controller, TrustOutcomeRecord } from "./controller";
import { parse_trust_condition } from "./utils";

function resolveChoiceLabel(response: unknown, trustKey: string, keepKey: string): "invest" | "keep" | "timeout" {
  if (response === trustKey) {
    return "invest";
  }
  if (response === keepKey) {
    return "keep";
  }
  return "timeout";
}

function resolveChoiceState(response: unknown, trustKey: string, keepKey: string): {
  trusted: boolean;
  kept: boolean;
  timed_out: boolean;
  choice_label: "invest" | "keep" | "timeout";
} {
  const choiceLabel = resolveChoiceLabel(response, trustKey, keepKey);
  if (choiceLabel === "invest") {
    return { trusted: true, kept: false, timed_out: false, choice_label: choiceLabel };
  }
  if (choiceLabel === "keep") {
    return { trusted: false, kept: true, timed_out: false, choice_label: choiceLabel };
  }
  return { trusted: false, kept: true, timed_out: true, choice_label: choiceLabel };
}

function resolveOutcomePayload(
  snapshot: TrialSnapshot,
  controller: Controller,
  condition: string,
  blockIdx: number,
  trialIndex: number,
  trustKey: string,
  keepKey: string
): TrustOutcomeRecord {
  const state = resolveChoiceState(snapshot.units.decision?.response, trustKey, keepKey);
  return controller.resolve_outcome({
    condition,
    block_idx: blockIdx,
    trial_index: trialIndex,
    trusted: state.trusted,
    timed_out: state.timed_out
  });
}

export function run_trial(
  trial: TrialBuilder,
  condition: string,
  context: {
    settings: TaskSettings;
    stimBank: StimBank;
    controller: Controller;
    block_id: string;
    block_idx: number;
  }
): TrialBuilder {
  const { settings, stimBank, controller, block_id, block_idx } = context;
  const parsed = parse_trust_condition(condition);
  const keyList = (Array.isArray(settings.key_list) ? settings.key_list : ["f", "j"]).map(String);
  const trustKey = keyList[0] ?? "f";
  const keepKey = keyList[1] ?? "j";
  const triggerMap = (settings.triggers ?? {}) as Record<string, unknown>;

  const partnerCueDuration = Number(settings.partner_cue_duration ?? 0.6);
  const preDecisionFixationDuration = Number(settings.pre_decision_fixation_duration ?? 0.6);
  const decisionDuration = Number(settings.decision_duration ?? 2.0);
  const decisionConfirmationDuration = Number(settings.decision_confirmation_duration ?? 0.5);
  const outcomeFeedbackDuration = Number(settings.outcome_feedback_duration ?? 1.0);
  const itiDuration = Number(settings.iti_duration ?? 0.8);

  const partnerCue = trial
    .unit("partner_cue")
    .addStim(stimBank.get_and_format("partner_cue", { partner_label: parsed.partner_label }));
  set_trial_context(partnerCue, {
    trial_id: trial.trial_id,
    phase: "partner_cue",
    deadline_s: partnerCueDuration,
    valid_keys: [],
    block_id,
    condition_id: parsed.condition_id,
    task_factors: {
      stage: "partner_cue",
      condition: parsed.condition,
      partner_label: parsed.partner_label,
      block_idx
    },
    stim_id: "partner_cue"
  });
  partnerCue.show({ duration: partnerCueDuration }).to_dict();

  const preDecisionFixation = trial.unit("pre_decision_fixation").addStim(stimBank.get("fixation"));
  set_trial_context(preDecisionFixation, {
    trial_id: trial.trial_id,
    phase: "pre_decision_fixation",
    deadline_s: preDecisionFixationDuration,
    valid_keys: [],
    block_id,
    condition_id: parsed.condition_id,
    task_factors: {
      stage: "pre_decision_fixation",
      condition: parsed.condition,
      block_idx
    },
    stim_id: "fixation"
  });
  preDecisionFixation.show({ duration: preDecisionFixationDuration }).to_dict();

  const decision = trial.unit("decision").addStim(
    stimBank.get_and_format("decision_panel", {
      partner_label: parsed.partner_label,
      endowment: controller.endowment
    })
  );
  set_trial_context(decision, {
    trial_id: trial.trial_id,
    phase: "trust_decision",
    deadline_s: decisionDuration,
    valid_keys: [trustKey, keepKey],
    block_id,
    condition_id: parsed.condition_id,
    task_factors: {
      stage: "trust_decision",
      condition: parsed.condition,
      partner_label: parsed.partner_label,
      return_ratio: parsed.return_ratio,
      endowment: controller.endowment,
      transfer_multiplier: controller.transfer_multiplier,
      trust_key: trustKey,
      keep_key: keepKey,
      block_idx
    },
    stim_id: "decision_panel"
  });
  decision
    .captureResponse({
      keys: [trustKey, keepKey],
      correct_keys: [trustKey, keepKey],
      duration: decisionDuration,
      response_trigger: Number(triggerMap.decision_response ?? 50),
      timeout_trigger: Number(triggerMap.decision_timeout ?? 51)
    })
    .set_state({
      choice_label: (snapshot: TrialSnapshot) =>
        resolveChoiceState(snapshot.units.decision?.response, trustKey, keepKey).choice_label,
      trusted: (snapshot: TrialSnapshot) => resolveChoiceState(snapshot.units.decision?.response, trustKey, keepKey).trusted,
      kept: (snapshot: TrialSnapshot) => resolveChoiceState(snapshot.units.decision?.response, trustKey, keepKey).kept,
      timed_out: (snapshot: TrialSnapshot) =>
        resolveChoiceState(snapshot.units.decision?.response, trustKey, keepKey).timed_out,
      outcome_payload: (snapshot: TrialSnapshot) =>
        resolveOutcomePayload(
          snapshot,
          controller,
          parsed.condition,
          block_idx,
          parsed.trial_index,
          trustKey,
          keepKey
        )
    })
    .to_dict();

  const decisionConfirmation = trial
    .unit("decision_confirmation")
    .addStim((snapshot: TrialSnapshot) => {
      const choice = String(snapshot.units.decision?.choice_label ?? "timeout");
      if (choice === "invest") {
        return stimBank.get("decision_invest");
      }
      if (choice === "keep") {
        return stimBank.get("decision_keep");
      }
      return stimBank.get("decision_timeout");
    });
  set_trial_context(decisionConfirmation, {
    trial_id: trial.trial_id,
    phase: "decision_confirmation",
    deadline_s: decisionConfirmationDuration,
    valid_keys: [],
    block_id,
    condition_id: parsed.condition_id,
    task_factors: {
      stage: "decision_confirmation",
      condition: parsed.condition,
      block_idx
    },
    stim_id: "decision_confirmation"
  });
  decisionConfirmation.show({ duration: decisionConfirmationDuration }).to_dict();

  const outcomeFeedback = trial
    .unit("outcome_feedback")
    .addStim((snapshot: TrialSnapshot) => {
      const payload = snapshot.units.decision?.outcome_payload as TrustOutcomeRecord | undefined;
      return stimBank.get_and_format("outcome_feedback", {
        partner_label: payload?.partner_label ?? parsed.partner_label,
        invested: payload?.invested ?? 0,
        multiplied_amount: payload?.multiplied_amount ?? 0,
        returned: payload?.returned ?? 0,
        earned: payload?.earned ?? 0,
        total_earned: payload?.total_earned ?? controller.total_earned
      });
    });
  set_trial_context(outcomeFeedback, {
    trial_id: trial.trial_id,
    phase: "outcome_feedback",
    deadline_s: outcomeFeedbackDuration,
    valid_keys: [],
    block_id,
    condition_id: parsed.condition_id,
    task_factors: {
      stage: "outcome_feedback",
      condition: parsed.condition,
      block_idx
    },
    stim_id: "outcome_feedback"
  });
  outcomeFeedback.show({ duration: outcomeFeedbackDuration }).to_dict();

  const iti = trial.unit("iti").addStim(stimBank.get("fixation"));
  set_trial_context(iti, {
    trial_id: trial.trial_id,
    phase: "inter_trial_interval",
    deadline_s: itiDuration,
    valid_keys: [],
    block_id,
    condition_id: parsed.condition_id,
    task_factors: {
      stage: "inter_trial_interval",
      block_idx
    },
    stim_id: "fixation"
  });
  iti.show({ duration: itiDuration }).to_dict();

  trial.finalize((snapshot, _runtime, helpers) => {
    const outcome = snapshot.units.decision?.outcome_payload as TrustOutcomeRecord | undefined;
    const choiceState = resolveChoiceState(snapshot.units.decision?.response, trustKey, keepKey);
    helpers.setTrialState("planned_trial_index", parsed.trial_index);
    helpers.setTrialState("condition", parsed.condition);
    helpers.setTrialState("condition_id", parsed.condition_id);
    helpers.setTrialState("partner_label", parsed.partner_label);
    helpers.setTrialState("return_ratio", parsed.return_ratio);
    helpers.setTrialState("choice_label", choiceState.choice_label);
    helpers.setTrialState("trusted", choiceState.trusted);
    helpers.setTrialState("kept", choiceState.kept);
    helpers.setTrialState("timed_out", choiceState.timed_out);
    helpers.setTrialState("choice_rt", snapshot.units.decision?.rt ?? null);
    helpers.setTrialState("endowment", outcome?.endowment ?? controller.endowment);
    helpers.setTrialState("invested", outcome?.invested ?? 0);
    helpers.setTrialState("multiplied_amount", outcome?.multiplied_amount ?? 0);
    helpers.setTrialState("returned", outcome?.returned ?? 0);
    helpers.setTrialState("earned", outcome?.earned ?? 0);
    helpers.setTrialState("total_earned", outcome?.total_earned ?? controller.total_earned);
    helpers.setTrialState("feedback_delta", outcome?.earned ?? 0);
  });

  return trial;
}
