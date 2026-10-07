# Model usage TODO

- Pi API-cost weighting as a possible future experiment: recorded
  `cost.total` could provide relative API-price weights, not actual payments
  or proven subscription-quota weights. Missing/zero model prices can make
  those weights unsuitable.
- Records from providers without a billing route (not openai/anthropic/
  neuralwatt) are currently dropped from the report; surface them as a
  usage-only section if that ever matters.
