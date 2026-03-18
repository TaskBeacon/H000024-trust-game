export interface PartnerProfile {
  label: string;
  return_ratio: number;
}

export interface PlannedTrustCondition {
  condition: string;
  partner_label: string;
  return_ratio: number;
  condition_id: string;
  trial_index: number;
}

export interface TrustOutcomeRecord {
  condition: string;
  partner_label: string;
  return_ratio: number;
  block_idx: number;
  trial_index: number;
  trusted: boolean;
  timed_out: boolean;
  endowment: number;
  invested: number;
  multiplied_amount: number;
  returned: number;
  earned: number;
  total_earned: number;
}

function makeSeededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function uniform(rng: () => number, low: number, high: number): number {
  return low + (high - low) * rng();
}

function shuffleInPlace<T>(values: T[], rng: () => number): void {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
  }
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.33;
  }
  return Math.max(0, Math.min(1, value));
}

export class Controller {
  readonly endowment: number;
  readonly transfer_multiplier: number;
  readonly return_noise_ratio: number;
  readonly seed: number;
  readonly enable_logging: boolean;

  private readonly rng: () => number;
  private readonly profiles: Record<string, PartnerProfile>;
  private history: TrustOutcomeRecord[] = [];
  total_earned = 0;

  constructor(args: {
    partner_profiles: Record<string, Partial<PartnerProfile>>;
    endowment?: number;
    transfer_multiplier?: number;
    return_noise_ratio?: number;
    seed?: number;
    enable_logging?: boolean;
  }) {
    this.endowment = Number(args.endowment ?? 10);
    this.transfer_multiplier = Number(args.transfer_multiplier ?? 3.0);
    this.return_noise_ratio = Math.max(0, Number(args.return_noise_ratio ?? 0));
    this.seed = Number(args.seed ?? 24024);
    this.enable_logging = args.enable_logging !== false;
    this.rng = makeSeededRandom(this.seed);
    this.profiles = this.build_profiles(args.partner_profiles);
  }

  static from_dict(config: Record<string, unknown>): Controller {
    const raw = config.partner_profiles;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("controller.partner_profiles must be a non-empty mapping");
    }
    return new Controller({
      partner_profiles: raw as Record<string, Partial<PartnerProfile>>,
      endowment: Number(config.endowment ?? 10),
      transfer_multiplier: Number(config.transfer_multiplier ?? 3.0),
      return_noise_ratio: Number(config.return_noise_ratio ?? 0),
      seed: Number(config.seed ?? 24024),
      enable_logging: Boolean(config.enable_logging ?? true)
    });
  }

  private build_profiles(raw: Record<string, Partial<PartnerProfile>>): Record<string, PartnerProfile> {
    const profiles: Record<string, PartnerProfile> = {};
    for (const [key, value] of Object.entries(raw ?? {})) {
      profiles[String(key)] = {
        label: String(value.label ?? key),
        return_ratio: clampRatio(Number(value.return_ratio ?? 0.33))
      };
    }
    if (Object.keys(profiles).length === 0) {
      throw new Error("controller.partner_profiles must be a non-empty mapping");
    }
    return profiles;
  }

  get_profile(condition: string): PartnerProfile {
    const key = String(condition);
    const profile = this.profiles[key];
    if (!profile) {
      throw new Error(`Unknown condition: ${key}`);
    }
    return profile;
  }

  prepare_block(args: { block_idx: number; n_trials: number; conditions: string[] }): string[] {
    const nTrials = Math.max(0, Math.trunc(args.n_trials));
    if (nTrials <= 0) {
      return [];
    }
    const validConditions = (Array.isArray(args.conditions) ? args.conditions : [])
      .map(String)
      .filter((condition) => this.profiles[condition] != null);
    if (validConditions.length === 0) {
      throw new Error("No valid trust-game conditions available");
    }

    const scheduled: string[] = [];
    for (let index = 0; index < nTrials; index += 1) {
      scheduled.push(validConditions[index % validConditions.length]);
    }
    shuffleInPlace(scheduled, this.rng);

    const planned: PlannedTrustCondition[] = [];
    scheduled.forEach((condition, index) => {
      const trialIndex = index + 1;
      const profile = this.get_profile(condition);
      const conditionId = `${condition}_r${String(Math.round(profile.return_ratio * 100)).padStart(
        2,
        "0"
      )}_t${String(trialIndex).padStart(3, "0")}`;
      planned.push({
        condition,
        partner_label: profile.label,
        return_ratio: profile.return_ratio,
        condition_id: conditionId,
        trial_index: trialIndex
      });
    });

    return planned.map((item) => JSON.stringify(item));
  }

  private sample_return(multiplied_amount: number, ratio: number): number {
    if (multiplied_amount <= 0) {
      return 0;
    }
    let expected = multiplied_amount * ratio;
    if (this.return_noise_ratio > 0) {
      const noiseSpan = multiplied_amount * this.return_noise_ratio;
      expected += uniform(this.rng, -noiseSpan, noiseSpan);
    }
    const rounded = Math.round(expected);
    return Math.max(0, Math.min(multiplied_amount, rounded));
  }

  resolve_outcome(args: {
    condition: string;
    block_idx: number;
    trial_index: number;
    trusted: boolean;
    timed_out: boolean;
  }): TrustOutcomeRecord {
    const profile = this.get_profile(args.condition);
    const invested = args.trusted ? this.endowment : 0;
    const multipliedAmount = Math.round(invested * this.transfer_multiplier);
    const returned = this.sample_return(multipliedAmount, profile.return_ratio);
    const earned = this.endowment - invested + returned;
    this.total_earned += earned;

    const record: TrustOutcomeRecord = {
      condition: String(args.condition),
      partner_label: profile.label,
      return_ratio: profile.return_ratio,
      block_idx: Number(args.block_idx),
      trial_index: Number(args.trial_index),
      trusted: Boolean(args.trusted),
      timed_out: Boolean(args.timed_out),
      endowment: this.endowment,
      invested,
      multiplied_amount: multipliedAmount,
      returned,
      earned,
      total_earned: this.total_earned
    };
    this.history.push(record);
    return record;
  }

  get histories(): Record<string, TrustOutcomeRecord[]> {
    const grouped: Record<string, TrustOutcomeRecord[]> = {};
    for (const item of this.history) {
      if (!grouped[item.condition]) {
        grouped[item.condition] = [];
      }
      grouped[item.condition].push(item);
    }
    return grouped;
  }
}
