# Selmio roadmap

Selmio starts as a useful personal tool. A broader product should follow evidence that people can maintain a more accurate plan with less effort. This is a direction of work, not a delivery schedule.

## First milestone: a local browser workspace

The first milestone focuses on importing or entering financial records, reviewing commitments, and exploring how a proposed purchase affects a dated spending plan. Sample data should make the experience understandable before anyone imports real records.

Workspace persistence is in the browser. It is **not encrypted by Selmio**, and is not a secure vault or an automatic backup. Clearing browser storage can remove the workspace. Explicit export and restore are necessary parts of a usable local workflow.

Uncertain inputs use a finite set of independently bounded amounts and dates. Results are conditional on those inputs and the commitments entered. This does not model every possible household outcome, establish a calibrated probability, or implement a new research algorithm. Do not describe it as a guarantee or a patentable invention.

An optional Plaid connection requires a server and environment configuration. Provider credentials and access tokens belong on the server, outside the browser bundle and version control. A bank connection still requires freshness checks and reconciliation; a successful sync does not establish complete data.

## Next: make the plan dependable

- Improve import mapping, duplicate detection and pending-to-posted matching.
- Keep transfers, refunds, card purchases and card payments from being counted twice.
- Show source freshness, reconciliation gaps and assumptions beside relevant decisions.
- Make edits reversible and exports complete enough to restore a workspace.
- Check the planning engine against dated, reproducible examples with late pay, variable bills and overlapping commitments.

The release gate is correctness and recoverability. A polished interface does not substitute for either.

## Then: reduce the work of keeping up

- Remember approved categorization and commitment rules as inspectable, editable data.
- Prioritize review items that could materially change a spending decision.
- Offer clear alternatives when a purchase does not fit the entered plan.
- Measure review time, corrections and whether explanations help people catch omissions.

AI assistance may propose structured edits and explain calculated results. The planning engine must remain usable and testable without an AI provider. Personal financial data must not be sent to a model without an explicit, understandable choice.

## Before broader distribution

Evaluate encrypted storage, backup recovery, accessibility, signed desktop packaging, credential handling, provider costs and a private vulnerability-reporting channel. Any sync or household feature needs an explicit conflict and permission model. Choose these from demonstrated needs rather than adding them to the first release by default.

Evidence for a broader product should include repeat use, fewer material planning errors, manageable maintenance time and willingness to pay. Revisit the roadmap using those observations.
