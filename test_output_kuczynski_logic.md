# Test Run: Kuczynski Logic Dissertation
# Date: 2026-01-08
# Input: 488 words from philosophical theses
# Target: ~2000 word expansion

## Pipeline Results Summary
- Original: 488 words
- Reconstruction (Stage 1): 3,093 words
- Objections (Stage 2): 8,333 words
- Responses (Stage 3): 11,409 words
- Bulletproof (Stage 4): 5,345 words
- Status: completed_with_warnings

## Timing
- Stage 1: 12:31:01 - 12:32:52 (1m 51s)
- Stage 2: 12:32:52 - 12:38:30 (5m 38s)
- Stage 3: 12:38:31 - 12:45:02 (6m 31s)
- Stage 4: 12:45:04 - 12:48:12 (3m 8s)
- Total: ~17 minutes

## LLM Calls Audit Log (14 calls)

| ID | Stage | Model | Latency | Input Tokens | Output Tokens | Summary |
|----|-------|-------|---------|--------------|---------------|---------|
| 1 | pipeline_stage1 | claude-sonnet-4-20250514 | 17.0s | 830 | 1,018 | Extract document skeleton |
| 2 | pipeline_stage1 | claude-sonnet-4-20250514 | 93.1s | 2,024 | 4,073 | Reconstruct document |
| 3 | pipeline_stage2 | claude-sonnet-4-20250514 | 38.6s | 5,447 | 2,187 | Identify 25 claims |
| 4 | pipeline_stage2 | claude-sonnet-4-20250514 | 60.8s | 1,037 | 2,327 | Generate objections 1/5 |
| 5 | pipeline_stage2 | claude-sonnet-4-20250514 | 70.4s | 1,046 | 2,819 | Generate objections 2/5 |
| 6 | pipeline_stage2 | claude-sonnet-4-20250514 | 56.6s | 1,051 | 2,386 | Generate objections 3/5 |
| 7 | pipeline_stage2 | claude-sonnet-4-20250514 | 53.9s | 1,064 | 2,191 | Generate objections 4/5 |
| 8 | pipeline_stage2 | claude-sonnet-4-20250514 | 55.0s | 1,063 | 2,345 | Generate objections 5/5 |
| 9 | pipeline_stage3 | claude-sonnet-4-20250514 | 87.9s | 2,511 | 3,222 | Enhance responses 1/5 |
| 10 | pipeline_stage3 | claude-sonnet-4-20250514 | 81.0s | 2,843 | 3,246 | Enhance responses 2/5 |
| 11 | pipeline_stage3 | claude-sonnet-4-20250514 | 75.1s | 2,671 | 2,981 | Enhance responses 3/5 |
| 12 | pipeline_stage3 | claude-sonnet-4-20250514 | 78.0s | 2,330 | 3,038 | Enhance responses 4/5 |
| 13 | pipeline_stage3 | claude-sonnet-4-20250514 | 66.0s | 2,469 | 2,524 | Enhance responses 5/5 |
| 14 | pipeline_stage4 | claude-sonnet-4-20250514 | 187.1s | 5,558 | 6,889 | Generate bullet-proof |

## Token Totals
- Total Input Tokens: 29,944
- Total Output Tokens: 41,246
- Total Latency: ~1,021 seconds (~17 minutes)

## 25 Objections Generated
Types: empirical, methodological, conceptual, practical, logical
Severities: serious, moderate, minor

## Horizontal Coherence Check
- Violations detected: 35 (11 errors, 24 warnings)
- Terminology drifts: 1
- Commitments missing: 11
- Responses not integrated: 23
