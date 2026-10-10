import { FEED_KINDS, MEDIA_FILTERS, type ListRule } from "../storage/types.js";

/** A rule the caller sent that cannot be stored; the message says which part. */
export class InvalidListRule extends Error {}

const MAX_RULE_FEEDS = 100;
const MAX_RULE_TEXT = 60;
const MAX_RULE_AGE_DAYS = 3650;
const RULE_ORDERS = ["newest", "oldest"] as const;

/**
 * Validate a dynamic list's rule at the trust boundary (HTTP body or MCP tool
 * arguments). Unknown keys are refused: a misspelled filter would otherwise
 * be dropped and the list would silently match far more than intended.
 */
export function parseListRule(raw: unknown, feedExists: (id: string) => boolean): ListRule {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new InvalidListRule("rule must be an object");
  const rule: ListRule = {};
  const text = (key: string, value: unknown): string => {
    if (typeof value !== "string" || !value.trim() || value.length > MAX_RULE_TEXT) {
      throw new InvalidListRule(`${key} must be a non-empty string of at most ${MAX_RULE_TEXT} characters`);
    }
    return value.trim();
  };
  const choice = <T extends string>(key: string, value: unknown, allowed: readonly T[]): T => {
    if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
      throw new InvalidListRule(`${key} must be one of ${allowed.join(", ")}`);
    }
    return value as T;
  };
  for (const [key, value] of Object.entries(raw)) {
    switch (key) {
      case "feedIds":
        if (!Array.isArray(value) || value.length === 0 || value.length > MAX_RULE_FEEDS || !value.every((id) => typeof id === "string")) {
          throw new InvalidListRule(`feedIds must be 1 to ${MAX_RULE_FEEDS} feed ids`);
        }
        for (const id of value as string[]) if (!feedExists(id)) throw new InvalidListRule(`feedIds names an unknown feed: ${id}`);
        rule.feedIds = [...new Set(value as string[])];
        break;
      case "feedCategory": rule.feedCategory = text(key, value); break;
      case "feedKind": rule.feedKind = choice(key, value, FEED_KINDS); break;
      case "category": rule.category = text(key, value); break;
      case "media": rule.media = choice(key, value, MEDIA_FILTERS); break;
      case "order": rule.order = choice(key, value, RULE_ORDERS); break;
      case "unreadOnly":
        if (typeof value !== "boolean") throw new InvalidListRule("unreadOnly must be true or false");
        rule.unreadOnly = value;
        break;
      case "maxAgeDays":
        if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_RULE_AGE_DAYS) {
          throw new InvalidListRule(`maxAgeDays must be a whole number from 1 to ${MAX_RULE_AGE_DAYS}`);
        }
        rule.maxAgeDays = value;
        break;
      default:
        throw new InvalidListRule(`unknown rule field: ${key}`);
    }
  }
  return rule;
}
