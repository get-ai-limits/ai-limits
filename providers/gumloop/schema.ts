import { z } from "zod";

// Only the fields AI Limits reads. Everything else in these responses
// (organization settings, billing ids, member details) is ignored.

export const gumloopProjectListSchema = z.array(
  z.object({ organization_id: z.string().trim().min(1).nullish() }).passthrough(),
);

export const gumloopCreditsSchema = z.object({
  remaining: z.number().finite(),
});

const unixSeconds = z.number().finite().positive();

export const gumloopSubscriptionSchema = z.object({
  allotment: z.number().finite().nullish(),
  current_period_start: unixSeconds.nullish(),
  current_period_end: unixSeconds.nullish(),
  next_reset: z
    .object({
      allotment: z.number().finite().nullish(),
      at: unixSeconds.nullish(),
    })
    .nullish(),
  tier: z.string().nullish(),
});

export type GumloopSubscription = z.infer<typeof gumloopSubscriptionSchema>;
