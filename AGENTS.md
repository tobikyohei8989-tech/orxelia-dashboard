# ORXELIA development and release instructions

## Dashboard publication requires user approval (2026-11-10)

- Develop and verify requested dashboard changes locally or on an isolated branch. Present the concrete changes, preview or screenshots, validation results, target URL, and expected Netlify production deployment credit usage before requesting publication approval.
- Do not publish dashboard UI, behavior, or production configuration changes without the user's explicit approval of that release. A request to develop or fix something is not publication approval. Approval for a previous release does not cover a new release.
- Do not merge or push dashboard changes to a production-connected branch, trigger a production deployment, or apply production database changes that alter dashboard behavior before that approval. Save unapproved implementation work on a development branch.
- Keep Netlify automatic builds stopped under the existing manual-release operation. Use `[skip netlify]` for repository-only operational updates. Do not enable automatic production publishing without explicit user authorization.
- Batch approved dashboard changes into one release where practical. Do not perform a production deployment to test a change.
- Existing authorized research, private prototype generation and ordinary dashboard data operations may continue. They do not authorize dashboard code publication. Apply the prototype submission standards in `docs/ai-collaboration-policy.md`.
