# Contributing to Selmio

Useful contributions make the plan easier to understand, maintain or verify. Small fixes, accessibility improvements, import examples and documentation are welcome. For a substantial change, describe the problem and proposed behavior before starting a large implementation.

Use synthetic financial data in issues, fixtures, screenshots and pull requests. Never commit real statements, account identifiers, bank access tokens, credentials or personal transaction history. See [SECURITY.md](SECURITY.md) for reporting a vulnerability.

## Local workflow

From the app directory, install dependencies using the package manager and lockfile in the repository, then run:

```sh
npm run dev
```

Before submitting a change, run the applicable checks:

```sh
npm run lint
npm run build
```

Run the financial-engine tests when changing calculations, and include a focused regression case for a corrected financial error. Explain any check you could not run. Do not add live bank or model calls to an automated test.

## Financial behavior

- Keep money arithmetic explicit; use integer minor units and declared currency assumptions.
- Distinguish a transaction, a future commitment, a savings allocation and a transfer.
- Preserve source records and make normalization and matching decisions inspectable.
- Cover the relevant edge cases: duplicates, pending replacements, refunds, card payments, late income, date boundaries and insufficient funds.
- Label estimates and missing inputs. Do not turn an unknown value into zero or imply a calibrated confidence level without evidence.
- Keep authoritative calculations independent of generated prose. AI proposals should become reviewable structured edits.

## Pull requests

Describe the user-visible problem, the resulting behavior and the checks performed. Include screenshots for interface changes and a small synthetic example for calculation changes. Keep unrelated refactors separate. Follow [the brand guide](docs/BRAND.md) for copy and visual changes, and update documentation when behavior changes.

By contributing, you agree that your contribution may be distributed under the repository's [MIT License](LICENSE). Include required attribution and license notices for third-party material.
